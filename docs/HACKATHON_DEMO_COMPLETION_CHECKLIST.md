# ProofPay AI hackathon demo completion checklist

**Updated:** 2026-11-03

**Purpose:** Finish and verify the original PayPal AI Hackathon story before resuming marketplace expansion.
**Scope rule:** Freeze new Upwork-like feature work. Preserve the existing marketplace and all 18 staging migrations. Fix only defects or UI problems that block the demo or weaken security.

## Verified starting point

- [x] ProofPayAI Staging has all 18 migrations recorded; do not edit or reapply them.
- [x] Fictional client and freelancer staging workflows have exercised fixed-price agreement acceptance, milestone start/submission/approval, and marketplace authorization checks.
- [x] One real Groq milestone-generation request returned structured output that passed the existing validation.
- [x] One real Groq scope analysis passed schema and evidence-citation validation, persisted an audit with provider `groq`, and remained a human-review result.
- [x] One PayPal Sandbox OAuth check succeeded with the required Invoicing scope.
- [x] One fictional USD 600 milestone invoice was created once, verified as DRAFT, and sent once. The recorded provider and local invoice state is SENT.
- [x] Local workspace checks recorded in the progress tracker pass: 275 tests, typecheck, and production build. The build still reports the known AG Grid chunk warning.
- [ ] No payment has been made and no webhook has been received or verified. The existing invoice is already SENT; it must not be recreated or resent.
- [ ] The configured webhook ID is a template placeholder. There is no configured or verified public HTTPS callback.
- [ ] The exact primary story—persisted Groq scope analysis, a dual-approved change order, an eligible milestone, and the related invoice—has not been demonstrated as one continuous authenticated UI workflow. Existing staging records should be inspected before any write; do not alter the already-sent invoice's agreement or milestone.

## Phase A — PayPal webhook security and payment reconciliation

- [x] `POST /api/webhooks/paypal` captures the original request JSON and transmission headers, verifies the signature with the configured Sandbox webhook ID, and enqueues only allowlisted event types after verification.
- [x] API returns HTTP 202 only after the verified event insert/deduplication RPC confirms durable storage. Signature failures and queue errors/timeouts are not acknowledged as accepted.
- [x] Migration `202611020004_paypal_webhook_durable_processing.sql` is applied as migration 18 on ProofPayAI Staging. The post-check verified the queue fields, bounded retry constraint, event-ID unique index, retry index, RLS, role grants, worker function definitions, and paid-state regression trigger. Existing invoice and operation-claim counts and states were preserved.
- [x] API worker claims one event with a 45-second lease, calls PayPal's current invoice GET, and completes the local update transactionally. A lease token fences off a previous worker after restart/reclaim. The migration's event ID uniqueness and the RPC's payload match check deduplicate re-delivery.
- [x] Transient read/database failures are retained with exponential backoff (5 seconds to one hour), up to eight attempts. Permanent failures and exhausted/crashed jobs remain as dead letters for explicit operator review and service-role-only requeue; no invoice write is automatically repeated.
- [x] Invoice status is derived from the provider's current invoice response, not the event body. A database trigger prevents a confirmed `paid` invoice from reverting to draft/sent/pending/unknown; it permits provider refund states. Reconciliation matches by PayPal invoice ID and does not modify milestone approval or agreement state, for either milestone or hourly-batch invoice sources.
- [x] Local mocked/static regression coverage includes valid/invalid signatures, original signed JSON preservation, duplicate redelivery, unsupported event types, provider/enqueue timeouts, queue failure, worker retry/dead-letter, completion failure recovery, concurrent in-process passes, restart/lease recovery, authoritative paid status against a stale event body, paid-state regression guard, service-role ACL, and both invoice source types using the same lookup.
- [ ] Exercise actual queue lease acquisition, expired-lease recovery, retry/dead-letter transitions, duplicate event handling, invoice row locking, and paid-state regression with mocked or separately approved Sandbox webhook operations. No queue event currently exists in Staging, so this behavior is verified by code and regression tests, not a live event.
- [ ] Provision a public HTTPS **staging** API host and confirm `POST /api/webhooks/paypal` is reachable on port 443. Render remains configuration only; deployment needs separate approval.
- [ ] Register the endpoint on the same PayPal Sandbox REST app used by invoice credentials, subscribing to exactly the seven documented Invoicing events: `CREATED`, `SENT`, `PAID`, `CANCELLED`, `REFUNDED`, `UPDATED`, and `SCHEDULED`. Webhook registration needs separate approval.
- [ ] Store the returned webhook ID only in server-side `PAYPAL_WEBHOOK_ID`, restart the API, and confirm the public status route reports readiness as booleans.
- [ ] Verify PayPal's postback signature endpoint's live transmission-freshness behavior. The app validates timestamp syntax and does not apply a local five-minute cutoff, avoiding rejection of legitimate redeliveries; exact event-ID deduplication and provider-authoritative GET protect reconciliation. The live postback freshness semantics remain unverified.
- [ ] Before a payment test, recheck the existing invoice is still SENT, still linked to the approved fictional milestone and recipient, and no payment/reconciliation result has already been recorded.
- [ ] After separate payment authorization, use only the fictional PayPal Sandbox buyer. Verify PayPal's authoritative invoice status, verified event persistence, local invoice status/`paid_at`, and persisted dashboard paid totals after refresh. Never use a UI action or client request to mark an invoice paid.
- [ ] Exercise duplicate delivery and delayed/out-of-order reconciliation without issuing another invoice operation. Confirm duplicate event IDs do not reapply state and that the newest provider observation wins.
- [ ] Confirm both milestone and hourly-batch invoice sources use the shared reconciliation path. The fixed-price demo is primary; do not expand hourly features unless a regression blocks the demo.

