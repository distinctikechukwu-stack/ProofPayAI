import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(root, 'supabase', 'migrations');
const migrationName = '202611010003_scope_analysis_provider_compatibility.sql';
const correctiveName = '202611020001_scope_analysis_actor_membership.sql';
const laterMigrationName = '202611020002_paypal_client_billing_email.sql';
const newestMigrationName = '202611020003_paypal_claim_invoice_number_scope.sql';
const webhookMigrationName = '202611020004_paypal_webhook_durable_processing.sql';
const completionMigrationName = '202611050001_project_completion_workflow.sql';
const paypalOrderingMigrationName = '202611070001_paypal_provider_snapshot_ordering.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const correctiveMigration = readFileSync(join(migrationsDirectory, correctiveName), 'utf8');
const originalMigration = readFileSync(join(migrationsDirectory, '202610290001_core_project_security.sql'), 'utf8');
const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function functionSql(sql) {
  const start = sql.indexOf('create or replace function public.record_scope_analysis(');
  assert.notEqual(start, -1, 'Missing record_scope_analysis function');
  const bodyStart = sql.indexOf('as $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && bodyEnd > bodyStart, 'Malformed record_scope_analysis function');
  return sql.slice(start, bodyEnd + 3).toLowerCase().replace(/\s+/g, ' ').trim();
}

const proposedFunction = functionSql(migration);
const originalFunction = functionSql(originalMigration);

test('provider compatibility remains migration 14 ahead of later corrections', () => {
  assert.equal(migrationFiles.indexOf(migrationName), 13, 'Compatibility migration must remain after thirteen earlier versions');
  assert.equal(migrationFiles.indexOf(correctiveName), 14, 'Actor-membership correction must follow provider compatibility');
  assert.equal(migrationFiles.indexOf(laterMigrationName), 15, 'Invoice-recipient correction must follow actor-membership migration');
  assert.equal(migrationFiles.indexOf(newestMigrationName), 16, 'Invoice-claim correction must remain migration 17');
  assert.equal(migrationFiles.indexOf(webhookMigrationName), 17, 'Webhook durability migration must follow all 17 existing migrations');
  assert.equal(migrationFiles.indexOf(completionMigrationName), 18, 'Project completion workflow must follow webhook durability migration');
  assert.equal(migrationFiles.indexOf(paypalOrderingMigrationName), 19, 'PayPal provider snapshot ordering must follow project completion');
  assert.equal(migrationFiles.at(-1), paypalOrderingMigrationName, 'PayPal provider snapshot ordering must be last in timestamp order');
  assert.match(migration.trim().toLowerCase(), /^begin;/);
  assert.match(migration.trim().toLowerCase(), /commit;$/);
  assert.equal((migration.match(/create or replace function/gi) ?? []).length, 1);
});

test('the strict allow-list accepts OpenAI and Groq and rejects all other values', () => {
  assert.match(proposedFunction, /or \(p_provider is distinct from 'openai' and p_provider is distinct from 'groq'\)/);
  const invalidProvider = (provider) => provider !== 'openai' && provider !== 'groq';
  assert.equal(invalidProvider('openai'), false);
  assert.equal(invalidProvider('groq'), false);
  assert.equal(invalidProvider('other-provider'), true);
  assert.equal(invalidProvider(''), true);
  assert.equal(invalidProvider(null), true);
  assert.match(proposedFunction, /raise exception 'scope analysis result or audit metadata is invalid\.' using errcode = '22023'/);
});

test('the audit stores the selected provider instead of mislabeling Groq results as OpenAI', () => {
  assert.match(proposedFunction, /insert into public\.ai_analysis_records[\s\S]*?values \( p_project_id, p_request_id, p_agreement_version_id, actor_id, p_provider,/);
  assert.doesNotMatch(proposedFunction, /actor_id, 'openai', left\(nullif\(trim\(p_model\)/);
});

test('migration 14 retains the service-role guard and deployed function ACLs', () => {
  assert.match(proposedFunction, /security definer set search_path = pg_catalog, public, extensions/);
  assert.match(proposedFunction, /if auth\.role\(\) is distinct from 'service_role' then/);
  assert.match(proposedFunction, /if actor_id is null or not public\.is_project_member\(p_project_id\) then/);
  assert.match(originalMigration.toLowerCase(), /revoke all on function public\.record_scope_analysis\(uuid, uuid, uuid, uuid, text, text, text, jsonb\) from public, anon, authenticated/);
  assert.match(originalMigration.toLowerCase(), /grant execute on function public\.record_scope_analysis\(uuid, uuid, uuid, uuid, text, text, text, jsonb\) to service_role/);
  assert.doesNotMatch(migration.toLowerCase(), /\b(grant|revoke|create policy|drop policy|disable row level security)\b/);
  assert.match(functionSql(correctiveMigration), /if actor_id is null or not exists \( select 1 from public\.project_members pm where pm\.project_id = p_project_id and pm\.user_id = actor_id and pm\.role in \('client', 'freelancer'\) \) then/);
});

test('all scope, agreement, citation, evidence, and audit behavior is unchanged beyond the two provider substitutions', () => {
  const expected = originalFunction
    .replace("or p_provider is distinct from 'openai'", "or (p_provider is distinct from 'openai' and p_provider is distinct from 'groq')")
    .replace("actor_id, 'openai', left(nullif(trim(p_model), ''), 160)", "actor_id, p_provider, left(nullif(trim(p_model), ''), 160)");
  assert.equal(proposedFunction, expected);
});
