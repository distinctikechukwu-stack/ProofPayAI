# ProofPay AI — permanent project instructions

## Source of truth

- `docs/MASTER_REQUIREMENTS.md` is the original hackathon master specification. Preserve its requirements.
- `docs/EXPANDED_PRODUCT_REQUIREMENTS.md` records the additional marketplace upgrade request. Read both specs; the supplied upgrade attachment ends mid-PayPal bullet, so do not invent its missing tail.
- `docs/IMPLEMENTATION_PROGRESS.md` is the canonical feature-by-feature tracker. The root `IMPLEMENTATION_PROGRESS.md` points to it for compatibility.
- Read this file, the master requirements, and the progress tracker before starting each implementation phase. Update the tracker after each phase and every verification run.
- `paypal-plan.md` is the required PayPal contract sheet. Read and complete it before changing PayPal integration code. Record any contract changes there first.

## Product and stack

- Build ProofPay AI as a professional freelancer agreement, project, AI scope intelligence, and PayPal Invoicing application.
- Use React, TypeScript, Vite, Tailwind CSS, Node.js, Supabase Auth/Postgres/RLS, and PayPal Sandbox. The codebase is a TypeScript-first npm workspace monorepo.
- Implement the original phases in `docs/MASTER_REQUIREMENTS.md`, then the extended marketplace phases in `docs/EXPANDED_PRODUCT_REQUIREMENTS.md`.
- Prioritize the end-to-end $600 agreement → milestones → evidence-backed scope amendment → dual approval → PayPal Sandbox invoice → verified webhook/payment-state workflow.

## Architecture conventions

- Keep browser, Node API, shared domain code, Supabase migrations/seeds, tests, and submission documentation in their designated folders.
- PayPal and AI secrets are server-only. The browser may receive only the Supabase public anon key and public API configuration.
- Use Zod schemas at API and AI boundaries. Use integer minor units or exact decimal text for money; JavaScript floating point is never the source of truth.
- Enforce authorization in API/domain logic and Supabase RLS. A client-supplied ID or role claim never proves access.
- Use immutable accepted agreement/amendment versions and append-only review/audit history. Keep milestone workflow state distinct from PayPal invoice/payment state.
- Do not represent demo data, mock API responses, or unavailable integrations as real persisted records, AI analysis, invoices, or payments. Label sample data and “Not configured” states clearly.

## Security and integration rules

- Sandbox only; never call a live-money PayPal host, expose a credential, claim escrow, or mark an invoice paid from a UI action.
- Verify every PayPal webhook before processing it; deduplicate by provider event ID. Create/send invoice operations need a committed database claim before the provider call and explicit unknown-outcome reconciliation.
- Treat client-entered agreement/request text as untrusted AI input. AI recommends; humans approve scope and money changes.
- Keep `.env` files and secrets out of version control. `.env.example` contains names and placeholders only.
- Do not install packages without a feature-level reason. Do not claim a sponsor integration was used unless it was installed/loaded and contributed to a documented implementation.
- Follow the APIMatic PayPal integration skill's plan-first gate for any SDK integration. This project uses direct REST for Invoicing because the inspected generated TypeScript SDK map has no Invoicing resource; do not substitute unrelated SDK operations.

## Development and verification

- Node.js `v26.13.0`, npm `v11.20.0`, and Git are available on native Windows. `C:\Program Files\nodejs` has been added to the User PATH; a running Codex process may need restarting before its inherited PATH refreshes. Until then, invoke `C:\Program Files\nodejs\npm.cmd` explicitly or prepend that directory in the process.
- Run the applicable typecheck, build, lint, and test commands after each phase. Record exact commands/results; never report a check that was not run.
- Do not suppress errors or leave decorative controls without behavior. Add tests for financial, authorization, webhook, AI schema, and approval invariants.
- If external credentials, a licensed package, or an unavailable service blocks verification, finish independent work and document the exact blocker and setup steps.

## Definition of done

- Meet the acceptance checklist in `docs/MASTER_REQUIREMENTS.md` and maintain its per-feature verification trail in `docs/IMPLEMENTATION_PROGRESS.md`.
- Setup, environment, migration, API, Sandbox configuration, test, deployment, and demo instructions accurately distinguish implemented, tested, blocked, and not configured behavior.
