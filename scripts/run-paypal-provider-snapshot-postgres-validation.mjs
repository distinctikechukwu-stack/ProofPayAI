import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePgTapDiagnostics } from './paypal-pgtap-diagnostics.mjs';
import { parsePaypalConcurrencyDiagnostic } from './paypal-concurrency-diagnostics.mjs';
import { createDisposablePostgresEnvironment } from './paypal-validation-environment.mjs';
import {
  parseSupabaseContainerState,
  parseSupabaseProjectContainerNames,
  parseSupabaseStartupDiagnostics,
  runSupabaseStartWithDiagnostics,
} from './supabase-startup-diagnostics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration19 = '202611050001_project_completion_workflow.sql';
const migration20 = '202611070001_paypal_provider_snapshot_ordering.sql';
const supabaseVersion = '2.122.0';
const expectedNodeVersion = '26.13.0';
const excludedServices = 'studio,imgproxy,edge-runtime,logflare,vector';
const maxOutputBytes = 1_000_000;
const pgtapTestFiles = Object.freeze(['project_completion_workflow.test.sql', 'paypal_provider_snapshot_ordering.test.sql']);
let stage = 'preflight';
let runEnv;
let cli;
let localRoot;
let projectId;
let tempRoot;
let stackStartAttempted = false;
let stackCleanupResult = null;
let exitCode = 0;

function emit(phase, result, details = {}) {
  process.stdout.write(JSON.stringify({ phase, result, ...details }) + '\n');
}

