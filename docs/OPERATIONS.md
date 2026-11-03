# Operations and deployment runbook

Current verified status (2026-11-03): ProofPayAI Staging (`staging-project-reference-redacted`) has all 18 migrations applied and its Phase A webhook queue schema/permissions verified. Groq milestone generation and scope analysis, PayPal Sandbox OAuth, and one fictional invoice create/send were exercised. The invoice is SENT. No Sandbox payment or webhook delivery has been tested, and the real Sandbox webhook ID is not configured. Render's authenticated dashboard shows only the existing `My project` Production environment with `Shipment-Tracker`; there are no ProofPay Blueprint instances or ProofPay services. The Render setup flow read the public ProofPayAI repository and listed the approved release branch, but a payment-information modal blocked the service preview. Nothing was created or deployed. This runbook's earlier migration and hosting instructions are historical where they conflict with this current status; do not reapply migrations 1–18 to the existing Staging project.

## Runtime and secrets

- The project baseline is Node.js `26.13.0` and npm `11.20.0`. `render.yaml` pins Node `26.13.0` for both services.
- Copy `.env.example` to a private root `.env` for local development. Fill only credentials for services that have been created. `.env` is ignored by Git; `.env.example` contains placeholders.
- For new Supabase projects, use the Dashboard's `sb_publishable_...` key for both `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`, and the server-only `sb_secret_...` key for `SUPABASE_SERVICE_ROLE_KEY`. The installed Supabase JS client accepts the current key formats. Legacy anon/service-role JWT keys also work, but prefer the current key types.
- The browser receives only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL`. Supabase service-role, Groq, OpenAI, and PayPal Sandbox credentials belong only in the API service environment. Never add provider secrets to `VITE_*` variables, browser storage, issue reports, screenshots, or Postman exports.
- Configure a unique `APP_ORIGIN` for the deployed browser origin. The API uses a fixed CORS origin and does not reflect an arbitrary request origin.
- Give administrator access only through a trusted operator's database process. The app does not allow self-assignment of the `admin` role. The role check and admin moderation RPCs still require database verification.

## Health, status, and logs

- `GET /health` returns process health only; it does not verify Supabase, AI, PayPal, or database migrations.
- `GET /api/status` reports server-side integration configuration booleans. A configured value does not prove the provider is reachable or authorized.
- API responses set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, `X-Permitted-Cross-Domain-Policies: none`, and `Cache-Control: no-store`.
- Fastify uses `x-request-id`, a 1 MiB request-body limit, and redacts authorization and cookie headers from request logs. Preserve request IDs when reporting failures; never attach tokens, full webhook bodies, or private project content to routine logs.
- The current code does not ship metrics, alert delivery, an error-tracking service, or a deployed uptime monitor. Configure and verify these in the chosen hosting/monitoring accounts before inviting users.

## Database changes and recovery

1. For the existing hackathon Staging target, verify the project reference and all 18 migration versions with the official CLI; do not replay them. For a different non-production database, review the complete timestamp-ordered migration set and dry-run before a separately approved apply.
2. Take and verify a restorable backup before changing a populated project.
3. Test row-level security, role boundaries, RPC transactions, storage policies, and realtime subscriptions with separate client and freelancer accounts.
4. In particular, verify admin-only moderation, report projections, listing holds, account-deletion request ownership, and append-only moderation audit behavior from `202610300005_commercial_hardening.sql`.
5. Before production, document the exact project, migration version, backup point, operator, and recovery procedure. Do not assume these forward migrations are safe to roll back after data has been written. Prefer a reviewed forward-fix; restore only under an owner-approved recovery plan.

No backup/restore drill or production migration has been run. Staging migration execution and catalog verification are recorded in `docs/IMPLEMENTATION_PROGRESS.md`; no production database is configured or authorized by this runbook.

## Account requests and moderation

- An account-deletion request records intent for manual review. It does not disable sign-in, delete the account, remove project or invoice rows, or erase provider records.
- Before an operator takes any separate deletion/deactivation action, define retention and legal requirements, resolve active contracts/disputes, preserve required financial/audit records, identify dependent data, and obtain appropriate owner approval. The current product has no automated retention or deletion worker.
- Users may cancel a request while it is still in `requested`. An administrator may move it to `under_review` or mark it `declined`; neither decision performs erasure.
- Job and conversation report decisions are checked by the database role and written to `moderation_actions`. Reported message excerpts are private queue data. Treat them as sensitive; do not copy them into public tickets or logs.
- Listing holds hide a listing from ordinary marketplace visibility while preserving it for its owner and authorized administrators. Verify this behavior against actual RLS and marketplace views before production use.

## PayPal Sandbox incident handling

- Keep PayPal configured to Sandbox. Live-money hosts and credentials are out of scope.
- The app commits an invoice operation claim before create/send calls. If a create/send write loses its connection or times out, treat the result as unknown. Do not retry the write or tell the user it failed until an operator or supported reconciliation path checks PayPal.
- For create unknowns, search Sandbox invoices by the persisted invoice number and inspect every result page. For send unknowns, fetch the known provider invoice. If lookup fails or finds no result, leave the operation unknown and investigate; do not create a second invoice.
- Webhook signatures must verify before an event is processed. Event IDs are deduplicated, and payment state is reconciled against the provider invoice rather than trusted from the event body. Only provider-confirmed `PAID` contributes to paid totals.
- Preserve the correlation invoice number, app invoice ID, PayPal request ID/debug ID where safely available, and `x-request-id` for an incident. Keep secrets and raw authorization headers out of incident notes.
- A fictional USD 600 Sandbox invoice has been created and sent once; its recorded provider and local states are SENT. No Sandbox payment, webhook delivery, or webhook database processing has been exercised. Durable queue migration 18 is applied and verified in Staging, but the local webhook ID remains a placeholder and there is no verified public HTTPS callback.

## Hosting checklist

The authenticated Render Dashboard was inspected on 2026-11-03. It contains the existing `My project` Production environment and `Shipment-Tracker`; the Blueprints page showed no existing Blueprint instances. Do not modify or move `Shipment-Tracker`.

The approved public repository `distinctikechukwu-stack/ProofPayAI` and branch `codex/proofpay-staging-release` were selected in Render's Blueprint setup flow. The flow initially defaulted to `master` and showed the older service names `proofpay-api` and `proofpay-web`; that preview was not used. After selecting the approved branch, Render reported that a Blueprint file was found but also showed a generic “there was an issue” notice. A payment-information modal appeared before service details, so the approved branch's YAML was not verified by a complete live preview and the source of the generic notice could not be distinguished. The GitHub integration's connected-repository list showed only `Shipment-Tracker`, so ProofPayAI was accessed through Render's public-repository option. Render notes that some GitHub integration features, including automatic deploys and PR previews, are unavailable for repositories not configured through the integration. The approved branch's remote HEAD was checked separately as `10bb23b8d251f55e36ef0349efadac144b7e84a8`.

The setup flow did not reach a service preview. Render displayed “Payment Information Required” because the workspace has no card on file and the proposed API uses paid compute. No billing details were entered. The current workspace plan is Hobby ($0/month), with 5 GB included outbound bandwidth, 500 included standard build-pipeline minutes, and 0/25 services used before this setup. Current unbilled charges and projected November total were both $0.00. Render's published rate for `0.5c-512mb` is $7/month, prorated by runtime; the static site is free. The baseline is therefore $7/month for an always-on API, plus any usage beyond included workspace limits: $0.15/GB outbound bandwidth and $5 per 1,000 standard build minutes over the included amount. Additional custom domains beyond the two included on Hobby are $0.25/domain/month. Render states that adding a card may trigger a temporary $1 USD authorization that is refunded after verification. The authorized Render billing account holder must review and approve adding a payment method and these possible charges before setup can continue.

The repository's local `render.yaml` proposes a separate Render project `ProofPay AI`, environment `Staging`, and exactly two resources: `proofpay-staging-api` (Node web service, `0.5c-512mb`) and `proofpay-staging-web` (static site). The API and durable webhook worker run together in the API process; no separate worker service or Render database is defined. Both services pin Node.js `26.13.0`; the API build is `npm ci && npm run build --workspace @proofpay/shared && npm run build --workspace @proofpay/api`, with start command `npm run start --workspace @proofpay/api` and health check `/health`. The web build is `npm ci && npm run build --workspace @proofpay/shared && npm run build --workspace @proofpay/web`, publishing `apps/web/dist` with an SPA rewrite. Automatic deploys and preview generation are disabled. Render's project/environment syntax supports this arrangement, but a live resource preview was not available, so service count, environment assignment, and final dashboard-resolved cost remain unverified.

The API's declared environment variable names are `NODE_VERSION`, `NODE_ENV`, `AI_PROVIDER`, `GROQ_MODEL`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYPAL_SANDBOX_CLIENT_ID`, and `PAYPAL_SANDBOX_CLIENT_SECRET`. `PAYPAL_WEBHOOK_ID` is intentionally not declared in the initial Blueprint because the real Sandbox webhook has not been registered. The web service declares only `NODE_VERSION`, `VITE_API_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. Keep Groq/OpenAI, Supabase service-role, and PayPal credentials on the API service. Browser configuration must contain only the API origin and public Supabase URL/publishable key. Set `APP_ORIGIN` and `VITE_API_URL` after Render assigns service URLs; do not invent their values.

`PAYPAL_WEBHOOK_ID` has no real Sandbox value yet and is intentionally omitted from the local initial Blueprint. Do not enter a placeholder or unrelated ID. The API starts without this setting, reports webhook processing as unavailable, returns HTTP 503 from the webhook endpoint, and does not start the durable worker. After separately approved Sandbox webhook registration, configure the real ID privately on the API service. Do not register the webhook as part of initial deployment.

The generic Blueprint notice shown in Render's setup flow remains unresolved: the UI gave no diagnostic beyond “A Blueprint file was found, but there was an issue,” and the flow stopped before a full preview. The official Blueprint JSON Schema was fetched with one read-only request and its relevant field definitions were reviewed against the local YAML. A full automated schema-validation run was not available because neither the Render CLI nor a YAML parser is installed; the local structural and runtime regressions are not equivalent to Render's validator. Do not reopen the setup flow until the local release changes have been separately committed and pushed, then inspect the complete preview for a specific diagnostic.

Render project/environment names are organizational labels; they do not themselves isolate private networking. Render's Hobby plan permits two environments per project but does not include network-isolated environments. This application instead must use the dedicated Supabase Staging URL and PayPal Sandbox credentials; do not provide production values.

Before deploying to an already verified Staging target:

1. Confirm the service is Staging and uses Supabase project `staging-project-reference-redacted`; do not provision or configure Production.
2. Configure the API service with server-only Supabase, Groq, and PayPal Sandbox values plus exact browser `APP_ORIGIN`; configure only public Supabase settings and API URL for the static web build.
3. Configure a PayPal business Sandbox app with Invoicing permissions and a registered HTTPS webhook. Set the webhook ID only on the API service.
4. Validate Render build/start commands and `/health`; verify browser CORS, Auth redirects, integration configuration status, secret separation, and server logs.
5. Run authenticated client/freelancer/admin acceptance workflows in Sandbox, including dual agreement approval, moderation authorization, deletion request review, hourly entry approvals, invoice reconciliation, verified/duplicate/out-of-order webhooks, and recovery from a failed deployment.
6. Set up owner-controlled monitoring, alert routing, backups, incident contacts, and rollback/recovery instructions. Record evidence in `docs/IMPLEMENTATION_PROGRESS.md` before marking hosted checks complete.

No ProofPay service was created, changed, or deployed during this review. The current local checkout is `codex/proofpay-staging-release` at the approved release commit `10bb23b8d251f55e36ef0349efadac144b7e84a8`; the Marketplace worktree remains on `feature/marketplace-expansion` and was not changed. The paid-service preview is blocked until the authorized billing account holder resolves the payment-method requirement. The local documentation correction in this worktree is not included in the already-pushed commit; publishing it requires a separate reviewed commit and push approval.

### PayPal Sandbox webhook setup runbook

Follow these steps only after separate approval for staging hosting and webhook registration. This is Sandbox-only; do not use Live credentials or endpoints.

1. Provision the staging API host only after deployment approval. The callback must be publicly reachable at `https://<staging-api-host>/api/webhooks/paypal` on HTTPS port 443. Verify `GET /health` and `GET /api/status` over that HTTPS origin before registering anything.
2. In PayPal Developer Dashboard, select the same Sandbox REST app used by the configured invoice credentials, with Invoicing enabled. Add the exact HTTPS callback and subscribe to `INVOICING.INVOICE.CREATED`, `INVOICING.INVOICE.SENT`, `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED`, `INVOICING.INVOICE.REFUNDED`, `INVOICING.INVOICE.UPDATED`, and `INVOICING.INVOICE.SCHEDULED`.
3. Save the webhook ID returned by PayPal as API-server-only `PAYPAL_WEBHOOK_ID`. Keep `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` on the API service. Never place them in `VITE_*`, browser storage, logs, or chat. Restart the API and verify that `/api/status` reports configuration by booleans only.
4. Migration 18 is already applied and verified on Staging. Once a verified Staging API host and real Sandbox webhook ID are separately configured, verify the worker starts from server-side credentials. The endpoint verifies each event before calling the durable enqueue RPC; it returns 202 only after the event is committed or deduplicated. A storage timeout/failure returns non-2xx so PayPal may redeliver. The worker fetches the current PayPal invoice and updates only the matching local invoice.
5. Do not use PayPal's webhook simulator as proof of this postback verification flow. PayPal documents that mock simulator events cannot be verified through `verify-webhook-signature`. A real Sandbox payment/webhook test requires separate payment approval.

