# ProofPay AI hackathon demo completion checklist

**Updated:** 2026-11-06

**Purpose:** Finish and verify the original PayPal AI Hackathon story before resuming marketplace expansion.
**Scope rule:** Freeze new Upwork-like feature work. Preserve the existing marketplace and all 18 staging migrations. Fix only defects or UI problems that block the demo or weaken security.

## Verified starting point

- [x] ProofPayAI Staging has all 18 migrations recorded; do not edit or reapply them.
- [x] Fictional client and freelancer staging workflows have exercised fixed-price agreement acceptance, milestone start/submission/approval, and marketplace authorization checks.
- [x] Local real Groq milestone generation (2026-11-02) used `openai/gpt-oss-20b` and returned ten structured milestones totaling exactly 60,000 minor units. Existing validation passed; generated milestones remained a draft for human review.
- [x] One real Groq scope analysis passed schema and evidence-citation validation, persisted an audit with provider `groq`, and remained a human-review result.
- [x] One PayPal Sandbox OAuth check succeeded with the required Invoicing scope.
- [x] One fictional USD 600 milestone invoice was created once, verified as DRAFT, and sent once. The recorded provider and local invoice state is SENT.
- [x] The combined local integration candidate passes 293 tests across shared, API, web, and contract suites, plus typecheck and production build. The build still reports the known AG Grid chunk warning. The candidate remains local and is not the currently deployed revision.
- [ ] No payment has been made and no PayPal webhook delivery/signature has been verified. The existing invoice is already SENT; it must not be recreated or resent. The Staging API has a public HTTPS base and its read-only health check passed, but that does not verify PayPal delivery.
- [ ] The current remote `PAYPAL_WEBHOOK_ID` value was not independently verified in the abbreviated environment-variable view. Do not claim it is configured or use a placeholder; keep webhook processing disabled until a real Sandbox ID and endpoint are separately authorized and verified.
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
- [x] A public HTTPS Staging API host is Live; on 2026-11-06, read-only `GET /health` returned HTTP 200. This does not establish PayPal callback registration or verified event delivery.
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
- [x] Groq milestone generation and scope analysis have real-provider evidence. The Nov 2 milestone result passed structured validation and allocated exactly 60,000 minor units; the previously recorded scope result passed Zod and evidence-citation validation and its audit records provider `groq`. These provider tests were not run on the current Render release.
- [x] The authenticated `POST /api/ai/milestones` route remains in the integration candidate. It validates the request and provider result, allocates exact minor-unit amounts, returns `draft_for_review`, and does not persist or approve the result. The project UI keeps suggestions editable and saves only through the separate draft-milestone action.
- [x] Read-only Render dashboard verification (2026-11-06) confirmed the current ProofPay AI / Staging API is Live on commit `85897a96b9376963ea864296ef7d0da0364d3e21`; API environment values are `AI_PROVIDER=groq` and `GROQ_MODEL=openai/gpt-oss-20b`. The `GROQ_API_KEY` variable is present and remained masked; its validity was not tested. The Live static site has `VITE_API_URL=https://proofpay-staging-api.onrender.com`; API `APP_ORIGIN` matches the static-site HTTPS origin. Read-only `/health` and `/api/status` returned HTTP 200, `integrations.ai` was true, and an authenticated-header CORS preflight from the frontend returned 204 with the expected origin, credentials, and Authorization allowance. These checks establish deployed configuration/readiness and connectivity, not a successful hosted Groq inference.
- [ ] **Release/config gate:** Publish and manually deploy the approved combined integration candidate to both Staging services; confirm each Live SHA matches the approved integration commit. The current Render deployment is still `85897a96…`. Reconfirm API `AI_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-20b`, and only that `GROQ_API_KEY` is present; never reveal or copy the key. Reconfirm web `VITE_API_URL`, API `APP_ORIGIN`, and Staging-only Supabase configuration.
- [ ] **Auth/CORS gate:** From the deployed frontend, sign in with an already authorized Staging test account and open a draft project owned by that user. Verify the browser sends the request to the intended API with a bearer token without recording or sharing the token. Check `OPTIONS` for the exact web origin and `POST /api/ai/milestones`; allow the `Authorization` and `Content-Type` headers. A separate no-bearer negative test should return HTTP 401 before provider generation.
- [ ] **One hosted Groq call (separate approval required):** In the project-detail UI, run exactly one generation with fictional data: project **Northstar Illustrator Portfolio**, client **Northstar Demo Studio**, a responsive illustrator portfolio with landing page, work gallery, three case-study templates, and contact page; mobile/tablet/desktop layouts, objective acceptance criteria, no supplied deadline; budget USD 600.00 (`budgetMinor: 60000`), currency USD. The request has no idempotency key: if it times out or its outcome is uncertain, do not retry blindly.
  - [ ] Confirm HTTP 200 and a result passing the existing Zod schema: 1–20 ordered milestones, valid fields, unique sequences, and dependencies only on earlier milestones.
  - [ ] Confirm positive integer-cent allocations sum exactly to 60,000, `totalMinor` is `"60000"`, currency is USD, and the response has `status: "draft_for_review"` / `needsHumanReview: true`.
  - [ ] Confirm the UI allows edits and generation alone shares no agreement, persists no milestones, and approves no work. Retain only sanitized status, model, milestone count, and total; omit prompt content, tokens, and secrets.
