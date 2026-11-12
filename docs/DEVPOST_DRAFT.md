# Devpost submission draft

**Status:** Copy-ready content draft; publication checks and submission-form completion remain required.

## Project title

ProofPay AI

## Tagline

Make freelance scope, approvals, and invoicing easier to trust.

## Project links

- **Live demo:** https://proofpay-staging-web.onrender.com
- **Public source and setup:** https://github.com/distinctikechukwu-stack/ProofPayAI/tree/codex/proofpay-final-integration-prep
- **Automated validation:** https://github.com/distinctikechukwu-stack/ProofPayAI/actions/runs/43056263683
- **Demo video:** Not recorded yet. Add the public YouTube URL after recording a video under three minutes.
- **Local setup:** Follow the root README on the source branch. The hosted site requires a Staging account; do not publish administrator, provider, or service credentials in the repository.

## Short description

ProofPay AI gives clients and freelancers one workspace for discovering work, agreeing on scope, reviewing milestone evidence, and requesting PayPal Sandbox invoices—with AI suggestions that stay editable and under human control.

## Inspiration

Freelance projects often scatter scope, approvals, evidence, and invoices across separate conversations. That makes it hard to answer: What did we agree to? What changed? What is ready for review? What has actually been invoiced or paid?

ProofPay AI brings those decisions into a shared project workspace and keeps project approval separate from provider-verified payment state.

## What it does

ProofPay AI brings freelancer profiles and service discovery together with client jobs, proposals, hiring, two-party agreements, milestones, deliverable evidence, review history, and evidence-backed scope analysis. Its AI milestone assistant returns structured, editable draft suggestions; people review and edit them before saving. AI does not accept agreements, approve deliverables, or decide that extra work is owed.

The application integrates PayPal Invoicing v2 in Sandbox. Invoice creation and sending are explicit operations. One historical fictional USD 600 Sandbox invoice was created once, read back as DRAFT, and sent once; its recorded state is SENT. SENT is not PAID.

## How we built it

- React, TypeScript, Vite, Tailwind CSS, and a Node.js TypeScript API.
- Supabase Auth and Postgres with row-level security, versioned agreements, and forward-only migrations.
- Shared Zod validation at API, AI, and provider boundaries; money is represented in integer minor units.
- Groq-backed structured milestone generation and evidence-based scope analysis, with server-only provider credentials and human review. A local run generated ten draft milestones totaling 60,000 cents with `openai/gpt-oss-20b`; this is historical local evidence, not a hosted result from the final candidate.
- PayPal Invoicing v2 REST calls use the Sandbox host. Durable operation claims and unknown-outcome handling protect invoice create/send operations.
- APIMatic’s PayPal Context Plugin informed development-time contract planning and testing. The inspected generated SDK map did not include Invoicing, so direct PayPal REST is used at runtime.
- AG Grid Community is used for analytics views; the milestone timeline is CSS-based.

## What has been verified

GitHub Actions [run #13](https://github.com/distinctikechukwu-stack/ProofPayAI/actions/runs/43056263683) passed 376 automated tests, TypeScript and webhook-test type checks, production build, Wrangler dry run, Linux Worker smoke, and isolated PostgreSQL validation. The CI database applied migrations 1–20, passed migration rollback/application checks and 116 pgTAP assertions, and verified two-session payment-state ordering plus final database integrity.

The owner confirms that the final candidate is deployed to both Render Staging services, all 20 Supabase Staging migrations are applied, and hosted login, dashboard, and existing projects work. Earlier owner-led Staging tests verified fictional client/freelancer project access, an accepted agreement, $40/$60 milestone approvals, private freelancer-profile save/reload, and authenticated profile/project reads. This does not establish that every marketplace route has been accepted on the final deployment.

## Known limitations

The historic invoice is **SENT, not PAID**. No Sandbox payment, successful signed webhook delivery, or authoritative payment reconciliation has been verified. The Cloudflare Staging webhook path currently reports an HTTP 400 failure; webhook-driven payment updates are not demonstrated. Do not present a payment as completed.

Hosted Groq inference and editing, saving, and reloading generated suggestions on the final candidate remain unverified. Use the hosted sample/scope page only if it is clearly labeled as sample; do not describe sample analysis as model output.

Render Free services can sleep, so continuous webhook processing and timely automatic reconciliation cannot be guaranteed.

## What we learned

Financial states need a trustworthy source and ordering, not just a visually convincing status. The isolated PostgreSQL checks exercise stale-snapshot rejection, refunds, rollback, and concurrent updates. A passing test suite is useful evidence, but it is not a substitute for a real hosted provider event—and the UI must say so.

## Tools used

- **Groq API:** Structured milestone and scope-analysis integration; historical local milestone generation used `openai/gpt-oss-20b`. Hosted generation on the final candidate is not verified.
- **PayPal Developer Platform:** Sandbox Invoicing v2 REST integration. One historical fictional invoice is recorded SENT; no payment is verified.
- **Supabase:** Auth, Postgres, row-level security, and migrations; the owner confirms 20 Staging migrations are applied.
- **Render:** Hosts the Staging API and static frontend.
- **APIMatic Context Plugin:** Used during development for contract planning/testing; no generated Invoicing SDK operation is used at runtime.
- **AG Grid Community:** Analytics interface.

Tool selection does not claim eligibility for a sponsor prize or endorsement.

## Demo plan

Use the sanitized [three-minute demo script](DEMO_SCRIPT.md) with existing fictional accounts and records only. The script shows the existing marketplace/project screens, the accepted agreement and milestone history, a prior local Groq result labeled as local evidence, and the invoice as SENT if its read-only record is available. It does not create records, make provider requests, resend an invoice, or claim payment reconciliation.

---

**Before submission:** confirm entrant eligibility, publish the owner-confirmed MIT license and reviewed source/docs, verify GitHub shows the license, record and upload the public YouTube demo, and enter the actual links in the Devpost form before the published deadline.