Listener budget: webhook signature verification is capped at 17 seconds total, including a cold OAuth request, and durable enqueue at 5 seconds (22 seconds maximum before response serialization). The queue lease is 45 seconds. Provider reads use the API client's 15-second timeout. Transient failures back off from 5 seconds exponentially, capped at one hour, and stop after eight attempts. Permanent errors or exhausted attempts remain retained as dead letters. An operator must inspect PayPal's current invoice and the sanitized failure code before invoking the service-role-only `requeue_dead_lettered_paypal_webhook` RPC; never resend invoices or payments as a recovery action.

The handler validates that `paypal-transmission-time` parses and sends the original transmission headers and unmodified event JSON to PayPal's postback verification API. It does not impose its own five-minute age cutoff: PayPal's Invoicing page describes that bound for direct signature verification, while this app uses PayPal postback verification and must keep provider redelivery viable. Provider event-ID uniqueness prevents replay from repeating reconciliation, and each queued event triggers a fresh provider invoice read. Whether PayPal postback verification enforces transmission freshness remains unverified until an approved live Sandbox webhook check.

## Phase 12 readiness handoff (historical snapshot)

The following notes were recorded on 2026-10-30 and are superseded by the dated current status at the top of this runbook and `docs/IMPLEMENTATION_PROGRESS.md`. In particular, ProofPayAI Staging now has all 18 migrations applied and verified, and several real Sandbox/provider checks have been performed. The local Render Dashboard session remains unauthenticated, so no remote Render configuration is verified.

