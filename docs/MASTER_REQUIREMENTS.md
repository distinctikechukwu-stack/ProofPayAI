# ProofPay AI — master requirements

Source: the user-provided “MASTER CODEX PROMPT — BUILD PROOFPAY AI” for the PayPal AI Hackathon 2026. This document organizes the product, engineering, security, integration, and submission requirements. The original prompt remains the authority if a requirement is ambiguous.

The later marketplace expansion is recorded separately in [`EXPANDED_PRODUCT_REQUIREMENTS.md`](EXPANDED_PRODUCT_REQUIREMENTS.md). Both specifications apply; preserve the original hackathon phases and acceptance checklist.

## Product goal and demo story

ProofPay AI helps freelancers and clients agree on scope, manage deliverables and milestone approvals, identify extra work with evidence from the accepted agreement, and request payment through PayPal Invoicing. The experience should feel like a polished fintech SaaS product.

The primary demo is a $600 website project with three editable milestones. A client requests an appointment-booking feature; AI compares it with the accepted agreement, cites the exact relevant agreement text, classifies the request, identifies affected milestones, and proposes a change order. Both parties explicitly approve it. Once a milestone is eligible, the freelancer confirms invoice creation and separately confirms sending it. A real PayPal Sandbox invoice is created and sent. Only a verified PayPal webhook or authoritative PayPal reconciliation may update payment state.

## Required pages and product behavior

### Public and account pages

- Landing page with product features, how it works, interactive product preview, scope-intelligence explanation, security/Sandbox explanation, calls to action, and footer.
- Sign-up, sign-in, sign-out, user roles, and password recovery where Supabase supports it.

### Freelancer workspace

- Overview dashboard; projects; project creation and detail; agreement/milestone builder; scope-intelligence review; approval tracking; invoices and payments; project timeline; analytics; settings.
- Project creation captures title, client information, description, deliverables, total budget, currency, deadline, and additional requirements.
- AI returns structured, editable milestones with title, description, deliverables, acceptance criteria, amount, deadline, dependencies, and completion conditions. Deterministic application logic validates totals against the project budget. A freelancer reviews and edits before sharing.
- Accepted agreements and amendments are immutable versions. Acceptance is explicit and actor/timestamp recorded.
- Freelancer submits deliverable evidence as a secure file or URL. Clients approve or request revisions. Keep review history and actor/timestamp data; prevent duplicate and unauthorized approvals.

### Client workspace

- Client dashboard, agreement and milestone review, project progress, invoices, and PayPal invoice links.
- Client may submit scope-change requests and approve or request revision on deliverables and amendments.
- A client only sees projects to which they belong.

### AI scope intelligence

- Compare each client request with the original accepted requirements, milestones, deliverables, and accepted amendments.
- Classify as covered, possibly covered, outside scope, or requires clarification.
- Return explanation, exact supporting excerpts/references, affected milestones, proposed amendment/additional work, supportable financial or schedule impact, and uncertainty/missing information.
- Validate structured model output with Zod. Never invent citations, hardcode AI results as the real feature, silently alter accepted scope, or state that a client owes money. Human review and both parties’ explicit approval are mandatory.
- Treat user text as untrusted; add prompt-injection protections. Missing AI credentials must produce a visible Not configured state and setup guidance.

### Milestone and invoice states

Keep project workflow and provider payment states separate. Project workflow includes Draft, Awaiting client agreement, Agreed, In progress, Submitted for review, Revision requested, Approved, Invoiced, and Paid. The provider’s invoice/payment state remains an independent PayPal field.

Required PayPal flow: approved milestone → freelancer confirms invoice creation → Sandbox draft created → freelancer confirms send → PayPal sends invoice → payer completes Sandbox payment → verified PayPal state update → dashboard reflects persisted state. Display clear PayPal invoice links and explain any action that must occur outside the app. Do not imply escrow or mark an invoice paid based on a UI click.

## Technology and structure

- React, TypeScript, Vite, Tailwind CSS, accessible component primitives, React Router, TanStack Query, React Hook Form, Zod, and Lucide React.
- Node.js TypeScript API using Fastify (or another justified production-ready framework), REST endpoints, server-side AI, and server-side PayPal.
- Supabase PostgreSQL, Auth, migrations, seed data, ownership checks, and Row-Level Security.
- OpenAI, Gemini, or another supported AI provider via server-only credentials and structured outputs with timeout/retry handling.
- PayPal Sandbox, Invoicing API v2, OAuth, and verified webhooks.
- Suggested monorepo areas: `apps/web`, `apps/api`, `packages/shared`, `supabase/migrations`, `supabase/seed`, tests, docs, and Postman collection.

