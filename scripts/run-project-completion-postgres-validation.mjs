import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyDatabaseFailure,
  evaluateInjectedSqlFailure,
  evaluateRollbackState,
  parseRollbackState,
  rollbackStateSql,
  safeProcessFailure,
} from './project-completion-rollback-checks.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetMigration = '202611050001_project_completion_workflow.sql';
const pinnedCliVersion = '2.122.0';
const previousBaseline = '202611020004';
const optionalServicesToExclude = 'studio,imgproxy,edge-runtime,logflare,vector';
const maxCapturedOutput = 1_000_000;

function report(stage, result, extra = {}) {
  process.stdout.write(`${JSON.stringify({ stage, result, ...extra })}\n`);
}

function makePrivateEnv(homePath, tempPath) {
  const allowedNames = ['PATH', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(allowedNames
    .filter((name) => typeof process.env[name] === 'string')
    .map((name) => [name, process.env[name]]));
  env.HOME = homePath;
  env.TMPDIR = tempPath;
  env.TMP = tempPath;
  env.TEMP = tempPath;
  env.DOCKER_CONFIG = join(homePath, '.docker');
  env.CI = 'true';
  env.SUPABASE_TELEMETRY_DISABLED = 'true';
  return env;
}

function run(command, args, { cwd, env, input, timeoutMs = 120_000, allowFailure = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let captured = 0;
    let timedOut = false;
    const capture = (target) => (chunk) => {
      if (captured >= maxCapturedOutput) return;
      const remaining = maxCapturedOutput - captured;
      const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      target.push(kept);
      captured += kept.length;
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      const result = {
        code,
        signal,
        timedOut,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (!allowFailure && (code !== 0 || timedOut)) {
        const error = new Error(`${command} exited ${timedOut ? 'after timeout' : `with status ${code}`}`);
        error.processResult = result;
        rejectPromise(error);
      } else {
        resolvePromise(result);
      }
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

function safeDiagnostic(error) {
  if (error?.safeDiagnostic && typeof error.safeDiagnostic === 'object') return error.safeDiagnostic;
  if (error?.processResult) return safeProcessFailure(error.processResult);
  if (error?.code === 'ERR_ASSERTION') {
    return {
      failureType: 'javascript_assertion',
      check: 'unstructured_assertion',
      expected: 'validation assertion passed',
      observed: 'assertion failed without structured check details',
    };
  }
  return {
    failureType: 'harness_error',
    errorCode: typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : null,
  };
}

function failWithSafeDiagnostic(safeDetails) {
  const error = new Error('project completion validation check failed');
  error.safeDiagnostic = safeDetails;
  return error;
}

async function psql(container, sql, { allowFailure = false } = {}) {
  return run('docker', [
    'exec', '-i', container,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-A', '-t',
  ], { cwd: repositoryRoot, env: runEnv, input: sql, timeoutMs: 30_000, allowFailure });
}

let runEnv;
let cliPath;
let supabaseRoot;
let projectId;
let stackStartAttempted = false;
let tempRoot;
let exitCode = 0;
let currentStage = 'preflight';

async function main() {
  assert.equal(process.platform, 'linux', 'this validation runner is designed for the GitHub-hosted Ubuntu job');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'run only from the manually triggered GitHub Actions workflow');

  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.devDependencies?.supabase, pinnedCliVersion, 'root package.json must pin the reviewed Supabase CLI');
  assert.equal(await readFile(join(repositoryRoot, '.node-version'), 'utf8').then((value) => value.trim()), '26.13.0');
  cliPath = join(repositoryRoot, 'node_modules', '.bin', 'supabase');
  const migrationsRoot = join(repositoryRoot, 'supabase', 'migrations');
  const migrationNames = (await readdir(migrationsRoot)).filter((name) => name.endsWith('.sql')).sort();
  assert.equal(migrationNames.length, 19, 'expected migrations 1-19 and no additional migration files');
  assert.equal(migrationNames.at(-1), targetMigration, 'migration 19 must be the final migration');
  assert.equal(migrationNames.find((name) => name.startsWith(previousBaseline)) , '202611020004_paypal_webhook_durable_processing.sql');
  assert.ok(await access(cliPath).then(() => true).catch(() => false), 'pinned Supabase CLI binary is missing after npm ci');
  report('preflight', 'passed', { migrationFiles: migrationNames.length, supabaseCliVersion: pinnedCliVersion, nodeVersion: '26.13.0' });

  const runnerTemp = process.env.RUNNER_TEMP || tmpdir();
  tempRoot = await mkdtemp(join(runnerTemp, 'proofpay-project-completion-'));
  const homePath = join(tempRoot, 'home');
  const tempPath = join(tempRoot, 'tmp');
  supabaseRoot = join(tempRoot, 'workspace');
  const localMigrations = join(supabaseRoot, 'supabase', 'migrations');
  await Promise.all([mkdir(homePath, { recursive: true }), mkdir(tempPath, { recursive: true }), mkdir(localMigrations, { recursive: true })]);
  projectId = `ppv${randomBytes(7).toString('hex')}`;
  runEnv = makePrivateEnv(homePath, tempPath);

  const config = [
    `project_id = "${projectId}"`,
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
  await writeFile(join(supabaseRoot, 'supabase', 'config.toml'), config, { mode: 0o600 });
  for (const migrationName of migrationNames.slice(0, -1)) {
    await copyFile(join(migrationsRoot, migrationName), join(localMigrations, migrationName));
  }
  report('isolated_workspace', 'prepared', { localProjectId: projectId, migrationsInitiallyAvailable: 18, seedDisabled: true, linkedProjectMetadataCopied: false, environmentFilesCopied: false });

  currentStage = 'docker_engine';
  const dockerCheck = await run('docker', ['info', '--format', '{{.ServerVersion}}'], {
    cwd: supabaseRoot, env: runEnv, timeoutMs: 15_000,
  });
  report('docker_engine', 'ready', { exitStatus: dockerCheck.code, versionReported: Boolean(dockerCheck.stdout.trim()) });

  currentStage = 'supabase_cli';
  const cliVersion = await run(cliPath, ['--version'], { cwd: supabaseRoot, env: runEnv, timeoutMs: 30_000 });
  assert.match(`${cliVersion.stdout} ${cliVersion.stderr}`, new RegExp(`\\b${pinnedCliVersion.replaceAll('.', '\\.')}\\b`));
  report('supabase_cli', 'verified', { version: pinnedCliVersion });

  currentStage = 'local_stack';
  stackStartAttempted = true;
  await run(cliPath, ['start', '--exclude', optionalServicesToExclude], { cwd: supabaseRoot, env: runEnv, timeoutMs: 8 * 60_000 });
  report('local_stack', 'started', { optionalServicesExcluded: optionalServicesToExclude });

  currentStage = 'migrations_1_to_18';
  await run(cliPath, ['db', 'reset', '--local', '--no-seed'], { cwd: supabaseRoot, env: runEnv, timeoutMs: 12 * 60_000 });
  const container = `supabase_db_${projectId}`;
  const baselineHistory = await psql(container, 'select count(*) || \'|\' || max(version) from supabase_migrations.schema_migrations;');
  assert.equal(baselineHistory.stdout.trim(), '18|202611020004');
  report('migrations_1_to_18', 'applied_locally', { appliedCount: 18, latest: previousBaseline });

  currentStage = 'preexisting_project_fixture';
  await psql(container, await readFile(join(repositoryRoot, 'scripts', 'fixtures', 'project-completion-pre-migration.sql'), 'utf8'));
  const baselineProject = await psql(container, `
select status || '|' || (select count(*) from public.milestones where project_id = '00000000-0000-4000-8000-000000000100' and workflow_status = 'approved')
from public.projects where id = '00000000-0000-4000-8000-000000000100';
`);
  assert.equal(baselineProject.stdout.trim(), 'in_progress|2');
  report('preexisting_project_fixture', 'preserved', { projectStatus: 'in_progress', approvedMilestones: 2 });

  currentStage = 'transaction_rollback_probe';
  const migrationSql = await readFile(join(migrationsRoot, targetMigration), 'utf8');
  const failureInjection = migrationSql.replace(/\r?\ncommit;\s*$/i, '\nselect 1 / 0;\ncommit;\n');
  const injectionPrepared = failureInjection !== migrationSql;
  if (!injectionPrepared) {
    throw failWithSafeDiagnostic({
      failureType: 'rollback_probe_preparation_failed',
      check: 'failure_injection_prepared',
      expected: { prepared: true },
      observed: { prepared: false },
    });
  }

  let rollbackAttempt;
  let rollbackProcessStarted = true;
  try {
    rollbackAttempt = await psql(container, failureInjection, { allowFailure: true });
  } catch {
    rollbackProcessStarted = false;
    rollbackAttempt = { code: null, signal: null, timedOut: false, stdout: '', stderr: '' };
  }
  const injectedSqlCheck = evaluateInjectedSqlFailure({
    prepared: injectionPrepared,
    processStarted: rollbackProcessStarted,
    exitStatus: rollbackAttempt.code,
    signal: rollbackAttempt.signal,
    timedOut: rollbackAttempt.timedOut,
    databaseCondition: classifyDatabaseFailure(rollbackAttempt.stderr),
  });

  // Always inspect the disposable database after the attempt, even if psql
  // returned zero. This separates an ignored SQL error from a rollback-state
  // mismatch and verifies whether any migration-19 effects escaped.
  let rollbackStateResult;
  try {
    rollbackStateResult = await psql(container, rollbackStateSql);
  } catch (error) {
    const processFailure = error?.processResult
      ? safeProcessFailure(error.processResult)
      : { failureType: 'database_process_start_failed', processStarted: false };
    throw failWithSafeDiagnostic({
      failureType: 'rollback_state_query_failed',
      check: 'rollback_state_query',
      expected: { querySucceeded: true },
      observed: processFailure,
      injectedSql: injectedSqlCheck,
    });
  }

  const parsedRollbackState = parseRollbackState(rollbackStateResult.stdout);
  if (!parsedRollbackState.ok) {
    throw failWithSafeDiagnostic({
      failureType: 'rollback_state_output_invalid',
      check: 'rollback_state_output',
      expected: { stateQueryOutputParsed: true, stateValuesValid: true },
      observed: parsedRollbackState.observed,
      injectedSql: injectedSqlCheck,
    });
  }

  const rollbackStateCheck = evaluateRollbackState(parsedRollbackState.observed);
  if (!injectedSqlCheck.passed || !rollbackStateCheck.passed) {
    throw failWithSafeDiagnostic({
      failureType: 'rollback_probe_validation_failed',
      failedChecks: [
        ...(!injectedSqlCheck.passed ? [injectedSqlCheck.check] : []),
        ...rollbackStateCheck.failedChecks,
      ],
      expected: {
        injectedSqlExitStatus: 'non-zero',
        migrationHistoryCount: rollbackStateCheck.expected.migrationHistoryCount,
        migrationHistoryLatestVersion: rollbackStateCheck.expected.migrationHistoryLatestVersion,
        fixtureProjectRowCount: rollbackStateCheck.expected.fixtureProjectRowCount,
        projectStatus: rollbackStateCheck.expected.projectStatus,
        migrationOnlyFunctionsRemaining: rollbackStateCheck.expected.migrationOnlyFunctionsRemaining,
        originalFunctionsMissing: rollbackStateCheck.expected.originalFunctionsMissing,
        completionTriggerPresent: rollbackStateCheck.expected.completionTriggerPresent,
      },
      observed: {
        injectedSqlFailedAsIntended: injectedSqlCheck.passed,
        injectedSqlExitStatus: injectedSqlCheck.observed.exitStatus,
        injectedSqlSignal: injectedSqlCheck.observed.signal,
        injectedSqlTimedOut: injectedSqlCheck.observed.timedOut,
        injectedSqlDatabaseCondition: injectedSqlCheck.observed.databaseCondition,
        ...rollbackStateCheck.observed,
        migrationHistoryStill18: rollbackStateCheck.observed.migrationHistoryCount === 18,
        originalProjectStatusUnchanged: rollbackStateCheck.observed.projectStatus === 'in_progress',
        newFunctionsFullyRolledBack: rollbackStateCheck.observed.migrationOnlyFunctionsRemaining.length === 0
          && rollbackStateCheck.observed.originalFunctionsMissing.length === 0
          && rollbackStateCheck.observed.completionTriggerPresent === false,
      },
    });
  }

  report('transaction_rollback_probe', 'passed', {
    injectedSqlFailedAsIntended: true,
    injectedSqlExitStatus: rollbackAttempt.code,
    injectedSqlSignal: injectedSqlCheck.observed.signal,
    injectedSqlTimedOut: rollbackAttempt.timedOut,
    injectedSqlDatabaseCondition: injectedSqlCheck.observed.databaseCondition,
    expected: rollbackStateCheck.expected,
    observed: {
      ...rollbackStateCheck.observed,
      migrationHistoryStill18: true,
      originalProjectStatusUnchanged: true,
      newFunctionsFullyRolledBack: true,
    },
  });

  currentStage = 'migration_19';
  await copyFile(join(migrationsRoot, targetMigration), join(localMigrations, targetMigration));
  await run(cliPath, ['db', 'push', '--local'], { cwd: supabaseRoot, env: runEnv, timeoutMs: 8 * 60_000 });
  const expectedVersions = migrationNames.map((name) => name.split('_', 1)[0]).join(',');
  const appliedVersions = await psql(container, 'select string_agg(version, \',\' order by version) from supabase_migrations.schema_migrations;');
  assert.equal(appliedVersions.stdout.trim(), expectedVersions, 'local migration history does not match all 19 repository files');
  report('migration_19', 'applied_locally', { appliedCount: 19, latest: targetMigration.split('_', 1)[0], allVersionsMatchRepository: true });

  currentStage = 'postgresql_integration_tests';
  await psql(container, await readFile(join(repositoryRoot, 'scripts', 'fixtures', 'project-completion-post-migration.sql'), 'utf8'));
  const testRoot = join(supabaseRoot, 'supabase', 'tests');
  await mkdir(testRoot, { recursive: true });
  await copyFile(join(repositoryRoot, 'supabase', 'tests', 'project_completion_workflow.test.sql'), join(testRoot, 'project_completion_workflow.test.sql'));
  const pgTap = await run(cliPath, ['test', 'db', '--local'], { cwd: supabaseRoot, env: runEnv, timeoutMs: 8 * 60_000 });
  const tapLines = `${pgTap.stdout}\n${pgTap.stderr}`.split(/\r?\n/)
    .filter((line) => /^\s*(?:ok\s+\d+|not ok\s+\d+|1\.\.\d+|#\s*(?:tests|pass|fail|skip|todo)|All tests (?:passed|successful)|Files=|Result:)/i.test(line) || /\.\.\s*ok\s*$/i.test(line))
    .slice(-80);
  if (pgTap.code !== 0 || /not ok\s+\d+/i.test(`${pgTap.stdout}\n${pgTap.stderr}`)) throw new Error(`PostgreSQL integration tests failed: ${tapLines.join(' ').slice(0, 800)}`);
  report('postgresql_integration_tests', 'passed', { runner: 'supabase test db --local', tapSummary: tapLines.slice(-12) });

  currentStage = 'concurrent_approvals';
  await run(process.execPath, [join(repositoryRoot, 'scripts', 'test-project-completion-concurrency.mjs'), projectId], {
    cwd: repositoryRoot, env: runEnv, timeoutMs: 25_000,
  });
  report('concurrent_approvals', 'passed', { databaseSessions: 2, duplicateCompletionPreventionVerified: true });

  currentStage = 'final_database_state';
  const finalState = await psql(container, `
select
  (select count(*) from supabase_migrations.schema_migrations) || '|' ||
  (select status from public.projects where id = '00000000-0000-4000-8000-000000000200') || '|' ||
  (select status from public.invoices where id = '00000000-0000-4000-8000-000000000220') || '|' ||
  (select status from public.projects where id = '00000000-0000-4000-8000-000000000800') || '|' ||
  (select count(*) from public.activity_logs where project_id = '00000000-0000-4000-8000-000000000800' and event_type = 'project.completed');
`);
  assert.equal(finalState.stdout.trim(), '19|in_progress|paid|completed|1', 'final read-only compatibility checks failed');
  report('final_database_state', 'verified', { migrationCount: 19, pgtapChangesRolledBack: true, concurrencyProjectCompleted: true, completionEvents: 1, invoiceState: 'paid', pgtapProjectStateRestored: true });
}

try {
  await main();
} catch (error) {
  exitCode = 1;
  report(currentStage, 'failed', { diagnostic: safeDiagnostic(error), exitStatus: error?.processResult?.code ?? null, timedOut: Boolean(error?.processResult?.timedOut) });
} finally {
  if (stackStartAttempted && supabaseRoot && cliPath && runEnv) {
    const stopped = await run(cliPath, ['stop', '--no-backup'], { cwd: supabaseRoot, env: runEnv, timeoutMs: 90_000, allowFailure: true }).catch(() => null);
    report('local_stack_cleanup', stopped?.code === 0 ? 'stopped' : 'runner_disposal_fallback', { processExitStatus: stopped?.code ?? null });
  }
  if (tempRoot) {
    const resolved = resolve(tempRoot);
    const allowedParent = resolve(process.env.RUNNER_TEMP || tmpdir());
    assert.ok(resolved.startsWith(`${allowedParent}/`), 'refusing to remove a validation directory outside the runner temporary directory');
    await rm(resolved, { recursive: true, force: true });
    report('temporary_workspace_cleanup', 'removed');
  }
}

process.exitCode = exitCode;