function run(command, args, { cwd, env, input, timeoutMs = 120_000, allowFailure = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let outputTruncated = false;
    const collect = (chunks) => {
      let captured = 0;
      return (chunk) => {
        if (captured >= maxOutputBytes) {
          outputTruncated = true;
          return;
        }
        const value = chunk.subarray(0, Math.min(chunk.length, maxOutputBytes - captured));
        chunks.push(value);
        captured += value.length;
        if (value.length < chunk.length) outputTruncated = true;
      };
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 4_000).unref();
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      error.processResult = {
        code: null,
        signal: null,
        timedOut,
        outputTruncated,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        spawnErrorCode: typeof error.code === 'string' ? error.code : null,
      };
      rejectRun(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const result = {
        code,
        signal,
        timedOut,
        outputTruncated,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (!allowFailure && (code !== 0 || timedOut)) {
        const error = new Error(command + ' failed during ' + stage);
        error.processResult = result;
        rejectRun(error);
      } else {
        resolveRun(result);
      }
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function psql(container, sql, allowFailure = false) {
  return run('docker', [
    'exec', '-i', container,
    'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-U', 'postgres', '-d', 'postgres', '-A', '-t',
  ], { cwd: localRoot, env: runEnv, input: sql, timeoutMs: 30_000, allowFailure });
}

async function captureCommand(command, args, options) {
  try {
    return await run(command, args, { ...options, allowFailure: true });
  } catch (error) {
    return error?.processResult ?? {
      code: null, signal: null, timedOut: false, outputTruncated: false,
      stdout: '', stderr: '', spawnErrorCode: typeof error?.code === 'string' ? error.code : null,
    };
  }
}

async function collectSupabaseStartupDiagnostics(error) {
  const options = { cwd: localRoot, env: runEnv, timeoutMs: 10_000 };
  const containerListResult = await captureCommand('docker', [
    'ps', '-a', '--filter', 'name=' + projectId, '--format', '{{.Names}}',
  ], options);
  const containerNames = containerListResult.code === 0 && !containerListResult.timedOut
    ? parseSupabaseProjectContainerNames(containerListResult.stdout, projectId)
    : [];
  const containerStates = await Promise.all(containerNames.map(async (name) => {
    const inspect = await captureCommand('docker', [
      'inspect', '--format', '{{.Name}}|{{.State.Status}}|{{.State.ExitCode}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.OOMKilled}}', name,
    ], options);
    if (inspect.code !== 0 || inspect.timedOut || inspect.outputTruncated) return null;
    const parsed = parseSupabaseContainerState(inspect.stdout, name, projectId);
    return parsed ? { ...parsed, outputTruncated: inspect.outputTruncated } : null;
  }));
  const dockerInfoResult = await captureCommand('docker', [
    'info', '--format', '{{.MemTotal}}|{{.NCPU}}|{{.DockerRootDir}}',
  ], options);
  const dockerRoot = dockerInfoResult.code === 0 && !dockerInfoResult.timedOut
    ? dockerInfoResult.stdout.trim().split('|')[2]
    : null;
  const safeDockerRoot = typeof dockerRoot === 'string'
    && /^\/[A-Za-z0-9._/-]{1,200}$/.test(dockerRoot)
    && !dockerRoot.split('/').includes('..')
    ? dockerRoot
    : null;
  const diskPaths = ['-Pk', localRoot];
  if (safeDockerRoot && safeDockerRoot !== localRoot) diskPaths.push(safeDockerRoot);
  const diskResult = await captureCommand('df', diskPaths, options);
  return parseSupabaseStartupDiagnostics({
    processResult: error?.processResult ?? {},
    projectId,
    containerListResult,
    containerNames,
    containers: containerStates.filter(Boolean),
    dockerInfoResult,
    diskResult,
  });
}

async function stopLocalStack() {
  stackCleanupResult = await captureCommand(cli, ['stop', '--no-backup'], {
    cwd: localRoot, env: runEnv, timeoutMs: 90_000,
  });
  return {
    kind: stackCleanupResult.code === 0 && !stackCleanupResult.timedOut ? 'stopped' : 'failed',
    exitStatus: Number.isInteger(stackCleanupResult.code) ? stackCleanupResult.code : null,
    timedOut: Boolean(stackCleanupResult.timedOut),
    outputTruncated: Boolean(stackCleanupResult.outputTruncated),
  };
}

function diagnosePgTapCommand(result, tool, testFile) {
  return parsePgTapDiagnostics({
    exitStatus: result.code, stdout: result.stdout, stderr: result.stderr,
    timedOut: result.timedOut, outputTruncated: result.outputTruncated,
    expectedTestFiles: [testFile], testFile, tool, spawnErrorCode: result.spawnErrorCode,
  });
}

function isPassingPgTapCommand(result, diagnostic) {
  return result.code === 0 && !result.timedOut && !result.outputTruncated && diagnostic.kind === 'passed';
}

async function runPsqlPgTapFallback(container, projectId, testFile, hostTestFile) {
  const remoteDirectory = '/tmp/proofpay-pgtap-' + projectId;
  const remoteTestFile = remoteDirectory + '/' + testFile;
  const options = { cwd: localRoot, env: runEnv, timeoutMs: 30_000 };
  const directoryResult = await captureCommand('docker', ['exec', container, 'mkdir', '-p', remoteDirectory], options);
  const directoryDiagnostic = diagnosePgTapCommand(directoryResult, 'docker', testFile);
  if (directoryResult.code !== 0 || directoryResult.timedOut || directoryResult.outputTruncated) {
    return { tool: 'docker', diagnostic: directoryDiagnostic };
  }
  const copyResult = await captureCommand('docker', ['cp', hostTestFile, container + ':' + remoteTestFile], options);
  const copyDiagnostic = diagnosePgTapCommand(copyResult, 'docker', testFile);
  if (copyResult.code !== 0 || copyResult.timedOut || copyResult.outputTruncated) {
    return { tool: 'docker', diagnostic: copyDiagnostic };
  }
  const psqlResult = await captureCommand('docker', [
    'exec', '-i', container, 'psql', '-X', '-q',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-v', 'SHOW_CONTEXT=always',
    '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-f', remoteTestFile,
  ], options);
  return { tool: 'psql', diagnostic: diagnosePgTapCommand(psqlResult, 'psql', testFile) };
}


function safeError(error) {
  const child = error?.processResult;
  if (child && stage === 'two_session_snapshot_race') {
    return parsePaypalConcurrencyDiagnostic(child);
  }
  if (child && stage === 'pgtap_suite') {
    return parsePgTapDiagnostics({
      exitStatus: child.code,
      stdout: child.stdout,
      stderr: child.stderr,
      timedOut: child.timedOut,
      outputTruncated: child.outputTruncated,
      expectedTestFiles: pgtapTestFiles,
      spawnErrorCode: child.spawnErrorCode,
    });
  }
  if (child) {
    const parsed = parsePgTapDiagnostics({ exitStatus: child.code, stderr: child.stderr });
    return {
      kind: 'command_failed',
      exitStatus: child.code,
      timedOut: child.timedOut,
      databaseErrorCode: parsed.sqlStateCodes[0] || null,
    };
  }
  return { kind: 'harness_error', code: /^[A-Z0-9_]{1,50}$/.test(String(error?.code || '')) ? error.code : null };
}

async function verifyRollback(container, failedSql, migrationCount, expectedBaseline) {
  const injected = await psql(container, failedSql, true);
  assert.notEqual(injected.code, 0, 'the injected SQL error did not abort the migration');
  assert.equal(injected.timedOut, false, 'the rollback probe timed out');
  assert.match(injected.stderr, /division by zero/i, 'the injected failure was not the intended SQL error');
  const state = await psql(container, [
    "select (select count(*) from supabase_migrations.schema_migrations) || '|' ||",
    "(exists(select 1 from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='provider_updated_at'))::text || '|' ||",
    "(to_regprocedure('public.paypal_invoice_snapshot_is_current(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)') is not null)::text || '|' ||",
    "(to_regprocedure('public.complete_verified_paypal_webhook(uuid,uuid,text,text,text,timestamptz,timestamptz)') is not null)::text || '|' ||",
    "(select status from public.invoices where id='00000000-0000-4000-8000-000000000220') || '|' ||",
    "(select provider_status || '|' || provider_invoice_id || '|' || amount_minor::text || '|' || currency",
    " from public.invoices where id='00000000-0000-4000-8000-000000000220');",
  ].join('\n'));
  assert.equal(state.stdout.trim(), migrationCount + '|false|false|true|' + expectedBaseline,
    'migration rollback did not restore the original schema, RPC, and invoice data');
  emit('migration20_transaction_rollback', 'passed', {
    migrationHistoryUnchanged: true,
    newColumnAndHelperRolledBack: true,
    previousRpcPreserved: true,
    existingInvoiceStatusAndProviderDataPreserved: true,
  });
}

async function main() {
  assert.equal(process.platform, 'linux', 'the PostgreSQL validation runner requires the isolated Ubuntu CI job');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'run only through the isolated GitHub Actions workflow');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/codex/cloudflare-paypal-webhooks', 'run only for the isolated webhook branch');
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.devDependencies?.supabase, supabaseVersion, 'the reviewed Supabase CLI version must remain pinned');
  assert.equal((await readFile(join(root, '.node-version'), 'utf8')).trim(), expectedNodeVersion);
  cli = join(root, 'node_modules', '.bin', 'supabase');
  assert.ok(await access(cli).then(() => true).catch(() => false), 'install dependencies with npm ci --include=dev first');

  const migrationsRoot = join(root, 'supabase', 'migrations');
  const names = (await readdir(migrationsRoot)).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(names.length, 20, 'expected exactly the reviewed migrations 1 through 20');
  assert.equal(names.at(-2), migration19, 'project completion migration 19 must remain immediately before migration 20');
  assert.equal(names.at(-1), migration20, 'snapshot ordering migration 20 must remain last');
  const cliVersion = await run(cli, ['--version'], { cwd: root, env: { PATH: process.env.PATH || '' }, timeoutMs: 30_000 });
  assert.match(cliVersion.stdout + cliVersion.stderr, /\b2\.122\.0\b/);
  emit('preflight', 'passed', { migrations: names.length, supabaseCliVersion: supabaseVersion, nodeVersion: expectedNodeVersion });

  const temporaryParent = process.env.RUNNER_TEMP || tmpdir();
  tempRoot = await mkdtemp(join(temporaryParent, 'proofpay-paypal-snapshot-'));
  const home = join(tempRoot, 'home');
  const temp = join(tempRoot, 'tmp');
  localRoot = join(tempRoot, 'workspace');
  const localMigrations = join(localRoot, 'supabase', 'migrations');
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(temp, { recursive: true }),
    mkdir(localMigrations, { recursive: true }),
  ]);
  projectId = 'ppv' + randomBytes(7).toString('hex');
  runEnv = createDisposablePostgresEnvironment(process.env, home, temp);
  const config = [
    'project_id = "' + projectId + '"',
    '',
    '[api]',
    'enabled = true',
    'schemas = ["public", "graphql_public"]',
    'extra_search_path = ["public", "extensions"]',
    '',
    '[db]',
    'major_version = 17',
    '',
    '[db.migrations]',
    'enabled = true',
    'schema_paths = []',
    '',
    '[db.seed]',
    'enabled = false',
    'sql_paths = []',
    '',
    '[auth]',
    'enabled = true',
    'enable_signup = true',
    '',
    '[storage]',
    'enabled = true',
    '',
    '[edge_runtime]',
    'enabled = false',
    '',
    '[analytics]',
    'enabled = false',
    '',
  ].join('\n');
  await writeFile(join(localRoot, 'supabase', 'config.toml'), config, { mode: 0o600 });
  for (const name of names.slice(0, 18)) {
    await copyFile(join(migrationsRoot, name), join(localMigrations, name));
  }
  emit('isolated_workspace', 'prepared', {
    localProjectId: projectId,
    migrationsInitiallyCopied: 18,
    seedDisabled: true,
    linkedProjectMetadataCopied: false,
    environmentFilesCopied: false,
  });

  stage = 'docker_preflight';
  const docker = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { cwd: localRoot, env: runEnv, timeoutMs: 15_000 });
  assert.ok(docker.stdout.trim(), 'Docker server did not report a version');
  emit('docker_preflight', 'passed', { dockerEngineResponded: true });

  stage = 'local_stack_start';
  stackStartAttempted = true;
  await runSupabaseStartWithDiagnostics({
    start: () => run(cli, ['start', '--exclude', excludedServices], { cwd: localRoot, env: runEnv, timeoutMs: 8 * 60_000 }),
    diagnose: collectSupabaseStartupDiagnostics,
    cleanup: stopLocalStack,
  });
  stage = 'local_database_reset';
  await run(cli, ['db', 'reset', '--local', '--no-seed'], { cwd: localRoot, env: runEnv, timeoutMs: 12 * 60_000 });
  const container = 'supabase_db_' + projectId;
  const initialHistory = await psql(container,
    "select count(*) || '|' || max(version) from supabase_migrations.schema_migrations;");
  assert.equal(initialHistory.stdout.trim(), '18|202611020004');
  emit('migrations_1_to_18', 'passed', { appliedCount: 18, latest: '202611020004' });

  stage = 'historical_fixture';
  await psql(container, await readFile(join(root, 'scripts', 'fixtures', 'project-completion-pre-migration.sql'), 'utf8'));
  const fixture = await psql(container, [
    "select status || '|' || (select count(*) from public.milestones where project_id='00000000-0000-4000-8000-000000000100' and workflow_status='approved')",
    "from public.projects where id='00000000-0000-4000-8000-000000000100';",
  ].join('\n'));
  assert.equal(fixture.stdout.trim(), 'in_progress|2');
  emit('historical_fixture', 'preserved', { projectStatus: 'in_progress', approvedMilestones: 2 });

  stage = 'migration19';
  await copyFile(join(migrationsRoot, migration19), join(localMigrations, migration19));
  await run(cli, ['db', 'push', '--local'], { cwd: localRoot, env: runEnv, timeoutMs: 8 * 60_000 });
  await psql(container, await readFile(join(root, 'scripts', 'fixtures', 'project-completion-post-migration.sql'), 'utf8'));
  const invoiceBaseline = await psql(container, [
    "select status || '|' || provider_status || '|' || provider_invoice_id || '|' || amount_minor::text || '|' || currency",
    "from public.invoices where id='00000000-0000-4000-8000-000000000220';",
  ].join('\n'));
  const expectedInvoice = 'paid|PAID|SYNTHETIC-COMPLETION-PAID-01|4000|USD';
  assert.equal(invoiceBaseline.stdout.trim(), expectedInvoice);
  const history19 = await psql(container, "select count(*) || '|' || max(version) from supabase_migrations.schema_migrations;");
  assert.equal(history19.stdout.trim(), '19|202611050001');
  emit('migration19_checkpoint', 'preserved', { migrationCount: 19, historicalInvoice: 'paid', amountMinor: 4000, currency: 'USD' });

  stage = 'migration20_transaction_rollback';
  const sql20 = await readFile(join(migrationsRoot, migration20), 'utf8');
  const injectedSql = sql20.replace(/\r?\ncommit;\s*$/i, '\nselect 1 / 0;\ncommit;\n');
  assert.notEqual(injectedSql, sql20, 'could not prepare a transactional failure injection');
  await verifyRollback(container, injectedSql, 19, expectedInvoice);

  stage = 'migration20_apply';
  await copyFile(join(migrationsRoot, migration20), join(localMigrations, migration20));
  await run(cli, ['db', 'push', '--local'], { cwd: localRoot, env: runEnv, timeoutMs: 8 * 60_000 });
  const finalHistory = await psql(container,
    "select count(*) || '|' || max(version) from supabase_migrations.schema_migrations;");
  assert.equal(finalHistory.stdout.trim(), '20|202611070001');
  emit('migration20_apply', 'passed', { migrationCount: 20, latest: '202611070001' });

  stage = 'pgtap_suite';
  const testsRoot = join(localRoot, 'supabase', 'tests');
  const testResults = [];

  for (const file of pgtapTestFiles) {
    const hostTestFile = join(testsRoot, file);
    let cliDiagnostic = { kind: 'harness_error', tool: 'harness', testFile: file };
    let cliPassed = false;
    let psqlFallback = null;

    try {
      await rm(testsRoot, { recursive: true, force: true });
      await mkdir(testsRoot, { recursive: true });
      await copyFile(join(root, 'supabase', 'tests', file), hostTestFile);
      const cliResult = await captureCommand(cli, ['test', 'db', '--local'], {
        cwd: localRoot, env: runEnv, timeoutMs: 8 * 60_000,
      });
      cliDiagnostic = diagnosePgTapCommand(cliResult, 'supabase', file);
      cliPassed = isPassingPgTapCommand(cliResult, cliDiagnostic);
      emit('pgtap_file_cli', cliPassed ? 'passed' : 'failed', { testFile: file, diagnostic: cliDiagnostic });

      if (!cliPassed) {
        psqlFallback = await runPsqlPgTapFallback(container, projectId, file, hostTestFile);
        const fallbackPassed = psqlFallback.tool === 'psql' && psqlFallback.diagnostic.kind === 'passed';
        emit('pgtap_file_psql_fallback', fallbackPassed ? 'passed' : 'failed', {
          testFile: file, tool: psqlFallback.tool, diagnostic: psqlFallback.diagnostic,
        });
      }
    } catch (error) {
      cliDiagnostic = {
        kind: 'harness_error', tool: 'harness', testFile: file,
        code: /^[A-Z0-9_]{1,50}$/.test(String(error?.code || '')) ? error.code : null,
      };
      emit('pgtap_file_harness', 'failed', { testFile: file, diagnostic: cliDiagnostic });
    } finally {
      await rm(testsRoot, { recursive: true, force: true });
    }

    testResults.push({ testFile: file, cliPassed, cliDiagnostic, psqlFallback });
  }

  if (testResults.some((result) => !result.cliPassed)) {
    const error = new Error('One or more isolated Supabase pgTAP files failed');
    error.safeDiagnostic = { kind: 'required_pgtap_validation_failed', testFiles: testResults };
    throw error;
  }

  emit('pgtap_suite', 'passed', {
    testFiles: testResults.length,
    results: testResults.map(({ testFile, cliDiagnostic }) => ({
      testFile, passingAssertions: cliDiagnostic.passingAssertions, assertionCount: cliDiagnostic.assertionCount,
    })),
  });

  stage = 'two_session_snapshot_race';
  let raceResult;
  try {
    raceResult = await run(process.execPath, [join(root, 'scripts', 'test-paypal-provider-snapshot-concurrency.mjs'), projectId], {
      cwd: root,
      env: runEnv,
      timeoutMs: 30_000,
    });
  } catch (error) {
    if (error?.processResult) error.safeDiagnostic = parsePaypalConcurrencyDiagnostic(error.processResult);
    throw error;
  }
  const raceDiagnostic = parsePaypalConcurrencyDiagnostic(raceResult);
  if (raceDiagnostic.kind !== 'passed'
    || raceDiagnostic.process.exitStatus !== 0
    || raceDiagnostic.process.timedOut
    || raceDiagnostic.process.signal !== null
    || raceDiagnostic.process.outputTruncated
    || raceDiagnostic.sessionsStarted.older !== true
    || raceDiagnostic.sessionsStarted.newer !== true
    || raceDiagnostic.finalIntegrityReached !== true
    || raceDiagnostic.databaseCommand?.exitStatus !== 0
    || raceDiagnostic.databaseCommand?.timedOut
    || raceDiagnostic.databaseCommand?.outputTruncated) {
    const error = new Error('Two-session snapshot concurrency validation did not report a complete pass');
    error.processResult = raceResult;
    error.safeDiagnostic = raceDiagnostic;
    throw error;
  }
  emit('two_session_snapshot_race', 'passed', {
    databaseSessions: 2,
    newerRefundAppliedBeforeOlderPaid: true,
    olderPaidRejectedAsStale: true,
    finalIntegrityReached: raceDiagnostic.finalIntegrityReached,
  });

  stage = 'final_database_state';
  const finalState = await psql(container, [
    "select (select count(*) from supabase_migrations.schema_migrations) || '|' ||",
    "(select status from public.projects where id='00000000-0000-4000-8000-000000000200') || '|' ||",
    "(select status from public.invoices where id='00000000-0000-4000-8000-000000000220') || '|' ||",
    "(select status from public.invoices where id='00000000-0000-4000-8000-000000009340') || '|' ||",
    "(select count(*) from public.paypal_webhook_events where id in (",
    "'00000000-0000-4000-8000-000000009341', '00000000-0000-4000-8000-000000009343'",
    ") and processed_at is not null);",
  ].join('\n'));
  assert.equal(finalState.stdout.trim(), '20|in_progress|paid|refunded|2');
  emit('final_database_state', 'verified', {
    migrationCount: 20,
    migration20PgtapChangesRolledBack: true,
    projectCompletionTestWritesRolledBack: true,
    preexistingInvoiceStillPaid: true,
    concurrentSnapshotFinalStatus: 'refunded',
    raceEventsProcessed: 2,
  });
}