## Data and security requirements

Create appropriate profiles, projects, project membership, agreement versions, milestones, deliverables, milestone reviews, change requests, change-order versions, invoices, PayPal webhook events, activity logs, and AI analysis records. Use primary/foreign keys, indexes, unique constraints, timestamps, input validation, owner/role checks, and RLS.

- Use exact decimal or integer-minor-unit money representations; never use JavaScript floating point as the source of truth.
- Keep Supabase service-role credentials, AI credentials, PayPal credentials, and access tokens on the server. Only the Supabase anon key may be exposed to the frontend.
- Validate requests; enforce client-specific isolation; safely render untrusted text; rate-limit sensitive/AI actions; apply upload limits; and audit financial/approval operations.
- Validate every PayPal webhook before processing, deduplicate by provider event ID, tolerate out-of-order events, and reconcile local invoice state with PayPal as needed.
- Create a placeholder-only `.env.example`. Use PayPal Sandbox only; never perform or claim real-money transactions.
- Missing Supabase, AI, or PayPal configuration must be clearly reported while other usable parts remain available.

## Sponsor integrations

Prioritize meaningful APIMatic integration, then AG Studio/AG Grid analytics, Bryntum timeline, Render deployment configuration, and Postman API collection. Preserve the core workflow and avoid optional products that require unavailable licenses or add no working end-to-end value. Document sponsor evidence accurately; never claim a plugin or sponsor tool was used without actual use.

## Demo and hackathon materials

- Clearly distinguish sample/demo data from persisted user data and real PayPal Sandbox records.
- Prepare local-run and deployment instructions, realistic demo data, Devpost draft, final checklist, sponsor evidence, and a compelling sub-three-minute demo script. The script must match the implemented app; it does not replace a real recording.
- Public repository preparation and any license selection must be accurate; do not claim features or zero defects without evidence.

## Required implementation phases

| Phase | Scope |
| --- | --- |
| 0 — Foundation | Environment/repository inspection, stack and structure, TypeScript/tooling, requirements and progress records, migrations, environment template, design tokens. |
| 1 — Premium frontend | Landing page, application shell, auth UI, freelancer/client dashboards, project screens, responsive layout, meaningful controls and polished states. |
| 2 — Core project functionality | Supabase Auth, data model, project/membership, immutable agreement versions, milestones, deliverable submission, client approval/revision workflow, RLS/persistence. |
| 3 — AI intelligence | Milestone generation, scope comparison/evidence, structured change-order proposal, validation, uncertainty, errors and injection protections. |
| 4 — PayPal/APIMatic | Install and verify APIMatic Context Plugin, Sandbox OAuth/Invoicing, draft/create/send, invoice state, webhook signature/idempotency, lifecycle tests. |
| 5 — Sponsor features | AG Studio/AG Grid analytics, Bryntum timeline where licensing allows, Render configuration, Postman collection. |
| 6 — Quality assurance | Automated and authorization tests, integration and responsive browser checks, accessibility, security, performance, refinements and bug fixes. |
| 7 — Hackathon readiness | README, repository/deployment/local setup, demo data, Devpost draft, demo script, integration evidence, final checklist. |

Run relevant typecheck/build/lint/tests after each phase, fix failures, and update `docs/IMPLEMENTATION_PROGRESS.md` before moving on. If an external service blocks work, complete independent work and record the exact blocker.

## Acceptance checklist

- [ ] Website builds; user can authenticate.
- [ ] Freelancer can create a project, generate/edit milestones, share an agreement, and retain immutable accepted versions.
- [ ] Client can approve, request revision, view progress/invoices, and submit scope requests.
- [ ] AI returns usable milestones and evidence-backed scope analysis without fabricated citations; both parties approve amendments.
- [ ] Freelancer submits deliverables; client review history and authorization are correct.
- [ ] Eligible approved milestone can create and send a real PayPal Sandbox invoice without duplication.
- [ ] PayPal webhook signature is verified; persisted payment state reflects trusted provider information.
- [ ] Dashboard reads correct persisted information after browser refresh; unauthorized access is blocked.
- [ ] Tests cover core behavior, authorization, provider failures, duplicate writes/events, webhook verification, and state transitions.
- [ ] Setup, API, database, deployment, integration, sponsor, demo, and submission documentation is complete and honest.
