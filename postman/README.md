# Postman collection

Import `ProofPayAI.postman_collection.json` and create a private Postman environment with `apiBase`, a Supabase user `accessToken`, and record IDs as requests return them. Keep access tokens, Supabase service-role values, OpenAI keys, and PayPal credentials out of the exported collection and source control.

The v2.1 collection covers health/status, project, agreement, milestone, deliverable/review, AI, scope/change-order, timeline/analytics, project conversations/messages, read receipts, notifications, blocking, and PayPal invoice list/create/send/reconcile routes. Private attachments are uploaded through the authenticated Supabase Storage client and are not represented as Postman JSON uploads. Database, AI, and PayPal requests need the corresponding local configuration and applied Supabase migrations. Postman CLI was unavailable during setup, so the collection is JSON-validated but has not been sent against a live API.