try {
  await main();
} catch (error) {
  exitCode = 1;
  const diagnostic = error?.safeDiagnostic ?? safeError(error);
  emit(stage, 'failed', {
    diagnostic,
    exitStatus: error?.processResult?.code ?? null,
    timedOut: Boolean(error?.processResult?.timedOut),
    signal: error?.safeDiagnostic?.process?.signal ?? null,
  });
} finally {
  if (stackStartAttempted && localRoot && cli && runEnv) {
    const stop = stackCleanupResult?.code === 0 && !stackCleanupResult.timedOut
      ? stackCleanupResult
      : await captureCommand(cli, ['stop', '--no-backup'], {
        cwd: localRoot, env: runEnv, timeoutMs: 90_000,
      });
    stackCleanupResult = stop;
    emit('local_stack_cleanup', stop?.code === 0 ? 'stopped' : 'runner_disposal_fallback', {
      processExitStatus: stop?.code ?? null,
    });
  }
  if (tempRoot) {
    const resolvedTemp = resolve(tempRoot);
    const allowedParent = resolve(process.env.RUNNER_TEMP || tmpdir());
    assert.ok(resolvedTemp.startsWith(allowedParent + '/'), 'refusing cleanup outside runner temporary directory');
    await rm(resolvedTemp, { recursive: true, force: true });
    emit('temporary_workspace_cleanup', 'removed');
  }
}
process.exitCode = exitCode;
