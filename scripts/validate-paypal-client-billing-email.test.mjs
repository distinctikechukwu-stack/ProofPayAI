import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(root, 'supabase', 'migrations');
const migrationName = '202611020002_paypal_client_billing_email.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const originalMigration = readFileSync(join(migrationsDirectory, '202610290002_paypal_invoice_workflow.sql'), 'utf8');
const normalizedMigration = migration.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const files = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function functionDefinition(sql, name) {
  const start = sql.toLowerCase().indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const bodyStart = sql.indexOf('as $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && bodyEnd > bodyStart, `Malformed function ${name}`);
  return sql.slice(start, bodyEnd + 3).toLowerCase().replace(/\s+/g, ' ');
}

const body = functionDefinition(migration, 'begin_paypal_invoice_create');
const originalBody = functionDefinition(originalMigration, 'begin_paypal_invoice_create');
const recipientLookupPattern = /select (?:u\.email|coalesce\(nullif\(btrim\(client_profile\.billing_email\), ''\), nullif\(btrim\(auth_user\.email\), ''\)\)) into target_client_email[\s\S]*?limit 1;/;

function withoutRecipientLookup(value) {
  const stripped = value.replace(recipientLookupPattern, 'recipient_lookup;');
  assert.notEqual(stripped, value, 'Expected exactly one recipient lookup to be replaced');
  return stripped;
}

test('billing recipient correction is a new, transactional, single-function migration', () => {
  assert.ok(files.indexOf(migrationName) > files.indexOf('202611020001_scope_analysis_actor_membership.sql'));
  assert.match(normalizedMigration, /^begin;/);
  assert.match(normalizedMigration, /commit;$/);
  assert.equal((normalizedMigration.match(/create or replace function/g) ?? []).length, 1);
  assert.match(normalizedMigration, /create or replace function public\.begin_paypal_invoice_create\(p_milestone_id uuid,\s*p_invoice_number text,\s*p_actor_id uuid\)/);
  assert.doesNotMatch(normalizedMigration, /\b(grant|revoke|alter table|create policy|drop policy|disable row level security|truncate)\b/);
  assert.equal(withoutRecipientLookup(body), withoutRecipientLookup(originalBody), 'All non-recipient function logic must remain byte-for-byte equivalent after normalization');
});

test('a configured private client billing email takes precedence, with Auth email as blank fallback', () => {
  assert.match(body, /select coalesce\(nullif\(btrim\(client_profile\.billing_email\), ''\), nullif\(btrim\(auth_user\.email\), ''\)\) into target_client_email/);
  assert.match(body, /join auth\.users auth_user on auth_user\.id = project_client\.user_id/);
  assert.match(body, /left join public\.client_profiles client_profile on client_profile\.user_id = project_client\.user_id/);
  assert.match(body, /where project_client\.project_id = target_project_id and project_client\.role = 'client'/);
  assert.match(body, /target_client_email !~\* '\^\[\^@\[:space:\]\]\+@\[\^@\[:space:\]\]\+\\\.\[\^@\[:space:\]\]\+\$'/);
  assert.doesNotMatch(body, /p_(?:client|recipient)_email/);
});

test('service-role restriction and verified freelancer actor remain intact', () => {
  assert.match(body, /security definer set search_path = pg_catalog, public, auth/);
  assert.match(body, /if auth\.role\(\) is distinct from 'service_role' or actor_id is null/);
  assert.match(body, /pm\.user_id = actor_id and pm\.role = 'freelancer'/);
  assert.match(originalMigration.toLowerCase(), /revoke all on function public\.begin_paypal_invoice_create\(uuid, text, uuid\) from public, anon, authenticated/);
  assert.match(originalMigration.toLowerCase(), /grant execute on function public\.begin_paypal_invoice_create\(uuid, text, uuid\) to service_role/);
  assert.doesNotMatch(normalizedMigration, /p_actor_id\s*:=|actor_id\s*:=\s*auth\.uid\(\)/);
});

test('current agreement, dual acceptance, approved milestone, and client recipient membership remain required', () => {
  assert.match(body, /p\.current_agreement_version_id = av\.id/);
  assert.match(body, /av\.state = 'accepted'/);
  assert.match(body, /m\.workflow_status = 'approved'/);
  assert.match(body, /count\(distinct aa\.member_role\).* = 2/);
  assert.match(body, /project_client\.project_id = target_project_id and project_client\.role = 'client'/);
  assert.match(body, /for update of p, m/);
});

test('recipient selection does not weaken invoice claim serialization or duplicate prevention', () => {
  assert.match(body, /pg_advisory_xact_lock\(hashtextextended\(p_milestone_id::text, 0\)\)/);
  assert.match(body, /if found and target_invoice\.status <> 'not_created' then/);
  assert.match(body, /operation_key := 'create:' \|\| p_milestone_id::text \|\| ':' \|\| target_agreement_id::text/);
  assert.match(body, /insert into public\.invoices/);
  assert.match(body, /insert into public\.paypal_operation_claims/);
  assert.match(body, /'clientemail', target_client_email/);
});
