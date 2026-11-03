# ProofPay AI

ProofPay AI is a freelancer project workspace for shared agreements, milestone approvals, evidence-backed scope reviews, and PayPal Sandbox invoicing.

## Implementation status

The original hackathon workflow has an implemented React frontend, authenticated Node API, Supabase Auth/Postgres/RLS integration, structured AI boundaries, and Sandbox-only PayPal Invoicing API v2 integration. As of 2026-11-03, the confirmed non-production Supabase project has all 18 migrations applied and verified. Real Groq milestone generation and scope analysis, PayPal Sandbox OAuth, invoice creation, and one invoice send have been verified. The continuous authenticated UI story, Sandbox payment, and verified webhook delivery/reconciliation remain unverified. The signed-out workspace is explicitly sample data.

The PayPal workflow includes durable create/send claims, unknown-outcome reconciliation, signature-verified webhook handling, a durable event queue, and provider-state mapping. The fictional Sandbox invoice is SENT; it must not be recreated or resent. The configured local webhook ID is still a placeholder and no hosted HTTPS endpoint or Render service has been verified. Marketplace phases 8–12 remain implemented and preserved, but new marketplace scope is frozen until the hackathon demo is complete. Reviews/reputation, actual account erasure/retention, monitoring, and backup/restore readiness remain incomplete. No deployment has been performed. See the [implementation tracker](docs/IMPLEMENTATION_PROGRESS.md) for verified results and blockers.

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

Copy `.env.example` to the ignored root `.env`; use the project's `sb_publishable_...` key for `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`, and its `sb_secret_...` key only for server-side `SUPABASE_SERVICE_ROLE_KEY`. Keep `SUPABASE_URL` and `VITE_SUPABASE_URL` set to the project URL. Never place the secret key in a `VITE_*` variable or chat. The original seven migrations are followed by timestamped corrective migrations through `202611020004_paypal_webhook_durable_processing.sql`. ProofPayAI Staging currently has all 18 applied. For a new non-production database, inspect the complete timestamp-ordered migration set, check remote history, and run the official Supabase CLI dry-run before any separately approved apply. Do not replay the seven-file historical list as if it were the complete schema. Read [`supabase/README.md`](supabase/README.md), [`supabase/migrations/README.md`](supabase/migrations/README.md), and the [operations guide](docs/OPERATIONS.md).

## AI and PayPal Sandbox

AI uses Groq by default (`AI_PROVIDER=groq`, server-only `GROQ_API_KEY`, and `GROQ_MODEL=openai/gpt-oss-20b`); OpenAI remains available by setting `AI_PROVIDER=openai` with server-only `OPENAI_API_KEY` and `OPENAI_MODEL`. If `AI_PROVIDER` is omitted, a configured Groq key takes precedence; an existing OpenAI-only configuration remains compatible. AI keys must never use `VITE_*` variables. PayPal is fixed to the Sandbox host and uses server-side `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`. Do not create live credentials or put secrets in `VITE_*` variables.

Both AI features keep their Zod checks and human-review boundary. The applied scope-analysis audit validation accepts exactly `openai` and `groq`; one real Groq scope-analysis result was validated and persisted with provider `groq`. Do not treat AI recommendations as approvals.

Invoice creation and sending require configured Supabase service-role access, an eligible persisted milestone or a batch of client-approved hourly entries, and PayPal Sandbox credentials. The hourly amount and entry set are derived server-side from the active accepted rate. Migration 18 provides durable verified-event processing, but webhook operation still requires a real Sandbox webhook ID and public HTTPS API endpoint. The local webhook ID is a placeholder; no webhook or payment has been tested. The app does not represent an unconfigured integration, sample, or mock as a real invoice or payment. See [`paypal-plan.md`](paypal-plan.md) and [`docs/APIMATIC_INTEGRATION.md`](docs/APIMATIC_INTEGRATION.md).

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

`render.yaml` defines a dedicated ProofPay AI Staging Blueprint for the Node API and static Vite app. Its paid 0.5 CPU / 512 MB API service runs the HTTP server and durable webhook worker together, and declares Groq/OpenAI plus server-only Supabase and PayPal Sandbox settings. The frontend receives only public `VITE_*` settings. This is configuration only: no Render service is deployed. Do not sync or deploy this Blueprint until the target, source branch, environment, plan, and required changes have been confirmed. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) and [`docs/SUBMISSION_CHECKLIST.md`](docs/SUBMISSION_CHECKLIST.md).

## Requirements and demo materials

- [Original hackathon requirements](docs/MASTER_REQUIREMENTS.md)
- [Expanded marketplace requirements](docs/EXPANDED_PRODUCT_REQUIREMENTS.md)
- [Operations and deployment guide](docs/OPERATIONS.md)
- [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md)
- [APIMatic integration evidence](docs/APIMATIC_INTEGRATION.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Devpost draft](docs/DEVPOST_DRAFT.md)
- [Submission checklist](docs/SUBMISSION_CHECKLIST.md)
