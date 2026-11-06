# ProofPay AI Development History

**Reconstructed through:** 2026-11-06  
**Current release checkout:** codex/proofpay-staging-release at 84f588fbe918b718649e888665a387577db62d43.

This timeline separates repository evidence, dated tracker reports, previous Codex context, and external state that is no longer freshly verified.

## Project evolution

### Initial product and source specifications

The project began as a PayPal AI Hackathon build for a freelancer agreement, project, scope intelligence, and PayPal Invoicing product. The original demo is the $600 website engagement with three milestones, a client scope-change request, exact agreement citations, human-reviewed amendment, invoice create/send confirmations, and provider-confirmed payment state.

A later user-provided addendum expanded the product into a marketplace: dual-purpose client/freelancer accounts, profiles and portfolio, jobs, proposals, offers, hiring, services, messaging, notifications, hourly work, moderation, and account lifecycle. The addendum itself ends mid-PayPal bullet; no missing tail has been reconstructed. The original requirements remain authoritative where the addendum is incomplete.

The repository instructions establish React/TypeScript/Vite/Tailwind, Node/Fastify, Supabase, Zod, integer minor units, server-only secrets, immutable accepted versions, sandbox-only PayPal, RLS, and honest distinction between preview data and persisted/provider data.

### October 29–30, 2026: foundations and major product implementation

The repository snapshot was committed on 2026-10-30 as 9bc8a45 (Initial ProofPay AI build snapshot). The project has since grown beyond the original phases into marketplace phases 8–12.

The Oct 30 history records commercial hardening and Phase 12 review artifacts. Code includes authenticated project workflows, profile and marketplace models, AI boundaries, PayPal REST invoicing, hourly work, messaging, analytics, moderation, account-deletion requests, operations docs, and demo/submission drafts. A dated independent review snapshot calls out live PostgreSQL and provider limitations; it is historical and should be reconciled with later tracker entries.

The PayPal/APIMatic decision was contract-first: the APIMatic Context Plugin was installed and its TypeScript integration/error/testing guidance was used; the generated SDK map was inspected and has no Invoicing operation. Direct REST to PayPal Invoicing API v2 is the documented implementation. No unrelated Orders SDK operation is used for invoice creation.

### October 31–November 2: staged integration checks

The canonical tracker records Staging checks with fictional accounts and reserved .invalid email addresses. Recorded observations include profile save/privacy, marketplace offer creation/idempotency/authorization, participant messaging, hourly time-entry dispute/resubmission/approval, and unrelated-user denial for selected workflows. These observations cover specific fixtures and do not replace a full RLS suite.

On Nov 2, the tracker records a real Groq milestone-generation call and one evidence-cited scope analysis whose output passed Zod/citation checks and whose audit was persisted. OpenAI was not exercised.

The same date's PayPal record documents a Sandbox OAuth success with accepted Invoicing access, one USD 600 invoice created once and reconciled as DRAFT, one provider detail read confirming amount/recipient/line item, and a later one-time send. The latest recorded local and provider state is SENT. No payment was performed. The invoice must not be recreated or resent.

Migration 18, 202611020004_paypal_webhook_durable_processing.sql, added durable verified-event processing, leases, retries/dead-letter handling, event deduplication, provider-state reconciliation, and protection against regressing a confirmed paid invoice. The tracker records Staging application/catalog verification for migration 18. It does not record a real signed webhook delivery, Sandbox payment, or webhook-driven payment reconciliation.

### November 3–4: release and Render preparation/deployment

On Nov 3, release-preparation commits configured a Free Render Blueprint, frontend API URL wiring, and webhook configuration. The first read-only Render listing documented no ProofPay staging services, and a Blueprint validation listed the expected API/static-web services without syncing or deploying them.

Later dated Nov 4 operations entries supersede part of that earlier hosting snapshot: a static frontend deployment completed Live at commit 1c9f356, and the page plus /app preview route were observed. The API service was recorded Live on the Free plan at earlier commit 8d8b82e. This was a partial deployment, not proof of a healthy connected workflow.

