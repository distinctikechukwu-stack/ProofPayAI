# Operations and deployment runbook

Current Staging status (owner-confirmed 2026-11-12): ProofPayAI Staging is Supabase project `whdvvbwirfmdubrlzaxo`; the owner confirms migrations 1–20 are applied. The owner also confirms both Render services run integrated candidate `23194d8caffb46378b7fe1dddb710410ac3c8f82` and that hosted login, dashboard, and existing projects work. This documentation review did not independently inspect the Render dashboard or query the database. A historical fictional USD 600 PayPal Sandbox invoice is recorded SENT, not PAID. No payment or successful webhook reconciliation is verified; the Cloudflare Staging webhook path has a known HTTP 400 failure. Render Free can sleep, so continuous webhook processing and timely reconciliation are not guaranteed. Do not replay migrations or present payment as complete.

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

1. For the existing hackathon Staging target, verify the project reference and all 20 migration versions with the official CLI; do not replay them. For a different non-production database, review the complete timestamp-ordered migration set and dry-run before a separately approved apply.
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
- A fictional USD 600 Sandbox invoice has been created and sent once; its recorded provider and local states are SENT. No Sandbox payment, signed webhook delivery, or webhook-driven database reconciliation has been verified. Migration 18 added the durable API queue; the current Cloudflare Staging webhook path has a known HTTP 400 failure.

## Hosting checklist

**Current hosted Staging state (owner-confirmed 2026-11-12):** `proofpay-staging-api` is at `https://proofpay-staging-api.onrender.com` and `proofpay-staging-web` is at `https://proofpay-staging-web.onrender.com`; both are reported on commit `23194d8caffb46378b7fe1dddb710410ac3c8f82`. The owner confirms hosted login, dashboard, and existing projects work. These dashboard details were not independently inspected during the current documentation review. The API is Free web service hosting and the frontend is a static site. Render Free API services may sleep after inactivity; cold starts and worker downtime prevent a guarantee of timely webhook processing.

The API's `/api/status` webhook readiness was reported false, and the Cloudflare Staging webhook path has a known HTTP 400 failure. Do not register a webhook or change webhook secrets while this failure remains. No Sandbox payment or automatic payment reconciliation is verified. The existing fictional USD 600 invoice is SENT; never recreate or resend it, and never describe it as PAID.

Use `render.yaml` and the current root README for the candidate's source, build/start commands, and setup. Keep `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, PayPal Sandbox credentials, and any optional OpenAI key on the API only. Frontend `VITE_*` values are public configuration. Set API `APP_ORIGIN` to the exact frontend HTTPS origin without a trailing slash; the frontend API URL comes from the one-way `fromService` reference. Never copy production values into Staging.

Earlier paragraphs and checklists in this runbook record the pre-creation setup investigation. Where they say no ProofPay services existed, describe a paid plan, or list fewer than 20 migrations, they are historical and superseded by the dated status above. Do not use them as a current deployment instruction. No Render service, environment setting, billing method, database record, or provider configuration was changed for this submission preparation.

### PayPal Sandbox webhook status

The intended Staging webhook processor is the Cloudflare Worker, Queue, and Cron path described in [`CLOUDFLARE_PAYPAL_WEBHOOKS.md`](CLOUDFLARE_PAYPAL_WEBHOOKS.md). Its current Supabase read/claim path is known to return HTTP 400, so successful event processing is not verified. Do not register or activate a webhook, make a Sandbox payment, or claim reconciliation works while this failure remains. Keep only one processor active during a future authorized cutover; do not run the legacy Render API processor in parallel.

The historical fictional USD 600 invoice is SENT, not PAID. Do not recreate or resend it. Any future test requires separate authorization, fresh fictional data, the genuine Sandbox webhook ID kept in the approved secret store, and read-only confirmation that the chosen webhook owner is healthy before creating a test payment. PayPal webhook simulator events are not evidence of verified provider delivery.

## Phase 12 readiness handoff (historical snapshot)

The following notes were recorded on 2026-10-30 and are superseded by the dated current status at the top of this runbook and `docs/IMPLEMENTATION_PROGRESS.md`. This historical snapshot is superseded by the 2026-11-12 status above. The owner now confirms migrations 1–20 and the Render deployment at commit 23194d8; payment reconciliation remains unverified.

