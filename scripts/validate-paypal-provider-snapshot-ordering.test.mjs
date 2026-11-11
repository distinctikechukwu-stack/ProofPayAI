import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parsePgTapDiagnostics } from './paypal-pgtap-diagnostics.mjs';
import {
  formatPaypalConcurrencyDiagnostic,
  parsePaypalConcurrencyDiagnostic,
  PAYPAL_CONCURRENCY_DIAGNOSTIC_PREFIX,
  extractPostgresSqlState,
} from './paypal-concurrency-diagnostics.mjs';
import { createDisposablePostgresEnvironment } from './paypal-validation-environment.mjs';
import { isAllowedPaypalValidationRef, PAYPAL_VALIDATION_GITHUB_REFS } from './paypal-validation-branch.mjs';
import {
  parseSupabaseContainerState,
  parseSupabaseProjectContainerNames,
  parseSupabaseResourceSnapshot,
  parseSupabaseStartupDiagnostics,
  buildSupabaseStartArgs,
  runSupabaseStartWithDiagnostics,
} from './supabase-startup-diagnostics.mjs';

const migration = readFileSync(new URL("../supabase/migrations/202611070001_paypal_provider_snapshot_ordering.sql", import.meta.url), "utf8").toLowerCase();
const normalized = migration.replace(/\s+/g, " ");
const migrationDdl = migration.split("create or replace function public.paypal_invoice_snapshot_is_current", 1)[0];
const paypal = readFileSync(new URL("../apps/api/src/paypal.ts", import.meta.url), "utf8");
const paypalTests = readFileSync(new URL("../apps/api/test/paypal.test.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../apps/api/src/paypal-webhook-worker.ts", import.meta.url), "utf8");
const sqlTest = readFileSync(new URL("../supabase/tests/paypal_provider_snapshot_ordering.test.sql", import.meta.url), "utf8");
const postMigrationFixture = readFileSync(new URL("../scripts/fixtures/project-completion-post-migration.sql", import.meta.url), "utf8");
const concurrency = readFileSync(new URL("../scripts/test-paypal-provider-snapshot-concurrency.mjs", import.meta.url), "utf8");
const postgresRunner = readFileSync(new URL("../scripts/run-paypal-provider-snapshot-postgres-validation.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/cloudflare-paypal-webhook-validation.yml", import.meta.url), "utf8");
const smoke = readFileSync(new URL("../scripts/cloudflare-webhook-workerd-smoke.mjs", import.meta.url), "utf8");
const configPath = new URL("../apps/cloudflare-paypal-webhook/wrangler.jsonc", import.meta.url);
const config = JSON.parse(readFileSync(configPath, "utf8"));

test("migration 20 is additive, transactional, and leaves existing invoice rows intact", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration.trimEnd(), /commit;$/);
  assert.match(migration, /alter table public\.invoices\s+add column provider_updated_at timestamptz/);
  assert.doesNotMatch(migration, /delete\s+from public\.|truncate\s+/);
  assert.doesNotMatch(migrationDdl, /update\s+public\.invoices\b/);
  assert.doesNotMatch(migration, /alter table public\.(?:milestones|agreement_versions|projects)\b/);
});