A subsequent Nov 4 check could not verify API health/CORS because Render dashboard/DNS access failed. The visible API environment-variable names did not include APP_ORIGIN. The code's fallback is localhost, so browser CORS would not accept the deployed frontend if that setting remained absent. Static Supabase build-time variables were not confirmed. Current hosted health/authentication is unknown.

The Free API hosts the webhook worker in the same process and polls once per second. The service may sleep after inactivity; the worker cannot guarantee continuous queue draining. Operations notes require a reviewed polling/availability mitigation or an approved always-on plan before registering a real webhook.

### November 5: fixed-price project completion and isolated PostgreSQL validation

Migration 19, 202611050001_project_completion_workflow.sql, introduced guarded fixed-price completion. It checks the current accepted agreement, both role acceptances, milestone approval and totals/currency, and unresolved scope/amendment state. It serializes completion-related operations, records completion activity, does not rewrite invoice/payment state, and prevents implicit reopening.

The migration was prepared locally after the last recorded Staging baseline of 18. A fresh linked migration-history query failed during database login/bootstrap on Nov 5. Thus migration 19 being the sole pending remote migration was not freshly confirmed. The tracker says not to apply it until isolated PostgreSQL validation and a clean read-only preflight succeed.

A manually dispatched GitHub workflow was added for ephemeral local Supabase/PostgreSQL validation. It applies repository migrations to a disposable local stack, tests rollback, loads synthetic fixtures, runs pgTAP, and exercises concurrent approval. It is not a remote database workflow and has no deployment or provider-write step.

### November 6: migration 19 validation failures and diagnostics

Three GitHub Actions manual runs are recorded for the PostgreSQL validation workflow:

| Run | Commit | Result | Verified failure detail |
| --- | --- | --- | --- |
| #1, 42202654385 | 86c89fe9560ebf1d4e7438ed0d863203c7c13982 | Failure | Stopped at transaction_rollback_probe with generic diagnostics; migration 19 was not reached. |
| #2, 42212829007 | c9b5177eb2190c2077347de1904eb9b145f441f3 | Failure | Run is failed; it used the same diagnostic commit as run #3. |
| #3, 42221327531 | c9b5177eb2190c2077347de1904eb9b145f441f3 | Failure | Rollback passed; all 19 migrations applied in the isolated stack; post-migration fixture failed before pgTAP with psql exit 3 and unclassified_database_error. |

The latest log does not preserve the failing statement, SQLSTATE, constraint, trigger, or fixture step. Therefore the failure's root cause is still not identified and cannot yet be attributed to migration 19 rather than the fixture.

Commit c9b5177 improved rollback diagnostics. Commit 84f588f then added verbose psql output mode, safe fixture-step markers, and allowlisted extraction of SQLSTATE, category, constraint name, trigger function, and fixture step. This instrumentation has not yet been exercised by a new Actions run. The current 84f588f commit status query returned pending with zero status contexts; no newer workflow run appears on the branch.

The local progress note records focused project-completion suites passing 29/29 after diagnostics. The latest full npm test attempt then hit the existing five-second timeout for the signed-out messaging privacy web test (21/22 web). A serialized rerun remained required. The immediately preceding full pass was 244/244. No Docker engine/CLI or psql is available in the current Windows environment, so local PostgreSQL reproduction was unavailable.

## Migration chronology

There are 19 SQL migration files in timestamp order:

