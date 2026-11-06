import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const projectId = '00000000-0000-4000-8000-000000000800';
const clientId = '00000000-0000-4000-8000-000000000001';
const milestoneOneKey = '00000000-0000-4000-8000-000000008001';
const milestoneTwoKey = '00000000-0000-4000-8000-000000008002';

function runDockerPsql(container, sql, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', container,
      'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-A', '-t',
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= 256 * 1024) stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= 256 * 1024) stderr.push(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    child.stdin.end(sql);
  });
}

function startPsql(container, sql) {
  const child = spawn('docker', [
    'exec', '-i', container,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-A', '-t',
  ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.stdin.end(sql);
  return {
    child,
    output: () => Buffer.concat(stdout).toString('utf8'),
    errorOutput: () => Buffer.concat(stderr).toString('utf8'),
  };
}

async function waitForQuery(container, sql, predicate, timeoutMs) {
  const expiresAt = Date.now() + timeoutMs;
  while (Date.now() < expiresAt) {
    const result = await runDockerPsql(container, sql, { timeoutMs: 3_000 });
    if (result.code === 0 && predicate(result.stdout.trim())) return true;
    await delay(100);
  }
  return false;
}

async function main() {
  const projectIdArgument = process.argv[2];
  assert.match(projectIdArgument ?? '', /^ppv[a-f0-9]{14}$/, 'expected this workflow run\'s isolated local Supabase id');
  const container = `supabase_db_${projectIdArgument}`;

  const connectionOne = startPsql(container, `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${clientId}', true);
select public.review_milestone(
  (select id from public.milestones where project_id = '${projectId}' and sequence = 1),
  'approved', '', '${milestoneOneKey}'
);
reset role;
\\echo COMPLETION_LOCK_HELD
select pg_sleep(8);
commit;
`);

  const firstApprovalIsHoldingLock = await waitForQuery(
    container,
    "select count(*) from pg_stat_activity where state = 'active' and query like 'select pg_sleep(8)%'",
    (value) => Number(value) > 0,
    5_000,
  );
  assert.equal(firstApprovalIsHoldingLock, true, 'the first database session did not reach the transaction-held project lock');

  const connectionTwo = startPsql(container, `
\\set ON_ERROR_STOP on
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '${clientId}', true);
select public.review_milestone(
  (select id from public.milestones where project_id = '${projectId}' and sequence = 2),
  'approved', '', '${milestoneTwoKey}'
);
commit;
`);

  const secondApprovalWaited = await waitForQuery(
    container,
    "select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%public.review_milestone%'",
    (value) => Number(value) > 0,
    5_000,
  );

  const [firstResult, secondResult] = await Promise.all([
    new Promise((resolve) => connectionOne.child.once('close', (code) => resolve(code))),
    new Promise((resolve) => connectionTwo.child.once('close', (code) => resolve(code))),
  ]);
  assert.equal(firstResult, 0, `first psql session failed: ${connectionOne.errorOutput().slice(-600)}`);
  assert.equal(secondResult, 0, `second psql session failed: ${connectionTwo.errorOutput().slice(-600)}`);
  assert.equal(secondApprovalWaited, true, 'the second approval did not wait on the first transaction\'s workflow lock');
  assert.match(connectionOne.output(), /COMPLETION_LOCK_HELD/);

  const state = await runDockerPsql(container, `
select
  (select status from public.projects where id = '${projectId}') || '|' ||
  (select count(*) from public.milestone_reviews where project_id = '${projectId}') || '|' ||
  (select count(*) from public.activity_logs where project_id = '${projectId}' and event_type = 'project.completed');
`);
  assert.equal(state.code, 0, 'final concurrency-state query failed');
  assert.equal(state.stdout.trim(), 'completed|2|1', 'concurrent approvals did not produce two reviews and one completion event');

  process.stdout.write(`${JSON.stringify({
    result: 'passed',
    sessions: 2,
    secondApprovalWaitedForProjectLock: secondApprovalWaited,
    persistedState: 'completed',
    reviewRows: 2,
    completionEvents: 1,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ result: 'failed', error: error.message.replace(/\s+/g, ' ').slice(0, 500) })}\n`);
  process.exitCode = 1;
});