### Non-production database verification

Use a separate Supabase staging project. Do not run this verification against production. The existing `ProofPayAI Staging` database already has all 18 migrations applied; do not replay them. For a new non-production database, inspect the complete migration history, review all 18 timestamp-ordered migrations, and run the official CLI dry-run before obtaining separate apply approval. Preserve sanitized SQL output and project ref as evidence; never send database passwords or API keys in chat.

Create separate staging accounts for a client, freelancer, ordinary non-admin user, and trusted moderator. Seed the ordinary marketplace records through the app/API. Grant the moderator `admin` only through the trusted operator database path; a profile field or client request must not be treated as an authorization grant.

Run and record these checks against the deployed staging API and database:

| Area | Action | Expected result |
| --- | --- | --- |
| Migration | For the existing Staging project, verify all 18 migration versions and catalog state without applying anything. For a different staging database, first review and dry-run the full migration set. | Existing Staging history/schema agree; no unapproved migration is applied. Validate constraints, indexes, functions, grants, and RLS policies against PostgreSQL rather than relying on API mocks alone. |
| Admin boundary | Call `GET /api/admin/moderation` and each review endpoint as the ordinary user, then as the trusted moderator. Attempt direct reads/writes to `moderation_actions` as anon/authenticated. | Non-admin is denied; moderator sees only the allowlisted queue and can make valid decisions; direct audit-table access is denied. Each accepted decision has exactly one matching audit row. |
| Listing moderation | Submit a marketplace report, hide its listing, read the marketplace as owner, unrelated user, and moderator, then restore it. Try an invalid decision and review the same report twice. | Hold hides the listing from ordinary visibility but not authorized owner/admin views; restore makes it visible again; invalid/repeated decisions do not mutate or append a second action. |
| Conversation moderation | Submit a conversation report; review as ordinary user and moderator using `no_action` and `escalate`. | Only the reporter/admin may use the policy-authorized report path; only admin can decide; private reporter/participant IDs stay out of the response; decision and audit commit atomically. |
| Deletion request | Request deletion without confirmation, then with exact confirmation; repeat request; read status as requester and another account; cancel; request again and move to `under_review`; try cancel after review; decline as moderator. | Invalid confirmation is rejected; repeat is idempotent; each user reads only their request; cancel works only while `requested`; reviewed/declined states require admin and write an audit action. No step erases account, project, invoice, or audit data. |
| Concurrency and rollback | Submit concurrent duplicate requests/reviews; force a failure inside a moderation transaction in staging. | The unique open-request rule and row locks prevent duplicate open requests/reviews; a failed transaction leaves no partial moderation action or listing change. |

