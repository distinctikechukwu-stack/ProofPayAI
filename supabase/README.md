# Supabase setup

Create a non-production Supabase project and set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in the private root `.env` file. Only the public URL and anon key are used by the browser.

Apply these migrations in timestamp order after reviewing them:

1. `migrations/202610290001_core_project_security.sql`
2. `migrations/202610290002_paypal_invoice_workflow.sql`
3. `migrations/202610300001_marketplace_profiles.sql`
4. `migrations/202610300002_marketplace_jobs.sql`
5. `migrations/202610300003_messaging_notifications.sql`
6. `migrations/202610300004_hourly_workflows.sql`
7. `migrations/202610300005_commercial_hardening.sql`

No migration has been applied or parsed by a live PostgreSQL/Supabase instance in this workspace. Supabase CLI, Docker, and `psql` are unavailable by command name. API fakes do not prove SQL, RLS, transaction, trigger, storage, or realtime behavior. After applying to a test project, verify freelancer/client isolation, public profile/service opt-in projections, role assignment restrictions, job ownership, proposal uniqueness, offer idempotency and draft-contract transaction, milestone acceptance gating, package validation, participant-only conversation reads/writes, storage paths/size/MIME rules, read receipts, notification ownership, blocks, report privacy and moderation authorization, deletion request isolation, approval transitions, hourly-offer backfill, timer transitions, timesheet resubmission history, approved-hour invoice claims, durable PayPal claims, deduplication, and refresh persistence before using the app.

See [`migrations/README.md`](migrations/README.md) and [`seed/README.md`](seed/README.md). The current `$600` project exists only as labeled frontend preview data; no seed creates real project or payment records.
