# ProofPay AI — evidence-aligned demo script

**Target run time:** 2 minutes 45 seconds (under the three-minute limit)
**Mode:** Existing fictional Staging accounts and records only. No new records, AI requests, invoices, sends, payments, or webhook actions are part of this prepared script.

## Before recording

- The owner confirms both Render Staging services use commit 23194d8 and hosted login, dashboard, and existing projects work. Before recording, visually confirm these remain true.
- Sign in only with the existing authorized fictional client and freelancer accounts. Keep passwords, recovery details, access tokens, private emails, and buyer information off-screen.
- Choose the existing project with an accepted agreement and the approved USD 40 / USD 60 milestones. Confirm its current status before narrating it. Do not edit it.
- The historical USD 600 Sandbox invoice was sent once and is recorded as SENT. Open it read-only if it remains available. Do not recreate or resend it. Do not associate it with the USD 100 project unless its project linkage is independently confirmed.
- The owner-confirmed hosted pass covers login, dashboard, and existing projects only. Do not imply full marketplace, hosted Groq, or webhook/payment acceptance from that limited check.

## 0:00–0:15 — The problem

**Show:** ProofPay AI landing page.

**Say:** “Freelance work depends on shared expectations. ProofPay keeps the profile, project terms, evidence, review decisions, and invoice state together, so a sent invoice is never mistaken for verified payment.”

## 0:15–0:40 — Marketplace and the two roles

**Show:** Existing freelancer profile/service listing and client opportunities or an existing job/proposal. Switch to the second authorized account in a separate browser profile if the project context is not available in one session.

**Say:** “Clients can discover services and projects; freelancers can present a profile and respond. The same project is then visible to its authorized participants.”

**Do not:** Create a new job, proposal, service, or account during this prepared read-only demo.

## 0:40–1:20 — Agreement, milestones, and evidence

**Show:** Existing shared project, accepted agreement, milestone amounts/statuses, and the existing submission/review history. If available, show the submitted evidence link and freelancer summary on the client side, then the client's revision feedback on the freelancer side.

**Say:** “The agreement and milestone review are shared workflow state. Evidence and revision notes stay attached to the project, and the client and freelancer see the same persisted history after refresh.”

**Do not:** Approve, reject, resubmit, or change a milestone during this recording. Only describe the two $40/$60 approvals if they are still visible in the selected fixture.

## 1:20–1:55 — AI assistance with a human decision

**Show:** A previously captured, sanitized Groq result or its test evidence. The recorded local run generated ten milestones totaling 60,000 cents using openai/gpt-oss-20b; suggestions remained drafts for human review.

**Say:** “The AI proposes structured milestones; a person edits and chooses what to save. Generation alone does not accept an agreement or approve work.”

**Do not:** Make a new hosted Groq request during this recording unless it has separate authorization. Do not describe the historical local response as a result from the currently deployed Staging service.

## 1:55–2:25 — PayPal Sandbox invoice state

**Show:** The existing invoice's read-only state, if available.

**Say:** “This fictional Sandbox invoice was created and sent once. Its verified recorded status is SENT. SENT is not PAID. The application is designed to accept payment state only from trusted provider data.”

**Do not:** Recreate or resend the invoice, make a payment, register a webhook, or change payment state. The Cloudflare webhook path is currently known to fail in Staging, and payment reconciliation is not verified.

## 2:25–2:45 — Close

**Say:** “ProofPay AI makes project decisions easier to audit. Our isolated automated suite validates the payment and concurrency safeguards; hosted payment reconciliation remains a clearly identified next step.”

## If the expected records or feature are unavailable

Stop that part of the recording. Do not fabricate, seed, or mutate records to keep the script moving. Show the corresponding local test or design evidence and label it as local/automated evidence.
