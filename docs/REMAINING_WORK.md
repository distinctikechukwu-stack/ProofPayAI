# ProofPay AI Remaining Work

**Snapshot date:** 2026-11-06  
**Current release HEAD:** 84f588fbe918b718649e888665a387577db62d43  
**Purpose:** A prioritized checklist for getting the existing project to a trustworthy hackathon-ready state. This is a work plan, not a claim that listed checks were run.

## P0 — Critical blockers

### 1. Resolve the migration 19 PostgreSQL fixture failure

- [ ] Review the current dirty working tree before changing anything. It contains pre-existing edits in the tracker, two scope-analysis test files, and Supabase migration notes.
- [ ] Run the existing manual PostgreSQL workflow against current release HEAD 84f588f only after the owner authorizes the workflow dispatch.
- [ ] Confirm the workflow uses only its ephemeral local Supabase/PostgreSQL stack; do not point it at Staging or Production.
- [ ] Use the sanitized fixture diagnostic to capture the fixture step, SQLSTATE, failure category, safe constraint name, and safe trigger function name.
- [ ] Identify the exact failing statement from the isolated runner's controlled log/fixture context. Determine whether the root cause is fixture/schema incompatibility or migration behavior.
- [ ] Correct the smallest root cause. Do not weaken assertions, remove migration behavior, alter payment protections, or rewrite migration history to make the workflow green.
- [ ] Run all project-completion pgTAP cases, the two-session concurrency check, and final-state checks. Prove that invoice/payment state remains unchanged and rollback leaves the pre-migration state intact.
- [ ] Run focused static/contract tests after the correction. Then run the full workspace test suite serially if the known 5-second web test timeout recurs.
- [ ] Update docs/IMPLEMENTATION_PROGRESS.md with exact commands/results and current failure/root cause.

**Acceptance criteria:** The migration applies in a disposable PostgreSQL environment; pgTAP, rollback, and concurrency checks all pass; no assertion is weakened; the diagnostics expose only allowlisted metadata; the exact former failure is explained; no remote database or provider was contacted.

**Current evidence:** Latest Actions run #3 (42221327531) passed rollback and applied all 19 migrations locally, then failed on the post-migration fixture before pgTAP with psql exit 3 and no SQLSTATE/fixture step. Commit 84f588f added diagnostics, but no new workflow run exists yet. The exact failure remains unresolved.

### 2. Confirm Staging migration history without changing it

- [ ] Use the approved read-only Staging target and verify project identity plus migration history.
- [ ] Resolve the Nov 5 failed migration-list/bootstrap check. Do not assume migration 19 is the only pending migration.
- [ ] Compare the live migration catalog/schema with the successful isolated PostgreSQL result.
- [ ] Stop if the target is not the intended non-production Staging project, if any migration differs from expectation, or if the remote list is incomplete.
- [ ] Apply migration 19 only after separate explicit owner approval and a clean preflight. Never run this as part of documentation, diagnosis, or a test fallback.
- [ ] Verify completion/authorization behavior with controlled client/freelancer accounts and confirm invoice/payment records did not change.

**Acceptance criteria:** Current remote history is known from a successful read-only check; any later migration is separately approved, correctly targeted, and post-verified. No Production database is modified.

### 3. Fix the hosted browser/API connection and verify current deployment

- [ ] Re-establish read-only access to the Render service dashboard and public health/status endpoints.
- [ ] Confirm which services currently exist, deployed commits, plans, runtime health, and exact static/API URLs.
- [ ] Check APP_ORIGIN by variable name/presence only. The last Nov 4 environment-variable listing omitted it; do not expose secret values.
- [ ] Set the API CORS origin to the exact static HTTPS origin only after explicit deployment/configuration approval, then redeploy only the affected service if approved.
- [ ] Verify CORS preflight and one normal authenticated browser API request; verify Auth redirects and public Supabase configuration.
- [ ] Update stale README, Supabase setup, operations, Devpost, and APIMatic wording using dated evidence.

**Acceptance criteria:** Landing page, Auth, and authenticated API work together at the current deployed commits; health and CORS are observed; browser-visible values contain no server secret; the tracker records the exact deployment and smoke-test evidence.

### 4. Keep webhook/payment claims accurate and complete the provider lifecycle

