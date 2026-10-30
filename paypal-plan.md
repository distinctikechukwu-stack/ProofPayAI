# PayPal integration plan and contract sheet

Status: original invoice contract plus Phase 11 approved-hour extension recorded; read this sheet before implementation. This sheet is the PayPal implementation authority until a versioned API contract changes.

## Scope and architecture decision

- The application uses PayPal Invoicing API v2 on the sandbox host `https://api-m.sandbox.paypal.com` only. The API is called from the Node.js TypeScript backend with server-side `fetch`; no PayPal credential is sent to the browser.
- The installed APIMatic TypeScript SDK package resolves as `paypal@2.29.0`. Its `sdk-map.md` lists only `orders`, `payments`, `vault`, `transactionSearch`, and `subscriptions`; there is no Invoicing resource or invoice operation page. **Generated SDK operations in scope: none.** Do not call unrelated Orders operations to create invoices. Use the official PayPal Invoicing REST endpoints below.
- The APIMatic Context Plugin remains a separate required sponsor tool. It must be installed and its context verified before PayPal integration code is written; document actual usage or the exact failure in `docs/APIMATIC_INTEGRATION.md`. The current `typescript-*` SDK skills are available, but are not evidence that the Context Plugin itself was installed or used.
- No PayPal sandbox credentials or webhook ID were present in the environment at planning time. Required configuration is `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`, and `PAYPAL_WEBHOOK_ID`. Missing values produce an explicit “Not configured” integration state. No live PayPal host or live credentials are permitted.
- Runtime baseline: Node.js `v26.13.0`, npm `11.20.0`; `apps/web` is ESM, Vite, TypeScript strict mode, and has no `exactOptionalPropertyTypes` or `verbatimModuleSyntax` flags. `apps/api` is currently a Node.js area with no application code; use ESM TypeScript. Frontend baseline command `npm run build` passes. There is no existing API build, lint, or test command to preserve.

## Assumptions & blockers

- Host decision is fixed: the application calls https://api-m.sandbox.paypal.com only. Do not make the host configurable or infer it from credentials.
- Invoicing implementation is direct REST: the generated APIMatic SDK map has no invoice operation. Do not add the unrelated SDK or call Orders operations. The installed APIMatic Context Plugin is available in this Codex session; its TypeScript integration workflow and this contract sheet were loaded before implementation.
- Live provider verification is blocked: no Sandbox client ID/secret, registered webhook ID, or public HTTPS callback is configured. Implement the provider boundary with injectable fetch and tests; do not claim any live invoice, send, webhook, or payment result.
- Database verification is blocked: Supabase credentials and PostgreSQL/Supabase CLI tooling are absent. The follow-on migration and service-role-only atomic RPCs are authored in `supabase/migrations/202610290002_paypal_invoice_workflow.sql`; API tests use fakes. Do not claim RLS, SQL functions, claim uniqueness, or webhook transactions were applied or verified against a database.
- Invoice creation/sending may be implemented independently under these constraints. Unknown outcomes must remain unknown until a successful PayPal search/show reconciliation establishes the provider's current invoice state.
- Phase 11 adds a second app-owned invoice source: one server-selected batch of client-approved, not-yet-invoiced hourly entries under the current dual-accepted hourly agreement. The marketplace offer's accepted hourly rate is stored as an exact integer number of currency minor units per hour. The database calculates the billable amount as `round(rate_minor × approved_duration_seconds / 3600)` using exact PostgreSQL numeric arithmetic and positive half-up rounding, then stores only the resulting integer minor units. The API formats that integer into the currency's exact decimal text. A client cannot submit a rate, amount, duration total, or entry set to the invoice-claim RPC.
- Hourly invoice creation uses the existing Sandbox Invoicing REST operation and existing direct-fetch boundary; no APIMatic SDK operation is added. Its one line item is named from the project and server-derived work-date range, quantity `1`, and unit amount equal to the database-calculated approved-hour total. Existing sender-confirmation, Sandbox-only host, provider error, unknown-outcome search, and verified-webhook rules apply unchanged.
- The database commits a durable batch and PayPal operation claim before `POST /v2/invoicing/invoices`. Its deterministic operation key is derived from project ID, accepted hourly agreement version, and the sorted exact set of entry IDs. The transaction reserves those entries against a second active batch. A definitive provider refusal releases the reservation; connection loss keeps the batch and claim unknown and requires invoice-number search before any retry. A later, disjoint set of newly approved entries may be invoiced separately.
- `invoices.milestone_id` becomes nullable only for an invoice with a matching `hourly_batch_id`; fixed milestone invoices continue to require a milestone. The shared send claim and webhook state path recognize both invoice sources without merging hourly review state into PayPal invoice state.

