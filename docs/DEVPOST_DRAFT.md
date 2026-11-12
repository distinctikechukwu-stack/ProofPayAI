# Devpost submission draft

**Status:** Evidence-aligned draft; review the release gates below before publication.

## Project title

ProofPay AI

## Tagline

Make freelance scope, approvals, and invoicing easier to trust.

## Inspiration

Clients and freelancers often manage scope, approvals, evidence, and invoices across separate conversations. That makes it difficult to answer simple questions: What was agreed? What changed? What is ready for review? What has actually been invoiced or paid?

ProofPay AI brings those decisions into one shared project workspace and keeps human approval and provider-verified payment state distinct.

## What it does

ProofPay AI combines freelancer profiles and service discovery with client jobs, proposals, hiring, agreements, milestones, deliverable evidence, review history, evidence-backed scope analysis, and PayPal Sandbox invoicing.

The AI milestone assistant returns structured, editable draft suggestions. It does not accept an agreement or approve work. Scope analysis cites saved project evidence, and a proposed price or scope change remains subject to human review and the project's approval rules.

PayPal invoice creation and sending are explicit operations. A SENT invoice is not a paid invoice. Payment state is intended to come from verified provider data and reconciliation, never from a UI action.

## How it was built

- React, TypeScript, Vite, Tailwind CSS, and a Node.js TypeScript API.
- Supabase Auth, Postgres, row-level security, and forward-only migrations.
- Zod validation at shared, API, AI, and provider boundaries; currency amounts use integer minor units.
- PayPal Invoicing v2 REST calls are fixed to the Sandbox host. Server-side operation claims and unknown-outcome handling protect invoice writes.
- The PayPal Context Plugin from APIMatic informed development-time contract planning, error handling, and testing. The inspected generated SDK map did not include Invoicing, so no unrelated generated SDK call is used at runtime.
- AG Grid Community supports analytics views; the milestone timeline uses CSS.

## What has been verified

The integrated candidate is branch **codex/proofpay-final-integration-prep**, commit **23194d8caffb46378b7fe1dddb710410ac3c8f82**. GitHub Actions [run #13](https://github.com/distinctikechukwu-stack/ProofPayAI/actions/runs/43056263683) passed 376 automated tests, TypeScript checks, production build, Wrangler dry run, and Linux Worker smoke. Its isolated PostgreSQL validation applied migrations 1–20, passed rollback/application checks, 116 pgTAP assertions, and a real two-session payment-state ordering race.

Earlier owner-led Staging tests verified two fictional participants, an accepted agreement, milestone approvals, private freelancer-profile save/reload, authenticated profile/project reads, and a fictional Sandbox invoice that was sent once. Local regression tests cover deliverable evidence and revision feedback; hosted post-fix visibility has not been reverified. Historical real Groq tests verified structured milestone generation and evidence-backed scope analysis locally. The owner confirms the final candidate is deployed; hosted Groq inference has not been tested.

## Honest limitations

- Public Staging frontend and API endpoints returned HTTP 200 in a read-only check. API status flags showed Supabase, AI, and PayPal configured; webhook readiness was false. Those flags are not authenticated database or provider tests.
- Owner-confirmed November 12: both Render Staging services run commit 23194d8, and hosted login, dashboard, and existing project views work. This review did not independently inspect the dashboard.
- The owner confirms all 20 Supabase Staging migrations are applied. Migration 20 also passed isolated CI; this review did not query migration history directly.
- Hosted Groq generation and editing/saving/reloading its suggestions have not been verified on the final candidate.
- The Cloudflare Staging webhook path has a known HTTP 400 issue. No genuine signed webhook delivery, Sandbox payment, or payment reconciliation is verified. No invoice is to be described as PAID.
- Render Free can sleep and cannot guarantee continuous webhook processing.
- Marketplace features have broad implementation and automated coverage, but a complete hosted marketplace acceptance pass remains outstanding.
- No recording is claimed by this draft.

## Demo plan

Use [the evidence-aligned demo script](DEMO_SCRIPT.md). Reuse only existing fictional Staging accounts and records; do not recreate or resend the historical invoice. Show a prior verified Groq result as historical/local evidence unless a separately authorized hosted request is completed. Show the existing invoice as SENT, never PAID. If a screen or integration has not been checked live, say so plainly.

## Sponsor evidence

APIMatic Context Plugin use during development is documented in [APIMATIC_INTEGRATION.md](APIMATIC_INTEGRATION.md). It informed planning and testing for the direct PayPal Invoicing integration; the generated SDK was not used at runtime. This records tool use and makes no claim about prize eligibility or judging outcome.

## Submission gate

The owner confirms the final candidate SHA is deployed and the hosted login, dashboard, and existing projects work. Before publishing, complete the broader marketplace/Groq checks or keep those claims limited, and decide whether to submit with webhook/payment reconciliation explicitly deferred. Do not imply webhook or payment completion until verified.