- [ ] Preserve the existing SENT fictional invoice. Do not recreate or resend it.
- [ ] First confirm the current Sandbox invoice state using an approved read-only reconciliation path; do not infer that it is paid.
- [ ] Resolve webhook-worker availability before registration. Free Render can sleep and the in-process worker polls once per second.
- [ ] Decide, with owner approval, whether to mitigate polling/backoff/wakeup behavior or move to an approved always-on API plan.
- [ ] Only after a reachable HTTPS endpoint and worker design are ready, obtain separate approval to register a PayPal Sandbox webhook and configure the real webhook ID server-side.
- [ ] With separate approval for any provider write/payment, test signature verification, durable enqueue, duplicate event, out-of-order event, authoritative invoice read, and persisted payment update. Use only Sandbox.
- [ ] Confirm only provider PAID counts as paid revenue. Partial, pending, externally marked, refund, unknown, or unverified event payloads must not be presented as paid.

**Acceptance criteria:** A real Sandbox event passes PayPal signature verification, is committed once, reconciled from a fresh invoice read, and updates only the intended invoice state. Event dedupe/retry/dead-letter behavior and logs are verified without exposing payloads or credentials. No escrow or live-money claim is made.

## P1 — Core product functionality and integration gaps

### Agreements, milestones, scope, and client/freelancer workflow

- [ ] Run a complete two-account workflow from project draft through agreement creation, separate party acceptance, milestone start, evidence submission, revision or approval, and reload-persistent state.
- [ ] Verify all project-level reads and child reads against member and unrelated users at both API and RLS layers.
- [ ] Validate AI milestone suggestions against project budget using exact minor units; verify edits before agreement sharing.
- [ ] Run scope analysis from saved request through evidence/citations, uncertainty, client/freelancer review, draft change order, both approvals, and represented milestone allocation.
- [ ] Add a safe user-facing resolution for analyzed/no-change scope requests if completion should be allowed; do not clear or rewrite a Staging record manually.
- [ ] Keep accepted agreement/amendment versions immutable and verify actor, timestamp, and audit history.

**Acceptance criteria:** Each party sees only authorized project data; citations match stored text; AI cannot change scope or money by itself; both approvals persist; approved added scope has a billable milestone representation before invoice eligibility.

### Marketplace completeness

- [ ] Verify job draft/publish/edit/close/reopen/archive, filters, favorite, suspicious-listing report, proposal uniqueness, offer acceptance, and draft project conversion.
- [ ] Verify profile/service public projections never reveal private contact or account fields.
- [ ] Decide whether the hackathon scope includes missing ratings/reviews, verified work history, AI job matching, AI proposal drafting, interview invitations, general business assistant, and non-project direct messages. Implement only against the actual addendum/source and preserve the incomplete-tail warning.
- [ ] Check changes on feature/marketplace-expansion against the current release branch before integration. Do not reset, merge, or overwrite another linked worktree.

### Hourly work

- [ ] Verify manual entry and timer start/pause/stop transitions with client/freelancer/unrelated accounts.
- [ ] Verify submit/dispute/edit/resubmit/approve history and idempotent retries.
- [ ] Verify batch creation derives the complete approved-entry set, rate, currency, and exact minor-unit amount server-side.
- [ ] Exercise hourly invoice unknown-outcome reconciliation and verified webhook state without merging hourly review state with provider state.

### Profile/account and moderation gaps

- [ ] Define retention/deactivation/deletion policy before adding any erasure behavior.
- [ ] Complete administrator assignment safeguards, report isolation, listing holds, moderation audit, and operator actions with live role/RLS tests.
- [ ] Add reviews/reputation and verified work history only after defining which completed contracts qualify and how users can dispute ratings.
- [ ] Configure secure attachment preview/download only after Storage authorization, MIME/size limits, malware scanning, and expiry behavior are tested.

## P1 — Testing and security

