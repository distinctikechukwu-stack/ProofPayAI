# ProofPay AI marketplace upgrade

This addendum preserves the expanded product requirements supplied on 2026-10-29. It extends `MASTER_REQUIREMENTS.md` without replacing the original eight phases or the hackathon acceptance story.

## Product direction

ProofPay AI is a professional, original freelancer marketplace for clients, freelancers, and administrators. It combines talent discovery, job posting, proposals, hiring, agreements, project management, scope intelligence, invoicing, and payment tracking. PayPal remains Sandbox-only until required account permissions, business approvals, and legal requirements are satisfied. Existing work must be preserved and the feature ledger must track implementation and evidence.

## Marketplace capabilities

- Authentication: registration, login/logout, email verification, recovery, sessions, settings, freelancer/client/admin and dual-purpose accounts, deactivation/deletion, and role-based access. Private account data must never be public.
- Freelancer profiles: photo, headline, biography, skills, experience, education, languages, portfolio, featured work, categories, services, hourly preferences, availability, work history, ratings/reviews, completeness, editing, and public URLs. Do not represent unverified qualifications as verified.
- Client profiles: individual/business details, organization description, job/hiring/review history, active projects, saved freelancers, billing preferences, and notifications. Do not invent verification.
- Persisted jobs: draft, publish, edit, close, reopen, archive/delete; browse/search/filter/sort by skills, budget, category, experience, project type; favorites, suspicious-listing reports, recent opportunities, detail view; fixed-price and hourly.
- Proposals: freelancer draft/edit/submit/withdraw, cover letter, quote, timeline, portfolio references, status, interview invitation, offer response; client applicant review/comparison, shortlist/reject/invite, offers, hiring decisions. Enforce membership and unique applications.
- Freelancer service catalog with title, description, category, starting price, delivery time, deliverables, packages, portfolio examples, and client hiring requests.
- Database-backed conversations, project messaging, history, unread counts, realtime updates, attachments, search, notifications, read receipts, blocking, and abuse reports, with strict participant-only access.
- Hiring flow: client offer, freelancer accept/decline, idempotent draft project/agreement, AI-assisted milestones, dual agreement approval, project activation, workspace and invoicing.
- Project workspace: overview, agreement, members, milestones, tasks, deliverables, deadlines, feedback/revisions, progress, activity, attachments, messaging, invoices/payment history. Preserve approval/revision audit history.
- Hourly contracts: manual time entries, start/pause/stop timer, descriptions, timesheet review, client approval, invoice based on approved hours, and disputed entries. No intrusive employee surveillance or unsupported payment-protection claims.

## AI capabilities

1. Job matching based on user-controlled skills, portfolio relevance, requirements, experience, availability, and budget preference, with explanations. Do not infer sensitive traits or use them for hiring eligibility.
2. Proposal drafting grounded in actual job and profile data, editable and user-approved; never invent qualifications or portfolio work.
3. Agreement drafting with requirements, deliverables, milestones, criteria, budget, deadlines, revisions, and responsibilities. Both parties approve; display a legal-review notice.
4. Scope-change detection for additional work, conflicts, missing detail, changed deadlines, and new deliverables. Cite accepted agreement evidence and require dual approval for amendments.
5. Payment intelligence for authorized invoice/project data: unpaid invoices, due dates, delayed approvals, revenue trends, attention needs, and explained follow-ups. No payment guarantees.
6. Neutral dispute evidence organization and next-step suggestions; do not claim legal authority or override PayPal dispute processes.
7. Allowlisted business assistant actions with authorization. Explicit user confirmation is required before messages, agreement changes, payment requests, or financial changes. Audit consequential actions.

## Security and rollout constraints

- Implement real persisted features; label demo data and absent providers honestly.
- PayPal Sandbox only; no live marketplace payments until approvals and legal requirements are met.
- Never claim unsupported deployment, tests, payment state, identity checks, or qualifications.
- Preserve current work and add safe checkpoints before significant changes. Continue independent work when credentials/services are unavailable.

## Source completeness

The supplied attachment `PROOFPAY AI — COMPLETE PRODUCTION-READY MARKETPLACE UPGRADE` ends mid-bullet in “7. COMPLETE PAYPAL INTEGRATION,” immediately after `- Re`. The remainder of that section and any later sections were not present in the file. PayPal requirements therefore continue to be governed by the original `MASTER_REQUIREMENTS.md` and `paypal-plan.md` until the missing text is supplied.

## Extended implementation phases

Keep the original phases 0–7. Add marketplace phases after the core agreement workflow: (8) identity and role profiles; (9) jobs, services, proposals, and hiring; (10) messaging and notifications; (11) hourly work; (12) commercial hardening, account lifecycle, moderation, and deployment. Reorder only when dependencies require it; keep each feature independently testable and accurately marked in `IMPLEMENTATION_PROGRESS.md`.
