# APIMatic PayPal integration evidence

Last checked: 2026-10-29.

## Current state

- The separate APIMatic Context Plugin installation succeeded on 2026-10-29. In the refreshed Codex session used for Phase 4, the plugin-provided PayPal TypeScript integration workflow plus getting-started, error-handling, and testing guidance were opened before implementation.
- The APIMatic-generated `paypal@2.29.0` TypeScript package was installed in `apps/api` only to inspect its packaged `sdk-map.md`. The map exposes Orders, Payments, Vault, Transaction Search, and Subscriptions, with no Invoicing resource. No generated SDK operation is used for invoice creation or sending.
- The PayPal implementation plan is [`paypal-plan.md`](../paypal-plan.md). Invoice work is planned against the official Invoicing API v2 REST documentation on PayPal Sandbox.
- **Context Plugin installation and use:** the initial sandbox `npx.cmd --yes context-plugins install paypal` attempt produced no output and was interrupted after about 45 seconds. Retrying with approved npm-registry access completed successfully; the marketplace source was fetched, `paypal@context-plugins` was installed into the VS Code and Codex targets, and the installer reported “Start a new `codex` session to load the plugin.” In the refreshed session, its TypeScript integration flow and companion contract/error/testing instructions were loaded before Phase 4 implementation. They were applied to the required contract-first gate, server-only auth boundary, distinction between known provider refusals and unknown writes, and fetch-seam verification plan. No generated SDK operation is claimed because the inspected package map has no Invoicing resource.
- PayPal credentials and a registered webhook ID are not configured. Real Sandbox API smoke tests and payment lifecycle verification have not run.

## Integration decisions

- Sandbox-only server-side OAuth client credentials; no PayPal secret or access token in browser code.
- PayPal Invoicing v2 draft creation, sending, search/show reconciliation, and webhook verification are direct REST calls because the inspected generated SDK map has no invoice methods.
- Invoice creation/sending are protected by committed application-owned unique claims. Connection/timeout after writes is an unknown outcome, reconciled with invoice-number search or invoice detail lookup.
- Provider webhooks are not applied until signature verification succeeds; event IDs are deduplicated.
- Exact endpoints, request fields/defaults, error mapping, and durable-write obligations are recorded in `paypal-plan.md`.

## Sources

- [APIMatic PayPal API Context Plugin](https://context.apimatic.io/plugins/paypal/)
- [PayPal Invoicing API v2](https://developer.paypal.com/api/invoicing/v2/)
- [PayPal Invoicing quick start](https://developer.paypal.com/api/invoicing)
- [PayPal Invoicing webhooks](https://developer.paypal.com/api/invoicing/webhooks/)
- [PayPal REST webhook verification](https://developer.paypal.com/api/rest/webhooks/rest/)