- [ ] Re-run full npm test after the migration diagnostic correction; the last current-tree full attempt timed out a signed-out messaging test at 21/22 web tests.
- [ ] Run workspace typecheck and production build against the final committed tree. Prior successful runs predate current diagnostic edits and are not fresh evidence.
- [ ] Keep mock provider tests distinct from real Sandbox tests. Fakes do not verify OAuth grants, RLS, transactions, signature delivery, or provider state.
- [ ] Expand isolated PostgreSQL coverage for all critical RLS, RPC grants/search paths, triggers, Storage policies, Realtime publication, and transaction/rollback invariants.
- [ ] Run end-to-end authorization tests for client, freelancer, admin, unrelated user, anonymous user, and service-role-only functions.
- [ ] Add accessibility, keyboard, contrast, narrow viewport, and upload validation review. There is no configured lint command or automated accessibility runner today.
- [ ] Review dependencies, log redaction, CORS, request limits/rate limits, browser secret exposure, and backups/restore. Complete a separate restore drill before production use.
- [ ] Set up monitoring, alert ownership, incident routing, and webhook dead-letter recovery before inviting real users.

**Acceptance criteria:** All reported tests have exact command, count, and result; no failing test is suppressed; database/provider checks use isolated or approved Sandbox targets; secrets remain server-only.

## P1 — Deployment readiness

- [ ] Confirm the currently live Render API/static-web service state and deployed commit; the last known evidence is partial and dated Nov 4.
- [ ] Configure exact APP_ORIGIN and static VITE_API_URL/public Supabase build values; inspect names and booleans only, never print values.
- [ ] Confirm the production start/build commands, health path, Auth redirect URL, CORS, and request logging.
- [ ] Decide whether Free hosting is acceptable for a demo. It has cold starts and cannot promise continuous webhook processing; account bandwidth/build overages may still affect cost.
- [ ] Verify restart behavior, webhook worker recovery, queue lease expiry, bounded retry, dead-letter operator requeue, and shutdown handling.
- [ ] Document the current Supabase backup point, retention, restore objective, and successful isolated restore evidence.
- [ ] Keep deployment automation off until its target and effect are reviewed. No deployment is implied by a valid Blueprint.

## P2 — Hackathon submission

- [ ] Reconcile root README, docs/OPERATIONS.md, supabase/README.md, docs/APIMATIC_INTEGRATION.md, docs/DEVPOST_DRAFT.md, demo script, and submission checklists against the dated tracker.
- [ ] State accurately that the demo invoice reached SENT but no payment/webhook was verified unless new evidence exists.
- [ ] Do not claim generated PayPal SDK invoicing; state that APIMatic Context Plugin guidance was used and direct REST was selected because the inspected SDK lacks Invoicing.
- [ ] Prepare an evidence matrix mapping each judging claim to an observed source/test/demo result.
- [ ] Record the final sub-three-minute walkthrough against the working build. Label sample content and do not show a false paid state.
- [ ] Complete Devpost title, description, sponsor/integration disclosures, repository link, and demo recording. No submission/recording is currently evidenced.
- [ ] Decide licensing only with owner/rights-holder approval. There is no root LICENSE file, and an earlier review treated licensing as unresolved.

## Safeguards for all remaining work

- Preserve existing functionality, worktrees, branches, and uncommitted edits.
- Never remove, disable, or replace required PayPal or AI functionality because credentials are absent.
- Never expose credential values, tokens, private billing data, or raw webhook payloads.
- Never change Staging or Production database state, apply remote migrations, send a PayPal invoice, make a payment, register a webhook, or deploy without the required explicit approval.
- Never retry an uncertain provider write until the prescribed read-only reconciliation resolves it.
- Never mark migration 19 as valid from static tests alone. Do not bypass a failing check or weaken assertions to claim success.
- Update docs/IMPLEMENTATION_PROGRESS.md with exact commands and observed results after each implementation phase and verification run.
- Distinguish current evidence, dated historical evidence, and unknown current external state.

## Recommended next task

Diagnose the existing migration 19 post-migration fixture failure using the already committed sanitized diagnostics in 84f588f.

### Acceptance criteria

1. A manually authorized run of the existing workflow on current HEAD emits the allowlisted fixture step and SQLSTATE/category, without raw SQL, row values, or credentials.
2. The exact failing statement and root cause are established in the isolated disposable PostgreSQL environment.
3. The smallest safe correction is made to fixture or migration according to evidence; no assertions or financial/security invariants are weakened.
4. The full pgTAP, rollback, and two-session concurrency checks pass, including unchanged invoice/payment state.
5. Focused tests pass, then full tests are rerun serially; typecheck and build pass on the final tree.
6. Tracker records exact results. No remote migration, provider operation, or deployment occurs as part of the diagnostic task.
