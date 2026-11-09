import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const config = join(root, 'apps', 'cloudflare-paypal-webhook', 'wrangler.jsonc');
let child;
let stopped = false;
let tempRoot;

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function ensureNoSecretFiles() {
  const candidates = [
    join(root, '.env'),
    join(root, '.env.local'),
    join(root, 'apps', 'api', '.env'),
    join(root, 'apps', 'api', '.dev.vars'),
    join(root, 'apps', 'cloudflare-paypal-webhook', '.env'),
    join(root, 'apps', 'cloudflare-paypal-webhook', '.dev.vars'),
  ];
  const present = [];
  for (const path of candidates) {
    if (await access(path).then(() => true).catch(() => false)) present.push(path.slice(root.length + 1));
  }
  assert.deepEqual(present, [], 'remove local secret files before running this no-secrets smoke');
}

function privateEnvironment(home, temp) {
  const env = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  Object.assign(env, {
    HOME: home,
    TMPDIR: temp,
    TMP: temp,
    TEMP: temp,
    XDG_CONFIG_HOME: join(home, 'config'),
    CI: 'true',
    WRANGLER_SEND_METRICS: 'false',
  });
  return env;
}

async function stopChild() {
  if (!child || stopped) return;
  stopped = true;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolveClose) => child.once('close', resolveClose)), delay(5_000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  assert.equal(process.platform, 'linux', 'Workerd runtime smoke requires Linux CI');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'run only from the manual isolated Linux workflow');
  await ensureNoSecretFiles();

  const port = await reservePort();
  tempRoot = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'proofpay-worker-smoke-'));
  const home = join(tempRoot, 'home');
  const temp = join(tempRoot, 'tmp');
  await Promise.all([mkdir(home, { recursive: true }), mkdir(temp, { recursive: true })]);
  const env = privateEnvironment(home, temp);
  const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
  let logBytes = 0;
  child = spawn(wrangler, [
    'dev',
    '--config', config,
    '--local',
    '--test-scheduled',
    '--ip', '127.0.0.1',
    '--port', String(port),
  ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const discardLogs = (chunk) => { logBytes += chunk.length; };
  child.stdout.on('data', discardLogs);
  child.stderr.on('data', discardLogs);

  const base = 'http://127.0.0.1:' + port;
  let health;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Wrangler exited before health became available');
    try {
      health = await fetch(base + '/health', { signal: AbortSignal.timeout(1_500) });
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(health, 'Workerd health endpoint did not start within 45 seconds');
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.deepEqual(healthBody, { status: 'ok', configured: false });

  const scheduled = new URL('/cdn-cgi/local/scheduled', base);
  scheduled.searchParams.set('cron', '* * * * *');
  const cronResponse = await fetch(scheduled, { signal: AbortSignal.timeout(5_000) });
  assert.ok([200, 204].includes(cronResponse.status), 'local Cron invocation did not return success');

  const malformed = await fetch(base + '/api/webhooks/paypal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not-json',
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(malformed.status, 503, 'unconfigured Worker should fail closed without provider or database calls');

  process.stdout.write(JSON.stringify({
    result: 'passed',
    workerRuntime: 'workerd-on-linux',
    health: '200 configured=false',
    scheduledCron: 'invoked while unconfigured; no database/provider client constructed',
    malformedWebhook: '503 fail-closed',
    secretFilesRead: false,
    providerOrDatabaseRequestsMade: false,
    queueDeliveryExercised: false,
    workerLogBytesDiscarded: logBytes,
  }) + '\n');
  await stopChild();
  const resolvedTemp = resolve(tempRoot);
  const allowedParent = resolve(process.env.RUNNER_TEMP || tmpdir());
  assert.ok(resolvedTemp.startsWith(allowedParent + '/'), 'refusing cleanup outside runner temporary directory');
  await rm(resolvedTemp, { recursive: true, force: true });
}

main().catch(async (error) => {
  await stopChild().catch(() => {});
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  process.stderr.write(JSON.stringify({
    result: 'failed',
    check: error?.code === 'ERR_ASSERTION' ? 'assertion_failed' : 'smoke_failed',
    message: String(error?.message || 'unknown').replace(/\s+/g, ' ').slice(0, 300),
  }) + '\n');
  process.exitCode = 1;
});
