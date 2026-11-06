import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(root, 'supabase', 'migrations');
const predecessorName = '202611010003_scope_analysis_provider_compatibility.sql';
const migrationName = '202611020001_scope_analysis_actor_membership.sql';
const laterMigrationName = '202611020002_paypal_client_billing_email.sql';
const newestMigrationName = '202611020003_paypal_claim_invoice_number_scope.sql';
const webhookMigrationName = '202611020004_paypal_webhook_durable_processing.sql';
const completionMigrationName = '202611050001_project_completion_workflow.sql';
const predecessor = readFileSync(join(migrationsDirectory, predecessorName), 'utf8');
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
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

const previousFunction = functionSql(predecessor);
const correctedFunction = functionSql(migration);

test('actor membership correction remains migration 15 ahead of later corrections', () => {
  assert.equal(migrationFiles.indexOf(predecessorName), 13, 'Provider compatibility must remain migration 14');
  assert.equal(migrationFiles.indexOf(migrationName), 14, 'Actor-membership correction must be migration 15');
  assert.equal(migrationFiles.indexOf(laterMigrationName), 15, 'Invoice-recipient correction must follow migration 15');
  assert.equal(migrationFiles.indexOf(newestMigrationName), 16, 'Invoice-claim correction must remain migration 17');
  assert.equal(migrationFiles.indexOf(webhookMigrationName), 17, 'Webhook durability migration must follow all 17 existing migrations');
  assert.equal(migrationFiles.indexOf(completionMigrationName), 18, 'Project completion workflow must follow webhook durability migration');
  assert.equal(migrationFiles.at(-1), completionMigrationName, 'Project completion workflow must be last in timestamp order');
  assert.match(migration.trim().toLowerCase(), /^begin;/);
  assert.match(migration.trim().toLowerCase(), /commit;$/);
  assert.equal((migration.match(/create or replace function/gi) ?? []).length, 1);
});

test('the service-role audit binds the supplied actor to a client or freelancer membership', () => {
  assert.match(correctedFunction, /if auth\.role\(\) is distinct from 'service_role' then/);
  assert.match(correctedFunction, /if actor_id is null or not exists \( select 1 from public\.project_members pm where pm\.project_id = p_project_id and pm\.user_id = actor_id and pm\.role in \('client', 'freelancer'\) \) then/);
  assert.doesNotMatch(correctedFunction, /public\.is_project_member\s*\(/);
  assert.doesNotMatch(correctedFunction, /auth\.uid\s*\(/);

  const memberships = [
    { projectId: 'project-a', userId: 'client-a', role: 'client' },
    { projectId: 'project-a', userId: 'freelancer-a', role: 'freelancer' },
    { projectId: 'project-b', userId: 'unrelated', role: 'client' },
  ];
  const mayPersist = (databaseRole, actorId, projectId) => databaseRole === 'service_role'
    && actorId !== null
    && memberships.some((member) => member.projectId === projectId
      && member.userId === actorId
      && ['client', 'freelancer'].includes(member.role));

  assert.equal(mayPersist('service_role', 'client-a', 'project-a'), true);
  assert.equal(mayPersist('service_role', 'freelancer-a', 'project-a'), true);
  assert.equal(mayPersist('service_role', 'unrelated', 'project-a'), false);
  assert.equal(mayPersist('service_role', 'client-a', 'project-b'), false);
  assert.equal(mayPersist('service_role', null, 'project-a'), false);
  assert.equal(mayPersist('authenticated', 'client-a', 'project-a'), false);
  assert.equal(mayPersist('anon', 'client-a', 'project-a'), false);
});

test('the correction changes only the membership identity source and preserves the remaining function body', () => {
  const oldGate = "if actor_id is null or not public.is_project_member(p_project_id) then";
  const newGate = "if actor_id is null or not exists ( select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = actor_id and pm.role in ('client', 'freelancer') ) then";
  assert.equal(previousFunction.split(oldGate).length, 2, 'Expected one original auth.uid-based gate');
  assert.equal(correctedFunction, previousFunction.replace(oldGate, newGate));
  assert.match(correctedFunction, /insert into public\.ai_analysis_records \( project_id, change_request_id, agreement_version_id, requested_by, provider, model, input_hash, result \) values \( p_project_id, p_request_id, p_agreement_version_id, actor_id, p_provider,/);
  assert.match(correctedFunction, /update public\.change_requests set status = 'analyzed' where id = p_request_id and status = 'pending_analysis'/);
  assert.match(correctedFunction, /'scope\.analysis_recorded'/);
});

test('the corrective migration preserves function security and does not change grants or RLS', () => {
  assert.match(correctedFunction, /security definer set search_path = pg_catalog, public, extensions/);
  assert.match(correctedFunction, /if auth\.role\(\) is distinct from 'service_role' then/);
  assert.match(previousFunction, /if auth\.role\(\) is distinct from 'service_role' then/);
  assert.match(originalMigration.toLowerCase(), /revoke all on function public\.record_scope_analysis\(uuid, uuid, uuid, uuid, text, text, text, jsonb\) from public, anon, authenticated/);
  assert.match(originalMigration.toLowerCase(), /grant execute on function public\.record_scope_analysis\(uuid, uuid, uuid, uuid, text, text, text, jsonb\) to service_role/);
  assert.doesNotMatch(migration.toLowerCase(), /\b(grant|revoke|create policy|drop policy|disable row level security)\b/);
});
