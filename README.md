# ProofPay AI

ProofPay AI is a shared workspace for freelance marketplace discovery, clear agreements, milestone reviews, evidence-backed scope decisions, and PayPal Sandbox invoicing.

## Final submission snapshot

Updated November 12, 2026. The reviewed application candidate is branch **codex/proofpay-final-integration-prep**, based on commit **23194d8caffb46378b7fe1dddb710410ac3c8f82**; the submission documentation and license changes are documentation-only. The project is licensed under MIT; see [LICENSE](LICENSE). The owner-confirmed copyright attribution is DeBest Tech Solutions (2026).

- GitHub Actions [run #13](https://github.com/distinctikechukwu-stack/ProofPayAI/actions/runs/43056263683) passed 376 automated tests, TypeScript checks, webhook-test typecheck, production build, Wrangler dry run, and Linux Workerd HTTP/Cron smoke. Its isolated Supabase run applied migrations 1–20, passed Migration 20 rollback/application, 116 pgTAP assertions, two-session concurrency, and final database integrity checks.
- The public Staging frontend and API responded during a read-only smoke check: the frontend shell and its sign-in/projects SPA paths returned HTTP 200; API /health and /api/status returned HTTP 200; a frontend-origin Authorization preflight returned 204; an unauthenticated profile request returned 401.
- The API status endpoint reported Supabase, AI, and PayPal as configured and PayPal webhook readiness as false. These flags indicate configuration presence, not successful Supabase queries, hosted Groq inference, or payment reconciliation.
- Owner-confirmed November 12: both Render Staging services use commit 23194d8; hosted login, dashboard, and existing projects work. The owner also confirms all 20 Staging migrations are applied. This review did not independently inspect the Render dashboard or query migration history.
- No payment completion, signed webhook delivery, or webhook-driven reconciliation is demonstrated. Never present an invoice as paid unless the provider-authoritative status has been verified.

## Product capabilities

The application includes React/TypeScript marketplace and project views, an authenticated Node API, Supabase Auth/Postgres/RLS integration, exact minor-unit money handling, and Zod validation at API and AI boundaries. Project workflows cover profiles, jobs, proposals, hiring, two-party agreement acceptance, milestones, deliverable evidence, review history, scope analysis, and project-completion guards.

Groq milestone generation returns structured, editable draft suggestions for human review. A real local run on November 2, 2026 used `openai/gpt-oss-20b` to produce ten structured milestones totaling 60,000 cents. A real local scope-analysis result passed schema and evidence-citation validation and persisted its audit. Hosted Groq inference and editing/saving/reloading suggestions on the final candidate have not been verified.

PayPal uses the Invoicing v2 REST API against the Sandbox host. A historical fictional USD 600 invoice was created once, read back as DRAFT, then sent once; its recorded provider/local state is SENT. Do not recreate or resend it. No Sandbox payment or authoritative payment reconciliation has been verified. The Cloudflare webhook has a known Staging RPC/read failure; webhook processing is not currently verified as working.

APIMatic’s Context Plugin informed development-time contract planning and testing. The inspected generated TypeScript SDK map had no Invoicing resource, so the app uses direct PayPal REST for Invoicing; no APIMatic-generated operation is used at runtime. See [APIMatic integration evidence](docs/APIMATIC_INTEGRATION.md).

## Known release limitations

- Owner-confirmed November 12: both Render Staging services use commit 23194d8. Hosted login, dashboard, and existing project views work; broader marketplace acceptance remains outstanding.
- Owner-confirmed November 12: all 20 Supabase Staging migrations are applied. This was not independently queried during this documentation review.
- The API status endpoint reports webhook readiness false; the Cloudflare Staging webhook path has a known HTTP 400 failure. Do not activate a webhook or claim payment reconciliation works.
- Hosted Groq generation and draft edit/save/reload still need acceptance testing.
- Render Free services can sleep; they cannot guarantee continuously available webhook processing or timely automatic reconciliation.

## Submission links

- Hosted Staging demo: [proofpay-staging-web.onrender.com](https://proofpay-staging-web.onrender.com)
- Source and current setup instructions: [codex/proofpay-final-integration-prep](https://github.com/distinctikechukwu-stack/ProofPayAI/tree/codex/proofpay-final-integration-prep)
- Isolated CI evidence: [GitHub Actions run #13](https://github.com/distinctikechukwu-stack/ProofPayAI/actions/runs/43056263683)
- Hackathon: [PayPal AI Hackathon on Devpost](https://paypalaihackathon.devpost.com/)
- Submission text: [Devpost draft](docs/DEVPOST_DRAFT.md)
- Recording: **not yet available**; add a public YouTube link only after a sub-three-minute recording is uploaded and verified.

The default branch `master` is not the reviewed application candidate. Use the branch-specific source link above after the candidate documentation and license are published. Do not merge branch histories merely to make the code appear on `master`.

## Local development

Requirements: Node.js 26.13.0 (or compatible Node 26) and npm 11.20.0. From the repository root, run `npm ci`. Copy `.env.example` to the ignored `.env` only if configuring local services. Keep Supabase service-role, Groq/OpenAI, and PayPal Sandbox secrets server-side; never place them in `VITE_*` variables.

Start the API and web app in separate terminals with `npm.cmd run dev:api` and `npm.cmd run dev:web`. The API listens on port 4000 and Vite on port 5173. The signed-out preview is explicitly sample content, not persisted client data, AI output, an invoice, or a payment.

## Verification

From the repository root:

- `npm.cmd test` — full release suite.
- `npm.cmd run typecheck` — shared, API, and web type checks.
- `npm.cmd run typecheck:webhook-tests` — webhook test type check.
- `npm.cmd run build` — production build.
- `npm.cmd run cloudflare:webhook:dry-run` — local Wrangler dry run; this does not deploy.

The latest candidate validation passed 376 tests: shared 24, API 195, web 34, and static validators 123. Typechecks, production build, and Wrangler dry run passed. The build retains the known AG Grid chunk-size advisory. See [implementation progress](docs/IMPLEMENTATION_PROGRESS.md) for evidence and limits.

## Project resources

- [Original hackathon requirements](docs/MASTER_REQUIREMENTS.md)
- [Expanded marketplace requirements](docs/EXPANDED_PRODUCT_REQUIREMENTS.md)
- [Implementation progress](docs/IMPLEMENTATION_PROGRESS.md)
- [Demo script](docs/DEMO_SCRIPT.md)
- [Devpost draft](docs/DEVPOST_DRAFT.md)
- [Hackathon demo completion checklist](docs/HACKATHON_DEMO_COMPLETION_CHECKLIST.md)
- [Operations guide](docs/OPERATIONS.md)
- [PayPal contract plan](paypal-plan.md)
