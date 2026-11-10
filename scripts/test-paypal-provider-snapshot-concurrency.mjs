import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { extractPostgresSqlState, formatPaypalConcurrencyDiagnostic } from './paypal-concurrency-diagnostics.mjs';

const projectId = '00000000-0000-4000-8000-000000000900';
const invoiceId = '00000000-0000-4000-8000-000000009340';
const olderEventId = '00000000-0000-4000-8000-000000009341';
const olderLeaseToken = '00000000-0000-4000-8000-000000009342';
const newerEventId = '00000000-0000-4000-8000-000000009343';
const newerLeaseToken = '00000000-0000-4000-8000-000000009344';
const olderApplicationName = 'proofpay_snapshot_older';
const newerApplicationName = 'proofpay_snapshot_newer';
const safeSignals = new Set(['SIGABRT', 'SIGINT', 'SIGKILL', 'SIGSEGV', 'SIGTERM']);
const safeSpawnCodes = new Set(['EACCES', 'EINVAL', 'ENOENT', 'ENOTDIR', 'ETIMEDOUT']);

const state = {
  phase: 'environment',
  databaseSetupStarted: false,
  sessionsStarted: { older: false, newer: false },
  finalIntegrityReached: false,
  assertionId: null,
  sqlState: null,
  databaseCommand: null,
};
const activeSessions = new Set();

class ConcurrencyFailure extends Error {
  constructor(category, phase, assertionId = null, sqlState = null) {
    super('Concurrency validation failed');
    this.category = category;
    this.phase = phase;
    this.assertionId = assertionId;
    this.sqlState = sqlState;
  }
}

function fail(category, assertionId = null, sqlState = null) {
  state.assertionId = assertionId;
  state.sqlState = sqlState;
  throw new ConcurrencyFailure(category, state.phase, assertionId, sqlState);
}

function expect(condition, assertionId, category = 'assertion_failure') {
  if (!condition) fail(category, assertionId);
  state.assertionId = null;
}

function commandSummary(result) {
  return {
    exitStatus: Number.isInteger(result?.code) && result.code >= 0 && result.code <= 255 ? result.code : null,
    timedOut: Boolean(result?.timedOut),
    signal: safeSignals.has(result?.signal) ? result.signal : null,
    spawnErrorCode: safeSpawnCodes.has(result?.spawnErrorCode) ? result.spawnErrorCode : null,
    outputTruncated: Boolean(result?.outputTruncated),
  };
}

function startPsql(container, sql, timeoutMs = 20_000) {
  const child = spawn('docker', [
    'exec', '-i', container,
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'postgres', '-A', '-t',
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: process.env });
  const stdout = [];
  const stderr = [];
  let capturedBytes = 0;
  let outputTruncated = false;
  let timedOut = false;
  const capture = (target) => (chunk) => {
    if (capturedBytes >= 128 * 1024) {
      outputTruncated = true;
      return;
    }
    const kept = chunk.subarray(0, Math.min(chunk.length, 128 * 1024 - capturedBytes));
    target.push(kept);
    capturedBytes += kept.length;
    if (kept.length < chunk.length) outputTruncated = true;
  };
  child.stdout.on('data', capture(stdout));
  child.stderr.on('data', capture(stderr));
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
  }, timeoutMs);

  let settled = false;
  const closed = new Promise((resolve) => {
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        timedOut,
        outputTruncated,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    };
    child.once('error', (error) => finish({ code: null, signal: null, spawnErrorCode: error?.code }));
    child.once('close', (code, signal) => finish({ code, signal }));
  });
  child.stdin.end(sql);
  return { child, closed };
}

async function runPsql(container, sql) {
  const result = await startPsql(container, sql).closed;
  state.databaseCommand = commandSummary(result);
  if (result.timedOut) fail('postgres_timeout', null, extractPostgresSqlState(result.stderr));
  if (result.outputTruncated) fail('harness_failure');
  if (result.code !== 0) {
    const category = result.spawnErrorCode ? 'harness_failure' : 'postgres_error';
    fail(category, null, extractPostgresSqlState(result.stderr));
  }
  return result.stdout.trim();
}

async function waitForSession(container, applicationName, queryPattern, timeoutMs) {
  const expires = Date.now() + timeoutMs;
  while (Date.now() < expires) {
    const count = await runPsql(container,
      `select count(*) from pg_stat_activity where application_name = '${applicationName}' and state = 'active' and query like '${queryPattern}';`);
    if (Number(count) > 0) return true;
    await delay(100);
  }
  return false;
}