test("PayPal parser uses only the documented detail.metadata path and rejects malformed versions", () => {
  assert.match(paypal, /detail:\s*z\.object\([\s\S]*?metadata:\s*z\.object\([\s\S]*?last_update_time:\s*z\.string\(\)\.optional\(\)/);
  assert.match(paypal, /providerUpdatedAt:\s*parseProviderUpdatedAt\(invoice\.detail\?\.metadata\?\.last_update_time\s*\?\?\s*invoice\.detail\?\.metadata\?\.update_time\)/);
  assert.doesNotMatch(paypal, /invoice\.metadata\?\./);
  assert.match(paypal, /if \(value === undefined\) return null/);
  assert.match(paypal, /throw new Error\("PayPal returned a malformed invoice update timestamp\."\)/);
  assert.match(paypalTests, /detail\.metadata\.last_update_time/);
  assert.match(paypalTests, /detail\.metadata\.update_time/);
  assert.match(paypalTests, /ignores root-level metadata/);
  assert.match(paypalTests, /missing detail metadata/);
  assert.match(paypalTests, /rejects a malformed canonical provider version/);
});

test("provider version ordering rejects stale, versionless, and equal-version conflicting states", () => {
  assert.match(normalized, /when p_incoming_updated_at > p_current_updated_at then true/);
  assert.match(normalized, /when p_incoming_updated_at = p_current_updated_at then p_current_status is not distinct from p_incoming_status and upper\(p_current_provider_status\) is not distinct from upper\(p_incoming_provider_status\)/);
  assert.match(normalized, /when p_current_updated_at is not null then false/);
  assert.match(normalized, /when p_incoming_observed_at = p_current_observed_at then/);
  assert.match(normalized, /provider_observed_at = case\s+when (?:target_invoice\.)?provider_observed_at is null or p_observed_at > (?:target_invoice\.)?provider_observed_at then p_observed_at\s+else (?:target_invoice\.)?provider_observed_at\s+end/);
  assert.match(normalized, /provider_updated_at = p_provider_updated_at/);
  assert.match(readFileSync(new URL("../apps/api/src/app.ts", import.meta.url), "utf8"), /p_provider_updated_at:\s*snapshot\?\.providerUpdatedAt\s*\?\?\s*null/);
  assert.match(readFileSync(new URL("../apps/api/src/app.ts", import.meta.url), "utf8"), /p_provider_updated_at:\s*current\.providerUpdatedAt\s*\?\?\s*null/);
  assert.match(worker, /p_observed_at:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(worker, /p_provider_updated_at:\s*providerInvoice\.providerUpdatedAt\s*\?\?\s*null/);
});

test("the status allowlist blocks illegal regressions and preserves documented payment and refund paths", () => {
  assert.match(normalized, /when p_current_status = 'draft' then\s+p_next_status in \('sent', 'scheduled', 'payment_pending', 'partially_paid', 'paid', 'unknown'\)/);
  const draftTransition = normalized.match(/when p_current_status = 'draft' then\s+p_next_status in \(([^)]+)\)/)?.[1] ?? "";
  assert.doesNotMatch(draftTransition, /cancelled|paid_external|partially_refunded|refunded/);
  assert.match(normalized, /when p_current_status in \('sent', 'payment_pending'\) then p_next_status in/);
  assert.match(normalized, /when p_current_status = 'paid' then p_next_status in \('partially_refunded', 'refunded'\)/);
  assert.match(normalized, /when p_current_status = 'refunded' then false/);
  assert.match(normalized, /when p_current_status = 'cancelled' then false/);
  assert.match(normalized, /when p_current_status = 'partially_refunded' then p_next_status in/);
  assert.match(normalized, /not public\.paypal_invoice_transition_allowed\(current_provider_status, mapped_status\)/);
});

test("the trigger protects both RPC and direct invoice writes with a fixed definer search path", () => {
  assert.match(normalized, /security definer set search_path = pg_catalog, public/);
  assert.match(normalized, /public\.paypal_invoice_snapshot_rejection_reason\(/);
  assert.match(normalized, /current_provider_status := case when old\.provider_status is null then old\.status else public\.paypal_invoice_status\(old\.provider_status\) end/);
  assert.match(normalized, /raise exception 'the paypal invoice snapshot is stale, conflicting, or an invalid provider transition\.' using errcode = '40001'/);
  assert.match(normalized, /public\.paypal_internal_operation_transition_allowed\(old\.id, old\.status, new\.status\)/);
  assert.doesNotMatch(normalized, /new\.provider_updated_at := old\.provider_updated_at/);
  assert.match(normalized, /new\.provider is distinct from 'paypal'/);
  assert.match(normalized, /new\.provider_invoice_id is distinct from old\.provider_invoice_id/);
  assert.match(normalized, /before update of provider, provider_invoice_id, status, provider_status, invoice_url, paid_at, provider_observed_at, provider_updated_at on public\.invoices/);
});

test("internal create and send claims remain independent from provider snapshots", () => {
  assert.match(normalized, /create or replace function public\.begin_paypal_invoice_create\([\s\S]*?insert into public\.paypal_operation_claims[\s\S]*?update public\.invoices set[\s\S]*?status = 'create_pending'/);
  assert.match(normalized, /when p_current_status = 'not_created' and p_next_status = 'create_pending' then exists/);
  assert.match(normalized, /when p_current_status = 'draft' and p_next_status = 'send_pending' then exists/);
  assert.match(normalized, /when p_current_status = 'create_pending' and p_next_status = 'not_created' then exists/);
  assert.match(normalized, /when p_current_status = 'send_pending' and p_next_status = 'draft' then exists/);
  assert.match(normalized, /drop function public\.finalize_paypal_operation\(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz\)/);
  assert.match(normalized, /p_provider_updated_at timestamptz default null/);
  assert.match(normalized, /snapshotrejectionreason/);
});

test("finalize and direct reconciliation RPCs reject stale snapshots without false success", () => {
  assert.match(normalized, /create function public\.finalize_paypal_operation\([\s\S]*?public\.paypal_invoice_snapshot_rejection_reason\([\s\S]*?snapshotapplied/);
  assert.match(normalized, /drop function public\.record_paypal_invoice_state\(uuid, uuid, text, text, text, timestamptz, timestamptz\)/);
  assert.match(normalized, /create function public\.record_paypal_invoice_state\([\s\S]*?public\.paypal_invoice_snapshot_rejection_reason\([\s\S]*?snapshotapplied/);
  assert.match(normalized, /grant execute on function public\.finalize_paypal_operation\(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz\) to service_role/);
  assert.match(normalized, /grant execute on function public\.record_paypal_invoice_state\(uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz\) to service_role/);
  assert.match(sqlTest, /begin_paypal_invoice_create/);
  assert.match(sqlTest, /begin_paypal_invoice_send/);
  assert.match(sqlTest, /finalize_paypal_operation rejects an older provider version/);
  assert.match(sqlTest, /record_paypal_invoice_state rejects an older provider version/);
  assert.match(sqlTest, /conflicting status changes at equal provider versions/);
  assert.match(sqlTest, /missing_provider_version/);
  assert.match(sqlTest, /newer unrecognized provider state is stored as unknown/);
  assert.match(sqlTest, /legacy seven-argument reconciliation calls still resolve/);
  assert.match(sqlTest, /legacy nine-argument finalization calls still resolve/);
  assert.match(sqlTest, /4::smallint[\s\S]*?the provider timestamp is a trailing optional reconciliation argument/);
  assert.match(readFileSync(new URL("../apps/api/src/app.ts", import.meta.url), "utf8"), /invoiceRow\.status !== "unknown" && invoiceRow\.status !== "draft"/);
  assert.match(readFileSync(new URL("../apps/api/src/app.ts", import.meta.url), "utf8"), /current\.id !== invoiceRow\.provider_invoice_id/);
  assert.match(readFileSync(new URL("../apps/api/src/app.ts", import.meta.url), "utf8"), /"payment_pending", "partially_paid", "paid"/);
});

test("completion RPC keeps service-role authorization, fixed search path, leases, and seven-argument compatibility", () => {
  assert.match(normalized, /drop function public\.complete_verified_paypal_webhook\(uuid, uuid, text, text, text, timestamptz, timestamptz\)/);
  assert.match(normalized, /p_provider_updated_at timestamptz default null/);
  assert.match(normalized, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(normalized, /target_event\.lease_token is distinct from p_lease_token/);
  assert.match(normalized, /p_provider_invoice_id is distinct from target_event\.resource_id/);
  assert.match(normalized, /target_event\.processed_at is not null/);
  assert.match(normalized, /security definer set search_path = pg_catalog, public, auth/);
  assert.match(normalized, /grant execute on function public\.complete_verified_paypal_webhook\(uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz\) to service_role/);
  assert.match(normalized, /revoke all on function public\.complete_verified_paypal_webhook\(uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz\) from public, anon, authenticated, service_role/);
});

test("pgTAP exercises the real completion RPC, trigger, grants, search paths, and existing data", () => {
  assert.match(sqlTest, /public\.complete_verified_paypal_webhook/);
  assert.match(sqlTest, /public\.prevent_paypal_paid_invoice_regression/);
  assert.match(sqlTest, /only the service role can execute the completion RPC/);
  assert.match(sqlTest, /fixed safe search path/);
  assert.match(sqlTest, /preserves the pre-existing paid invoice status/);
  assert.match(sqlTest, /same provider version/);
  assert.match(sqlTest, /seven-argument call/);
  assert.match(sqlTest, /SENT can advance to CANCELLED/);
  assert.match(sqlTest, /cancelled invoice cannot accept a later refund/);
  assert.match(sqlTest, /direct paid-after-refund update/);
  assert.match(sqlTest, /refuses to reassign a linked PayPal invoice identity/);
  assert.match(sqlTest, /snapshot and transition helpers are immutable/);
  assert.match(sqlTest, /a create retry preserves the invoice identity/);
  assert.match(sqlTest, /begin_paypal_invoice_send transitions draft to send_pending/);
  assert.match(sqlTest, /finalize_paypal_operation rejects conflicting status changes/);
});

test("pgTAP covers trusted DRAFT-to-payment snapshots through all three RPC paths", () => {
  assert.match(sqlTest, /finalize_paypal_operation accepts a newer provider-confirmed DRAFT-to-PAYMENT_PENDING transition/);
  assert.match(sqlTest, /record_paypal_invoice_state accepts a current provider-confirmed DRAFT-to-PARTIALLY_PAID transition/);
  assert.match(sqlTest, /record_paypal_invoice_state accepts a current provider-confirmed DRAFT-to-PAID transition/);
  assert.match(sqlTest, /verified webhook completion applies the fetched PAID snapshot when the signed event payload says DRAFT/);
  assert.match(sqlTest, /duplicate webhook completion is idempotent/);
  assert.match(sqlTest, /authenticated caller cannot finalize/);
  assert.match(sqlTest, /authenticated caller cannot record provider payment state/);
  assert.match(sqlTest, /authenticated caller cannot complete a verified webhook/);
  assert.match(sqlTest, /rejects a stale payment snapshot after the new DRAFT transition/);
  assert.match(sqlTest, /rejects a conflicting status at an equal provider version after the new DRAFT transition/);
  assert.match(sqlTest, /a newer PAID snapshot cannot overwrite REFUNDED/);
  assert.match(sqlTest, /webhook reconciliation rejects a provider invoice identity/);
});

test("webhook SQL helper passes paid_at separately without shifting legacy calls", () => {
  const helper = sqlTest.match(/create function pg_temp\.apply_snapshot\([\s\S]*?\$test\$;/)?.[0] ?? "";
  assert.match(helper, /p_legacy_seven_argument_call boolean default false,\s*p_event_payload_status text default null,\s*p_paid_at timestamptz default null/);
  const legacyCall = helper.match(/if p_legacy_seven_argument_call then([\s\S]*?)end if;/)?.[1] ?? "";
  assert.match(legacyCall, /complete_verified_paypal_webhook\(\s*p_event_id, p_lease_token, p_invoice_id, p_provider_status, null, null, p_observed_at\s*\)/);
  assert.match(helper, /p_event_id, p_lease_token, p_invoice_id, p_provider_status, null, p_paid_at, p_observed_at, p_provider_updated_at/);
  assert.match(sqlTest, /'2026-11-07T16:05:00Z', '2026-11-07T16:06:00Z', false, 'DRAFT', '2026-11-07T16:04:30Z'/);
  assert.match(sqlTest, /invoice\.paid_at = '2026-11-07T16:04:30Z'::timestamptz/);
});

test("create and retry pgTAP scenarios use an eligible milestone isolated from snapshot fixtures", () => {
  const createMilestones = [...sqlTest.matchAll(/public\.begin_paypal_invoice_create\(\s*\(select id from public\.milestones where project_id = '([^']+)' and sequence = 1\)/gi)]
    .map((match) => match[1]);
  assert.deepEqual(createMilestones, [
    "00000000-0000-4000-8000-000000000400",
    "00000000-0000-4000-8000-000000000400",
    "00000000-0000-4000-8000-000000000600",
    "00000000-0000-4000-8000-000000001000",
  ]);
  assert.match(postMigrationFixture, /add_project\(\s*'00000000-0000-4000-8000-000000000400',[\s\S]*?'fixed', 'in_progress', array\['approved'\], array\[10000\]::bigint\[\]/i);
  assert.match(sqlTest, /the create\/retry fixture milestone is eligible and has no existing invoice/);
  assert.match(sqlTest, /'SYNTHETIC-SNAPSHOT-ORDERING-01'[\s\S]*?where project\.id = '00000000-0000-4000-8000-000000000900'/);
  assert.match(sqlTest, /'SYNTHETIC-SNAPSHOT-OBSERVATION-01'[\s\S]*?where project\.id = '00000000-0000-4000-8000-000000000800'/);
  assert.match(sqlTest, /'SYNTHETIC-SNAPSHOT-CANCEL-01'[\s\S]*?where project\.id = '00000000-0000-4000-8000-000000000500'/);
});

test("a deterministic two-session PostgreSQL race covers older PAID after newer REFUNDED", () => {
  assert.match(concurrency, /older.*paid/i);
  assert.match(concurrency, /newer.*refund/i);
  assert.match(concurrency, /complete_verified_paypal_webhook/);
  assert.match(concurrency, /pg_sleep/);
  assert.match(concurrency, /provider_updated_at/);
  assert.match(concurrency, /application_name/);
  assert.match(concurrency, /sessionsStarted\[sessionKey\] = observed/);
  assert.match(concurrency, /requireObservedSession\([\s\S]*older_paid_session_observed/);
  assert.match(concurrency, /requireObservedSession\([\s\S]*newer_refunded_session_observed/);
  assert.match(concurrency, /extractPostgresSqlState\(result\.stderr\)/);
  assert.match(concurrency, /if \(result\.outputTruncated\) fail\('harness_failure'\)/);
  assert.match(concurrency, /finalIntegrityReached = true/);
  assert.match(concurrency, /formatPaypalConcurrencyDiagnostic/);
  assert.doesNotMatch(concurrency, /message:\s*String\(error\?\.message/);
  assert.match(postgresRunner, /test-paypal-provider-snapshot-concurrency\.mjs/);
  assert.match(postgresRunner, /parsePaypalConcurrencyDiagnostic/);
  assert.match(postgresRunner, /sessionsStarted\.older !== true/);
  assert.match(postgresRunner, /sessionsStarted\.newer !== true/);
  assert.match(postgresRunner, /finalIntegrityReached !== true/);
  assert.match(postgresRunner, /createDisposablePostgresEnvironment\(process\.env, home, temp\)/);
  assert.match(postgresRunner, /env: runEnv/);
  assert.doesNotMatch(postgresRunner, /env:\s*process\.env/);
});

test("concurrency SQL templates contain no unescaped psql meta-command lines", () => {
  const sqlTemplates = [...concurrency.matchAll(/`([\s\S]*?)`/g)].map((match) => match[1]);
  const metaCommandLine = /^\s*\\(?:[A-Za-z][A-Za-z_]*|[!.?])(?:\s|$)/;
  const unescapedCommands = sqlTemplates
    .flatMap((sql) => sql.split(/\r?\n/))
    .filter((line) => metaCommandLine.test(line));

  assert.ok(sqlTemplates.length > 0, "the race should continue to pass SQL through template literals");
  assert.deepEqual(unescapedCommands, []);
  assert.doesNotMatch(concurrency, /OLDER_EVENT_LOCKED/);
});

test("concurrency child environment receives only the verified GitHub Actions marker", () => {
  const parent = {
    PATH: "synthetic-safe-path",
    LANG: "en_US.UTF-8",
    GITHUB_ACTIONS: "true",
    GITHUB_REF: "refs/heads/codex/cloudflare-paypal-webhooks",
    GITHUB_TOKEN: "synthetic-github-token",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-secret",
    SUPABASE_ACCESS_TOKEN: "synthetic-supabase-token",
    SUPABASE_URL: "synthetic-connection-string",
    GH_TOKEN: "synthetic-token",
    DATABASE_URL: "postgresql://synthetic-user:synthetic-password@localhost/private",
    PAYPAL_SANDBOX_CLIENT_SECRET: "synthetic-paypal-secret",
    GROQ_API_KEY: "synthetic-groq-key",
    CF_API_TOKEN: "synthetic-cloudflare-token",
    NODE_OPTIONS: "--require synthetic-hook",
    UNSAFE_INHERITED: "synthetic-untrusted-value",
  };
  const env = createDisposablePostgresEnvironment(parent, "C:/private/home", "C:/private/tmp");
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.PATH, parent.PATH);
  assert.equal(env.LANG, parent.LANG);
  assert.equal(env.CI, "true");
  for (const key of [
    "GITHUB_REF", "GITHUB_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_URL",
    "GH_TOKEN", "DATABASE_URL", "PAYPAL_SANDBOX_CLIENT_SECRET", "GROQ_API_KEY", "CF_API_TOKEN",
    "NODE_OPTIONS", "LC_ALL", "UNSAFE_INHERITED",
  ]) {
    assert.equal(Object.hasOwn(env, key), false, `${key} must not be inherited by the child`);
  }
  const serialized = JSON.stringify(env);
  assert.ok(!serialized.includes("synthetic-secret"));
  assert.ok(!serialized.includes("synthetic-connection-string"));
  assert.ok(!serialized.includes("synthetic-token"));
  assert.ok(!serialized.includes("synthetic-password"));
  assert.ok(!serialized.includes("synthetic-paypal-secret"));
  assert.ok(!serialized.includes("synthetic-groq-key"));
  assert.ok(!serialized.includes("synthetic-cloudflare-token"));
  assert.ok(!serialized.includes("synthetic-untrusted-value"));

  const outsideActions = createDisposablePostgresEnvironment({ ...parent, GITHUB_ACTIONS: "false" }, "C:/private/home", "C:/private/tmp");
  assert.equal(Object.hasOwn(outsideActions, "GITHUB_ACTIONS"), false);
});

function concurrencyPayload(overrides = {}) {
  return {
    version: 1,
    result: "passed",
    category: "completed",
    phase: "complete",
    assertionId: null,
    sqlState: null,
    databaseSetupStarted: true,
    sessionsStarted: { older: true, newer: true },
    finalIntegrityReached: true,
    databaseCommand: { exitStatus: 0, timedOut: false, signal: null, spawnErrorCode: null, outputTruncated: false },
    ...overrides,
  };
}

test("concurrency diagnostics retain structured pass evidence and process status", () => {
  const result = parsePaypalConcurrencyDiagnostic({
    code: 0,
    signal: null,
    timedOut: false,
    outputTruncated: false,
    stdout: formatPaypalConcurrencyDiagnostic(concurrencyPayload()),
  });
  assert.equal(result.kind, "passed");
  assert.equal(result.process.exitStatus, 0);
  assert.equal(result.process.timedOut, false);
  assert.equal(result.databaseSetupStarted, true);
  assert.deepEqual(result.sessionsStarted, { older: true, newer: true });
  assert.equal(result.finalIntegrityReached, true);
});

test("concurrency failure diagnostics report only allowlisted SQL and assertion evidence", () => {
  const failure = concurrencyPayload({
    result: "failed",
    category: "postgres_error",
    phase: "newer_session_start",
    assertionId: null,
    sqlState: "40001",
    sessionsStarted: { older: true, newer: false },
    finalIntegrityReached: false,
    databaseCommand: { exitStatus: 3, timedOut: false, signal: null, spawnErrorCode: null, outputTruncated: false },
  });
  const result = parsePaypalConcurrencyDiagnostic({
    code: 1, signal: "SIGTERM", timedOut: true, outputTruncated: false,
    stderr: formatPaypalConcurrencyDiagnostic(failure),
  });
  assert.equal(result.kind, "postgres_error");
  assert.equal(result.phase, "newer_session_start");
  assert.equal(result.sqlState, "40001");
  assert.equal(result.databaseCommand.exitStatus, 3);
  assert.deepEqual(result.sessionsStarted, { older: true, newer: false });
  assert.equal(result.finalIntegrityReached, false);
  assert.equal(result.process.exitStatus, 1);
  assert.equal(result.process.signal, "SIGTERM");
  assert.equal(result.process.timedOut, true);

  const assertionFailure = parsePaypalConcurrencyDiagnostic({
    code: 1, signal: null, timedOut: false, outputTruncated: false,
    stderr: formatPaypalConcurrencyDiagnostic(concurrencyPayload({
      result: "failed", category: "assertion_failure", phase: "state_order_assertions",
      assertionId: "older_paid_rejected_as_stale", sessionsStarted: { older: true, newer: true },
      finalIntegrityReached: false,
    })),
  });
  assert.equal(assertionFailure.failedAssertionId, "older_paid_rejected_as_stale");
});

test("concurrency diagnostic parser safely classifies malformed and truncated output", () => {
  const privateToken = "synthetic-private-token";
  const malformed = parsePaypalConcurrencyDiagnostic({
    code: 1, stderr: `${PAYPAL_CONCURRENCY_DIAGNOSTIC_PREFIX}{\"sql\":\"select '${privateToken}'\",\"error\":\"raw private output\"}`,
  });
  assert.equal(malformed.kind, "child_diagnostic_malformed");
  assert.ok(!JSON.stringify(malformed).includes(privateToken));
  assert.ok(!JSON.stringify(malformed).includes("raw private output"));

  const truncated = parsePaypalConcurrencyDiagnostic({
    code: 1, outputTruncated: true,
    stderr: formatPaypalConcurrencyDiagnostic(concurrencyPayload()),
  });
  assert.equal(truncated.kind, "child_diagnostic_truncated");
  assert.equal(truncated.process.outputTruncated, true);
  assert.ok(!JSON.stringify(truncated).includes(PAYPAL_CONCURRENCY_DIAGNOSTIC_PREFIX));
});

test("PostgreSQL verbose errors expose only a recognized SQLSTATE", () => {
  assert.equal(extractPostgresSqlState("psql: file.sql: ERROR:  40001: could not serialize access\nDETAIL: private row value"), "40001");
  assert.equal(extractPostgresSqlState("FATAL:  57P03: the database is starting"), "57P03");
  assert.equal(extractPostgresSqlState("ERROR: private exception 40001 without verbose code"), null);
  assert.equal(extractPostgresSqlState("ERROR:  PRIVATE: arbitrary value"), null);
});

test("Cloudflare webhook validation is manual and branch-gated", () => {
  assert.match(workflow, /workflow_dispatch:/);
  const pushBranchBlock = workflow.match(/push:\s*\n\s+branches:\s*\n((?:\s+-[^\n]+\n?)+)/)?.[1] ?? "";
  assert.deepEqual(PAYPAL_VALIDATION_GITHUB_REFS, [
    "refs/heads/codex/cloudflare-paypal-webhooks",
    "refs/heads/codex/proofpay-final-integration-prep",
  ]);
  const approvedBranches = PAYPAL_VALIDATION_GITHUB_REFS.map((ref) => ref.replace(/^refs\/heads\//, ""));
  assert.deepEqual([...pushBranchBlock.matchAll(/^\s+- (.+)$/gm)].map(([, branch]) => branch), approvedBranches);
  const branchGate = workflow.match(/^\s*if: (.+)$/m)?.[1] ?? "";
  assert.match(branchGate, /^github\.ref == .+ \|\| github\.ref == .+$/);
  assert.equal((branchGate.match(/\|\|/g) ?? []).length, 1);
  assert.deepEqual([...branchGate.matchAll(/refs\/heads\/codex\/[\w-]+/g)].map(([ref]) => ref), PAYPAL_VALIDATION_GITHUB_REFS);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /run-paypal-provider-snapshot-postgres-validation\.mjs/);
  assert.doesNotMatch(workflow, /^\s{0,2}(?:pull_request|schedule):/m);
  assert.doesNotMatch(workflow, /secrets\./i);
  assert.match(postgresRunner, /assert.equal\(names.length, 20/);
  assert.match(postgresRunner, /GITHUB_ACTIONS/);
  assert.match(postgresRunner, /isAllowedPaypalValidationRef\(process\.env\.GITHUB_REF\)/);
  assert.match(postgresRunner, /assert\.equal\(process\.env\.GITHUB_ACTIONS, 'true'/);
  assert.match(postgresRunner, /assert\.equal\(process\.platform, 'linux'/);
  assert.match(postgresRunner, /linkedProjectMetadataCopied: false/);
  assert.match(postgresRunner, /environmentFilesCopied: false/);
});

test("PostgreSQL validation branch allowlist accepts both approved branch refs", () => {
  assert.equal(isAllowedPaypalValidationRef("refs/heads/codex/cloudflare-paypal-webhooks"), true);
  assert.equal(isAllowedPaypalValidationRef("refs/heads/codex/proofpay-final-integration-prep"), true);
});

test("PostgreSQL validation branch allowlist rejects unapproved branches", () => {
  for (const ref of [
    "refs/heads/master",
    "refs/heads/codex/proofpay-staging-release",
    "refs/heads/codex/proofpay-final-integration-prep-extra",
    "refs/pull/12/merge",
  ]) {
    assert.equal(isAllowedPaypalValidationRef(ref), false, `${ref} must remain outside the allowlist`);
  }
});

test("PostgreSQL validation branch allowlist rejects missing and malformed refs", () => {
  for (const ref of [undefined, null, "", "codex/proofpay-final-integration-prep", " refs/heads/codex/proofpay-final-integration-prep", 42]) {
    assert.equal(isAllowedPaypalValidationRef(ref), false);
  }
});

test("PostgreSQL validation runner preserves isolated local-only database safeguards", () => {
  assert.match(postgresRunner, /\['db', 'reset', '--local', '--no-seed'\]/);
  assert.match(postgresRunner, /\['db', 'push', '--local'\]/);
  assert.match(postgresRunner, /createDisposablePostgresEnvironment\(process\.env, home, temp\)/);
  assert.match(postgresRunner, /env: runEnv/);
  assert.doesNotMatch(postgresRunner, /env:\s*process\.env/);
  assert.doesNotMatch(postgresRunner, /--linked|--db-url/);
  assert.doesNotMatch(workflow, /secrets\./i);
});

test("isolated PostgreSQL validation enables startup debug without workflow secrets", () => {
  assert.match(workflow, /PROOFPAY_SUPABASE_STARTUP_DIAGNOSTICS:\s+'debug'/);
  assert.doesNotMatch(workflow, /secrets\./i);
  assert.match(postgresRunner, /process\.env\.PROOFPAY_SUPABASE_STARTUP_DIAGNOSTICS === 'debug'/);
});

test("Linux Workerd smoke uses no secret files and exercises health and Cron", () => {
  assert.match(smoke, /process\.platform, 'linux'/);
  assert.match(smoke, /GITHUB_ACTIONS/);
  assert.match(smoke, /--test-scheduled/);
  assert.match(smoke, /cdn-cgi\/local\/scheduled/);
  assert.match(smoke, /\/health/);
  assert.match(smoke, /configured: false/);
  assert.match(smoke, /\.dev\.vars/);
  assert.match(smoke, /child\.kill/);
});

test("Cloudflare drain caps remain eight Queue rows and one Cron row", () => {
  assert.match(readFileSync(new URL("../apps/api/src/cloudflare-paypal-webhook.ts", import.meta.url), "utf8"), /CLOUDFLARE_QUEUE_DRAIN_LIMIT = 8/);
  assert.match(readFileSync(new URL("../apps/api/src/cloudflare-paypal-webhook.ts", import.meta.url), "utf8"), /drainInbox\(env, 1\)/);
  assert.equal(config.queues.consumers[0].max_batch_size, 1);
  assert.equal(config.triggers.crons[0], "* * * * *");
});

test("pgTAP diagnostics parse Supabase CLI and pg_prove summaries", () => {
  const file = "paypal_provider_snapshot_ordering.test.sql";
  const pgProve = parsePgTapDiagnostics({
    exitStatus: 1, tool: "supabase", testFile: file, expectedTestFiles: [file],
    stdout: [
      "2026-11-09T10:00:00.000Z /tmp/supabase/tests/" + file + " .. Dubious, test returned 255",
      "Failed 2/66 subtests", "Files=1, Tests=66, Result: FAIL",
    ].join("\n"),
  });
  assert.equal(pgProve.kind, "pgprove_failure_summary");
  assert.equal(pgProve.testFile, file);
  assert.deepEqual(pgProve.reportedTestFiles, [file]);
  assert.equal(pgProve.pgProveFailedSubtests, 2);
  assert.equal(pgProve.assertionCount, 66);
  assert.equal(pgProve.failedAssertions, 0);
  assert.deepEqual(pgProve.failures, []);

  const cliPass = parsePgTapDiagnostics({
    exitStatus: 0, tool: "supabase", testFile: file,
    stdout: ["/tmp/supabase/tests/" + file + " .. ok", "All tests successful.", "Files=1, Tests=66, Result: PASS"].join("\n"),
  });
  assert.equal(cliPass.kind, "passed");
  assert.equal(cliPass.passingAssertions, 66);
});

test("psql fallback diagnostics identify only the allowlisted file, line, and SQLSTATE", () => {
  const file = "paypal_provider_snapshot_ordering.test.sql";
  const privateEmail = "private" + "@example.invalid";
  const diagnostic = parsePgTapDiagnostics({
    exitStatus: 3, tool: "psql", testFile: file,
    stderr: [
      "psql:/tmp/proofpay-pgtap/" + file + ":412: ERROR:  23505: duplicate key for " + privateEmail,
      "LINE 1: update invoices set status = 'paid';", "DETAIL: synthetic-sensitive-record",
    ].join("\n"),
  });
  assert.equal(diagnostic.kind, "sql_execution_error");
  assert.deepEqual(diagnostic.sqlStateCodes, ["23505"]);
  assert.deepEqual(diagnostic.statementLocations, [{ file, line: 412 }]);
  assert.equal(diagnostic.failedAssertions, 0);
  assert.ok(!JSON.stringify(diagnostic).includes(privateEmail));
  assert.ok(!JSON.stringify(diagnostic).includes("synthetic-sensitive-record"));
  assert.ok(!JSON.stringify(diagnostic).includes("update invoices"));
});

test("pgTAP diagnostics preserve assertion identity through CLI prefixes and redact values", () => {
  const file = "project_completion_workflow.test.sql";
  const syntheticEmail = "user" + "@example.invalid";
  const syntheticId = ["00000000", "0000", "4000", "8000", "000000000001"].join("-");
  const diagnostic = parsePgTapDiagnostics({
    exitStatus: 1, tool: "pg_prove", testFile: file,
    stdout: ["2026-11-09T10:01:00.000Z \u001b[31mnot ok 2 - the row contains " + syntheticEmail + " and " + syntheticId + "\u001b[0m"].join("\n"),
  });
  assert.equal(diagnostic.kind, "pgtap_assertion_failure");
  assert.equal(diagnostic.passingAssertions, 0);
  assert.equal(diagnostic.assertionCount, 1);
  assert.equal(diagnostic.failedAssertions, 1);
  assert.equal(diagnostic.failures[0].number, 2);
  assert.equal(diagnostic.failures[0].file, file);
  assert.equal(diagnostic.failures[0].description, "the row contains redacted email and redacted id");
  assert.ok(!JSON.stringify(diagnostic).includes(syntheticEmail));
  assert.ok(!JSON.stringify(diagnostic).includes(syntheticId));
});

test("diagnostics classify missing fixtures, CLI errors, database connection errors, and passing TAP", () => {
  assert.equal(parsePgTapDiagnostics({ exitStatus: 1, tool: "supabase", stderr: "could not find test file project.test.sql" }).kind, "missing_fixture");
  assert.equal(parsePgTapDiagnostics({ exitStatus: null, tool: "supabase", spawnErrorCode: "ENOENT" }).kind, "cli_error");
  assert.equal(parsePgTapDiagnostics({ exitStatus: 2, tool: "supabase", stderr: "supabase: unknown command test" }).kind, "cli_error");
  assert.equal(parsePgTapDiagnostics({ exitStatus: 1, tool: "supabase", stderr: "ERROR: failed to start the local pg_prove command" }).kind, "cli_error");
  assert.equal(parsePgTapDiagnostics({ exitStatus: 1, tool: "supabase", stderr: "supabase: error: connection refused while starting the local test runner" }).kind, "database_connection_error");
  assert.equal(parsePgTapDiagnostics({ exitStatus: 0, tool: "psql", testFile: "project_completion_workflow.test.sql", stdout: "ok 1 - schema is ready\n1..1" }).kind, "passed");
});

test("pgTAP runner isolates each SQL file and retains strict failure behavior", () => {
  assert.match(postgresRunner, /for \(const file of pgtapTestFiles\)/);
  assert.match(postgresRunner, /\['test', 'db', '--local'\]/);
  assert.match(postgresRunner, /runPsqlPgTapFallback/);
  assert.match(postgresRunner, /ON_ERROR_STOP=1/);
  assert.match(postgresRunner, /VERBOSITY=verbose/);
  assert.match(postgresRunner, /SHOW_CONTEXT=always/);
  assert.match(postgresRunner, /error\.safeDiagnostic/);
  assert.match(postgresRunner, /await rm\(resolvedTemp, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(postgresRunner, /--linked/);
  assert.doesNotMatch(postgresRunner, /--db-url/);
});

const startupProjectId = "ppv123456789abcde";
const startupContainerName = `supabase_db_${startupProjectId}`;

function startupDiagnostic(stderr, overrides = {}) {
  return parseSupabaseStartupDiagnostics({
    processResult: { code: 1, signal: null, timedOut: false, outputTruncated: false, stdout: "", stderr },
    projectId: startupProjectId,
    containerListResult: { code: 0, timedOut: false, outputTruncated: false, stdout: "", stderr: "" },
    ...overrides,
  });
}

test("startup diagnostics classify Docker image pull failures without returning raw CLI text", () => {
  const diagnostic = startupDiagnostic("Error response from daemon: manifest unknown while pulling image");
  assert.equal(diagnostic.kind, "image_pull_failure");
  assert.equal(diagnostic.phase, "image_pull");
  assert.deepEqual(diagnostic.signals, ["image_manifest_unavailable"]);
  assert.ok(!JSON.stringify(diagnostic).includes("Error response from daemon"));
});

test("startup diagnostics report health-check failures and the failed Supabase service state", () => {
  const names = parseSupabaseProjectContainerNames(startupContainerName, startupProjectId);
  const state = parseSupabaseContainerState(
    `/${startupContainerName}|exited|1|unhealthy|false`, startupContainerName, startupProjectId,
  );
  const diagnostic = startupDiagnostic('service "db" failed health check after connection refused', {
    containerListResult: { code: 0, timedOut: false, outputTruncated: false, stdout: names.join("\n") },
    containerNames: names,
    containers: [state],
  });
  assert.equal(diagnostic.kind, "service_health_check_failure");
  assert.equal(diagnostic.phase, "service_health_check");
  assert.deepEqual(diagnostic.failedServices, ["db"]);
  assert.equal(diagnostic.containers.created, true);
  assert.deepEqual(diagnostic.containers.states, [{
    name: startupContainerName, service: "db", state: "exited", exitCode: 1, health: "unhealthy", oomKilled: false,
  }]);
});

test("startup diagnostics distinguish Docker networking errors", () => {
  const diagnostic = startupDiagnostic("failed to create network: no route to host");
  assert.equal(diagnostic.kind, "startup_network_failure");
  assert.equal(diagnostic.phase, "network_setup");
  assert.deepEqual(diagnostic.signals, ["network_connectivity_failure"]);
});

test("startup diagnostics record disk and memory resource failures only from recognized evidence", () => {
  const diskDiagnostic = startupDiagnostic("write failed: no space left on device", {
    diskResult: { code: 0, stdout: "Filesystem 1024-blocks Used Available Use% Mounted on\n/dev/root 1000000 999500 500 100% /", timedOut: false },
  });
  assert.equal(diskDiagnostic.kind, "resource_failure");
  assert.equal(diskDiagnostic.resource, "disk");
  assert.equal(diskDiagnostic.resources.availableDiskKiB, 500);

  const memoryDiagnostic = startupDiagnostic("process was OOMKilled");
  assert.equal(memoryDiagnostic.kind, "resource_failure");
  assert.equal(memoryDiagnostic.resource, "memory");
});

test("resource diagnostics use the lowest free space across checked filesystems without exposing paths", () => {
  const resources = parseSupabaseResourceSnapshot(
    "8589934592|4|/var/lib/docker",
    "Filesystem 1024-blocks Used Available Use% Mounted on\n/dev/work 1000000 100 900000 10% /workspace\n/dev/docker 1000000 999500 500 100% /var/lib/docker",
  );
  assert.equal(resources.memoryBytes, 8589934592);
  assert.equal(resources.cpuCount, 4);
  assert.equal(resources.availableDiskKiB, 500);
  assert.equal(resources.filesystemsChecked, 2);
  assert.ok(!JSON.stringify(resources).includes("/var/lib/docker"));
});

test("low disk headroom is reported as context without guessing it caused the startup failure", () => {
  const diagnostic = startupDiagnostic("startup operation failed with an unrecognized error", {
    diskResult: { code: 0, stdout: "Filesystem 1024-blocks Used Available Use% Mounted on\n/dev/root 1000000 999500 500 100% /", timedOut: false },
  });
  assert.equal(diagnostic.kind, "unknown_startup_failure");
  assert.deepEqual(diagnostic.signals, ["disk_headroom_below_recommended_minimum"]);
  assert.equal(diagnostic.resources.belowRecommendedDiskMinimum, true);
});

test("startup diagnostics identify recognized Supabase configuration errors", () => {
  const diagnostic = startupDiagnostic("failed to parse config: invalid supabase/config.toml");
  assert.equal(diagnostic.kind, "supabase_cli_configuration_failure");
  assert.equal(diagnostic.phase, "cli_configuration");
});

test("startup diagnostics classify registry, container creation, and database initialization errors safely", () => {
  const registry = startupDiagnostic("failed to fetch oauth token: unauthorized");
  assert.equal(registry.kind, "image_registry_failure");
  assert.equal(registry.phase, "registry_access");
  assert.deepEqual(registry.signals, ["image_registry_access_denied"]);
  assert.ok(registry.startupOutputEvidence.observedStages.includes("registry_access"));

  const container = startupDiagnostic("failed to create container: port is already allocated");
  assert.equal(container.kind, "container_creation_failure");
  assert.equal(container.phase, "container_creation");
  assert.deepEqual(container.signals, ["container_creation_failure"]);

  const database = startupDiagnostic("initdb: error: could not create directory");
  assert.equal(database.kind, "database_initialization_failure");
  assert.equal(database.phase, "database_initialization");
  assert.deepEqual(database.signals, ["database_initialization_failure"]);
});

test("startup diagnostics report bounded output evidence without returning CLI text", () => {
  const privateValue = "synthetic-private-value-never-emit";
  const diagnostic = startupDiagnostic(`Pulling image layer\n${privateValue}`, {
    processResult: {
      code: 1, signal: null, timedOut: false, outputTruncated: false,
      stdout: "Pulling image layer", stderr: privateValue,
    },
  });
  assert.equal(diagnostic.startupOutputEvidence.classificationBasis, "no_recognized_failure_signature");
  assert.deepEqual(diagnostic.startupOutputEvidence.observedStages, ["image_pull"]);
  assert.deepEqual(diagnostic.startupOutputEvidence.capturedBytes, {
    stdout: Buffer.byteLength("Pulling image layer"),
    stderr: Buffer.byteLength(privateValue),
    total: Buffer.byteLength(`Pulling image layer\n${privateValue}`),
  });
  assert.ok(!JSON.stringify(diagnostic).includes(privateValue));

  const truncated = startupDiagnostic("arbitrary startup text", {
    processResult: { code: 1, outputTruncated: true, stdout: "arbitrary startup text", stderr: "" },
  });
  assert.equal(truncated.startupOutputEvidence.classificationBasis, "captured_output_truncated");
  assert.equal(truncated.startupOutputEvidence.truncated, true);
});

test("Supabase debug startup mode adds only the documented global debug flag", () => {
  const exclusions = "studio,imgproxy,edge-runtime,logflare,vector";
  assert.deepEqual(buildSupabaseStartArgs(exclusions), ["start", "--exclude", exclusions]);
  assert.deepEqual(buildSupabaseStartArgs(exclusions, "debug"), ["--debug", "start", "--exclude", exclusions]);
  assert.throws(() => buildSupabaseStartArgs(exclusions, "unknown"), /Invalid Supabase startup diagnostics mode/);
});

test("unknown startup errors remain unclassified and do not create a guessed service", () => {
  const diagnostic = startupDiagnostic("startup operation failed with an unrecognized provider error");
  assert.equal(diagnostic.kind, "unknown_startup_failure");
  assert.equal(diagnostic.phase, "unclassified");
  assert.deepEqual(diagnostic.failedServices, []);
});

test("startup diagnostics distinguish an empty isolated Docker project from failed discovery", () => {
  const missing = startupDiagnostic("startup aborted");
  assert.equal(missing.containers.discoveryAvailable, true);
  assert.equal(missing.containers.created, false);
  assert.equal(missing.containers.count, 0);

  const unavailable = startupDiagnostic("startup aborted", {
    containerListResult: { code: 1, timedOut: false, outputTruncated: false, stdout: "", stderr: "private docker error" },
  });
  assert.equal(unavailable.containers.discoveryAvailable, false);
  assert.equal(unavailable.containers.created, null);
  assert.equal(unavailable.containers.count, null);
  assert.ok(!JSON.stringify(unavailable).includes("private docker error"));

  const missingInspect = startupDiagnostic("startup aborted", {
    containerListResult: { code: 0, timedOut: false, outputTruncated: false, stdout: startupContainerName, stderr: "" },
    containerNames: [startupContainerName],
  });
  assert.equal(missingInspect.containers.created, true);
  assert.equal(missingInspect.containers.count, 1);
  assert.equal(missingInspect.containers.inspectionFailures, 1);
});

test("startup diagnostics retain truncation and command exit/timeout evidence", () => {
  const diagnostic = parseSupabaseStartupDiagnostics({
    processResult: { code: 1, signal: "SIGTERM", timedOut: true, outputTruncated: true, stdout: "pull access denied", stderr: "" },
    projectId: startupProjectId,
    containerListResult: { code: 0, timedOut: false, outputTruncated: true, stdout: "", stderr: "" },
  });
  assert.equal(diagnostic.kind, "image_registry_failure");
  assert.deepEqual(diagnostic.signals, ["image_registry_access_denied"]);
  assert.equal(diagnostic.process.exitStatus, 1);
  assert.equal(diagnostic.process.signal, "SIGTERM");
  assert.equal(diagnostic.process.spawnErrorCode, null);
  assert.equal(diagnostic.process.timedOut, true);
  assert.equal(diagnostic.process.outputTruncated, true);
  assert.equal(diagnostic.diagnosticOutputTruncated, true);
});

test("startup diagnostics preserve only allowlisted process spawn error codes", () => {
  const recognized = parseSupabaseStartupDiagnostics({
    processResult: { code: null, spawnErrorCode: "ENOENT", stderr: "synthetic private output" },
    projectId: startupProjectId,
  });
  const unrecognized = parseSupabaseStartupDiagnostics({
    processResult: { code: null, spawnErrorCode: "PRIVATE_VALUE", stderr: "synthetic private output" },
    projectId: startupProjectId,
  });
  assert.equal(recognized.process.spawnErrorCode, "ENOENT");
  assert.equal(unrecognized.process.spawnErrorCode, null);
  assert.ok(!JSON.stringify(recognized).includes("synthetic private output"));

  const missingDocker = parseSupabaseStartupDiagnostics({
    processResult: { code: 1, stderr: "startup failed" },
    projectId: startupProjectId,
    containerListResult: { code: null, spawnErrorCode: "ENOENT", timedOut: false, outputTruncated: false },
  });
  assert.equal(missingDocker.diagnosticTools.containerList.spawnErrorCode, "ENOENT");
});

test("startup diagnostics never echo synthetic credentials, connection strings, or arbitrary CLI output", () => {
  const token = "synthetic-token-value-should-never-appear";
  const connection = "postgresql://user:password@example.invalid:5432/private";
  const diagnostic = startupDiagnostic(`service db exited; token=${token}; db=${connection}`, {
    containerNames: [startupContainerName],
    containers: [{
      name: startupContainerName, service: "db", state: "exited", exitCode: 1,
      health: null, oomKilled: false,
    }],
  });
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.kind, "service_start_failure");
  assert.ok(!serialized.includes(token));
  assert.ok(!serialized.includes(connection));
  assert.ok(!serialized.includes("token="));
});

test("partial startup cleanup runs after diagnostics, even when diagnostic collection throws", async () => {
  const calls = [];
  await assert.rejects(runSupabaseStartWithDiagnostics({
    start: async () => {
      calls.push("start");
      const error = new Error("synthetic startup failure");
      error.processResult = { code: 1, timedOut: false, outputTruncated: false };
      throw error;
    },
    diagnose: async () => {
      calls.push("diagnose");
      throw new Error("diagnostic collection failed");
    },
    cleanup: async () => {
      calls.push("cleanup");
      return { kind: "stopped", exitStatus: 0, timedOut: false };
    },
  }), (error) => {
    assert.equal(error.safeDiagnostic.kind, "startup_diagnostics_unavailable");
    assert.deepEqual(error.safeDiagnostic.partialStartupCleanup, { kind: "stopped", exitStatus: 0, timedOut: false });
    return true;
  });
  assert.deepEqual(calls, ["start", "diagnose", "cleanup"]);
});

test("the PostgreSQL runner captures startup diagnostics before cleanup and remains local-only", () => {
  assert.match(postgresRunner, /runSupabaseStartWithDiagnostics/);
  assert.match(postgresRunner, /docker', \[\s*'ps', '-a', '--filter', 'name=' \+ projectId/);
  assert.match(postgresRunner, /'inspect', '--format'/);
  assert.match(postgresRunner, /'info', '--format', '\{\{\.MemTotal\}\}\|\{\{\.NCPU\}\}\|\{\{\.DockerRootDir\}\}'/);
  assert.match(postgresRunner, /diskPaths = \['-Pk', localRoot\]/);
  assert.match(postgresRunner, /\['db', 'reset', '--local', '--no-seed'\]/);
  assert.match(postgresRunner, /finally\s*\{[\s\S]*stackStartAttempted[\s\S]*temporary_workspace_cleanup/);
  assert.doesNotMatch(postgresRunner, /--linked/);
  assert.doesNotMatch(postgresRunner, /--db-url/);
});
