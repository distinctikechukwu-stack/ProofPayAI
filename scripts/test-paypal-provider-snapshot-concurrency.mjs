import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const projectId = '00000000-0000-4000-8000-000000000900';
const invoiceId = '00000000-0000-4000-8000-000000009340';
const olderEventId = '00000000-0000-4000-8000-000000009341';
const olderLeaseToken = '00000000-0000-4000-8000-000000009342';
const newerEventId = '00000000-0000-4000-8000-000000009343';
const newerLeaseToken = '00000000-0000-4000-8000-000000009344';

function startPsql(container, sql, timeoutMs = 20_000) {
  const child = spawn('docker', [
    'exec', '-i', container,
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-A', '-t',
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const stdout = [];
  const stderr = [];
  let capturedBytes = 0;
  const capture = (target) => (chunk) => {
    if (capturedBytes >= 128 * 1024) return;
    const kept = chunk.subarray(0, Math.min(chunk.length, 128 * 1024 - capturedBytes));
    target.push(kept);
    capturedBytes += kept.length;
  };
  child.stdout.on('data', capture(stdout));
  child.stderr.on('data', capture(stderr));
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
  child.stdin.end(sql);
  return { child, closed };
}

async function runPsql(container, sql) {
  const result = await startPsql(container, sql).closed;
  assert.equal(result.code, 0, 'PostgreSQL setup or assertion query failed');
  return result.stdout.trim();
}

async function waitForOlderSession(container, timeoutMs) {
  const expires = Date.now() + timeoutMs;
  while (Date.now() < expires) {
    const count = await runPsql(container,
      "select count(*) from pg_stat_activity where state = 'active' and query like 'select pg_sleep(10)%';");
    if (Number(count) > 0) return true;
    await delay(100);
  }
  return false;
}

async function main() {
  assert.equal(process.platform, 'linux', 'the two-session database race is designed for isolated Linux CI');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'run only from the manual isolated GitHub Actions validation');
  const projectIdArgument = process.argv[2] || '';
  assert.match(projectIdArgument, /^ppv[a-f0-9]{14}$/, 'expected a disposable local Supabase project ID');
  const container = 'supabase_db_' + projectIdArgument;

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

  const older = startPsql(container, `
\\set ON_ERROR_STOP on
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
begin;
select id from public.paypal_webhook_events where id = '${olderEventId}' for update;
\\echo OLDER_EVENT_LOCKED
select pg_sleep(10);
select public.complete_verified_paypal_webhook(
  '${olderEventId}', '${olderLeaseToken}', 'SYNTHETIC-SNAPSHOT-RACE-01', 'PAID',
  null, null, '2026-11-07T13:00:00Z', '2026-11-07T11:00:00Z'
);
commit;
`, 25_000);

  let newer;
  try {
    const olderSessionReady = await waitForOlderSession(container, 5_000);
    assert.equal(olderSessionReady, true, 'the older PAID transaction did not hold its event lock before the newer refund');
    newer = await startPsql(container, `
\\set ON_ERROR_STOP on
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
begin;
select public.complete_verified_paypal_webhook(
  '${newerEventId}', '${newerLeaseToken}', 'SYNTHETIC-SNAPSHOT-RACE-01', 'REFUNDED',
  null, null, '2026-11-07T12:30:00Z', '2026-11-07T12:00:00Z'
);
commit;
`, 15_000).closed;
  } catch (error) {
    older.child.kill('SIGKILL');
    throw error;
  }
  const olderResult = await older.closed;
  assert.equal(newer.code, 0, 'the newer REFUNDED RPC failed');
  assert.equal(olderResult.code, 0, 'the delayed older PAID RPC failed');
  assert.match(newer.stdout, /"applied": true/, 'the newer provider version was not applied');
  assert.match(olderResult.stdout, /"applied": false/, 'the stale PAID provider version was not rejected');
  assert.match(olderResult.stdout, /"status": "refunded"/, 'the stale RPC did not observe the already-refunded invoice');

  const finalState = await runPsql(container, `
select
  status || '|' || provider_status || '|' ||
  to_char(provider_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '|' ||
  ((select processed_at is not null from public.paypal_webhook_events where id = '${olderEventId}')::text) || '|' ||
  ((select processed_at is not null from public.paypal_webhook_events where id = '${newerEventId}')::text)
from public.invoices where id = '${invoiceId}';
`);
  assert.equal(finalState, 'refunded|REFUNDED|2026-11-07T12:00:00Z|true|true',
    'the older PAID event overwrote the newer REFUNDED provider snapshot');
  process.stdout.write(JSON.stringify({
    result: 'passed',
    sessions: 2,
    newerRefundAppliedBeforeOlderPaid: true,
    olderPaidRejectedAsStale: true,
    finalState: 'refunded',
    providerVersion: '2026-11-07T12:00:00Z',
    bothEventsProcessed: true,
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    result: 'failed',
    check: error?.code === 'ERR_ASSERTION' ? 'assertion_failed' : 'harness_failed',
    message: String(error?.message || 'unknown').replace(/\s+/g, ' ').slice(0, 300),
  }) + '\n');
  process.exitCode = 1;
});
