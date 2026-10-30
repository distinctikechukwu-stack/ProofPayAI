# Devpost submission draft

**Status:** Draft only. Update this page after live Sandbox and database verification. Do not submit it as a production-ready marketplace description while phases 8–12 are incomplete.

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
- PayPal Invoicing v2 direct REST calls against the fixed Sandbox host. The APIMatic Context Plugin's TypeScript integration and error/testing guidance informed the plan-first contract and test seams. The inspected generated SDK map had no Invoicing resource, so no unrelated SDK operation is claimed.
- AG Grid Community for role-scoped analytics tables, a lightweight responsive timeline, a Render Blueprint, and a secret-free Postman collection.

## Challenges and safety decisions

Creating and sending invoices are separate operations. Durable database claims must precede provider writes, and uncertain write outcomes stay reconcilable rather than triggering duplicate sends. Webhook event bodies are not trusted as payment state; signature verification and an authoritative invoice read are required.

## Verification and current limitations

The workspace typecheck, automated tests, and production build pass; PayPal/API tests use controlled fakes. The exact current results are in [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md).

No Supabase migration has been applied or tested against PostgreSQL. No PayPal Sandbox credentials or webhook ID are configured, no live Sandbox request or transaction has been made, and no public HTTPS webhook or hosted deployment exists. Marketplace profile, job, proposal, offer, and service code has shared/API/UI tests that use fakes; live persistence, RLS, and SQL execution remain unverified. Reviews, verified work history, messaging, hourly work, moderation, and deactivation/deletion remain incomplete.

## Sponsor evidence to attach after verification

- APIMatic Context Plugin installation/use: documented in [`APIMATIC_INTEGRATION.md`](APIMATIC_INTEGRATION.md); direct REST is used for Invoicing because the inspected SDK map lacks those operations.
- PayPal Sandbox: implementation tests only until live Sandbox credentials and webhook checks have been run.
- AG Grid Community: used in analytics. AG Studio charts were not separately added.
- Bryntum: not included because no project license/package is configured; the current timeline is CSS-based.
- Render: a Blueprint is present, but no service has been deployed.
- Postman: collection parses as JSON; no live collection run has been performed.

## Before submission

Complete [`SUBMISSION_CHECKLIST.md`](SUBMISSION_CHECKLIST.md), replace any draft claims with observed results, and link the actual demo recording only after recording it. No recording or public deployment is claimed by this document.
