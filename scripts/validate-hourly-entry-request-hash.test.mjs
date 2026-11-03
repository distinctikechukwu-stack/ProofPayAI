import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(repositoryRoot, 'supabase', 'migrations');
const migrationName = '202611010001_hourly_entry_request_hash_qualification.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const normalized = migration.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const original = readFileSync(join(migrationsDirectory, '202610300004_hourly_workflows.sql'), 'utf8').toLowerCase();
const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function functionBody(sql, functionName) {
  const start = sql.indexOf(`create or replace function public.${functionName}(`);
  assert.notEqual(start, -1, `Missing function ${functionName}`);
  const bodyStart = sql.indexOf('as $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && bodyEnd > bodyStart, `Malformed function ${functionName}`);
  return sql.slice(bodyStart + 5, bodyEnd).replace(/\s+/g, ' ');
}

test('entry ambiguity correction is a new transactional migration after all 11 applied versions', () => {
  assert.ok(migrationFiles.indexOf(migrationName) > migrationFiles.indexOf('202610310004_hourly_acceptance_trigger_privileges.sql'));
  assert.match(normalized, /^begin;/);
  assert.match(normalized, /commit;$/);
  assert.match(normalized, /create or replace function public\.create_manual_hourly_time_entry\(p_project_id uuid,p_input jsonb\)/);
  assert.doesNotMatch(normalized, /\b(grant|revoke|create policy|drop policy|disable row level security|delete from|update public\.)\b/);
});

test('idempotency lookup qualifies the stored request_hash column and avoids the PL/pgSQL variable collision', () => {
  const body = functionBody(migration, 'create_manual_hourly_time_entry');
  assert.match(body, /select entry_row\.id,entry_row\.request_hash into entry_id,existing_hash from public\.hourly_time_entries as entry_row where entry_row\.freelancer_id=actor_id and entry_row\.idempotency_key=key_id/);
  assert.doesNotMatch(body, /select\s+id\s*,\s*request_hash\s+into/);
  assert.match(original, /select id,request_hash into entry_id,existing_hash from public\.hourly_time_entries where freelancer_id=actor_id and idempotency_key=key_id/);
});

test('function replacement preserves authentication, freelancer ownership, active-contract, validation, and idempotency checks', () => {
  const body = functionBody(migration, 'create_manual_hourly_time_entry');
  for (const expression of [
    /actor_id uuid:=auth\.uid\(\)/,
    /if actor_id is null then raise exception/,
    /contract_row\.freelancer_id<>actor_id/,
    /contract_row\.status<>'active'/,
    /not public\.is_active_hourly_project\(p_project_id\)/,
    /perform pg_advisory_xact_lock/,
    /if existing_hash<>request_hash then raise exception/,
    /insert into public\.hourly_time_entry_events/,
  ]) assert.match(body, expression);
  assert.match(normalized, /security definer set search_path=pg_catalog,public,extensions/);
  assert.match(original, /grant execute on function public\.create_manual_hourly_time_entry\(uuid,jsonb\),[\s\S]*?to authenticated/);
});
