# ProofPay AI — hackathon final submission checklist

**Updated:** November 12, 2026
**Reviewed application candidate:** `codex/proofpay-final-integration-prep` at `23194d8caffb46378b7fe1dddb710410ac3c8f82`
**Prior local docs checkpoint:** `1aee833eb494dea58993d5c690650c3c8507828f` (documentation-only parent of this finalization)
**Successful isolated validation:** [GitHub Actions run #13](https://github.com/distinctikechukwu-stack/ProofPayAI/actions/runs/43056263683)

## Submission blockers to close

- [ ] **Owner/license:** The owner confirms individual creator ownership and the public creator name DeBest Tech Solutions; the root MIT attribution is finalized. Verify GitHub detects the license on the repository’s default branch. Confirm third-party assets and dependencies retain their own notices and permissions.
- [ ] **Public video:** Record a functioning on-device demo under 3 minutes, upload it publicly to YouTube, and paste that URL into the Devpost form. Avoid unlicensed music/third-party material and hide account details.
- [ ] **Public source/default view:** Publish the reviewed candidate/docs with a normal fast-forward update. Make the candidate the repository default branch, or otherwise provide a branch-specific source link and ensure the default branch’s visible README/license are not stale. Do not merge or rewrite branch histories just for appearance.
- [ ] **Judge access:** Confirm the hosted URL is available to judges. If authentication is required, decide on a safe, dedicated fictional judge-account access method; never put administrator, provider, or service-role credentials in public source.
- [ ] **Devpost form:** Submit the final description, actual live/source/video URLs, and list of tools with their actual uses. Check all links after publishing.
- [ ] **Eligibility/ownership:** Confirm entrant age of majority, jurisdiction and conflict eligibility; appoint an authorized representative if submitting for a team/organization; explain significant work completed during the event period; confirm any third-party source, images, video, or assets are permissioned.
- [ ] **Deadline:** Official rules list November 12, 2026 at 12:00 PM Pacific (20:00 UTC / 21:00 WAT). Confirm the live Devpost countdown/form before submission and submit with time to spare.

## Already supported by evidence

- [x] Owner confirms both Render Staging services use commit 23194d8; hosted login, dashboard, and existing project screens work.
- [x] Owner confirms all 20 Supabase Staging migrations are applied.
- [x] GitHub Actions #13 passed 376 tests, TypeScript checks, webhook-test typecheck, production build, Wrangler dry run, and Linux Worker HTTP/Cron smoke.
- [x] Isolated PostgreSQL CI applied migrations 1–20, passed Migration 20 rollback/application, project-completion pgTAP 32/32 and provider-snapshot pgTAP 84/84 (116/116), two-session concurrency, final integrity checks, and cleanup.
- [x] Earlier owner-led Staging tests verified two fictional participants, an accepted agreement, approved USD 40/USD 60 milestones, freelancer profile persistence, and authenticated profile/project reads.
- [x] Historical local Groq result: ten structured draft milestones totaling 60,000 cents using `openai/gpt-oss-20b`; local scope-analysis evidence passed schema/citation validation.
- [x] Historical fictional USD 600 Sandbox invoice was created once, read back as DRAFT, then sent once; its recorded provider/local state is SENT.
- [x] APIMatic Context Plugin use is documented accurately as development-time guidance/testing. No generated SDK Invoicing operation is used at runtime.

## Feature status and evidence boundary

| Feature | Status | Evidence boundary |
| --- | --- | --- |
| Authentication and project authorization | Hosted login and authenticated profile/project reads confirmed in earlier Staging tests | Do not publish reusable private credentials. |
| Profiles, listings, jobs, proposals, hiring | Implemented and automated coverage exists; some earlier hosted flows were inspected | Complete end-to-end marketplace acceptance on this candidate remains unverified. |
| Agreements, milestones, evidence, review history | Existing fictional $100 project has accepted agreement and $40/$60 milestones approved; code/regression tests cover evidence and feedback | It remains In Progress; do not click recheck or alter it during the demo. |
| Groq milestone/scope assistance | Implemented; historical local results exist | Hosted inference and suggestion edit/save/reload on the final candidate remain unverified. |
| PayPal Sandbox invoice create/send | One historical fictional invoice is recorded SENT | No payment, signed webhook delivery, or authoritative reconciliation is verified. Never call it PAID. |
| Cloudflare webhook processing | Code and isolated CI coverage exist | Staging webhook path has a known HTTP 400 issue; not ready to demonstrate as working. |
| Public Staging app | Owner confirms both services use 23194d8 and login/dashboard/existing projects work | Broader marketplace/provider workflow remains unverified; Render Free can sleep. |

## Short, accurate demo path

Use [DEMO_SCRIPT.md](DEMO_SCRIPT.md), under three minutes:

1. Landing page; show the client/freelancer marketplace surfaces using existing fictional accounts.
2. Open the existing USD 100 project: accepted agreement, $40/$60 milestones, and current In Progress state. Use only safe, non-identifying content. Do not mutate it.
3. If available, show an existing evidence/review record read-only; skip if the current view or account does not show it.
4. Present the prior Groq output only as historical/local evidence, not as a hosted result. The current Scope Intelligence sample notice explicitly labels sample content; do not pass it off as AI.
5. If the separate historical USD 600 invoice is available in an authorized account, show its state read-only as SENT. Do not tie it to the $100 project unless its linkage is verified. Do not recreate, resend, pay, or claim it paid.
6. Close by disclosing that payment reconciliation/webhook delivery is unverified and the Cloudflare path currently fails with HTTP 400.

Do not create new users/jobs/proposals/projects, approve/reject milestones, invoke Groq, send invoices, or perform payments for this prepared demo without separate authorization. If a record is unavailable, skip that segment; never fabricate it.

## Devpost links to use after publication

- Demo: https://proofpay-staging-web.onrender.com
- Source/setup: https://github.com/distinctikechukwu-stack/ProofPayAI/tree/codex/proofpay-final-integration-prep
- CI: https://github.com/distinctikechukwu-stack/ProofPayAI/actions/runs/43056263683
- Video: **must be added after a public YouTube upload** (currently absent).
- Submission copy: [DEVPOST_DRAFT.md](DEVPOST_DRAFT.md)

See the official [hackathon rules](https://paypalaihackathon.devpost.com/rules) and [schedule](https://paypalaihackathon.devpost.com/details/dates). The entry is not ready to submit until the video and license/ownership items are complete and the live form is submitted.
