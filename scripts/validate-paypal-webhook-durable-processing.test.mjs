import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202611020004_paypal_webhook_durable_processing.sql", import.meta.url), "utf8").toLowerCase();
const normalizedMigration = migration.replace(/\s+/g, " ");
const previousSecurity = readFileSync(new URL("../supabase/migrations/202610290001_core_project_security.sql", import.meta.url), "utf8").toLowerCase();
const hourlyWorkflow = readFileSync(new URL("../supabase/migrations/202610300004_hourly_workflows.sql", import.meta.url), "utf8").toLowerCase();

test("webhook queue migration is additive and transactional", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration.trimEnd(), /commit;$/);
  assert.match(migration, /alter table public\.paypal_webhook_events\s+add column verified_at/);
  assert.match(migration, /add column attempt_count integer not null default 0 check \(attempt_count between 0 and 8\)/);
  assert.match(migration, /add column lease_token uuid/);
  assert.match(migration, /add column lease_expires_at timestamptz/);
  assert.match(migration, /add column dead_lettered_at timestamptz/);
  assert.doesNotMatch(migration, /alter table public\.(?:milestones|agreement_versions|change_order_versions)\b/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\./);
  assert.doesNotMatch(migration, /truncate\s+/);
});

test("enqueue requires a verified-server caller and allowlisted matching event fields", () => {
  assert.match(migration, /function public\.enqueue_verified_paypal_webhook\([\s\S]*?if auth\.role\(\) is distinct from 'service_role'/);
  for (const event of ["created", "sent", "paid", "cancelled", "refunded", "updated", "scheduled"]) {
    assert.match(migration, new RegExp(`invoicing\\.invoice\\.${event}`));
  }
  assert.match(migration, /p_payload->>'id' is distinct from p_provider_event_id/);
  assert.match(migration, /p_payload#>>'\{resource,id\}' is distinct from p_resource_id/);
  assert.match(migration, /on conflict \(provider_event_id\) do nothing/);
  assert.match(migration, /verified_at\s*\)\s*values[\s\S]*clock_timestamp\(\)/);
});

test("concurrent claims use a lease, row locking, and stale-lease recovery", () => {
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /lease_expires_at <= clock_timestamp\(\)/);
  assert.match(migration, /lease_expires_at = clock_timestamp\(\) \+ interval '45 seconds'/);
  assert.match(migration, /attempt_count = e\.attempt_count \+ 1/);
  assert.match(migration, /attempt_count >= 8/);
  assert.match(migration, /processing_error = 'worker_attempts_exhausted'/);
  assert.match(migration, /verified_at is not null/);
  assert.match(migration, /target_event\.lease_token is distinct from p_lease_token/);
  assert.match(migration, /target_event\.lease_expires_at <= clock_timestamp\(\)/);
});

test("retry scheduling is bounded and retains failed verified events", () => {
  assert.match(migration, /should_dead_letter := p_permanent or target_event\.attempt_count >= 8/);
  assert.match(migration, /least\(\s*3600::numeric,\s*5::numeric \* power\(2::numeric/);
  assert.match(migration, /dead_lettered_at = case when should_dead_letter then clock_timestamp\(\)/);
  assert.match(migration, /function public\.requeue_dead_lettered_paypal_webhook/);
  assert.match(migration, /verified_at is not null\s+and processed_at is null\s+and dead_lettered_at is not null/);
});

test("worker completion uses provider invoice IDs and provider status mapping, not event status", () => {
  assert.match(migration, /function public\.complete_verified_paypal_webhook/);
  assert.match(migration, /mapped_status := public\.paypal_invoice_status\(p_provider_status\)/);
  assert.match(migration, /where provider = 'paypal' and provider_invoice_id = p_provider_invoice_id/);
  assert.match(migration, /p_provider_invoice_id is distinct from target_event\.resource_id/);
  assert.match(migration, /provider_observed_at is null or p_observed_at >= target_invoice\.provider_observed_at/);
  assert.match(migration, /status = mapped_status/);
  assert.match(migration, /paid_at = case when mapped_status = 'paid'/);
  assert.match(migration, /status, provider_status, paid_at/);
  assert.match(migration, /old\.status = 'paid'/);
  assert.match(migration, /new\.status not in \('paid', 'partially_refunded', 'refunded', 'refunded_external'\)/);
});

test("the shared provider lookup covers fixed-price and hourly invoice rows", () => {
  assert.match(previousSecurity, /create table public\.invoices\s*\([\s\S]*?milestone_id uuid/);
  assert.match(hourlyWorkflow, /alter table public\.invoices add column hourly_batch_id uuid/);
  assert.match(hourlyWorkflow, /check \(\(milestone_id is null\)=\(hourly_batch_id is not null\)\)/);
  assert.match(migration, /from public\.invoices\s+where provider = 'paypal' and provider_invoice_id = p_provider_invoice_id\s+for update/);
  assert.doesNotMatch(migration, /where provider = 'paypal' and provider_invoice_id = p_provider_invoice_id and milestone_id/);
  assert.doesNotMatch(migration, /where provider = 'paypal' and provider_invoice_id = p_provider_invoice_id and hourly_batch_id/);
});

test("all queue mutations remain service-role-only and direct table access stays revoked", () => {
  assert.match(migration, /revoke all on public\.paypal_webhook_events from public, anon, authenticated/);
  for (const signature of [
    "enqueue_verified_paypal_webhook(text, text, text, jsonb)",
    "claim_paypal_webhook_event()",
    "complete_verified_paypal_webhook(uuid, uuid, text, text, text, timestamptz, timestamptz)",
    "retry_paypal_webhook_event(uuid, uuid, text, boolean)",
    "requeue_dead_lettered_paypal_webhook(uuid)",
  ]) {
    assert.ok(normalizedMigration.includes(`revoke all on function public.${signature} from public, anon, authenticated, service_role`));
    assert.ok(normalizedMigration.includes(`grant execute on function public.${signature} to service_role`));
  }
  assert.match(migration, /revoke all on function public\.apply_verified_paypal_webhook\([\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(previousSecurity, /provider_event_id text not null unique/);
  assert.match(previousSecurity, /alter table public\.paypal_webhook_events enable row level security/);
});
