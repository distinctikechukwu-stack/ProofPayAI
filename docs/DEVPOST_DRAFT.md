# Devpost submission draft

**Status:** Draft only. Update it after the remaining payment, webhook, database, and end-to-end demo checks. Do not present it as a production-ready marketplace description while phases 8–12 are incomplete.

## Project title

ProofPay AI

## Tagline

Clear freelance scope, accountable approvals, and payment tracking in one shared workspace.

## Inspiration

Freelancers and clients can lose time and trust when project agreements, scope changes, approvals, and invoices live in separate conversations. ProofPay AI is designed to keep the accepted terms and the next decision visible to both sides.

## What it does

ProofPay AI provides a project workspace for agreements, milestones, deliverable reviews, evidence-backed scope requests, and PayPal invoice tracking. Its intended core story follows a `$600` website project through three milestones. AI analysis is schema-checked and must cite the saved agreement evidence; proposed changes remain drafts until both project roles approve them. PayPal invoices are a separate provider workflow, with separate create/send confirmations and verified-provider-state handling.

The current signed-out experience is a clearly labeled sample preview. It does not claim that its project, AI analysis, invoice, or payment is persisted or real.

## How it was built

- React, TypeScript, Vite, Tailwind CSS, and a Node.js TypeScript API.
- Supabase Auth/Postgres/RLS integration code and forward-only migrations.
- Zod validation at shared, API, provider, and AI boundaries; money is stored and calculated in integer minor units.
- PayPal Invoicing v2 direct REST calls against the fixed Sandbox host. APIMatic's PayPal Context Plugin was used during development: its TypeScript integration workflow and getting-started, error-handling, and testing guidance informed the contract-first plan, server-only credential boundary, uncertain-write handling, and injected-fetch test seam. The inspected generated SDK map had no Invoicing resource; no APIMatic-generated SDK operation is used at runtime.
- AG Grid Community for role-scoped analytics tables, a lightweight responsive timeline, a Render Blueprint, and a secret-free Postman collection.

## Challenges and safety decisions

Creating and sending invoices are separate operations. Durable database claims must precede provider writes, and uncertain write outcomes stay reconcilable rather than triggering duplicate sends. Webhook event bodies are not trusted as payment state; signature verification and an authoritative invoice read are required.

## Verification and current limitations

The latest recorded local checks are listed in [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md). They include automated tests, TypeScript checks, and a production build; PayPal/API tests use controlled fakes and are not live provider verification.

- **Database:** ProofPayAI Staging has migrations 1–18. Migration 19 passed PostgreSQL integration, rollback, and concurrency validation in the isolated GitHub Actions runner; it has not been applied to Staging. Some marketplace live persistence and RLS behavior remain unverified.
- **Groq:** Real local milestone generation and scope analysis are recorded in the progress tracker. The milestone test used `openai/gpt-oss-20b`, returned ten structured milestones totaling 60,000 minor units, and left them in draft status. Scope analysis passed schema and evidence-citation validation and recorded provider `groq`. These results do not verify hosted inference on the currently deployed Render revision.
- **Historical PayPal Sandbox evidence:** One OAuth request succeeded with the Invoicing scope. One fictional USD 600 invoice was created once, read back as `DRAFT`, and sent once; its recorded state is `SENT`. Do not recreate or resend it.
- **Payment and webhooks:** No Sandbox payment has been completed. No genuine signed webhook delivery or authoritative webhook-driven payment reconciliation has been verified. A prior read-only status check reported `paypalWebhook: false` and the worker disabled; the latest dashboard review did not independently verify the webhook-ID setting.
- **Hosting:** Read-only checks confirmed the Staging API and web services were reachable; API `/health` returned HTTP 200 and a frontend-origin CORS preflight returned HTTP 204. The services were last observed on commit `85897a96b9376963ea864296ef7d0da0364d3e21`, not the combined integration candidate. The API is on Render Free; a reachable service does not establish webhook delivery, hosted Groq inference, or a completed end-to-end demo. Free hosting can sleep and cannot guarantee continuously available webhook processing.
- **End-to-end demo:** The exact primary story—persisted Groq scope analysis, a dual-approved change order, an eligible milestone, and its related invoice—has not been demonstrated as one continuous authenticated UI workflow.
- **Marketplace:** Profile, job, proposal, offer, and service code has shared/API/UI tests that use fakes; live persistence, RLS, and SQL behavior remain partly unverified. Reviews, verified work history, messaging, hourly work, moderation, and deactivation/deletion remain incomplete.

## Sponsor evidence to attach after verification

- **APIMatic:** The Context Plugin was installed and loaded for Codex/VS Code and its TypeScript integration, getting-started, error-handling, and testing guidance informed the PayPal implementation plan and test seams. The official rules list the Best Use of APIMatic prize for eligible submissions using any APIMatic tools, and the APIMatic sponsor page specifically recognizes using the Context Plugin to build a PayPal integration. This is a documented development-time tool-use claim, not a runtime SDK claim; sponsor selection and any additional terms are not guaranteed. See [`APIMATIC_INTEGRATION.md`](APIMATIC_INTEGRATION.md).
- **PayPal Sandbox:** The historical OAuth, invoice creation, and invoice send are recorded above. Payment completion, genuine signed webhook delivery, and authoritative payment reconciliation remain unverified.
- **AG Grid Community:** Used in analytics. AG Studio charts were not separately added.
- **Bryntum:** Not included because no project license/package is configured; the current timeline is CSS-based.
- **Render:** The Staging API and web services were reported online on the older commit listed above. The combined candidate is not deployed; do not claim its features are hosted or production readiness.
- **Postman:** The collection parses as JSON; no live collection run has been performed.

## Before submission

Complete [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md), recheck the Staging service and webhook status before submission, and link the actual demo recording only after recording it. This draft does not claim a recording, a verified deployed commit, payment completion, or a verified webhook.