async function requireObservedSession(container, applicationName, queryPattern, timeoutMs, session, sessionKey, assertionId) {
  const observed = await waitForSession(container, applicationName, queryPattern, timeoutMs);
  state.sessionsStarted[sessionKey] = observed;
  if (observed) return;

  const result = await session.closed;
  activeSessions.delete(session);
  state.databaseCommand = commandSummary(result);
  if (result.timedOut) fail('postgres_timeout', null, extractPostgresSqlState(result.stderr));
  if (result.outputTruncated) fail('harness_failure');
  if (result.spawnErrorCode) fail('harness_failure');
  if (result.code !== 0) fail('postgres_error', null, extractPostgresSqlState(result.stderr));
  fail('assertion_failure', assertionId);
}

function diagnostic(result, failure = null) {
  return {
    version: 1,
    result,
    category: failure?.category ?? 'completed',
    phase: failure?.phase ?? state.phase,
    assertionId: failure?.assertionId ?? state.assertionId,
    sqlState: failure?.sqlState ?? state.sqlState,
    databaseSetupStarted: state.databaseSetupStarted,
    sessionsStarted: state.sessionsStarted,
    finalIntegrityReached: state.finalIntegrityReached,
    databaseCommand: state.databaseCommand,
  };
}

function emit(result, failure = null) {
  process.stderr.write(formatPaypalConcurrencyDiagnostic(diagnostic(result, failure)) + '\n');
}