## API contracts

All paths are relative to the sandbox host above. Credential acquisition and PayPal requests stay server-side. For invoice mutations, the local application claim and eligibility check happen before the provider call.

### 1. OAuth access token

| Item | Contract |
| --- | --- |
| Operation | `POST /v1/oauth2/token` |
| Authentication | HTTP Basic with sandbox client ID and secret. |
| Request | `Content-Type: application/x-www-form-urlencoded`; body `grant_type=client_credentials`. |
| Success | HTTP 200 JSON; use `access_token` as a bearer token and honor `expires_in` for the in-memory cache. Never persist or return the token to the browser. |
| Used by | Invoice create/send/search/show and webhook verification. |

### 2. Create draft invoice

| Item | Contract |
| --- | --- |
| Operation | `POST /v2/invoicing/invoices` |
| Authentication | `Authorization: Bearer <access_token>`; JSON body. PayPal documentation lists the invoice read/write scope for invoice management. |
| Request fields set | `detail.currency_code` (the accepted project currency); `detail.invoice_number` (a persisted app-generated correlation number, max 25 characters); `detail.invoice_date` (current date so the separately confirmed send is immediate); `primary_recipients[0].billing_info.email_address` (the client on the accepted project); and each `items[]` line's `name`, `quantity` (`"1"`), and `unit_amount.currency_code` / `unit_amount.value` (either an approved milestone amount or the database-calculated approved-hour batch amount, represented as exact decimal text). At least one `items` entry is included. |
| Request fields omitted | `invoicer` (allow the merchant account details to populate); `note`, `reference`, payment terms, taxes, discounts, tips, partial-payment settings, and other optional invoice settings (not required by the requested workflow; provider/account defaults apply). No manually calculated invoice total is sent. |
| Success | HTTP 201 JSON containing PayPal `id` and initial `status` (`DRAFT`); persist the ID, status, invoice number, response links needed by the app, and the local milestone/agreement version or immutable hourly-batch/agreement version. |
| Declared errors | HTTP 400, 401, 403, 422, 500, and default. Error bodies follow PayPal's standard `{ name, message, debug_id, details? }` shape. |

### 3. Send invoice

| Item | Contract |
| --- | --- |
| Operation | `POST /v2/invoicing/invoices/{invoice_id}/send` |
| Authentication | `Authorization: Bearer <access_token>`; JSON body. |
| Path | `invoice_id` is required and must come from an application-owned invoice row linked either to an eligible, client-approved milestone or to an immutable batch of client-approved hourly entries. |
| Request fields set | `send_to_recipient: true`, because the product workflow requires PayPal to send the invoice to the approved project client. |
| Request fields omitted | `subject` and `note` (PayPal says user values are not honored); `send_to_invoicer` (default false); `additional_recipients` (no extra recipients are required). |
| Success | HTTP 200 or 202 JSON. Persist provider status/result and timestamps. If the issue date is current or past, PayPal sends immediately; a future date schedules the invoice. PayPal documents that resending an invoice has no effect. |
| Declared errors | HTTP 400, 401, 403, 404, 422, 500, and default. Error bodies follow PayPal's standard error shape. |

### 4. Search invoices (create unknown-outcome reconciliation)

| Item | Contract |
| --- | --- |
| Operation | `POST /v2/invoicing/search-invoices?page={page}&page_size=100&total_required=true` |
| Authentication | `Authorization: Bearer <access_token>`; JSON body. |
| Request fields set | `invoice_number` equal to the value persisted in the create-operation claim. Paginate through every returned page; do not filter on status. |
| Optional query defaults | `page` defaults to 1 (range 1–1000); `page_size` defaults to 20 (range 1–100); `total_required` defaults false. Set all three as above so the reconciliation lookup is bounded and can inspect all matches. |
| Success | HTTP 200 JSON with `items[]` (invoice ID, status, and detail) and pagination metadata/links. Match the exact invoice number. |
| Declared errors | HTTP 400, 401, 403, 500, and default. Error bodies follow PayPal's standard error shape. |

