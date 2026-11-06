import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classifyDatabaseFailure,
  evaluateInjectedSqlFailure,
  evaluateRollbackState,
  extractFixtureStep,
  parseRollbackState,
  rollbackStateSql,
  safeProcessFailure,
} from './project-completion-rollback-checks.mjs';
import { sanitizeCiDiagnostic } from './sanitize-ci-diagnostic.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const workflow = read('.github/workflows/project-completion-postgres-validation.yml');
const runner = read('scripts/run-project-completion-postgres-validation.mjs');
const concurrency = read('scripts/test-project-completion-concurrency.mjs');
const sqlTests = read('supabase/tests/project_completion_workflow.test.sql');
const postMigrationFixture = read('scripts/fixtures/project-completion-post-migration.sql');
const fixtures = `${read('scripts/fixtures/project-completion-pre-migration.sql')}\n${read('scripts/fixtures/project-completion-post-migration.sql')}`;
const packageJson = JSON.parse(read('package.json'));
const migration = read('supabase/migrations/202611050001_project_completion_workflow.sql');
const cliExcludeNames = [
  'gotrue', 'realtime', 'storage-api', 'imgproxy', 'kong', 'mailpit',
  'postgrest', 'postgres-meta', 'studio', 'edge-runtime', 'logflare', 'vector', 'supavisor',
];
const preparedPaths = [
  '.github/workflows/project-completion-postgres-validation.yml',
  'scripts/fixtures/project-completion-pre-migration.sql',
  'scripts/fixtures/project-completion-post-migration.sql',
  'scripts/project-completion-rollback-checks.mjs',
  'scripts/run-project-completion-postgres-validation.mjs',
  'scripts/sanitize-ci-diagnostic.mjs',
  'scripts/test-project-completion-concurrency.mjs',
  'scripts/validate-project-completion-ci.test.mjs',
  'supabase/tests/project_completion_workflow.test.sql',
];

test('manual workflow is narrowly permissioned, branch-gated, pinned, and never deploys', () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/codex\/proofpay-staging-release'/);
  assert.match(workflow, /actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/);
  assert.match(workflow, /actions\/setup-node@a0853c24544627f65ddf259abe73b1d18a591444/);
  assert.match(workflow, /node-version-file: \.node-version/);
  assert.match(workflow, /timeout-minutes: 45/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|render|deploy|paypal|groq|service_role/i);
  assert.doesNotMatch(workflow, /contents:\s*(?:write|none)/);
});

test('workflow stops before Supabase image pulls when disk headroom is insufficient', () => {
  assert.match(workflow, /Check disk headroom before local Supabase image pulls/);
  assert.match(workflow, /docker info --format '\{\{\.DockerRootDir\}\}'/);
  assert.match(workflow, /df -Pk/);
  assert.match(workflow, /minimum_free_kib=\$\(\(6 \* 1024 \* 1024\)\)/);
  assert.match(workflow, /free_kib < minimum_free_kib/);
  assert.match(workflow, /Could not determine free disk space/);
});

test('workflow uses the repository-pinned CLI, Node version, locked install, and local-only validation', () => {
  assert.equal(packageJson.devDependencies.supabase, '2.122.0');
  assert.equal(read('.node-version').trim(), '26.13.0');
  assert.match(workflow, /npm ci --include=dev/);
  assert.match(workflow, /scripts\/validate-project-completion-ci\.test\.mjs/);
  assert.match(workflow, /scripts\/run-project-completion-postgres-validation\.mjs/);
  assert.match(runner, /assert\.equal\(packageJson\.devDependencies\?\.supabase, pinnedCliVersion/);
  assert.match(runner, /\['db', 'reset', '--local', '--no-seed'\]/);
  assert.match(runner, /\['db', 'push', '--local'\]/);
  assert.match(runner, /\['test', 'db', '--local'\]/);
  assert.match(runner, /'VERBOSITY=verbose'/);
  assert.match(runner, /failureType: 'postgresql_fixture_failure'/);
  assert.doesNotMatch(runner, /--linked|--project-ref|db\s+push[^\]]*remote/i);
  assert.match(runner, /assert\.equal\(process\.env\.GITHUB_ACTIONS, 'true'/);
  assert.match(runner, /supabase_db_\$\{projectId\}/);
});

test('Supabase CLI exclusions use supported container names and analytics is disabled by config', () => {
  const configuredExclusions = runner.match(/const optionalServicesToExclude = '([^']+)'/)?.[1]?.split(',') ?? [];
  assert.ok(configuredExclusions.length > 0, 'the isolated stack must keep its reviewed optional-service exclusions');
  assert.ok(configuredExclusions.every((name) => cliExcludeNames.includes(name)), 'start --exclude contains an unsupported service name');
  assert.match(runner, /\[analytics\][\s\S]*?enabled = false/);
});

