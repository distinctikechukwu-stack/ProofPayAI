import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const migrationsDirectory = join(root, 'supabase', 'migrations');
const migrationName = '202611020003_paypal_claim_invoice_number_scope.sql';
const migration = readFileSync(join(migrationsDirectory, migrationName), 'utf8');
const normalized = migration.toLowerCase().replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const core = readFileSync(join(migrationsDirectory, '202610290002_paypal_invoice_workflow.sql'), 'utf8').toLowerCase().replace(/\s+/g, ' ');
const hourly = readFileSync(join(migrationsDirectory, '202610300004_hourly_workflows.sql'), 'utf8').toLowerCase().replace(/\s+/g, ' ');
const billing = readFileSync(join(migrationsDirectory, '202611020002_paypal_client_billing_email.sql'), 'utf8').toLowerCase().replace(/\s+/g, ' ');
const files = readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

function functionDefinition(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const bodyStart = sql.indexOf('as $$', start);
  const bodyEnd = sql.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart > start && bodyEnd > bodyStart, `Malformed function ${name}`);
  return sql.slice(start, bodyEnd + 3).replace(/\s+/g, ' ');
}

const createFunction = functionDefinition(billing, 'begin_paypal_invoice_create');
const sendFunction = functionDefinition(hourly, 'begin_paypal_invoice_send');
const finalizeFunction = functionDefinition(core, 'finalize_paypal_operation');

function assertClaimUniqueIndexes(existing, candidate) {
  if (candidate.operation === 'create' && existing.some((row) => row.operation === 'create' && row.invoice_number === candidate.invoice_number)) {
    throw new Error('paypal_operation_claims_invoice_number_idx');
  }
  if (candidate.active_operation_key !== null && existing.some((row) => row.active_operation_key === candidate.active_operation_key)) {
    throw new Error('paypal_operation_claims_active_key_idx');
  }
}

test('new migration is forward-only, transactional, and changes only create invoice-number uniqueness', () => {
  assert.ok(files.indexOf(migrationName) > files.indexOf('202611020002_paypal_client_billing_email.sql'));
  assert.match(normalized, /^begin;/);
  assert.match(normalized, /commit;$/);
  assert.equal([...normalized.matchAll(/drop index/g)].length, 1);
  assert.match(normalized, /drop index if exists public\.paypal_operation_claims_invoice_number_idx/);
  assert.equal([...normalized.matchAll(/create unique index/g)].length, 1);
  assert.match(normalized, /create unique index paypal_operation_claims_invoice_number_idx on public\.paypal_operation_claims \(invoice_number\) where operation = 'create'/);
  assert.doesNotMatch(normalized, /\b(alter table|create or replace function|grant|revoke|policy|row level security|truncate|delete|update|insert)\b/);
});

test('the final schema has no other global unique index on operation-claim invoice numbers', () => {
  assert.match(core, /create unique index paypal_operation_claims_invoice_number_idx on public\.paypal_operation_claims \(invoice_number\)/);
  assert.match(normalized, /drop index if exists public\.paypal_operation_claims_invoice_number_idx/);
  assert.match(normalized, /where operation = 'create'/);
  assert.match(core, /create unique index paypal_operation_claims_active_key_idx on public\.paypal_operation_claims \(active_operation_key\) where active_operation_key is not null/);
  assert.match(hourly, /invoice_number text not null unique/); // Separate hourly-batch namespace, unchanged by this correction.
  assert.doesNotMatch(normalized, /paypal_operation_claims[^;]*invoice_number[^;]*unique constraint/i);
});

test('a completed create claim and its send claim may share a provider invoice number', () => {
  const claims = [{ operation: 'create', invoice_number: 'INV2-TEST-000002', active_operation_key: 'create:milestone:agreement' }];
  assert.doesNotThrow(() => assertClaimUniqueIndexes(claims, {
    operation: 'send', invoice_number: 'INV2-TEST-000002', active_operation_key: 'send:invoice',
  }));
  assert.equal(claims[0].operation, 'create');
  assert.match(sendFunction, /'send'\s*,\s*operation_key\s*,\s*operation_key\s*,\s*target_invoice\.provider_invoice_number/);
});

test('duplicate create invoice numbers and active operation keys remain rejected', () => {
  const existingCreate = [{ operation: 'create', invoice_number: 'INV2-TEST-000002', active_operation_key: 'create:milestone:agreement' }];
  assert.throws(() => assertClaimUniqueIndexes(existingCreate, {
    operation: 'create', invoice_number: 'INV2-TEST-000002', active_operation_key: 'create:another-key',
  }), /paypal_operation_claims_invoice_number_idx/);
  assert.throws(() => assertClaimUniqueIndexes(existingCreate, {
    operation: 'send', invoice_number: 'INV2-TEST-000003', active_operation_key: 'create:milestone:agreement',
  }), /paypal_operation_claims_active_key_idx/);
  assert.match(createFunction, /pg_advisory_xact_lock\(hashtextextended\(p_milestone_id::text, 0\)\)/);
  assert.match(createFunction, /where invoice_id = target_invoice\.id and operation = 'create'/);
});

test('duplicate and concurrent send paths serialize and retain the existing claim', async () => {
  assert.match(sendFunction, /for update of i/);
  assert.match(sendFunction, /pg_advisory_xact_lock\(hashtextextended\(p_invoice_id::text,\s*1\)\)/);
  assert.match(sendFunction, /if target_invoice\.status\s*<>\s*'draft' then[\s\S]*?where invoice_id=target_invoice\.id and operation='send'/);
  assert.match(core, /create unique index paypal_operation_claims_active_key_idx on public\.paypal_operation_claims \(active_operation_key\) where active_operation_key is not null/);

  let invoiceStatus = 'draft';
  let sendClaims = 0;
  let lock = Promise.resolve();
  const beginSend = async () => {
    const previous = lock;
    let release;
    lock = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      if (invoiceStatus !== 'draft') return 'existing';
      invoiceStatus = 'send_pending';
      sendClaims += 1;
      return 'claimed';
    } finally {
      release();
    }
  };
  assert.deepEqual(await Promise.all([beginSend(), beginSend()]), ['claimed', 'existing']);
  assert.equal(sendClaims, 1);
});

test('unknown outcomes keep the active send key until reconciliation resolves them', () => {
  const unknownBranch = finalizeFunction.slice(finalizeFunction.indexOf("if p_outcome = 'unknown' then"), finalizeFunction.indexOf("elsif p_outcome = 'rejected' then"));
  assert.match(unknownBranch, /set state\s*=\s*'unknown'/);
  assert.doesNotMatch(unknownBranch, /active_operation_key\s*=/);
  assert.match(finalizeFunction, /state\s*=\s*'rejected',\s*active_operation_key\s*=\s*null/);
  assert.match(sendFunction, /if target_invoice\.status\s*<>\s*'draft' then/);

  const unknownSend = { operation: 'send', invoice_number: 'INV2-TEST-000002', active_operation_key: 'send:invoice-1', state: 'unknown' };
  assert.throws(() => assertClaimUniqueIndexes([unknownSend], {
    operation: 'send', invoice_number: 'INV2-TEST-000002', active_operation_key: 'send:invoice-1',
  }), /paypal_operation_claims_active_key_idx/);
});