Keep test-account IDs and sanitized request IDs in a private evidence record. Do not include message excerpts, bearer tokens, webhook bodies, database URLs, or provider secrets.

### Secret setup without chat

For local verification, copy `.env.example` to the ignored root `.env` and set values there. Alternatively, set secrets in the API service's private environment settings. Send only a non-secret “ready” message when configuration is complete; do not paste secret values here.

| Verification | Required private configuration / operator action |
| --- | --- |
| Supabase API and RLS workflows | Staging `SUPABASE_URL`; `sb_publishable_...` value in `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`; `sb_secret_...` value in server-only `SUPABASE_SERVICE_ROLE_KEY`; staging users listed above. All 18 migrations are applied to the confirmed Staging project; do not replay them. Keep `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` public-only. |
| PayPal Sandbox | Sandbox OAuth, one fictional invoice create, DRAFT verification, and one invoice send have been verified; the invoice is recorded SENT. Before webhook use, configure server-only Sandbox credentials and a registered Sandbox webhook ID, then host the callback at public HTTPS `/api/webhooks/paypal`. No payment/webhook test is verified. Never use Live credentials. |
| GroqCloud AI | API-server-only `AI_PROVIDER=groq`, `GROQ_API_KEY`, and `GROQ_MODEL=openai/gpt-oss-20b` are configured. One real fictional milestone-generation request and one real scope-analysis request passed structured-output validation; the analysis audit persisted with provider `groq`. New inference requests need separate approval. |
| OpenAI alternative | Set API-server-only `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. The existing Responses adapter retains strict structured output and `store:false`. OpenAI live-provider behavior remains untested; obtain separate approval before its first request. |
| Render staging | The owner confirmed no ProofPay AI Blueprint or service exists. The existing `My project` Production environment contains `Shipment-Tracker`; do not modify it. Local `render.yaml` now defines a separate ProofPay AI Staging API and static web service on `codex/proofpay-staging-release`, with a paid 0.5 CPU / 512 MB API plan, Groq/OpenAI settings, and server-only Supabase/PayPal variables. No Render service, remote environment value, or public origin has been configured. GitHub publication and creating the paid service require separate approval. |

The applied scope-analysis audit RPC accepts exactly `openai` and `groq`; a real Groq scope analysis was validated and persisted with provider `groq`. No additional AI request is authorized by this runbook.

Groq's current data-controls documentation says inference inputs and outputs are not retained by default, but may be temporarily retained for reliability or abuse investigations for up to 30 days unless the organization enables Zero Data Retention. Confirm the account's data-control setting and use fictional, non-sensitive staging text for the first approved provider test.

### Monitoring, backup, and lifecycle decisions

These are not configured in the repository. Before inviting external users, choose an accountable monitoring owner, an alert destination, an availability/error signal, and a test alert; verify logs redact credentials and private content. Choose database backup retention and recovery-point/recovery-time objectives that match the selected Supabase plan, run a backup, and record a successful restore drill on a separate staging target. A configured backup without a restore test is not verified.

The account flow currently records and reviews requests only. Before building automated deactivation or erasure, the project owner must set the request response target, retention period for invoices/contracts/audit and dispute evidence, legal-hold rules, treatment of backups/provider records, and who can authorize final erasure. Until those policies and the dependent-data inventory are reviewed, the UI must continue to describe the action as a request and must not claim the account was deleted.

### Bundle review

Analytics and its grid are lazy-loaded, and the grid itself is dynamically imported only when the authenticated Analytics route renders. The installed `ag-grid-community` package exposes one large ESM entry point; the current build emits a 719.63 kB (198.47 kB gzip) grid chunk. Removing needed row-model, pagination, or text-filter modules or replacing AG Grid would change working analytics/sponsor behavior. No safe further split was identified; retain the visible warning and track it for a future measured optimization.
