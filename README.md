# ProofPay AI

ProofPay AI is a freelancer project workspace for shared agreements, milestone approvals, evidence-backed scope reviews, and PayPal Sandbox invoicing.

## Implementation status

The original hackathon workflow has an implemented React frontend, authenticated Node API paths, Supabase migrations, structured AI boundaries, and a Sandbox-only PayPal Invoicing REST integration. Workspace tests exercise provider and database seams with fakes; they do not prove live Supabase, AI, or PayPal behavior. The signed-out workspace is explicitly sample data.

The PayPal workflow includes durable create/send claims, unknown-outcome reconciliation, verified-webhook handling, and provider-state mapping. No live PayPal request has been made, and no migration has been applied or parsed by PostgreSQL. Marketplace phases 8 and 9 include protected profile/role flows, public opt-in profiles, persisted jobs/proposals/offers/services, and editable AI/manual milestone planning. Phase 10 includes project-member conversations, idempotent messages, read receipts, notifications, private attachments, blocking, abuse reports, and realtime message subscriptions. Phase 11 adds hourly offer-to-agreement conversion, manual and timer-based time entries, client approvals/disputes, and approved-hours PayPal invoice batching. Phase 12 adds admin-only report review, explicit account-deletion requests, baseline API security headers, and an operations runbook. These database paths are tested with fakes only; no AI provider call has been made, and PostgreSQL/Supabase RLS, storage, realtime, and moderation behavior remain unverified. Reviews/reputation, actual account deletion/retention, and live service verification remain incomplete. No deployment has been performed. See the [implementation tracker](docs/IMPLEMENTATION_PROGRESS.md) for the phase ledger and blockers.

## Project structure

- `apps/web/` — React, TypeScript, Vite, Tailwind, Supabase browser client, and responsive workspace.
- `apps/api/` — Fastify TypeScript API; PayPal and AI credentials stay server-side.
- `packages/shared/` — shared Zod/domain schemas and exact money helpers.
- `supabase/migrations/` — forward-only schema, RLS, and service-role RPC migrations.
- `supabase/seed/` — seed setup notes. The current $600 sample is frontend preview data, not a database seed.
- `postman/` — secret-free v2.1 collection for the implemented routes.
- `docs/` — source specifications, progress ledger, integration evidence, demo, and submission materials.

## Local setup

Requirements: Node.js `v26.13.0` (or a compatible Node 26 release) and npm `v11.20.0`. Install the workspace dependencies once from the repository root:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` only for services you have configured. Keep the Supabase service-role key, AI key, and PayPal Sandbox credentials private. The Vite config loads the root `.env` file but exposes only `VITE_*` values; the API dev command loads it with Node's built-in `--env-file-if-exists` option.

Start the API and frontend in separate PowerShell terminals from the repository root:

```powershell
npm.cmd run dev:api
```

```powershell
npm.cmd run dev:web
```

The API listens on `http://localhost:4000`; the web app uses `http://localhost:5173`. `GET /health` does not require external credentials. Without Supabase configuration, the web app remains in clearly labeled preview states; invoice creation, persistence, and provider calls are unavailable.

If a running Codex process has an old PATH, invoke npm with the installed Windows command or refresh the current PowerShell process:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
npm.cmd run typecheck
```

## Supabase configuration

Create a Supabase project and fill `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in the private root `.env` file. Apply migrations in timestamp order:

1. `supabase/migrations/202610290001_core_project_security.sql`
2. `supabase/migrations/202610290002_paypal_invoice_workflow.sql`
3. `supabase/migrations/202610300001_marketplace_profiles.sql`
4. `supabase/migrations/202610300002_marketplace_jobs.sql`
5. `supabase/migrations/202610300003_messaging_notifications.sql`
6. `supabase/migrations/202610300004_hourly_workflows.sql`
7. `supabase/migrations/202610300005_commercial_hardening.sql`

The SQL has not been applied or verified against PostgreSQL/Supabase in this workspace. The hourly migration also attaches older accepted hourly offers that have no project to a draft project and agreement. The commercial-hardening migration adds admin report review, listing holds, an audit trail, and deletion requests; it does not delete accounts. Review every migration, apply them to a non-production project, and test RLS and role boundaries before using persisted workflows. Read [`supabase/README.md`](supabase/README.md), [`supabase/migrations/README.md`](supabase/migrations/README.md), and the [operations guide](docs/OPERATIONS.md).

## AI and PayPal Sandbox

AI analysis uses server-side `OPENAI_API_KEY` and `OPENAI_MODEL`. PayPal is fixed to the Sandbox host and uses server-side `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`. Do not create live credentials or put secrets in `VITE_*` variables.

Invoice creation and sending require configured Supabase service-role access, an eligible persisted milestone or a batch of client-approved hourly entries, and PayPal Sandbox credentials. The hourly amount and entry set are derived server-side from the active accepted rate. Verified webhooks additionally require a registered Sandbox webhook pointing to a public HTTPS API endpoint. The app does not represent an unconfigured integration, sample, or mock as a real invoice or payment. See [`paypal-plan.md`](paypal-plan.md) and [`docs/APIMATIC_INTEGRATION.md`](docs/APIMATIC_INTEGRATION.md).

## Verification

Run the checks from the root:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

There is no workspace lint script yet. The current build emits a visible Vite warning for the lazy AG Grid Community bundle. Test counts and external verification limits are recorded in [`docs/IMPLEMENTATION_PROGRESS.md`](docs/IMPLEMENTATION_PROGRESS.md).

## Postman and hosting

Import [`postman/ProofPayAI.postman_collection.json`](postman/ProofPayAI.postman_collection.json). Use a private environment for `apiBase`, a Supabase access token, and record IDs; never export credentials. The collection is JSON-validated but has not been run through Postman against a configured API.

`render.yaml` defines a Render Blueprint for the Node API and static Vite app. It is configuration only: no Render service is deployed. Supply the public Supabase settings at frontend build time and server-only values in the API service, apply the migrations, set the exact app origin, and configure a public HTTPS PayPal Sandbox webhook before testing a full lifecycle. See [`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md).

## Requirements and demo materials

- [Original hackathon requirements](docs/MASTER_REQUIREMENTS.md)
- [Expanded marketplace requirements](docs/EXPANDED_PRODUCT_REQUIREMENTS.md)
- [Operations and deployment guide](docs/OPERATIONS.md)
- [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md)
- [APIMatic integration evidence](docs/APIMATIC_INTEGRATION.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Devpost draft](docs/DEVPOST_DRAFT.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)
