# ProofPay AI Project Memory

**Repository snapshot:** 2026-11-06, Africa/Lagos  
**Release branch:** codex/proofpay-staging-release  
**Inspected HEAD:** 84f588fbe918b718649e888665a387577db62d43  
**Remote:** origin points to distinctikechukwu-stack/ProofPayAI.

This file is a verified handover snapshot, not a replacement for the specifications or the canonical progress tracker. Current and historical claims below are labeled so that code presence is not confused with live service verification.

## Evidence labels

- **Current repository fact:** visible in the inspected branch, source, configuration, or test files.
- **Historically verified:** a dated result recorded in the canonical tracker or operations notes. It proves that observation at that date, not current external availability.
- **Unverified:** no reliable test or fresh external check was available.
- **Blocked:** an explicit environmental, configuration, authorization, or test failure prevents verification.

No application tests, database commands, provider calls, migrations, or deployments were run for this documentation task. Git and GitHub Actions status reads were read-only.

## Identity and product vision

ProofPay AI is a freelancer marketplace and project workspace intended to reduce scope disputes and improve payment clarity. It gives clients and freelancers a shared record of accepted terms, deliverables, reviews, evidence, scope changes, invoices, and provider-confirmed payment status. The original product target is a polished fintech SaaS experience for the 2026 PayPal AI Hackathon.

The original hackathon demo centers on a fictional $600 website project split into three milestones of $150, $250, and $200. A client asks for appointment booking. AI compares the request with the accepted agreement, cites the relevant text, classifies the request, identifies affected milestones and uncertainty, and proposes an amendment. People review and approve changes. For eligible work, the freelancer confirms invoice creation and sending as separate actions. PayPal Sandbox is the invoice provider; only verified provider state or authoritative reconciliation may establish payment.

The marketplace addendum expands the product with freelancer/client profiles, public opt-in discovery, jobs, proposals, offers, hiring, services, messaging, notifications, and hourly work. This addendum supplements the original workflow. Its supplied attachment ends mid-PayPal bullet after “- Re”; no missing requirements are inferred.

AI recommends and drafts. People remain responsible for scope, money, hiring, agreement acceptance, milestone review, and payment actions. The application must not claim escrow or let a UI action mark an invoice paid.

## PayPal Hackathon objectives and sponsor roles

- **PayPal:** central Sandbox-only invoicing and payment-state workflow. The backend obtains OAuth credentials, creates and sends invoices, reconciles uncertain writes, verifies webhooks, and records provider state. No live-money PayPal host is permitted.
- **APIMatic:** the PayPal Context Plugin was installed and its TypeScript integration/error/testing guidance was loaded before implementation. The generated TypeScript SDK map was inspected. It lists Orders, Payments, Vault, Transaction Search, and Subscriptions, but no Invoicing resource. Invoice work therefore uses PayPal Invoicing API v2 direct REST calls. No unrelated generated SDK operation is represented as invoice functionality, and no generated SDK runtime dependency remains.
- **AI:** Groq is the historically exercised provider; OpenAI is an alternative adapter. Structured output is validated at boundaries and citations are checked against saved agreement text. AI cannot accept or amend a contract. Missing configuration must be shown as unavailable.
- **AG Grid:** AG Grid Community is used for analytics tables. AG Studio charts are not separately present.
- **Timeline:** a responsive CSS timeline exists. Bryntum is not installed because no project license/package is configured.
- **Render:** a Free-plan Blueprint defines an API web service and static web service. It is not evidence of a currently healthy end-to-end deployment.
- **Postman:** a secret-free collection documents implemented API routes; no live Postman CLI run is recorded.

The master requirements ask for accurate sponsor evidence, user-facing distinction between sample data and persisted records, a truthful demo under three minutes, setup/deployment materials, and no unverified claims in the submission.

## Architecture

### Workspace and runtime

This is an npm workspace monorepo with TypeScript shared by the browser and API:

- **apps/web:** React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router, TanStack Query, React Hook Form, Zod, Lucide, and AG Grid Community.
- **apps/api:** Node.js TypeScript and Fastify 5 REST API. Server-only Supabase service-role, AI, and PayPal credentials are used here.
- **packages/shared:** Zod domain/input schemas and exact-money/domain helpers used across the app and API.
- **supabase/migrations:** 19 timestamp-ordered PostgreSQL migrations for schema, RLS, views, functions, triggers, and storage policy.
- **supabase/tests:** pgTAP coverage for the project-completion workflow.
- **scripts:** static SQL-contract checks, PostgreSQL workflow harness, synthetic fixtures, concurrency validation, and Render checks.
- **postman:** v2.1 collection and usage notes.
- **docs:** specifications, phase tracker, integration/operations records, demo and submission drafts.

The repository pins Node 26.13.0 in .node-version; documentation records npm 11.20.0. The API exposes /health and /api/status. The former only proves the process responds; the latter reports configuration booleans and does not prove a provider is reachable.

### Browser application

apps/web/src/App.tsx wires the route shell. contexts/AuthContext.tsx and lib/supabase.ts use only the public Supabase URL/key. lib/api.ts sends the signed-in user token to the API. data/demo.ts supplies clearly labeled signed-out preview content.

Main pages include Landing, Auth, Dashboard, Projects and Project Detail, Scope, Invoices, Timeline, Analytics, Profile, Opportunities, Services, Messages, Hourly Work, Moderation, and account/settings information. Shared visual components and responsive styles live under components/ and styles/.

### API and service boundaries

apps/api/src/app.ts registers Fastify routes and validates request/provider/domain boundaries. supabase.ts creates user-scoped and service-role clients. ai.ts implements provider selection and structured responses. paypal.ts implements direct PayPal Sandbox REST. paypal-webhook-worker.ts claims and reconciles durably queued events; server.ts starts the API and the worker when configuration is ready.

Route families include:

- Health/configuration: GET /health, GET /api/status.
- Identity and accounts: /api/profile, /api/profile/roles, /api/profile/account, /api/profile/freelancer, /api/profile/client, and account-deletion request/cancel routes.
- Public profiles/services: /api/public/freelancers/:slug, /api/services, /api/services/mine, and service-request routes.
- Marketplace: /api/jobs, job status/favorite/report/proposals, proposal transitions/offers, and offer responses.
- Projects/contracts: /api/projects, project detail, clients, agreement acceptance, draft milestones, milestone start/deliverables/reviews, scope requests, analysis, change-order proposal/decision, and project-completion recheck.
- Messaging: conversations, messages, receipts/read state, blocks, reports, and notifications.
- Work and reporting: hourly entries/timers, invoice candidates, analytics, and timeline.
- Invoicing: list, milestone create, hourly batch create, send, and reconcile routes.
- Provider callback: POST /api/webhooks/paypal.
- Administration: /api/admin/moderation and job/conversation/deletion-request decisions.

The detailed route declarations are in apps/api/src/app.ts; apps/api/README.md gives a concise contract summary.

### Authentication, authorization, and storage

Supabase Auth authenticates users. API requests carry a Supabase bearer token and user-facing reads use the request-scoped anon client, with database RLS as a second boundary. A submitted user ID or role label is not proof of authority. Admin role assignment is operator-controlled; app users cannot self-assign it.

Privileged operations use server-only service-role RPCs that independently validate the actor and project membership/role. This includes invoice claims, provider-state writes, scope-analysis audit writes, and webhook queue operations. The database uses RLS, participant/member checks, fixed-search-path security-definer functions, unique/idempotency constraints, append-only review/event history, and security-barrier/invoker views where appropriate.

Storage policies cover private project deliverables and conversation attachments. Secure file preview/download is not configured; the project UI avoids exposing private storage paths. Realtime message subscriptions are present in migrations/client code, but live behavior has not been fully verified.

### Money, agreements, and workflow state