### Non-production database verification

Use a separate Supabase staging project. Do not run this verification against production. The existing `ProofPayAI Staging` database is owner-confirmed to have migrations 1–20 applied; do not replay them. For a new non-production database, inspect the complete timestamp-ordered migration history and run the official CLI dry-run before obtaining separate apply approval. Preserve sanitized SQL output and project ref as evidence; never send database passwords or API keys in chat.

Create separate staging accounts for a client, freelancer, ordinary non-admin user, and trusted moderator. Seed the ordinary marketplace records through the app/API. Grant the moderator `admin` only through the trusted operator database path; a profile field or client request must not be treated as an authorization grant.

Run and record these checks against the deployed staging API and database:

| Area | Action | Expected result |
| --- | --- | --- |
| Migration | For the existing Staging project, verify the 20 migration versions and catalog state without applying anything. For a different staging database, first review and dry-run the full migration set. | Existing Staging history/schema agree; no unapproved migration is applied. Validate constraints, indexes, functions, grants, and RLS policies against PostgreSQL rather than relying on API mocks alone. |
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
| Supabase API and RLS workflows | Staging `SUPABASE_URL`; `sb_publishable_...` value in `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`; `sb_secret_...` value in server-only `SUPABASE_SERVICE_ROLE_KEY`; staging users listed above. All 20 migrations are owner-confirmed applied to the confirmed Staging project; do not replay them. Keep `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` public-only. |
| PayPal Sandbox | Sandbox OAuth, one fictional invoice create, DRAFT verification, and one invoice send have been verified; the invoice is recorded SENT. Before webhook use, configure server-only Sandbox credentials and a registered Sandbox webhook ID, then host the callback at public HTTPS `/api/webhooks/paypal`. No payment/webhook test is verified. Never use Live credentials. |
| GroqCloud AI | API-server-only `AI_PROVIDER=groq`, `GROQ_API_KEY`, and `GROQ_MODEL=openai/gpt-oss-20b` are configured. One real fictional milestone-generation request and one real scope-analysis request passed structured-output validation; the analysis audit persisted with provider `groq`. New inference requests need separate approval. |
| OpenAI alternative | Set API-server-only `AI_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. The existing Responses adapter retains strict structured output and `store:false`. OpenAI live-provider behavior remains untested; obtain separate approval before its first request. |
| Render staging | Historical paid-plan and pre-creation notes are superseded by the current [Hosting checklist](#hosting-checklist). The owner confirms both ProofPay Staging services are deployed at commit 23194d8. Keep Shipment-Tracker untouched. The known webhook limitation, Free sleep behavior, and payment-reconciliation restriction are documented above. |

The applied scope-analysis audit RPC accepts exactly `openai` and `groq`; a real Groq scope analysis was validated and persisted with provider `groq`. No additional AI request is authorized by this runbook.

Groq's current data-controls documentation says inference inputs and outputs are not retained by default, but may be temporarily retained for reliability or abuse investigations for up to 30 days unless the organization enables Zero Data Retention. Confirm the account's data-control setting and use fictional, non-sensitive staging text for the first approved provider test.

### Monitoring, backup, and lifecycle decisions

These are not configured in the repository. Before inviting external users, choose an accountable monitoring owner, an alert destination, an availability/error signal, and a test alert; verify logs redact credentials and private content. Choose database backup retention and recovery-point/recovery-time objectives that match the selected Supabase plan, run a backup, and record a successful restore drill on a separate staging target. A configured backup without a restore test is not verified.

The account flow currently records and reviews requests only. Before building automated deactivation or erasure, the project owner must set the request response target, retention period for invoices/contracts/audit and dispute evidence, legal-hold rules, treatment of backups/provider records, and who can authorize final erasure. Until those policies and the dependent-data inventory are reviewed, the UI must continue to describe the action as a request and must not claim the account was deleted.

### Bundle review

Analytics and its grid are lazy-loaded, and the grid itself is dynamically imported only when the authenticated Analytics route renders. The installed `ag-grid-community` package exposes one large ESM entry point; the current build emits a 719.63 kB (198.47 kB gzip) grid chunk. Removing needed row-model, pagination, or text-filter modules or replacing AG Grid would change working analytics/sponsor behavior. No safe further split was identified; retain the visible warning and track it for a future measured optimization.
