import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(repositoryRoot, 'supabase', 'migrations');
const migrationName = '202610310004_hourly_acceptance_trigger_privileges.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const normalized = migration.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const workflow = readFileSync(join(migrationsDirectory, '202610310003_workflow_sql_corrections.sql'), 'utf8').toLowerCase();
const hourlySchema = readFileSync(join(migrationsDirectory, '202610300004_hourly_workflows.sql'), 'utf8').toLowerCase();
const viewHardening = readFileSync(join(migrationsDirectory, '202610310001_view_access_hardening.sql'), 'utf8').toLowerCase();
const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function workflowFunctionBody(functionName) {
  const start = workflow.indexOf(`create or replace function public.${functionName}(`);
  assert.notEqual(start, -1, `Missing workflow function ${functionName}`);
  const bodyStart = workflow.indexOf('as $$', start);
  const bodyEnd = workflow.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && bodyEnd > bodyStart, `Malformed workflow function ${functionName}`);
  return workflow.slice(bodyStart + 5, bodyEnd).replace(/\s+/g, ' ');
}

test('hourly acceptance privilege fix is the next transactional migration and contains only the missing column grant', () => {
  assert.ok(migrationFiles.indexOf(migrationName) > migrationFiles.indexOf('202610310003_workflow_sql_corrections.sql'));
  assert.match(normalized, /^begin;/);
  assert.match(normalized, /commit;$/);
  const statements = normalized.replace(/^begin;|commit;$/g, '').split(';').map((item) => item.trim()).filter(Boolean).sort();
  assert.deepEqual(statements, ['grant select (client_id) on public.hourly_contracts to authenticated']);
});

test('client_id is added only as a column-level grant while the existing project-member RLS policy remains responsible for row access', () => {
  assert.match(normalized, /grant select \(client_id\) on public\.hourly_contracts to authenticated/);
  assert.match(hourlySchema, /alter table public\.hourly_contracts enable row level security/);
  assert.match(hourlySchema, /create policy hourly_contracts_read_member on public\.hourly_contracts for select to authenticated using\(public\.is_project_member\(project_id\)\)/);
  assert.match(viewHardening, /grant select \(project_id,freelancer_id,hourly_rate_minor,currency,status,agreement_version_id\)\s+on public\.hourly_contracts to authenticated/);
  assert.doesNotMatch(normalized, /\b(create policy|drop policy|enable row level security|disable row level security)\b/);
  assert.doesNotMatch(normalized, /grant select on public\.hourly_contracts/);
  assert.doesNotMatch(normalized, /\b(create|alter|drop) table\b/);
  assert.doesNotMatch(normalized, /\b(insert|update|delete|truncate)\b/);
});

test('the trigger continues to run as invoker and read the client id required for its contract checks', () => {
  const triggerFunction = workflowFunctionBody('assert_accepted_agreement_total');
  assert.match(triggerFunction, /from public\.hourly_contracts as contract_row/);
  assert.match(triggerFunction, /contract_row\.freelancer_id, contract_row\.client_id/);
  assert.doesNotMatch(normalized, /security definer|grant execute|revoke all on function/);
});

test('the hourly acceptance RPC keeps member, named-party, draft-contract, and dual-approval checks', () => {
  const body = workflowFunctionBody('accept_agreement_version');
  assert.match(body, /actor_id uuid := auth\.uid\(\)/);
  assert.match(body, /actor_role not in \('client', 'freelancer'\)/);
  assert.match(body, /contract_row\.status = 'draft'/);
  assert.match(body, /actor_id = contract_freelancer_id/);
  assert.match(body, /actor_id = contract_client_id/);
  assert.match(body, /accepted_count = 2/);
  assert.match(body, /set status = 'active'/);
  assert.match(body, /activated_contract_count <> 1/);
  assert.match(body, /milestone_total is distinct from agreement_total::numeric/);
});