Money is stored as integer minor units or exact decimal text. JavaScript floating-point values are not the source of truth. Accepted agreement and change-order versions are immutable. Acceptance is explicit and associated with actor/role/time. Milestone workflow status is distinct from PayPal invoice/payment status.

The invoice lifecycle commits a database claim before provider writes. A timeout or lost response after create/send is an unknown outcome, not a failed operation. Create uncertainty is reconciled by the persisted invoice number; send uncertainty by the known provider invoice ID. No automatic retry may duplicate a provider write.

### Database domains

The current migration set creates 44 public tables, plus views and Supabase Storage objects/policies. Main tables are:

- **Core project and contract:** profiles, projects, project_members, agreement_versions, agreement_acceptances, milestones, deliverables, milestone_reviews, change_requests, change_order_versions, change_order_acceptances, activity_logs.
- **AI and payments:** ai_analysis_records, invoices, paypal_operation_claims, paypal_webhook_events.
- **Profiles and marketplace:** profile_roles, freelancer_profiles, freelancer_portfolio_items, client_profiles, marketplace_jobs, marketplace_job_favorites, marketplace_job_reports, marketplace_proposals, marketplace_proposal_events, marketplace_offers, freelancer_services, service_hiring_requests.
- **Messaging and safety:** project_conversations, project_messages, project_message_receipts, user_notifications, user_blocks, conversation_abuse_reports.
- **Hourly work:** hourly_contracts, hourly_timer_sessions, hourly_timer_events, hourly_time_entries, hourly_time_entry_reviews, hourly_time_entry_events, hourly_invoice_batches, hourly_invoice_batch_entries.
- **Commercial administration:** moderation_actions, account_deletion_requests.

Migration 19 adds guards/RPCs/triggers but no new table. Migration filenames and purposes are in DEVELOPMENT_HISTORY.md.

## External integrations and configuration

Variable names in .env.example and render.yaml include:

- Application: API_PORT, PORT (host supplied), APP_ORIGIN, VITE_API_URL.
- Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
- AI: AI_PROVIDER, GROQ_API_KEY, GROQ_MODEL, OPENAI_API_KEY, OPENAI_MODEL.
- PayPal Sandbox: PAYPAL_SANDBOX_CLIENT_ID, PAYPAL_SANDBOX_CLIENT_SECRET, PAYPAL_WEBHOOK_ID.
- Host/runtime: NODE_VERSION, NODE_ENV, and Render-provided RENDER_EXTERNAL_URL.

Only Vite-prefixed public Supabase/API settings may reach the browser. Service-role, AI, and PayPal values remain server-only. No secret values are included in this memory.

## Current status snapshot

### Git and workspace

At inspection, local HEAD and the public release branch were both 84f588fbe918b718649e888665a387577db62d43 (test: add safe PostgreSQL fixture diagnostics). The checkout is codex/proofpay-staging-release. Before these five handover files were added, four tracked files already had local edits: docs/IMPLEMENTATION_PROGRESS.md, two scope-analysis static test files, and supabase/migrations/README.md. Preserve those edits.

Git lists other linked ProofPay worktrees: ProofPayAI-Codex3 on codex/security-qa at 85897a9; ProofPayAI-Marketplace on feature/marketplace-expansion at db27dd5; ProofPayAI-master-workflow on master at 113a71c; ProofPayAI-Webhook on codex/webhook-readiness at 85897a9; and ProofPayAI-Webhook-Integration detached at 85897a9. Their file contents and cleanliness were not inspected in this handover. Do not remove or reset them.

### CI, tests, and migration 19

The only workflow under .github/workflows is a manual workflow_dispatch PostgreSQL validation workflow for migration 19. The latest available GitHub Actions run is #3, run ID 42221327531, at commit c9b5177; it failed. Runs #1 and #2 also failed. There is no newer Actions run for current HEAD 84f588f. The commit status API for 84f588f says pending with zero status contexts.

