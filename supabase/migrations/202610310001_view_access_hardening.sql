begin;

do $migration_guard$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'ProofPay view access hardening requires PostgreSQL 15 or newer for security_invoker views';
  end if;
end
$migration_guard$;

-- This narrowly scoped definer helper returns only a project participant's display name.
-- Both the caller and target must be members of the same project.
create or replace function public.project_participant_display_name(p_project_id uuid,p_user_id uuid)
returns text
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select profile.display_name
  from public.project_members target_member
  join public.profiles profile on profile.id=target_member.user_id
  where p_project_id is not null
    and p_user_id is not null
    and auth.uid() is not null
    and public.is_project_member(p_project_id)
    and target_member.project_id=p_project_id
    and target_member.user_id=p_user_id;
$$;

revoke all on function public.project_participant_display_name(uuid,uuid) from public,anon,authenticated;
grant execute on function public.project_participant_display_name(uuid,uuid) to authenticated;

-- Rebuild these projections to use the constrained profile helper before enabling invoker rights.
create or replace view public.project_conversations_for_user with (security_barrier=true) as
select c.id,c.project_id,p.title as project_title,c.created_at,c.last_message_at,
  (select member.role from public.project_members member where member.project_id=c.project_id and member.user_id=auth.uid()) as participant_role,
  coalesce((select public.project_participant_display_name(c.project_id,other.user_id)
    from public.project_members other
    where other.project_id=c.project_id and other.user_id<>auth.uid()
    order by other.user_id limit 1),'Project participant') as other_display_name,
  coalesce((select left(m.body,180) from public.project_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),'') as last_message_preview,
  (select count(*)::integer from public.project_messages m
    where m.conversation_id=c.id and m.sender_id<>auth.uid()
      and not exists(select 1 from public.project_message_receipts receipt where receipt.message_id=m.id and receipt.user_id=auth.uid())) as unread_count,
  exists(select 1 from public.project_members actor join public.project_members other on other.project_id=actor.project_id and other.user_id<>actor.user_id
    join public.user_blocks block_row on block_row.blocker_id=auth.uid() and block_row.blocked_id=other.user_id
    where actor.project_id=c.project_id and actor.user_id=auth.uid()) as blocked_by_me,
  exists(select 1 from public.project_members actor join public.project_members other on other.project_id=actor.project_id and other.user_id<>actor.user_id
    join public.user_blocks block_row on block_row.blocker_id=other.user_id and block_row.blocked_id=auth.uid()
    where actor.project_id=c.project_id and actor.user_id=auth.uid()) as blocked_by_other
from public.project_conversations c
join public.projects p on p.id=c.project_id
where public.is_project_member(c.project_id);

create or replace view public.project_messages_for_user with (security_barrier=true) as
select m.id,m.conversation_id,m.body,m.attachments,m.created_at,
  (m.sender_id=auth.uid()) as is_mine,
  coalesce(public.project_participant_display_name(c.project_id,m.sender_id),'Project participant') as sender_display_name,
  exists(select 1 from public.project_message_receipts receipt where receipt.message_id=m.id and receipt.user_id<>m.sender_id) as read_by_other
from public.project_messages m
join public.project_conversations c on c.id=m.conversation_id
where public.is_project_member(c.project_id);

create or replace view public.user_notifications_for_user with (security_barrier=true) as
select notification.id,notification.conversation_id,c.project_id,p.title as project_title,
  coalesce(public.project_participant_display_name(c.project_id,notification.actor_id),'Project participant') as actor_display_name,
  left(msg.body,180) as message_preview,notification.created_at,notification.read_at,
  (notification.read_at is null) as is_unread
from public.user_notifications notification
join public.project_conversations c on c.id=notification.conversation_id
join public.projects p on p.id=c.project_id
join public.project_messages msg on msg.id=notification.message_id
where notification.user_id=auth.uid()
  and public.is_project_member(c.project_id);

-- Keep the invoice candidate projection tied to the authenticated freelancer's own active,
-- currently accepted hourly agreement. Do not grant callers the broader definer helper.
create or replace view public.hourly_invoice_candidates_for_user with (security_barrier=true) as
select project_row.id as project_id,project_row.title as project_title,project_row.client_name,contract_row.hourly_rate_minor,contract_row.currency,
  sum(entry.duration_seconds)::bigint as approved_seconds,
  round(contract_row.hourly_rate_minor::numeric*sum(entry.duration_seconds)::numeric/3600)::bigint as amount_minor,
  min(entry.work_date) as work_date_start,max(entry.work_date) as work_date_end,count(*)::integer as entry_count
from public.hourly_contracts contract_row
join public.projects project_row on project_row.id=contract_row.project_id
join public.hourly_time_entries entry on entry.project_id=contract_row.project_id
  and entry.agreement_version_id=contract_row.agreement_version_id and entry.status='approved'
