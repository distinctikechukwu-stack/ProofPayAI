begin;

-- The deferred agreement invariant trigger runs with the authenticated caller's
-- privileges. The trigger already reads these columns from hourly_contracts;
-- the existing column grants omitted client_id. RLS still limits rows to the
-- caller's project memberships.
grant select (client_id) on public.hourly_contracts to authenticated;

commit;
