# APIMatic and PayPal integration evidence

Last reviewed: 2026-11-06.

## Finding

- The PayPal AI Hackathon requires a meaningful PayPal Developer Platform integration in Sandbox, meaningful AI use, and a working prototype with documentation. Its public rules list APIMatic as an optional sponsor tool; they do not require an APIMatic SDK or runtime dependency for the main submission.
- The public rules describe the Best Use of APIMatic sponsor prize as open to eligible submissions that use APIMatic tools. APIMatic's hackathon page specifically recognizes participants who used its PayPal Context Plugin to build their PayPal integration. ProofPay AI has a documented, build-time Context Plugin use, so it is reasonable to identify APIMatic as a tool used. That supports the tool-use criterion; it does not guarantee eligibility under any additional terms, a prize, or a favorable judging result.
- In ProofPay AI, APIMatic is a developer-time integration aid. No APIMatic SDK is imported by the running application, and no generated SDK operation is used for invoice creation, sending, reconciliation, or webhook verification.

## What was used

- Project records document that the PayPal Context Plugin was installed for Codex and VS Code on 2026-10-29. In a refreshed Codex session, its TypeScript integration workflow and companion getting-started, error-handling, and testing guidance were loaded before the PayPal implementation phase.
- The guidance informed the contract-first review, server-only credential boundary, handling of known provider refusals versus uncertain write outcomes, and injected-fetch test seam. PayPal Invoicing request and response details were checked against PayPal's own Invoicing API v2 documentation and recorded in [paypal-plan.md](../paypal-plan.md).
- The generated TypeScript SDK package paypal@2.29.0 was inspected during implementation only to review its packaged SDK map. It exposed Orders, Payments, Vault, Transaction Search, and Subscriptions, but no Invoicing resource. The package is not a runtime dependency in the current application manifests or lockfile.
- At this review, PayPal's public TypeScript Server SDK repository identifies version 2.5.0 and documents only Orders, Payments, Vault, Transaction Search, and Subscriptions. Its published surface likewise has no Invoicing controller or invoice operation. The official PayPal Invoicing API v2 separately documents invoice create, send, list/search, and show operations.

## ProofPay AI implementation

- [paypal.ts](../apps/api/src/paypal.ts) implements server-side OAuth and direct REST calls to the fixed PayPal Sandbox host. It includes draft creation, send, invoice show/search reconciliation, and signature-verification calls.
- [app.ts](../apps/api/src/app.ts) keeps invoice actions behind authenticated application routes and durable application-owned operation claims. The webhook route verifies the signature before allowlisted events are durably enqueued.
- [paypal-webhook-worker.ts](../apps/api/src/paypal-webhook-worker.ts) claims queued events, reads current invoice state from PayPal, and reconciles that provider state. The event body is not treated as proof of payment. Database and API regression tests cover the request boundary with fakes; those tests are not live PayPal verification.
- The historical Sandbox evidence in the canonical progress/checklist records one successful OAuth request with an accepted Invoicing scope, one USD 600 fictional invoice created and read back as DRAFT, and one send of that same invoice. Its recorded state is SENT. It must not be recreated or resent. No Sandbox payment, signed webhook delivery, or webhook-driven payment reconciliation has been verified.

## Judge demonstration evidence

Use a short, factual explanation alongside the working ProofPay AI demo:

1. Show this note and [paypal-plan.md](../paypal-plan.md) to explain that the Context Plugin was used during development, while the invoice contract was verified against PayPal's official Invoicing API reference.
2. Show [paypal.ts](../apps/api/src/paypal.ts) and [paypal.test.ts](../apps/api/test/paypal.test.ts). Explain that the inspected generated SDK omitted Invoicing, so the app uses direct Sandbox REST rather than an unrelated Orders operation. Do not describe the application as running on an APIMatic SDK.
3. Demonstrate the implemented PayPal flow and distinguish the recorded OAuth, DRAFT, and SENT evidence from payment state. State clearly that no payment or genuine webhook delivery has been verified.
4. Keep credentials, access tokens, buyer email, and private account information off screen. Do not recreate or resend the existing invoice for the demo.

Suggested narration: “We used APIMatic's PayPal Context Plugin as a coding-time guide for the integration and tests. The generated TypeScript SDK we inspected did not expose PayPal Invoicing v2, so our server calls the official Sandbox Invoicing REST API directly. The existing fictional invoice was created and sent once; no payment or verified webhook is claimed.”

## What remains

- No additional APIMatic runtime code is needed for the current Invoicing v2 workflow. Do not add an SDK dependency unless a supported, needed operation is later verified.
- For a stronger sponsor evidence trail, retain the installation/use record and show the relevant source/contract during the demo. Do not present plugin guidance as generated SDK execution.
- Separate PayPal payment, webhook-registration, signature-delivery, and final payment-reconciliation verification remain outstanding. Consult the current hackathon checklist before making any provider or remote-service change.

## Sources

- [PayPal AI Hackathon requirements and prizes](https://paypalaihackathon.devpost.com/)
- [Official PayPal AI Hackathon rules](https://paypalaihackathon.devpost.com/rules)
- [APIMatic sponsor information for this hackathon](https://paypalaihackathon.devpost.com/details/apimatic)
- [APIMatic PayPal Context Plugin](https://context.apimatic.io/plugins/paypal/)
- [PayPal TypeScript Server SDK source](https://github.com/paypal/PayPal-TypeScript-Server-SDK)
- [PayPal TypeScript Server SDK package](https://www.npmjs.com/package/@paypal/paypal-server-sdk)
- [PayPal Invoicing API v2](https://developer.paypal.com/api/invoicing/v2/)
- [PayPal Invoicing webhooks](https://developer.paypal.com/api/invoicing/webhooks/)
- [PayPal REST webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/)