where contract_row.freelancer_id=auth.uid()
  and contract_row.status='active'
  and project_row.contract_type='hourly'
  and project_row.current_agreement_version_id=contract_row.agreement_version_id
  and public.is_project_member(project_row.id)
  and exists (
    select 1 from public.agreement_versions agreement_row
    where agreement_row.id=contract_row.agreement_version_id
      and agreement_row.project_id=project_row.id
      and agreement_row.state='accepted'
      and (select count(distinct accepted.member_role)
        from public.agreement_acceptances accepted
        where accepted.agreement_version_id=agreement_row.id)=2
  )
  and not exists (
    select 1 from public.hourly_invoice_batch_entries link_row
    join public.hourly_invoice_batches batch_row on batch_row.id=link_row.batch_id and batch_row.released_at is null
    where link_row.entry_id=entry.id
  )
group by project_row.id,project_row.title,project_row.client_name,contract_row.hourly_rate_minor,contract_row.currency
having round(contract_row.hourly_rate_minor::numeric*sum(entry.duration_seconds)::numeric/3600)>0;

-- Switch every authenticated-only view to caller privileges so the base-table RLS policies apply.
alter view public.marketplace_jobs_for_user set (security_invoker=true);
alter view public.marketplace_proposals_for_user set (security_invoker=true);
alter view public.marketplace_offers_for_user set (security_invoker=true);
alter view public.service_hiring_requests_for_user set (security_invoker=true);
alter view public.project_conversations_for_user set (security_invoker=true);
alter view public.project_messages_for_user set (security_invoker=true);
alter view public.user_notifications_for_user set (security_invoker=true);
alter view public.hourly_contracts_for_user set (security_invoker=true);
alter view public.hourly_time_entries_for_user set (security_invoker=true);
alter view public.hourly_timer_sessions_for_user set (security_invoker=true);
alter view public.hourly_invoice_candidates_for_user set (security_invoker=true);

-- The two deliberately public marketplace projections remain security-barrier owner views.
alter view public.public_freelancer_profiles set (security_invoker=false);
alter view public.public_freelancer_services set (security_invoker=false);

-- Grant only the source columns needed by these invoker views; the existing table RLS policies
-- continue to decide which rows each authenticated caller can see.
grant select (
  id,created_by,title,summary,description,requirements,skills,category,experience_level,project_type,
  fixed_budget_minor,hourly_rate_min_minor,hourly_rate_max_minor,currency,estimated_days,status,
  published_at,created_at,updated_at
) on public.marketplace_jobs to authenticated;
grant select (
  id,job_id,freelancer_id,cover_letter,quote_minor,currency,timeline_days,portfolio_item_ids,status,created_at,updated_at
) on public.marketplace_proposals to authenticated;
grant select (
  id,proposal_id,job_id,freelancer_id,client_id,terms,amount_minor,currency,timeline_days,status,project_id,created_at,responded_at
) on public.marketplace_offers to authenticated;
grant select (
  id,service_id,client_id,freelancer_id,request_text,budget_minor,currency,status,created_at,responded_at
) on public.service_hiring_requests to authenticated;

grant select (project_id,freelancer_id,hourly_rate_minor,currency,status,agreement_version_id)
  on public.hourly_contracts to authenticated;
grant select (
  id,project_id,agreement_version_id,freelancer_id,work_date,duration_seconds,description,source,status,created_at,submitted_at
) on public.hourly_time_entries to authenticated;
grant select (entry_id,decision,details,created_at) on public.hourly_time_entry_reviews to authenticated;
grant select (id,project_id,freelancer_id,description,state,started_at,running_since,accumulated_seconds,stopped_at)
  on public.hourly_timer_sessions to authenticated;
grant select (id,project_id,released_at) on public.hourly_invoice_batches to authenticated;
grant select (batch_id,entry_id) on public.hourly_invoice_batch_entries to authenticated;

grant select (id,project_id,created_at,last_message_at) on public.project_conversations to authenticated;
grant select (message_id,user_id) on public.project_message_receipts to authenticated;
grant select (id,conversation_id,message_id,user_id,actor_id,created_at,read_at) on public.user_notifications to authenticated;
grant select (blocker_id,blocked_id) on public.user_blocks to authenticated;

create policy user_blocks_read_involved on public.user_blocks for select to authenticated
  using (blocker_id=auth.uid() or blocked_id=auth.uid());

-- Authenticated participants may see block state only for relationships involving themselves.
revoke all on public.marketplace_jobs_for_user,public.marketplace_proposals_for_user,
  public.marketplace_offers_for_user,public.service_hiring_requests_for_user,
  public.project_conversations_for_user,public.project_messages_for_user,public.user_notifications_for_user,
  public.hourly_contracts_for_user,public.hourly_time_entries_for_user,public.hourly_timer_sessions_for_user,
  public.hourly_invoice_candidates_for_user from public,anon,authenticated;
grant select on public.marketplace_jobs_for_user,public.marketplace_proposals_for_user,
  public.marketplace_offers_for_user,public.service_hiring_requests_for_user,
  public.project_conversations_for_user,public.project_messages_for_user,public.user_notifications_for_user,
  public.hourly_contracts_for_user,public.hourly_time_entries_for_user,public.hourly_timer_sessions_for_user,
  public.hourly_invoice_candidates_for_user to authenticated;

revoke all on public.public_freelancer_profiles,public.public_freelancer_services from public,anon,authenticated;
grant select on public.public_freelancer_profiles,public.public_freelancer_services to anon,authenticated;

commit;
