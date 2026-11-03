begin;

-- The invoker-rights hourly time-entry view orders review history by id as a tie-breaker.
-- Grant that one additional column; the existing project-member RLS policy still filters rows.
grant select (id) on public.hourly_time_entry_reviews to authenticated;

commit;
