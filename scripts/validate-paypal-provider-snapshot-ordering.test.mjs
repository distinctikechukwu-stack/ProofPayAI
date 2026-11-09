import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parsePgTapDiagnostics } from './paypal-pgtap-diagnostics.mjs';

const migration = readFileSync(new URL("../supabase/migrations/202611070001_paypal_provider_snapshot_ordering.sql", import.meta.url), "utf8").toLowerCase();
const normalized = migration.replace(/\s+/g, " ");
const migrationDdl = migration.split("create or replace function public.paypal_invoice_snapshot_is_current", 1)[0];
const paypal = readFileSync(new URL("../apps/api/src/paypal.ts", import.meta.url), "utf8");
const paypalTests = readFileSync(new URL("../apps/api/test/paypal.test.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../apps/api/src/paypal-webhook-worker.ts", import.meta.url), "utf8");
const sqlTest = readFileSync(new URL("../supabase/tests/paypal_provider_snapshot_ordering.test.sql", import.meta.url), "utf8");
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
  assert.match(normalized, /when p_current_status = 'draft' then p_next_status in \('sent', 'scheduled', 'unknown'\)/);
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

test("a deterministic two-session PostgreSQL race covers older PAID after newer REFUNDED", () => {
  assert.match(concurrency, /older.*paid/i);
  assert.match(concurrency, /newer.*refund/i);
  assert.match(concurrency, /complete_verified_paypal_webhook/);
  assert.match(concurrency, /pg_sleep/);
  assert.match(concurrency, /provider_updated_at/);
  assert.match(postgresRunner, /test-paypal-provider-snapshot-concurrency\.mjs/);
});

test("PostgreSQL CI is read-only and triggers only on the isolated branch", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- codex\/cloudflare-paypal-webhooks/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/codex\/cloudflare-paypal-webhooks'/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /run-paypal-provider-snapshot-postgres-validation\.mjs/);
  assert.doesNotMatch(workflow, /^\s{0,2}(?:pull_request|schedule):/m);
  assert.doesNotMatch(workflow, /secrets\./i);
  assert.match(postgresRunner, /assert.equal\(names.length, 20/);
  assert.match(postgresRunner, /GITHUB_ACTIONS/);
  assert.match(postgresRunner, /GITHUB_REF/);
  assert.match(postgresRunner, /linkedProjectMetadataCopied: false/);
  assert.match(postgresRunner, /environmentFilesCopied: false/);
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