| # | File | Purpose recorded by source and tracker |
| --- | --- | --- |
| 1 | 202610290001_core_project_security.sql | Core profiles, projects, members, agreement versions/acceptances, milestones, evidence/reviews, scope/amendments, invoices, webhook rows, audit/AI records, RPCs, RLS, and storage rules. |
| 2 | 202610290002_paypal_invoice_workflow.sql | PayPal invoice status fields, create/send claim schema, constraints, and service-role workflow RPCs. |
| 3 | 202610300001_marketplace_profiles.sql | Roles, freelancer/client profiles, portfolio, and restricted public profile projection. |
| 4 | 202610300002_marketplace_jobs.sql | Jobs, favorites/reports, proposals/events, offers, services/requests, and marketplace RPCs/views. |
| 5 | 202610300003_messaging_notifications.sql | Conversations/messages/read receipts/notifications, blocks/reports, attachment policies, and Realtime publication. |
| 6 | 202610300004_hourly_workflows.sql | Hourly contracts, timers, entries/reviews/events, invoice batches, and associated policies/RPCs. |
| 7 | 202610300005_commercial_hardening.sql | Moderation actions, listing/report workflows, and account-deletion requests. |
| 8 | 202610310001_view_access_hardening.sql | View access hardening. |
| 9 | 202610310002_hourly_review_view_privilege.sql | Hourly review view privilege correction. |
| 10 | 202610310003_workflow_sql_corrections.sql | Corrections to profile save, notifications, project reads, and workflow RPCs. |
| 11 | 202610310004_hourly_acceptance_trigger_privileges.sql | Hourly acceptance trigger privilege correction. |
| 12 | 202611010001_hourly_entry_request_hash_qualification.sql | Qualifies hourly idempotency/request-hash behavior. |
| 13 | 202611010002_marketplace_offer_idempotency_hash_qualification.sql | Corrects marketplace offer replay hash qualification. |
| 14 | 202611010003_scope_analysis_provider_compatibility.sql | Allows the intended AI provider compatibility in scope audit storage. |
| 15 | 202611020001_scope_analysis_actor_membership.sql | Ties scope-analysis audit writes to authenticated actor/project membership. |
| 16 | 202611020002_paypal_client_billing_email.sql | Uses project-client billing preference with Auth-email fallback for invoices. |
| 17 | 202611020003_paypal_claim_invoice_number_scope.sql | Corrects invoice claim number uniqueness/scope. |
| 18 | 202611020004_paypal_webhook_durable_processing.sql | Durable verified webhook queue, worker leasing/retries, dedupe, and paid-state guard. |
| 19 | 202611050001_project_completion_workflow.sql | Guarded fixed-price project completion and serialized workflow wrappers. |

The recorded remote Staging migration state was 18 at the last successful verification. A fresh migration list failed on Nov 5, so current remote history is unknown. Do not apply or replay migrations during a documentation/handover task.

## Significant release-branch commits

| Commit | Date | Message |
| --- | --- | --- |
| 9bc8a45 | 2026-10-30 | Initial ProofPay AI build snapshot |
| dd00447 | 2026-10-30 | Update Phase 12 moderation hardening |
| e032391 | 2026-10-30 | Record final Phase 12 verification |
| 7b96465 | 2026-10-30 | Refresh Phase 12 technical review artifacts |
| 10bb23b | 2026-11-03 | Prepare ProofPay AI hackathon staging release |
| a28fe46 | 2026-11-03 | Fix initial Render staging webhook configuration |
| 5a6e2f4 | 2026-11-03 | Configure free Render hosting for ProofPay AI staging |
| 8d8b82e | 2026-11-03 | Fix Render production build dependency installation |
| 29f3a9b | 2026-11-04 | Configure automatic API URL for free Render staging |
| 1c9f356 | 2026-11-04 | Fix Linux Tailwind dependency for Render static build |
| e3dce9b | 2026-11-04 | Fix freelancer profile save payload validation |
| 85897a9 | 2026-11-05 | Fix milestone evidence and revision feedback |
| 86c89fe | 2026-11-06 | Add guarded project completion and PostgreSQL validation |
| c9b5177 | 2026-11-06 | Improve rollback validation diagnostics |
| 84f588f | 2026-11-06 | Add safe PostgreSQL fixture diagnostics |

Other worktrees exist for marketplace, security QA, and webhook readiness and are listed in PROJECT_MEMORY.md. Their changes must not be assumed to be merged into the release branch.

## Prior Codex context and important caution

Accessible prior Codex records include the original ProofPay build thread, a separate marketplace worktree, a webhook-readiness worktree, a security/demo-preparation worktree, and a recent migration 19 debugging thread. The latest migration thread corroborates the run #3 failure and current local diagnostic preparation. Older threads contain conflicting or superseded hosting statements; the dated operations record distinguishes the Nov 3 Blueprint-only state from the Nov 4 partial deployment.

The user explicitly reaffirmed that PayPal and AI remain central requirements. Missing credentials or service access do not authorize removing those integrations. Do not represent plugin guidance as generated SDK invoice usage. Do not treat a manually triggered local Docker workflow as a remote migration.
