# Hackathon and hosting readiness checklist

This checklist separates code that exists from integrations that have been exercised. Keep unchecked items open until there is recorded evidence.

## Repository and local setup

- [x] Native Windows Node/npm/Git toolchain recorded.
- [x] Root npm workspace, `.env.example`, and `.gitignore` present.
- [x] Local frontend and API start instructions documented; root `.env` handling is configured for Vite and the API dev script.
- [x] Typecheck, test, and build commands recorded in [`IMPLEMENTATION_PROGRESS.md`](IMPLEMENTATION_PROGRESS.md).
- [ ] Choose and add a repository license if public release requires one.
- [ ] Run a final secret scan on the complete repository and verify ignored local `.env` files remain untracked.

## Core product and integrations

- [x] Signed-out frontend clearly labels sample records and unconfigured services.
- [x] Project, agreement, milestone, scope, AI, invoice, analytics, and timeline code paths have unit/API/UI coverage.
- [x] PayPal create/send claim, unknown-outcome, state-mapping, and webhook API tests pass with fakes.
- [ ] Apply all seven Supabase migrations to a non-production project and test RLS, RPCs, transactions, storage, realtime, moderation, and refresh persistence.
- [ ] Verify Supabase Auth registration, email verification, password recovery, and both project roles.
- [ ] Run configured AI milestone and scope-analysis flows; retain evidence that citations match persisted accepted terms.
- [ ] Configure PayPal Sandbox app credentials and webhook ID; run draft, send, payment, signature verification, duplicate-event, out-of-order, and reconciliation checks.
- [ ] Configure a public HTTPS webhook endpoint and verify its registered URL.
- [ ] Confirm any accepted amendment amount is allocated into a separately approved milestone before invoicing changed work.

## Sponsor and quality evidence

- [x] APIMatic plugin workflow and integration decision documented.
- [x] AG Grid Community analytics, CSS milestone timeline, Render Blueprint, and secret-free Postman collection are present.
- [x] Responsive Chrome preview inspected at desktop and approximately 374 px width; current smoke result is recorded.
- [x] Static browser-source scans found no server-only secret names, Node environment references, or direct HTML execution sinks.
- [ ] Finish keyboard-only, contrast, screen-reader, narrow viewport, and broader browser QA.
- [ ] Add/run an automated accessibility check and a dependency/security audit.
- [ ] Resolve or explicitly accept the Vite warning for the 719.63 kB AG Grid Community chunk.
- [ ] Validate the Render Blueprint in a real Render project and test health, CORS, build-time frontend settings, logs, and secret configuration.
- [ ] Import and run the Postman collection against a configured test account.

## Marketplace expansion

- [x] Implement profile roles/private client details/public freelancer profiles and Phase 9 job, proposal, offer, service, hiring-request, and editable AI/manual offer-milestone flows with fake-backed tests; database/RLS migration application and live AI remain unverified.
- [ ] Apply and verify the marketplace profile migration, test public-view/RLS isolation, and finish review/history and account lifecycle behavior.
- [ ] Apply and verify `202610300002_marketplace_jobs.sql`; verify role isolation, public view/package sanitization, idempotency, and fixed-offer draft agreement transaction against PostgreSQL.
- [x] Add the marketplace-offer milestone review/save and pre-acceptance gate to the dual-agreement approval path; its migration still needs PostgreSQL/Supabase verification.
- [x] Implement participant-scoped project conversations, messages, read receipts, unread notifications, private file attachments, blocks, and reports with fake-backed API/schema tests; migration/storage/realtime behavior remains unverified.
- [ ] Apply `202610300003_messaging_notifications.sql` and verify participant isolation, attachment policies, read receipts, notification ownership, block/report actions, and Realtime delivery in a non-production project.
- [x] Implement hourly offer-to-agreement setup, manual and timer entries, client approval/dispute with resubmission history, and server-derived approved-hours invoice claims (Phase 11); typecheck and fake-backed tests pass.
- [ ] Apply and verify hourly migration/backfill/RLS and run the PayPal Sandbox approved-hours invoice lifecycle with configured credentials.
- [x] Implement admin-only job/conversation moderation, append-only decisions, listing holds, explicit account-deletion requests, baseline API security headers, and the operations guide (Phase 12); local schema/API/UI checks are recorded in the tracker.
- [ ] Apply `202610300005_commercial_hardening.sql` and verify admin-role authorization, report privacy, listing holds, account-request RLS, and audit behavior in a non-production Supabase project.
- [ ] Define and verify account deactivation, retention, legal/financial holds, and a separate approved deletion process; the current request flow does not erase accounts or records.
- [ ] Deploy the Render Blueprint, configure external monitoring/alerts and backups, and perform an operator-reviewed rollback/recovery exercise.

## Demo and submission

- [x] Current demo script is labeled as a preview and avoids claiming live AI/payment behavior.
- [x] Devpost copy is a draft and describes unverified work honestly.
- [ ] Record a demo that exactly matches the configured and verified application.
- [ ] Update the Devpost draft with the actual demo, final test results, and verified sponsor evidence.
- [ ] Re-read the original and expanded requirements and confirm every checked acceptance item has evidence.
- [ ] Complete a final deployment and rollback review before inviting real users.
