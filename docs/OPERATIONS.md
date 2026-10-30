# Operations and deployment runbook

This runbook describes the local implementation and the steps still required before a hosted pilot. No Supabase project or Render service has been configured from this workspace. The migration files have not been executed or parsed by PostgreSQL.

## Runtime and secrets

- The project baseline is Node.js `26.13.0` and npm `11.20.0`. `render.yaml` pins Node `26.13.0` for both services.
- Copy `.env.example` to a private root `.env` for local development. Fill only credentials for services that have been created. `.env` is ignored by Git; `.env.example` contains placeholders.
- The browser receives only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_API_URL`. Supabase service-role, OpenAI, and PayPal Sandbox credentials belong only in the API service environment. Never add provider secrets to `VITE_*` variables, browser storage, issue reports, screenshots, or Postman exports.
- Configure a unique `APP_ORIGIN` for the deployed browser origin. The API uses a fixed CORS origin and does not reflect an arbitrary request origin.
- Give administrator access only through a trusted operator's database process. The app does not allow self-assignment of the `admin` role. The role check and admin moderation RPCs still require database verification.

## Health, status, and logs

- `GET /health` returns process health only; it does not verify Supabase, AI, PayPal, or database migrations.
- `GET /api/status` reports server-side integration configuration booleans. A configured value does not prove the provider is reachable or authorized.
- API responses set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, `X-Permitted-Cross-Domain-Policies: none`, and `Cache-Control: no-store`.
- Fastify uses `x-request-id`, a 1 MiB request-body limit, and redacts authorization and cookie headers from request logs. Preserve request IDs when reporting failures; never attach tokens, full webhook bodies, or private project content to routine logs.
- The current code does not ship metrics, alert delivery, an error-tracking service, or a deployed uptime monitor. Configure and verify these in the chosen hosting/monitoring accounts before inviting users.

## Database changes and recovery

1. Create a non-production Supabase project and configure its URL and keys in a private local environment.
2. Review the seven SQL files listed in `supabase/README.md` in timestamp order. Take and verify a restorable backup before applying changes to a populated project.
3. Apply migrations manually in the non-production project. Check that each statement completes, then test row-level security, role boundaries, RPC transactions, storage policies, and realtime subscriptions with separate client and freelancer accounts.
4. In particular, verify admin-only moderation, report projections, listing holds, account-deletion request ownership, and append-only moderation audit behavior from `202610300005_commercial_hardening.sql`.
5. Before production, document the exact project, migration version, backup point, operator, and recovery procedure. Do not assume these forward migrations are safe to roll back after data has been written. Prefer a reviewed forward-fix; restore only under an owner-approved recovery plan.

No database backup, restore, migration application, or rollback has been run here. The current tracker records PostgreSQL/Supabase verification as outstanding.

## Account requests and moderation

- An account-deletion request records intent for manual review. It does not disable sign-in, delete the account, remove project or invoice rows, or erase provider records.
- Before an operator takes any separate deletion/deactivation action, define retention and legal requirements, resolve active contracts/disputes, preserve required financial/audit records, identify dependent data, and obtain appropriate owner approval. The current product has no automated retention or deletion worker.
- Users may cancel a request while it is still in `requested`. An administrator may move it to `under_review` or mark it `declined`; neither decision performs erasure.
- Job and conversation report decisions are checked by the database role and written to `moderation_actions`. Reported message excerpts are private queue data. Treat them as sensitive; do not copy them into public tickets or logs.
- Listing holds hide a listing from ordinary marketplace visibility while preserving it for its owner and authorized administrators. Verify this behavior against actual RLS and marketplace views before production use.

## PayPal Sandbox incident handling

- Keep PayPal configured to Sandbox. Live-money hosts and credentials are out of scope.
- The app commits an invoice operation claim before create/send calls. If a create/send write loses its connection or times out, treat the result as unknown. Do not retry the write or tell the user it failed until an operator or supported reconciliation path checks PayPal.
- For create unknowns, search Sandbox invoices by the persisted invoice number and inspect every result page. For send unknowns, fetch the known provider invoice. If lookup fails or finds no result, leave the operation unknown and investigate; do not create a second invoice.
- Webhook signatures must verify before an event is processed. Event IDs are deduplicated, and payment state is reconciled against the provider invoice rather than trusted from the event body. Only provider-confirmed `PAID` contributes to paid totals.
- Preserve the correlation invoice number, app invoice ID, PayPal request ID/debug ID where safely available, and `x-request-id` for an incident. Keep secrets and raw authorization headers out of incident notes.
- No real Sandbox invoice, webhook, payment, or unknown-outcome recovery has been exercised in this environment. Credentials, a registered webhook, a public HTTPS endpoint, and an applied database migration are still needed.

## Hosting checklist

`render.yaml` is a deployment blueprint, not a deployed system. Before deploying:

1. Apply and verify migrations on non-production Supabase, then provision a separate production project and tested backups.
2. Create and configure the API service with server-only keys and the exact browser `APP_ORIGIN`; configure only public Supabase settings and the API URL for the static web build.
3. Configure a PayPal business Sandbox app with Invoicing permissions and a registered HTTPS webhook. Set the webhook ID only on the API service.
4. Validate Render build/start commands and `/health`; verify browser CORS, Auth redirects, integration configuration status, secret separation, and server logs.
5. Run authenticated client/freelancer/admin acceptance workflows in Sandbox, including dual agreement approval, moderation authorization, deletion request review, hourly entry approvals, invoice reconciliation, verified/duplicate/out-of-order webhooks, and recovery from a failed deployment.
6. Set up owner-controlled monitoring, alert routing, backups, incident contacts, and rollback/recovery instructions. Record evidence in `docs/IMPLEMENTATION_PROGRESS.md` before marking hosted checks complete.

The Render Blueprint has not been validated in a Render account, and no service has been deployed.