test('temporary database workspace is synthetic, unlinked, seed-free, and credentials are not inherited', () => {
  assert.match(runner, /mkdtemp\(join\(runnerTemp, 'proofpay-project-completion-'\)\)/);
  assert.match(runner, /project_id = "\$\{projectId\}"/);
  assert.match(runner, /enabled = false[\s\S]*sql_paths = \[\]/);
  assert.match(runner, /const allowedNames = \['PATH', 'LANG', 'LC_ALL'\]/);
  assert.doesNotMatch(runner, /\.\.\.process\.env|copyFile\([^)]*\.env|\.supabase[\\/]/);
  assert.doesNotMatch(runner, /SUPABASE_URL|SERVICE_ROLE_KEY|PAYPAL_CLIENT_SECRET|GROQ_API_KEY/);
  assert.match(runner, /environmentFilesCopied: false/);
  assert.match(runner, /linkedProjectMetadataCopied: false/);
  assert.match(runner, /finally[\s\S]*\['stop', '--no-backup'\]/);
  assert.match(runner, /rm\(resolved, \{ recursive: true, force: true \}\)/);
  assert.match(fixtures, /example\.invalid/);
  assert.doesNotMatch(fixtures, /@proofpay\.invalid|[a-z0-9]{20}|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('rollback probe reports injected SQL exit and every post-rollback invariant separately', () => {
  assert.match(runner, /slice\(0, -1\)/);
  assert.match(runner, /select 1 \/ 0/);
  assert.match(runner, /const injectedSqlCheck = evaluateInjectedSqlFailure/);
  assert.match(runner, /const rollbackStateCheck = evaluateRollbackState/);
  assert.match(runner, /migrationHistoryStill18/);
  assert.match(runner, /originalProjectStatusUnchanged/);
  assert.match(runner, /newFunctionsFullyRolledBack/);
  assert.doesNotMatch(runner, /assert\.notEqual\(rollbackAttempt\.code/);
  assert.match(rollbackStateSql, /migrationHistoryCount/);
  assert.match(rollbackStateSql, /migrationHistoryLatestVersion/);
  assert.match(rollbackStateSql, /migrationOnlyFunctionsRemaining/);
  assert.match(rollbackStateSql, /originalFunctionsMissing/);
  assert.match(rollbackStateSql, /projects_prevent_completed_reopen/);
  assert.match(runner, /migrationHistoryStill18: true/);
  assert.match(runner, /allVersionsMatchRepository: true/);
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
});

test('rollback diagnostics identify an injected SQL command that unexpectedly exits zero', () => {
  assert.deepEqual(evaluateInjectedSqlFailure({
    prepared: true, processStarted: true, exitStatus: 0, timedOut: false, databaseCondition: 'division_by_zero',
  }), {
    passed: false,
    check: 'injected_sql_exit_status',
    expected: { exitStatus: 'non-zero' },
    observed: {
      prepared: true,
      processStarted: true,
      exitStatus: 0,
      signal: null,
      timedOut: false,
      databaseCondition: 'division_by_zero',
    },
  });
});

test('rollback diagnostics distinguish unstarted and timed out injected SQL', () => {
  const notStarted = evaluateInjectedSqlFailure({
    prepared: true, processStarted: false, exitStatus: null, timedOut: false,
  });
  assert.equal(notStarted.check, 'injected_sql_process_started');
  assert.equal(notStarted.observed.processStarted, false);

  const timedOut = evaluateInjectedSqlFailure({
    prepared: true, processStarted: true, exitStatus: null, timedOut: true,
  });
  assert.equal(timedOut.check, 'injected_sql_completed');
  assert.equal(timedOut.observed.timedOut, true);
});

test('rollback probe rejects unrelated SQL errors even when psql exits non-zero', () => {
  const result = evaluateInjectedSqlFailure({
    prepared: true,
    processStarted: true,
    exitStatus: 3,
    timedOut: false,
    databaseCondition: classifyDatabaseFailure('ERROR: permission denied'),
  });
  assert.equal(result.passed, false);
  assert.equal(result.check, 'injected_sql_failure_condition');
  assert.equal(result.observed.exitStatus, 3);
  assert.equal(result.observed.databaseCondition, 'unclassified_database_error');
});

test('rollback probe accepts only the intended division-by-zero failure', () => {
  const result = evaluateInjectedSqlFailure({
    prepared: true,
    processStarted: true,
    exitStatus: 3,
    timedOut: false,
    databaseCondition: classifyDatabaseFailure('ERROR: division by zero'),
  });
  assert.equal(result.passed, true);
  assert.equal(result.observed.databaseCondition, 'division_by_zero');
});

test('rollback probe accepts the specific PostgreSQL division-by-zero SQLSTATE', () => {
  const result = evaluateInjectedSqlFailure({
    prepared: true,
    processStarted: true,
    exitStatus: 3,
    timedOut: false,
    databaseCondition: classifyDatabaseFailure('SQLSTATE 22012'),
  });
  assert.equal(result.passed, true);
  assert.equal(result.observed.databaseCondition, 'sqlstate_22012');
});

test('rollback diagnostics show expected and observed migration, fixture, function, and trigger state', () => {
  const observed = {
    migrationHistoryCount: 19,
    migrationHistoryLatestVersion: '202611050001',
    fixtureProjectRowCount: 1,
    projectStatus: 'in_progress',
    migrationOnlyFunctionsRemaining: ['public.try_complete_fixed_price_project(uuid,text)'],
    originalFunctionsMissing: [],
    completionTriggerPresent: true,
  };
  const result = evaluateRollbackState(observed);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failedChecks, [
    'migrationHistoryCount',
    'migrationHistoryLatestVersion',
    'migrationOnlyFunctionsRemaining',
    'completionTriggerPresent',
  ]);
  assert.equal(result.expected.migrationHistoryCount, 18);
  assert.equal(result.observed.migrationHistoryCount, 19);
  assert.deepEqual(result.observed.migrationOnlyFunctionsRemaining, ['public.try_complete_fixed_price_project(uuid,text)']);
});

test('a successful rollback requires history and data unchanged and all migration-only functions removed', () => {
  const parsed = parseRollbackState(JSON.stringify({
    migrationHistoryCount: 18,
    migrationHistoryLatestVersion: '202611020004',
    fixtureProjectRowCount: 1,
    projectStatus: 'in_progress',
    migrationOnlyFunctionsRemaining: [],
    originalFunctionsMissing: [],
    completionTriggerPresent: false,
  }));
  assert.equal(parsed.ok, true);
  assert.equal(evaluateRollbackState(parsed.observed).passed, true);
});

test('rollback output parsing and process diagnostics never echo raw sensitive text', () => {
  const rawDiagnostic = 'SUPABASE_SERVICE_ROLE_KEY=synthetic-secret';
  const malformed = parseRollbackState(rawDiagnostic);
  assert.deepEqual(malformed, { ok: false, observed: { stateQueryOutputParsed: false, outputLength: rawDiagnostic.length } });
  assert.ok(!JSON.stringify(malformed).includes('synthetic-secret'));

  const diagnostic = safeProcessFailure({
    code: 3,
    signal: null,
    timedOut: false,
    stderr: 'ERROR: password=synthetic-password postgresql://postgres:secret@localhost/db eyJabc123456789012345678901234567890.token.sig',
  });
  const output = JSON.stringify(diagnostic);
  assert.equal(diagnostic.exitStatus, 3);
  assert.equal(diagnostic.signal, null);
  assert.ok(!output.includes('synthetic-password'));
  assert.ok(!output.includes('secret@localhost'));
  assert.ok(!output.includes('eyJabc123'));
  assert.equal(diagnostic.databaseCondition, 'unclassified_database_error');

  const killed = safeProcessFailure({ code: null, signal: 'SIGTERM', timedOut: false, stderr: '' });
  assert.equal(killed.exitStatus, null);
  assert.equal(killed.signal, 'SIGTERM');
  assert.equal(killed.timedOut, false);
});

test('post-migration fixture reports only allowlisted step markers on failure', () => {
  for (const step of [
    'begin', 'project_200', 'project_300', 'project_400', 'project_500', 'project_600',
    'project_700', 'project_800', 'project_900', 'paid_invoice', 'scope_requests',
    'change_order_versions', 'commit',
  ]) assert.match(postMigrationFixture, new RegExp(`\\\\echo fixture_step=${step}`));

  assert.equal(extractFixtureStep('fixture_step=project_200\nfixture_step=paid_invoice\n'), 'paid_invoice');
  assert.equal(extractFixtureStep('fixture_step=password=private-value\n'), null);
  assert.match(runner, /fixtureName = 'project-completion-post-migration\.sql'/);
  assert.match(runner, /fixtureStep: processFailure\.fixtureStep/);
});

test('database fixture failures expose SQLSTATE and safe object names without raw SQL details', () => {
  const syntheticError = [
    'ERROR:  23514: row with synthetic private value violates check constraint "milestones_workflow_status_check"',
    'CONSTRAINT: milestones_workflow_status_check',
    'CONTEXT: PL/pgSQL function public.prevent_completed_project_reopen() line 4 at RAISE',
    'STATEMENT: insert into public.milestones values (\'synthetic-private-value\')',
  ].join('\n');
  const diagnostic = safeProcessFailure({
    code: 3,
    signal: null,
    timedOut: false,
    stderr: syntheticError,
    stdout: 'fixture_step=project_700\n',
  });
  assert.equal(diagnostic.sqlState, '23514');
  assert.equal(diagnostic.failureCategory, 'check_violation');
  assert.equal(diagnostic.constraint, 'milestones_workflow_status_check');
  assert.equal(diagnostic.triggerFunction, 'public.prevent_completed_project_reopen');
  assert.equal(diagnostic.fixtureStep, 'project_700');
  const serialized = JSON.stringify(diagnostic);
  assert.ok(!serialized.includes('synthetic private value'));
  assert.ok(!serialized.includes('synthetic-private-value'));
  assert.ok(!serialized.includes('STATEMENT'));
});

test('SQL integration suite covers guards, permissions, recheck, history, idempotency, RLS, and payment isolation', () => {
  for (const phrase of [
    'migration 19 leaves the pre-existing all-approved project unchanged',
    'an authorized freelancer can explicitly recheck an existing eligible project',
    'the final approved milestone completes an eligible fixed-price project',
    'a revision-requested milestone blocks completion',
    'a pending scope-change request blocks completion',
    'an analyzed scope request without a rejected outcome blocks completion',
    'an accepted amendment without represented milestones blocks completion',
    'hourly projects are excluded from fixed-price milestone completion',
    'replaying an identical final review is idempotent after completion',
    'an unrelated authenticated user cannot complete another project',
    'RLS hides project and scope data from an unrelated authenticated user',
    'completion does not change the synthetic invoice payment status',
    'completion leaves the verified payment timestamp and provider status intact',
  ]) assert.ok(sqlTests.includes(phrase), `missing PostgreSQL scenario: ${phrase}`);
  assert.match(sqlTests, /not has_function_privilege\('anon'/);
  assert.match(sqlTests, /not has_function_privilege\('authenticated', 'public\.review_milestone_unlocked/);
  assert.match(sqlTests, /extensions\.throws_ok/);
  assert.match(sqlTests, /rollback;/);
});

test('concurrency test uses two independent database sessions and verifies one completion transition', () => {
  assert.equal((concurrency.match(/const connection(?:One|Two) = startPsql\(container,/g) ?? []).length, 2);
  assert.match(concurrency, /pg_stat_activity/);
  assert.match(concurrency, /wait_event_type = 'Lock'/);
  assert.match(concurrency, /completed\|2\|1/);
  assert.match(runner, /test-project-completion-concurrency\.mjs/);
});

test('prepared workflow and test files have clean line endings and no trailing whitespace', () => {
  for (const path of preparedPaths) {
    const source = read(path);
    assert.ok(source.endsWith('\n'), `${path} must end with a newline`);
    assert.doesNotMatch(source, /[\t ]+\r?$/m, `${path} contains trailing whitespace`);
  }
});

test('failure diagnostics redact tokens, API keys, database passwords, and bearer credentials', () => {
  const synthetic = [
    'request failed: eyJabcdefghijklmnopqrstuvwxyz0123456789.eyJabcdefghijklmnopqrstuvwxyz0123456789.signature',
    'SUPABASE_SERVICE_ROLE_KEY=synthetic-service-role-secret',
    'connection failed postgresql://postgres:synthetic-db-password@127.0.0.1:54321/postgres',
    'Authorization: Bearer synthetic-access-token-value',
  ].join('\n');
  const sanitized = sanitizeCiDiagnostic(synthetic);
  for (const secret of ['eyJabcdefghijklmnopqrstuvwxyz', 'synthetic-service-role-secret', 'synthetic-db-password', 'synthetic-access-token-value']) {
    assert.ok(!sanitized.includes(secret), `diagnostic leaked ${secret.slice(0, 8)}`);
  }
  assert.match(sanitized, /\[redacted\]/);
});