async function main() {
  expect(process.platform === 'linux', 'linux_runner_required', 'environment_failure');
  expect(process.env.GITHUB_ACTIONS === 'true', 'github_actions_marker_required', 'environment_failure');
  const projectIdArgument = process.argv[2] || '';
  expect(/^ppv[a-f0-9]{14}$/.test(projectIdArgument), 'disposable_project_id_required', 'environment_failure');
  const container = 'supabase_db_' + projectIdArgument;

  state.phase = 'database_setup';
  state.databaseSetupStarted = true;
  await runPsql(container, `
insert into public.invoices (
  id, project_id, milestone_id, created_by, provider, provider_invoice_id,
  provider_invoice_number, status, amount_minor, currency, provider_status,
  paid_at, provider_observed_at, provider_updated_at
)
select
  '${invoiceId}', milestone.project_id, milestone.id,
  '00000000-0000-4000-8000-000000000002', 'paypal',
  'SYNTHETIC-SNAPSHOT-RACE-01', 'TEST-SNAPSHOT-RACE-01',
  'paid', milestone.amount_minor, milestone.currency, 'PAID',
  '2026-11-07T10:00:00Z', '2026-11-07T10:00:00Z', '2026-11-07T10:00:00Z'
from public.milestones as milestone
where milestone.project_id = '${projectId}' and milestone.sequence = 1;

insert into public.paypal_webhook_events (
  id, provider_event_id, event_type, resource_id, payload,
  verified_at, attempt_count, lease_token, lease_expires_at
) values
  (
    '${olderEventId}', 'SYNTHETIC-EVENT-RACE-OLDER-PAID', 'INVOICING.INVOICE.UPDATED',
    'SYNTHETIC-SNAPSHOT-RACE-01',
    '{"id":"SYNTHETIC-EVENT-RACE-OLDER-PAID","event_type":"INVOICING.INVOICE.UPDATED","resource":{"id":"SYNTHETIC-SNAPSHOT-RACE-01","status":"PAID"}}'::jsonb,
    clock_timestamp(), 1, '${olderLeaseToken}', clock_timestamp() + interval '10 minutes'
  ),
  (
    '${newerEventId}', 'SYNTHETIC-EVENT-RACE-NEWER-REFUNDED', 'INVOICING.INVOICE.UPDATED',
    'SYNTHETIC-SNAPSHOT-RACE-01',
    '{"id":"SYNTHETIC-EVENT-RACE-NEWER-REFUNDED","event_type":"INVOICING.INVOICE.UPDATED","resource":{"id":"SYNTHETIC-SNAPSHOT-RACE-01","status":"REFUNDED"}}'::jsonb,
    clock_timestamp(), 1, '${newerLeaseToken}', clock_timestamp() + interval '10 minutes'
  );
`);
  const fixtureState = await runPsql(container, `
select (exists(select 1 from public.invoices where id = '${invoiceId}'))::text || '|' ||
  (select count(*)::text from public.paypal_webhook_events where id in ('${olderEventId}', '${newerEventId}'));
`);
  expect(fixtureState === 'true|2', 'race_fixture_created');

  state.phase = 'older_session_start';
  const older = startPsql(container, `
select set_config('application_name', '${olderApplicationName}', false);
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
begin;
select id from public.paypal_webhook_events where id = '${olderEventId}' for update;
\echo OLDER_EVENT_LOCKED
select pg_sleep(10);
select public.complete_verified_paypal_webhook(
  '${olderEventId}', '${olderLeaseToken}', 'SYNTHETIC-SNAPSHOT-RACE-01', 'PAID',
  null, null, '2026-11-07T13:00:00Z', '2026-11-07T11:00:00Z'
);
commit;
`, 25_000);
  activeSessions.add(older);

  await requireObservedSession(
    container, olderApplicationName, 'select pg_sleep(10)%', 5_000, older, 'older', 'older_paid_session_observed',
  );

  state.phase = 'newer_session_start';
  const newer = startPsql(container, `
select set_config('application_name', '${newerApplicationName}', false);
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
begin;
select pg_sleep(1);
select public.complete_verified_paypal_webhook(
  '${newerEventId}', '${newerLeaseToken}', 'SYNTHETIC-SNAPSHOT-RACE-01', 'REFUNDED',
  null, null, '2026-11-07T12:30:00Z', '2026-11-07T12:00:00Z'
);
commit;
`, 15_000);
  activeSessions.add(newer);
  await requireObservedSession(
    container, newerApplicationName, 'select pg_sleep(1)%', 5_000, newer, 'newer', 'newer_refunded_session_observed',
  );

  state.phase = 'state_order_assertions';
  const newerResult = await newer.closed;
  activeSessions.delete(newer);
  state.databaseCommand = commandSummary(newerResult);
  if (newerResult.timedOut) fail('postgres_timeout', null, extractPostgresSqlState(newerResult.stderr));
  if (newerResult.outputTruncated) fail('harness_failure');
  if (newerResult.spawnErrorCode) fail('harness_failure');
  if (newerResult.code !== 0) fail('postgres_error', null, extractPostgresSqlState(newerResult.stderr));
  expect(/"applied":\s*true/.test(newerResult.stdout), 'newer_refund_applied');

  const olderResult = await older.closed;
  activeSessions.delete(older);
  state.databaseCommand = commandSummary(olderResult);
  if (olderResult.timedOut) fail('postgres_timeout', null, extractPostgresSqlState(olderResult.stderr));
  if (olderResult.outputTruncated) fail('harness_failure');
  if (olderResult.spawnErrorCode) fail('harness_failure');
  if (olderResult.code !== 0) fail('postgres_error', null, extractPostgresSqlState(olderResult.stderr));
  expect(/"applied":\s*false/.test(olderResult.stdout), 'older_paid_rejected_as_stale');
  expect(/"status":\s*"refunded"/.test(olderResult.stdout), 'older_rpc_observed_refund');

  state.phase = 'final_integrity';
  const finalState = await runPsql(container, `
select
  status || '|' || provider_status || '|' ||
  to_char(provider_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '|' ||
  ((select processed_at is not null from public.paypal_webhook_events where id = '${olderEventId}')::text) || '|' ||
  ((select processed_at is not null from public.paypal_webhook_events where id = '${newerEventId}')::text)
from public.invoices where id = '${invoiceId}';
`);
  expect(finalState === 'refunded|REFUNDED|2026-11-07T12:00:00Z|true|true', 'race_invoice_and_events_final_state');
  state.finalIntegrityReached = true;
  state.phase = 'complete';
  emit('passed');
}

try {
  await main();
} catch (error) {
  const failure = error instanceof ConcurrencyFailure
    ? error
    : new ConcurrencyFailure('harness_failure', state.phase, null, null);
  for (const session of activeSessions) session.child.kill('SIGKILL');
  for (const session of activeSessions) {
    const result = await session.closed;
    state.databaseCommand = commandSummary(result);
  }
  activeSessions.clear();
  emit('failed', failure);
  process.exitCode = 1;
}
