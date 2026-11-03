# Proposal portfolio projection design

Status: design only. No API route, schema, migration, database, or provider change has been made.
Date: 2026-11-03

## Goal and current boundary

A client who owns a job should be able to open the portfolio items a freelancer explicitly attached to that exact proposal. The current proposal API returns the proposal's `portfolioItemIds`, but it does not return portfolio titles or URLs. The current UI therefore shows the reference count and explains that titles and links are unavailable.

In the current Marketplace schema, `marketplace_proposals.portfolio_item_ids` is a UUID array. `freelancer_portfolio_items` stores each item's title, description, project URL, image URL, featured flag, and owner ID. RLS currently permits a freelancer to read only their own portfolio rows. A public profile view may expose all portfolio rows for an opted-in public profile; that is broader than proposal sharing and should not be used as the authorization source for this feature.

## Proposed API

`GET /api/jobs/:jobId/proposals/:proposalId/portfolio-items`

Require the existing bearer-authenticated API context. Return only a small projection:

```json
{
  "portfolioItems": [
    {
      "id": "<attached item UUID>",
      "title": "Selected work",
      "description": "Short portfolio description",
      "projectUrl": "https://example.invalid/project",
      "imageUrl": "https://example.invalid/image.jpg",
      "featured": false
    }
  ],
  "unavailableReferenceCount": 0
}
```

The array is limited to IDs currently present in that proposal's attachment array and owned by the proposal's freelancer. Keep the attachment order. Do not return the freelancer's other portfolio rows, profile fields, email, account UUID, private profile data, raw storage paths, or proposal data already available elsewhere. The API should send `Cache-Control: private, no-store`.

A valid, authorized proposal with no attached items returns `200` with an empty array and a zero unavailable count. A reference that was deleted after submission is omitted and counted as unavailable, so the UI can explain that some attached work is no longer available without inventing content. Invalid IDs, an unauthorized owner, a cross-job proposal, and an ineligible proposal should use the same generic not-found response to avoid confirming private record existence.

## Authorization and exact-ID enforcement

1. Authenticate the request and validate both route IDs as UUIDs. Do not accept a caller-supplied owner, freelancer, or role identifier.
2. In the database projection, derive the actor from `auth.uid()` and require the `client` role.
3. Require `marketplace_jobs.id = :jobId` and `marketplace_jobs.created_by = auth.uid()` for the same job. A job UUID alone never proves ownership.
4. Require the proposal row to match both `id = :proposalId` and `job_id = :jobId`; require its freelancer to be the owner of every returned item. Exclude draft proposals; the applicant has not submitted those references yet. Keep submitted and later proposal states attached to the same job's authorized review record.
5. Expand only that proposal's `portfolio_item_ids` with ordinality, then join by item ID and `freelancer_portfolio_items.user_id = marketplace_proposals.freelancer_id`. Never query the freelancer's full portfolio as a fallback. This intersection enforces the exact attachment list even if a stale or foreign ID appears in the array.
6. Return only the explicit column allowlist in the response. Do not rely on the public-profile opt-in view to grant access, and do not add a policy that makes all freelancer portfolio rows readable by clients.

The existing portfolio table's self-only RLS means a direct client-side table query will not work. Prefer a narrow, actor-bound `SECURITY DEFINER` RPC called through the authenticated user's Supabase client. Fix the function `search_path` to trusted schemas, use static SQL, derive identity only from `auth.uid()`, revoke execution from `PUBLIC` and `anon`, and grant it to `authenticated`. Do not call the RPC with the service-role client or use a client-provided user ID as proof of access. The API remains responsible for route validation and safe generic denial mapping.

## Links and storage

Current portfolio URL columns are nullable HTTPS URLs, not Supabase Storage object paths. Return those exact URLs; no signed URL is required for the current schema. Render external links with safe new-tab attributes when applicable, and do not fetch or proxy arbitrary URLs from the API server.

If portfolio media later moves to a private Storage bucket, store an object path rather than a long-lived public URL. After the same job/proposal/exact-ID authorization succeeds, mint a short-lived signed URL for only the attached object's path. Never sign arbitrary client-provided paths or sign all objects for a freelancer. Keep the authorization and signing action on the server.

## Focused verification plan for a later implementation phase

- Authorized client owner can read titles and links for the exact attached IDs on their own job.
- Another client, a freelancer who is not the proposal owner, and a client without the job-owner role receive the same generic denial.
- A proposal UUID paired with a different job UUID is denied.
- Draft proposals are denied; submitted and subsequent review states use the documented policy.
- Unattached portfolio IDs and IDs belonging to another freelancer never appear, even if added to the proposal UUID array in a malformed fixture.
- Deleted or replaced portfolio items are omitted and reported only as unavailable references; an empty attachment list returns an empty projection.
- Response schema allows only the stated fields and does not leak account identifiers, private profile fields, or storage paths; response is not cacheable by shared caches.
- Test RPC execution grants, fixed `search_path`, RLS behavior, and `auth.uid()` binding against a disposable local/non-production PostgreSQL instance, in addition to API route tests.

## Coordination and merge notes

This Marketplace branch is based on the October 30 checkpoint. No Codex 1 source was read or synchronized during this phase. Before implementation, compare the then-current API route registration, proposal view and ownership helper, portfolio RLS, and active migration sequence against Codex 1's checkpoint. Likely conflict surfaces are `apps/api/src/app.ts`, the marketplace SQL migration/policy area, and `docs/IMPLEMENTATION_PROGRESS.md`. Keep this feature in a new, separately reviewed migration and avoid changing proposal, PayPal, webhook, or AI workflows.