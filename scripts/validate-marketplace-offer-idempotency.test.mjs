import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(root, 'supabase', 'migrations');
const migrationName = '202611010002_marketplace_offer_idempotency_hash_qualification.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const normalized = migration.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const original = readFileSync(join(migrationsDirectory, '202610300002_marketplace_jobs.sql'), 'utf8').toLowerCase();
const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function functionBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const bodyStart = sql.indexOf('as $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && bodyEnd > bodyStart, `Malformed function ${name}`);
  return sql.slice(bodyStart + 5, bodyEnd).toLowerCase().replace(/\s+/g, ' ');
}

const body = functionBody(migration, 'create_marketplace_offer');
const replayStart = body.indexOf('if offer_id is not null then');
const creationStart = body.indexOf('select * into proposal', replayStart);
assert.ok(replayStart >= 0 && creationStart > replayStart, 'Offer replay branch must precede new offer creation');
const replayBranch = body.slice(replayStart, creationStart);

test('offer ambiguity correction is a new transactional migration after all twelve applied versions', () => {
  assert.ok(migrationFiles.indexOf(migrationName) > migrationFiles.indexOf('202611010001_hourly_entry_request_hash_qualification.sql'));
  assert.match(normalized, /^begin;/);
  assert.match(normalized, /commit;$/);
  assert.match(normalized, /create or replace function public\.create_marketplace_offer\(p_proposal_id uuid,p_input jsonb\)/);
  assert.equal((normalized.match(/create or replace function/g) ?? []).length, 1);
  assert.doesNotMatch(normalized, /\b(grant|revoke|create policy|drop policy|disable row level security|delete from|truncate)\b/);
});

test('the stored hash column and local hash value are explicitly distinct and qualified', () => {
  assert.match(body, /request_hash_value:=encode\(extensions\.digest\(p_proposal_id::text\|\|e'\\n'\|\|p_input::text,'sha256'\),'hex'\)/);
  assert.match(body, /existing_offer\.request_hash=request_hash_value/);
  assert.doesNotMatch(body, /\brequest_hash\s*=\s*request_hash\b/);
  assert.match(original, /where id=offer_id and request_hash=request_hash and client_id=actor_id/);
});

test('an identical retry returns the existing offer before reaching the insert path', () => {
  assert.match(body.slice(0, replayStart), /select marketplace_offers\.id into offer_id from public\.marketplace_offers where marketplace_offers\.idempotency_key=key_id/);
  assert.match(replayBranch, /existing_offer\.request_hash=request_hash_value and existing_offer\.client_id=actor_id/);
  assert.match(replayBranch, /select existing_offer\.status,existing_offer\.project_id into existing_status,existing_project/);
  assert.match(replayBranch, /return jsonb_build_object\('offerid',offer_id,'status',existing_status,'projectid',existing_project,'alreadycreated',true\)/);
  assert.doesNotMatch(replayBranch, /\binsert\s+into\s+public\.marketplace_offers\b/);
  assert.ok(body.indexOf('return jsonb_build_object(\'offerid\',offer_id') < body.indexOf('insert into public.marketplace_offers'));
});

test('reusing a key with changed details raises the existing conflict code', () => {
  assert.match(body, /request_hash_value:=encode\(extensions\.digest\(p_proposal_id::text\|\|e'\\n'\|\|p_input::text,'sha256'\),'hex'\)/);
  assert.match(replayBranch, /if not exists \( select 1 from public\.marketplace_offers as existing_offer where existing_offer\.id=offer_id and existing_offer\.request_hash=request_hash_value and existing_offer\.client_id=actor_id \) then raise exception 'offer key conflicts with prior details' using errcode = '23505'/);
  assert.ok(replayBranch.indexOf("errcode = '23505'") < replayBranch.indexOf('return jsonb_build_object'));
});

test('another client cannot retrieve or reuse an offer idempotency key', () => {
  assert.match(replayBranch, /existing_offer\.client_id=actor_id/);
  assert.match(replayBranch, /if not exists[\s\S]*?raise exception 'offer key conflicts with prior details' using errcode = '23505'/);
  assert.match(body, /if job_row\.created_by<>actor_id or job_row\.status not in/);
  assert.match(body, /proposal\.status not in \('submitted','shortlisted','interview_invited'\)/);
  assert.match(body, /values\(p_proposal_id,proposal\.job_id,actor_id,proposal\.freelancer_id,key_id,request_hash_value/);
});

test('related marketplace idempotency checks are qualified and PayPal SQL has no request-hash local collision', () => {
  const jobs = functionBody(original, 'save_marketplace_job');
  const serviceRequests = functionBody(original, 'request_freelancer_service');
  assert.match(jobs, /marketplace_jobs\.request_hash/);
  assert.match(serviceRequests, /service_hiring_requests\.request_hash/);
  assert.doesNotMatch(jobs, /\brequest_hash\s*=\s*request_hash\b/);
  assert.doesNotMatch(serviceRequests, /\brequest_hash\s*=\s*request_hash\b/);
  const paypal = readFileSync(join(migrationsDirectory, '202610290002_paypal_invoice_workflow.sql'), 'utf8').toLowerCase();
  assert.doesNotMatch(paypal, /\brequest_hash\b/);
});