Run #3 passed its rollback probe, applied all 19 migrations inside its disposable local Supabase/PostgreSQL stack, then failed while applying scripts/fixtures/project-completion-post-migration.sql, before pgTAP. psql exited 3. CI retained only unclassified_database_error, not the failing statement, SQLSTATE, constraint, trigger, or fixture step. Therefore the underlying fixture/SQL cause is **not identified**. The failure does not establish that migration 19 itself is defective.

Commit 84f588f added verbose psql error mode, allowlisted fixture-step markers, and sanitized extraction of SQLSTATE/category/constraint/trigger/step. This instrumentation has not yet been rerun in GitHub Actions. Focused project-completion tests passed 29/29 in the local record. The latest full npm test attempt then timed out one existing web test (keeps project conversations and notifications private while signed out): web 21/22; a serialized full rerun remained required. The last recorded full passing run before that was 244/244 (24 shared, 124 API, 22 web, 74 SQL/Blueprint contracts). Typecheck and production build passed in that earlier verification; do not claim a fresh pass on current HEAD. Current Windows has no Docker engine/CLI or psql, so local engine-level reproduction was unavailable.

### Database and provider status

- Local repository contains 19 migrations. The last recorded successful Supabase Staging catalog/history verification was through migration 18. A fresh Nov 5 migration-history request failed at database login/bootstrap; therefore current remote history is **unknown**. Migration 19 is local/repository code and was not applied to Staging by this documentation work.
- Groq milestone generation and one citation-validated scope analysis were historically exercised against the provider; an analysis audit was recorded. OpenAI provider behavior is unverified.
- One fictional USD 600 PayPal Sandbox invoice was created once, reconciled as DRAFT, and sent once. The latest recorded local/provider state is SENT. No Sandbox payment, paid state, signature-verified webhook delivery, or webhook queue processing has been verified. Do not recreate or resend that invoice.
- The historical staging PayPal OAuth request succeeded, but current provider credentials/configuration were not inspected for this task. The real PAYPAL_WEBHOOK_ID was recorded as absent/placeholder, and no registered public HTTPS webhook was documented.

### Hosting status and source conflicts

The repository records a successful Render static frontend deployment on 2026-11-04 at commit 1c9f356, serving the landing page and sample route. At that time the API service was recorded Live on the Free plan at prior commit 8d8b82e. A separate Nov 4 check could not verify API health/CORS because Render dashboard/DNS requests failed; its visible API environment-variable list lacked APP_ORIGIN, which would leave the code's localhost CORS fallback in place. Static Supabase build configuration was not confirmed. Current live status is unverified.

The Free API runs the durable webhook worker in-process and polls at one-second intervals. Free hosting can sleep and cannot guarantee continuous webhook processing. The webhook ID is absent; no real webhook should be registered until the polling/availability design is addressed.

Some repository documents are stale or conflict with later records: root README.md and top portions of docs/OPERATIONS.md/supabase/README.md have older no-deployment/no-migration wording; later dated operations notes record a Nov 4 frontend deployment and prior Staging migrations. docs/DEVPOST_DRAFT.md and docs/APIMATIC_INTEGRATION.md also contain older integration wording. Use the dated canonical tracker and operations notes, and refresh public-facing claims before submission.

## Source-of-truth reading order

1. AGENTS.md — permanent project safeguards.
2. docs/MASTER_REQUIREMENTS.md — original hackathon specification and acceptance checklist.
3. docs/EXPANDED_PRODUCT_REQUIREMENTS.md — marketplace extension, including its incomplete-source warning.
4. docs/IMPLEMENTATION_PROGRESS.md — canonical feature/test/history ledger; check the working tree version because it is edited locally.
5. paypal-plan.md — authoritative PayPal contract sheet.
6. docs/FEATURE_STATUS.md, docs/DEVELOPMENT_HISTORY.md, and docs/REMAINING_WORK.md — this handover package.

See docs/AI_HANDOVER.md for the next task and safe continuation procedure.