### 5. Show invoice details

| Item | Contract |
| --- | --- |
| Operation | `GET /v2/invoicing/invoices/{invoice_id}` |
| Authentication | `Authorization: Bearer <access_token>`. |
| Path | Required PayPal invoice ID from the application-owned invoice row. |
| Request body | None. |
| Success | HTTP 200 JSON with current invoice details/status. Use this for refresh and send unknown-outcome reconciliation. |
| Declared errors | HTTP 400, 401, 403, 404, 500, and default. Error bodies follow PayPal's standard error shape. |

### 6. Verify incoming webhook signature

| Item | Contract |
| --- | --- |
| Operation | `POST /v1/notifications/verify-webhook-signature` |
| Authentication | `Authorization: Bearer <access_token>`; JSON body. |
| Required body fields | `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, and `transmission_time` copied from the corresponding PayPal transmission headers; `webhook_id` from `PAYPAL_WEBHOOK_ID`; `webhook_event` is the parsed incoming event. Preserve and parse the original request body only after capture. |
| Success | HTTP 200 JSON; process the event only when PayPal returns `verification_status: SUCCESS`. |
| Inbound events in scope | `INVOICING.INVOICE.CREATED`, `.SENT`, `.PAID`, `.CANCELLED`, `.REFUNDED`, `.UPDATED`, and `.SCHEDULED`; persist event IDs uniquely and apply state transitions only after successful verification. Reconcile against the current invoice record when events arrive out of order. |

Invoicing webhook events have a unique event ID, and resource.id is the PayPal invoice ID. PayPal documents at-least-once delivery. INVOICING.INVOICE.PAID can represent partial or pending payment, so a verified event triggers an authoritative invoice-detail read before persisted payment state is changed.

Persist the raw provider status separately from the internal status. Only provider `PAID` contributes to the app's paid totals. `MARKED_AS_PAID` and `PAID_EXTERNAL` map to `paid_external`; `MARKED_AS_REFUNDED` and `REFUNDED_EXTERNAL` map to `refunded_external`. Partial, pending, refunded, and unknown states never count as paid revenue. This keeps PayPal's manually/external-marked invoice states visible without presenting them as a confirmed PayPal payment.

## Error policy

For PayPal API responses, inspect status and the documented JSON error body. Return the provider's reason for caller-caused 4xx responses other than 401/403/429, without exposing tokens or internal diagnostics. Map 401/403 to a fixed 502 message that identifies sandbox credentials/permissions as the integration issue; map 429 to 503 with a fixed quota message; map provider 5xx to 502 with a fixed provider message. Include `debug_id` only in server logs. A read with no response returns a fixed 502. A create/send write with a connection failure or timeout is **unknown** until its reconciliation lookup succeeds; never report it as failed or encourage a duplicate action.

## Durable writes

### Duplicate claims

| Write | Claim store | Duplicate rejection | Catch point | Code location |
| --- | --- | --- | --- | --- |
| Create invoice | App-owned Supabase `paypal_operation_claims`, unique operation key derived from approved milestone + current accepted base agreement version + `create`. Commit claim before the PayPal request. Persist a cryptographically random, globally unique invoice number (5–25 chars) in the same claim. Accepted change-order amounts are not invoiceable until allocated into an explicitly approved milestone. | Service-role RPC locks the project/milestone and serializes existing invoice state; unique invoice-number and partial active-key indexes are the database backstops. There is no read-before-write or process-local lock. | The row-locked function returns the existing persisted invoice/claim state for concurrent attempts. On a definitive PayPal refusal, it marks the claim rejected so the partial unique key is released. | `supabase/migrations/202610290002_paypal_invoice_workflow.sql` (`begin_paypal_invoice_create`); `apps/api/src/app.ts` (`POST /api/invoices/milestones/:milestoneId/create`). |
| Create hourly invoice | Same app-owned claim store plus an immutable `hourly_invoice_batches` entry snapshot; unique deterministic key over project + accepted hourly agreement + sorted approved entry IDs. Commit the batch, reserve its entries, and create the app invoice before PayPal is called. | Service-role RPC locks the hourly contract/project and checks every selected entry is currently approved, unreserved, same project/agreement/currency; unique operation/invoice-number constraints and overlap checks are DB backstops. | Existing invoice-create route error handling/finalizer; a definitive refusal releases the entry reservation and rejects the claim, while a transport unknown preserves it. | New `begin_paypal_hourly_invoice_create` in the Phase 11 migration; `POST /api/invoices/hourly/projects/:projectId/create` in `apps/api/src/app.ts`. |
| Send invoice | Same app-owned store, unique operation key derived from application invoice ID + `send`. Commit before the PayPal request. | Service-role RPC locks the invoice and checks its persisted state; a partial unique active-key index is the database backstop. | The row-locked function returns the existing persisted send state for concurrent attempts. On a definitive PayPal refusal, it marks the claim rejected to release the active unique key. | `supabase/migrations/202610290002_paypal_invoice_workflow.sql` (`begin_paypal_invoice_send`); `apps/api/src/app.ts` (`POST /api/invoices/:invoiceId/send`). |

### Unknown outcomes

| Write | Re-read operation | Lookup reference | Code location | Connection-failure test |
| --- | --- | --- | --- | --- |
| Create invoice | Search invoices, following all pages | Persisted `detail.invoice_number` from the claim, via `POST /v2/invoicing/search-invoices` | `apps/api/src/app.ts` create route; `apps/api/src/paypal.ts` `findInvoices`. | `apps/api/test/paypal.test.ts`: create connection loss searches then remains unknown if absent; OAuth 401 before create makes no search and releases claim. |
| Create hourly invoice | Search invoices, following all pages | Persisted `detail.invoice_number` from the hourly batch claim, via the existing `POST /v2/invoicing/search-invoices` | Hourly create route reuses `apps/api/src/paypal.ts` `findInvoices` and existing invoice finalizer. | Phase 11 API test: connection loss searches by the committed batch invoice number; a missing result stays unknown and a pre-write OAuth error does not search. |
| Send invoice | Show invoice details | Known PayPal invoice ID via `GET /v2/invoicing/invoices/{invoice_id}` | `apps/api/src/app.ts` send/reconcile routes; `apps/api/src/paypal.ts` `showInvoice`. | `apps/api/test/paypal.test.ts`: send connection loss triggers show and saves SENT; OAuth 401 before send makes no show and releases claim. |

A missing search result or a failed re-read remains `unknown`; do not create/send again automatically. A found provider state is recorded and displayed. Never trust a client-provided invoice or milestone ID without confirming membership in the user's authorized project set before making the claim.

Provider snapshots obtained by a create/send response, a verified webhook reconciliation, or an explicit reconciliation read include a server-generated `provider_observed_at` timestamp. The database applies a snapshot only when its observation timestamp is not older than the last persisted provider snapshot. An unrecognized provider status is stored verbatim as `provider_status`, mapped internally to `unknown`, and remains eligible for reconciliation rather than completing an operation claim. This protects against delayed in-flight responses and keeps future provider states from getting stuck as completed-but-unknown.

## Cross-operation invariants

| Invariant | Legal set | Enforced before claim/provider write | Proof test |
| --- | --- | --- | --- |
| Invoice or billable-source IDs used to send, show, or reconcile | Rows in the full application-owned dataset visible to the authenticated project member; invoice must be linked to their project and either an approved milestone/version or an immutable approved hourly batch/version. | API authorization/domain service before claim insertion; database ownership/foreign-key constraints and RLS. | Out-of-project ID is rejected and provider call is not made. |
| A milestone eligible for invoice creation | Approved milestone from the current dual-accepted base agreement, not already invoiced. Accepted change-order deltas do not alter this invoice amount until separately represented by an approved billable milestone. | Service-role database function verifies actual freelancer membership, current agreement, both agreement acceptances, approved workflow state, and milestone amount before creating the claim. | Ineligible milestone is rejected and provider call is not made. |
| An hourly invoice eligible for creation | The server's complete selected batch of approved, not-yet-reserved entries on one active, dual-accepted hourly project agreement. Only the freelancer may initiate the invoice; the API accepts a project ID, never caller-supplied entry IDs/rate/amount. | Service-role RPC locks the project/contract, derives entry IDs, rate, currency, date range, and exact rounded minor-unit sum, then inserts the batch/claim and reserves the entries atomically before the provider call. | Shared/API tests reject clients and fixed contracts, verify the request has no amount/source-set fields, and ensure provider calls follow a committed claim. Live database invariant remains unverified. |
| Provider state update | State from an authenticated PayPal response or a webhook that passed PayPal signature verification and was followed by an authoritative invoice-detail read. | Server-only service-role RPC maps provider state and rejects snapshots older than the saved observation timestamp. | Tampered event state is ignored; delayed older snapshots cannot regress a newer saved snapshot. |

## Optional fields

| Write | Field | What requires it | Set? |
| --- | --- | --- | --- |
| Create invoice | `detail.invoice_number` | Create claim and create unknown-outcome reconciliation rows above. | Yes, stable value generated once and committed with the claim. |
| Create invoice | `detail.currency_code` | Accepted project and milestone amount. | Yes, from the agreement. |
| Create invoice | `detail.invoice_date` | User-confirmed immediate send flow; a future issue date would schedule delivery. | Yes, current date at invoice creation. |
| Create invoice | `primary_recipients[0].billing_info.email_address` | Task requires the invoice to be addressed to the project client. | Yes, from the accepted project member record. |
| Create invoice | `items[]` | PayPal requires invoice items; the approved milestone or approved hourly batch is the billable work. | Yes, include the milestone description/amount or the server-generated hourly work/date summary and exact approved-hours amount. |
| Create invoice | `invoicer` | Nothing in the initial flow; PayPal can auto-populate from the merchant account. | No. |
| Create invoice | `detail.note`, `detail.reference`, payment term, tax, discount, tip, and configuration fields | Nothing in the initial workflow. | No; omit and let PayPal/account defaults apply. |
| Send invoice | `send_to_recipient` | Explicit user-confirmed workflow requires the payer notification. | Yes, `true`. |
| Send invoice | `send_to_invoicer` | Nothing; default is false. | No. |
| Send invoice | `subject`, `note` | Nothing; PayPal documents these user-provided values are ignored. | No. |
| Send invoice | `additional_recipients` | No additional recipients are requested. | No. |
| Search invoices | `invoice_number` | Create unknown-outcome row above. | Yes, exact persisted correlation number. |
| Search invoices | `page`, `page_size`, `total_required` | Full reconciliation lookup and the documented pagination contract. | Yes: 1, 100, true; advance through all pages. |
| Show invoice | Request body | Nothing; endpoint is a GET. | No body. |

## API operation error response matrix

Apply the error policy above to create, send, search, show, and webhook verification. For each caller-data 4xx error, preserve PayPal's `message` and safe `details[].description`/`details[].issue` as the actionable response. Never send `debug_id`, raw provider body, secrets, or token material to the browser. `401`/`403`, `429`, 5xx, and no-response outcomes use their fixed mappings above. Webhook events are never processed if the verification response is not successful.

## Required reading

- **`typescript-error-handling` — loaded before implementation.** Its distinction between caller-caused provider errors, credentials, quota, transport failures, and unknown write outcomes is applied at the PayPal boundary.
- **`typescript-testing` — loaded before the first PayPal integration test file.** The PayPal integration is direct REST `fetch`, not the generated SDK; tests use the injected fetch boundary and are not evidence of a live Sandbox transaction.
- The remaining `typescript-*` SDK usage skills are not named for this implementation because the generated SDK has no invoice operation and no `PaypalClient` is constructed. If implementation scope changes to generated SDK calls, stop and load the required client-initialization, authentication, endpoint-calling, models, resilience, and testing skills before writing those calls.

## Verification limits and open external configuration

- Read-only PayPal smoke calls cannot run: sandbox client ID/secret and webhook ID are absent. Do not send sample or guessed credentials.
- Real invoice creation/sending, signature verification, and sandbox payment lifecycle remain blocked until the owner configures a PayPal business sandbox app with Invoicing enabled, a reachable HTTPS webhook, and its registered webhook ID.
- SDK map is resolved and read; the direct REST contract was checked against the official PayPal Invoicing v2 create, send, search, and show references; Invoicing webhook guide; REST webhook verification guide; OAuth quickstart; and standard API error response guide. No invoice SDK operation lookup remains open.
