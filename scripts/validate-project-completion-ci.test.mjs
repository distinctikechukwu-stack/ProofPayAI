import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { sanitizeCiDiagnostic } from './sanitize-ci-diagnostic.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const workflow = read('.github/workflows/project-completion-postgres-validation.yml');
const runner = read('scripts/run-project-completion-postgres-validation.mjs');
const concurrency = read('scripts/test-project-completion-concurrency.mjs');
const sqlTests = read('supabase/tests/project_completion_workflow.test.sql');
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

test('rollback probe fails before applying migration 19, then asserts migration 1-18 data and schema are unchanged', () => {
  assert.match(runner, /slice\(0, -1\)/);
  assert.match(runner, /select 1 \/ 0/);
  assert.match(runner, /18\|in_progress\|t\|t/);
  assert.match(runner, /migrationHistoryStill18: true/);
  assert.match(runner, /allVersionsMatchRepository: true/);
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
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
