# ProofPay AI demo script

**Run time:** about 2 minutes 20 seconds  
**Script status:** matches the current local preview. The signed-out workspace uses illustrative data; no provider or database action occurs in this recording.

## 0:00–0:20 — Set the problem

“Freelancers and clients often disagree about what was included, what changed, and when approved work can be invoiced. ProofPay keeps scope, milestone decisions, and payment status visible in one shared workspace.”

Show the landing page. Point out that scope evidence and approval controls are part of the product preview.

## 0:20–0:50 — Walk through the sample project

Choose **Open demo**. Say: “This is labeled sample data, not a connected client account.” Show the `$600` Studio website refresh and its `$150`, `$250`, and `$200` milestones. Open the project and point out its agreement, milestone progress, and review surfaces.

## 0:50–1:25 — Explain the scope-review workflow

Open **Scope review**. Show the appointment-booking request and the exact sample agreement excerpt that excludes scheduling. Say: “The sample illustrates how evidence is shown next to a request. AI is not configured in this preview, so this classification is illustrative; it is not a live model result.”

Explain that the implemented API validates model output and citations, and that a human-priced change order requires both parties' approval before accepted scope changes.

## 1:25–2:00 — Explain payment controls

Open **Invoices**. Show the notice that no invoice, provider link, or payment record exists in the signed-out preview. Explain the separate draft-creation and send confirmations, durable server-side claims, and reconciliation path. Say: “The code targets PayPal Sandbox only. No live Sandbox request or transaction has been performed in this environment.”

## 2:00–2:20 — Close with what is next

“The next validation step is to apply the migrations to a test Supabase project, configure provider credentials, and run the full Sandbox webhook lifecycle. Job, proposal, messaging, and hourly-work code paths are implemented with fake-backed tests, but their database behavior is not verified here. Account lifecycle, moderation, and deployment hardening remain in progress.”

## Optional configured-environment substitution

Only after the environment is actually configured and verified, replace the illustrative scope section with a real authenticated request and verified AI result. Replace the invoice section only after demonstrating a real Sandbox invoice and provider-authoritative state update. Do not narrate an expected result as if it happened, and do not expose credentials or access tokens on screen.