## Phase B — APIMatic and AI verification

- [x] APIMatic Context Plugin installation and use are documented. Its TypeScript workflow informed the contract-first PayPal implementation.
- [x] The inspected APIMatic-generated TypeScript SDK map has no Invoicing resource. The app correctly uses direct PayPal Invoicing API v2 REST; do not call unrelated SDK operations or claim that generated SDK invoice calls are used.
- [x] Groq milestone generation and scope analysis have real-provider evidence; scope output passed Zod and citation validation and its audit records provider `groq`.
- [ ] Refresh APIMatic and setup evidence to reflect the real OAuth, invoice-create, and invoice-send checks and the remaining webhook/payment blockers. Check the hackathon's sponsor-evidence criteria before claiming the Context Plugin use satisfies an “integration” requirement.
- [ ] Demonstrate the existing Groq result and human-review boundary in the authenticated UI. Reuse persisted analysis where possible; any new inference request needs its own authorization.
- [ ] No additional AI feature or provider is required for the primary story. Keep OpenAI as the configured alternative; its live-provider behavior remains unverified and must not be presented as tested.

## Phase C — Fictional client-to-freelancer demo workflow

- [x] Existing staging accounts, project membership, accepted agreement, fixed-price milestone approval, persisted Groq analysis, and sent invoice have recorded API/database evidence.
- [ ] Choose a safe fictional staging project for the continuous demo. Do not attach a new amendment to the project/milestone already invoiced unless read-only inspection proves that is correct and the owner separately approves the required writes.
- [ ] If the selected project lacks the needed change-order state, request approval before creating any fictional scope request, proposal, amendment, acceptance, or milestone record. Preserve dual approval and exact-money validation.
- [ ] Walk the existing responsive UI as the client and freelancer: agreement/milestones, persisted scope request and cited AI analysis, human review and dual approval, approved milestone, invoice link, and provider payment state. Confirm refresh reads persisted state rather than preview data.
- [ ] Verify that the milestone workflow state remains distinct from invoice/payment state and that analytics totals change only from provider-verified invoice status.
- [ ] Complete the previously outstanding unrelated-user read test for the specific Groq scope-analysis audit and repeat essential cross-account checks after demo records are present. Do not weaken RLS to make a test pass.

## Phase D — Demo-blocking quality and security only

- [x] Latest recorded local verification: `npm test` (275 passing), `npm run typecheck`, and `npm run build` pass.
- [x] Added focused mocked/static coverage for signature rejection, durable acceptance, duplicate delivery, bounded timeout/retry, restart/lease recovery, provider-authoritative reconciliation, out-of-order status protection, and milestone/hourly invoice lookup.
- [ ] Verify the persisted payment summary and paid totals in the connected demo UI after an authorized provider-confirmed payment.
- [ ] Test the connected demo UI at desktop and narrow mobile widths, with keyboard access and readable loading/error/success states. Prior preview smoke checks do not prove the authenticated payment flow.
- [ ] Fix only defects that block the core demo, compromise authorization, or misstate payment/AI results. Do not add marketplace features or redesign unrelated pages.