- [ ] **Separate Staging persistence approval:** Use a dedicated fictional project whose agreement remains a draft and whose authenticated user is the project creator. If none exists, stop and request approval before creating it. Generate suggestions, edit title, description, deliverable, acceptance criterion, and completion condition; if amounts change, keep the exact total at USD 600. Save through the authenticated draft-milestone route, refresh/reopen, and confirm all edits and cents amounts persist while the project/agreement remain unaccepted. Do not approve either party, create an invoice, or change payment state.
- [ ] Preserve the scope-analysis path in the combined release: use the existing authenticated route, validate output with the existing Zod schema, verify every citation against accepted project evidence, and require human review. Any new hosted inference, scope-request creation, audit write, or change-order action requires separate approval; do not repeat the prior real-provider test as part of the milestone check.
- [x] Updated `APIMATIC_INTEGRATION.md` and `DEVPOST_DRAFT.md` with the documented Context Plugin use, the direct Invoicing API v2 REST decision, and the historical OAuth/DRAFT/SENT evidence. They distinguish development-time APIMatic tool use from runtime SDK use, and invoice sending from unverified payment and webhook delivery. Sponsor eligibility is described without guaranteeing a prize or judging outcome.
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

- [x] Latest recorded combined-candidate verification: 293 tests passed, `npm run typecheck`, and `npm run build` passed; see `docs/IMPLEMENTATION_PROGRESS.md` for exact suite counts and the existing AG Grid chunk warning.
- [x] Added focused mocked/static coverage for signature rejection, durable acceptance, duplicate delivery, bounded timeout/retry, restart/lease recovery, provider-authoritative reconciliation, out-of-order status protection, and milestone/hourly invoice lookup.
- [ ] Verify the persisted payment summary and paid totals in the connected demo UI after an authorized provider-confirmed payment.
- [ ] Test the connected demo UI at desktop and narrow mobile widths, with keyboard access and readable loading/error/success states. Prior preview smoke checks do not prove the authenticated payment flow.
- [ ] Fix only defects that block the core demo, compromise authorization, or misstate payment/AI results. Do not add marketplace features or redesign unrelated pages.

## Phase E — Production-like staging hosting

- [x] Dedicated Render ProofPay AI / Staging project exists with `proofpay-staging-api` and `proofpay-staging-web`; both were observed Live in the Render dashboard on 2026-11-06. Their current deployment is commit `85897a96b9376963ea864296ef7d0da0364d3e21`, not the uncommitted combined integration candidate. The separate `Shipment-Tracker` Production service was not opened or changed.
- [x] The current API is on Render Free and the frontend is a static site. Local `render.yaml` keeps both services Free, targets `codex/proofpay-staging-release`, and uses manual deployment controls. Free hosting can sleep; the worker cannot guarantee continuously available webhook processing or timely reconciliation.
- [x] The combined integration candidate is prepared locally from `a1629ffa56000c333b719d2cf55ef8345cc2b25e` with the reviewed Codex 2 and Codex 3 changes; publication and deployment still require separate approval.
- [x] Current API `APP_ORIGIN` and frontend `VITE_API_URL` match the respective HTTPS service origins, verified read-only in Render. Only the Groq provider/model values and key-variable presence were inspected; other secret values were not revealed. The current API config status reports AI configured, which does not establish that Groq accepts a request.
- [ ] Before the hosted inference test, publish/deploy the approved integrated commit manually to the API and frontend and confirm both deployed SHAs. Independently verify webhook configuration before any webhook test; if a real Sandbox webhook ID is absent, keep processing disabled. Any webhook configuration change still requires separate authorization.
- [ ] Review CORS/origins, health checks, log redaction, restart/rollback steps, and a minimal monitoring/alert path. Confirm a Staging backup/recovery approach for demo data.
- [ ] Obtain separate deployment approval before changing/syncing hosted services. Do not configure Production or use PayPal Live.
- [ ] After deployment approval, verify both app/API origins and HTTPS webhook callback externally, then repeat only approved Staging smoke tests.

**Preflight outcome (2026-11-03):** local `npm run typecheck`, `npm test` (275 passing), and `npm run build` passed. The build retains the 719.63 kB minified AG Grid chunk warning. The local Supabase URL hostname matched `staging-project-reference-redacted.supabase.co`; presence-only checks found the expected local server/client, Groq, and PayPal Sandbox configuration without exposing values. `.env` and `.proofpay-local` are Git-ignored and untracked. This does not verify remote Render configuration. No Render service was created, changed, synced, or deployed; no GitHub push, webhook registration, payment, or external provider call occurred. **Deployment is blocked pending an authenticated target/source/plan review and separate approval for any publishing, service, or cost change.**

## Phase F — Submission materials and final evidence

- [ ] Reconcile remaining stale claims in `README.md`, `paypal-plan.md`, `docs/OPERATIONS.md`, `docs/SUBMISSION_CHECKLIST.md`, `docs/DEMO_SCRIPT.md`, and the Supabase setup guides. `APIMATIC_INTEGRATION.md` and `DEVPOST_DRAFT.md` were reviewed and updated on 2026-11-06; recheck their claims against the final deployed release before submission.
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