## Phase E — Production-like staging hosting

- [ ] Create a dedicated ProofPay AI Staging project and services only after separate approval. The owner confirmed that Render has no ProofPay AI Blueprint instance or service. The existing `My project` Production environment contains `Shipment-Tracker`; do not modify it.
- [x] Prepare the local `render.yaml`: it defines `proofpay-staging-api` and `proofpay-staging-web` under ProofPay AI / Staging, targets `codex/proofpay-staging-release`, disables automatic deploys and previews, declares Groq/OpenAI and server-only Supabase/PayPal variables, and aligns Node.js to 26.13.0. The Blueprint validator passes; these local settings do not prove that remote services exist.
- [x] Configure the local API service on Render's paid 0.5 CPU / 512 MB plan so the API and durable webhook worker run together without free-service suspension. Migration 18 supplies the durable queue across restarts. If the Sandbox webhook ID or required server configuration is absent, the worker is not started and the endpoint does not accept events. Creating the paid service still requires separate approval.
- [ ] Publish only a reviewed source revision that includes the current webhook route, worker, and migration-18-compatible API. The release is prepared on the local `codex/proofpay-staging-release` branch and is not yet published to GitHub. Obtain separate approval before pushing it.
- [ ] Verify the remote API service has Staging Supabase values, server-only Groq/PayPal Sandbox credentials, and a real Sandbox webhook ID; the inspected local webhook ID is still a placeholder. The static web build may receive only the public Supabase URL/key and API URL. Remote Render environment settings remain unverified.
- [ ] Review CORS/origins, health checks, log redaction, restart/rollback steps, and a minimal monitoring/alert path. Confirm a Staging backup/recovery approach for demo data.
- [ ] Obtain separate deployment approval before changing/syncing hosted services. Do not configure Production or use PayPal Live.
- [ ] After deployment approval, verify both app/API origins and HTTPS webhook callback externally, then repeat only approved Staging smoke tests.

**Preflight outcome (2026-11-03):** local `npm run typecheck`, `npm test` (275 passing), and `npm run build` passed. The build retains the 719.63 kB minified AG Grid chunk warning. The local Supabase URL hostname matched `staging-project-reference-redacted.supabase.co`; presence-only checks found the expected local server/client, Groq, and PayPal Sandbox configuration without exposing values. `.env` and `.proofpay-local` are Git-ignored and untracked. This does not verify remote Render configuration. No Render service was created, changed, synced, or deployed; no GitHub push, webhook registration, payment, or external provider call occurred. **Deployment is blocked pending an authenticated target/source/plan review and separate approval for any publishing, service, or cost change.**

## Phase F — Submission materials and final evidence

- [ ] Reconcile stale claims in `README.md`, `paypal-plan.md`, `docs/APIMATIC_INTEGRATION.md`, `docs/OPERATIONS.md`, `docs/SUBMISSION_CHECKLIST.md`, `docs/DEVPOST_DRAFT.md`, `docs/DEMO_SCRIPT.md`, and the Supabase setup guides. Several still describe seven migrations or say there were no live AI/PayPal operations.
- [ ] Write a demo script that matches the verified authenticated UI and clearly distinguishes Groq output, persisted audit evidence, PayPal Sandbox records, and the final verified payment state.
- [ ] Record a concise screen demo using fictional accounts only; exclude credentials, tokens, private buyer data, and unrelated marketplace surfaces.
- [ ] Update the Devpost draft with verified results, the innovation (evidence-backed scope decisions plus provider-verified invoicing), accurate APIMatic evidence, and remaining limitations.
- [ ] Run the final typecheck, full suite, build, responsive/security review, and repository secret scan; record exact results in `docs/IMPLEMENTATION_PROGRESS.md`.
- [ ] Submit or publish only after a separate explicit approval.

## Separate approval gates

1. Staging hosting/deployment.
2. PayPal Sandbox webhook registration and server-only webhook-ID configuration.
3. Any staging database writes needed to establish a continuous dual-approved change-order demo.
4. One controlled Sandbox payment against the existing SENT fictional invoice, followed by read-only reconciliation and authorized duplicate-delivery checks.
5. Any new Groq inference request or other external provider operation not already covered by a one-time authorization.
6. Hackathon submission/publication.

No gate above is authorized by this checklist. No production database, PayPal Live environment, real customer, or real-money payment is in scope.
