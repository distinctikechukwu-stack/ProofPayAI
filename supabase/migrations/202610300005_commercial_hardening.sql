begin;

alter table public.marketplace_jobs
  add column moderation_hold boolean not null default false,
  add column moderation_hold_at timestamptz;

alter table public.marketplace_job_reports
  add column decision text check (decision is null or decision in ('hide_listing','restore_listing','no_action','escalate')),
  add column reviewed_by uuid references public.profiles(id) on delete restrict,
  add column reviewed_at timestamptz,
  add column resolution_note text not null default '' check (char_length(resolution_note)<=2000),
  add constraint marketplace_job_report_review_shape check (
    (status='pending' and reviewed_by is null and reviewed_at is null and decision is null)
    or (status in ('reviewed','dismissed','actioned') and (
      (reviewed_by is null and reviewed_at is null and decision is null)
      or (reviewed_by is not null and reviewed_at is not null and decision is not null)
    ))
  );

alter table public.conversation_abuse_reports
  add column status text not null default 'pending' check (status in ('pending','reviewed')),
  add column decision text check (decision is null or decision in ('no_action','escalate')),
  add column reviewed_by uuid references public.profiles(id) on delete restrict,
  add column reviewed_at timestamptz,
  add column resolution_note text not null default '' check (char_length(resolution_note)<=2000),
  add constraint conversation_report_review_shape check ((status='pending' and reviewed_by is null and reviewed_at is null and decision is null)
    or (status='reviewed' and reviewed_by is not null and reviewed_at is not null and decision is not null));

create index marketplace_job_reports_status_created_idx on public.marketplace_job_reports(status,created_at desc);
create index conversation_reports_status_created_idx on public.conversation_abuse_reports(status,created_at desc);

create table public.moderation_actions (
  id uuid primary key default extensions.gen_random_uuid(),
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (target_type in ('marketplace_job_report','conversation_abuse_report','account_deletion_request')),
  target_id uuid not null,
  action text not null check (action in ('hide_listing','restore_listing','no_action','escalate','begin_deletion_review','decline_deletion_request')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);
create index moderation_actions_target_created_idx on public.moderation_actions(target_type,target_id,created_at desc);
alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from public,anon,authenticated;

create table public.account_deletion_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'requested' check (status in ('requested','under_review','cancelled','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  resolution_note text not null default '' check (char_length(resolution_note)<=2000),
  check ((status in ('under_review','declined'))=(reviewed_by is not null and reviewed_at is not null))
);
create unique index account_deletion_one_open_request_idx on public.account_deletion_requests(user_id) where status in ('requested','under_review');
create index account_deletion_requests_status_created_idx on public.account_deletion_requests(status,created_at desc);
alter table public.account_deletion_requests enable row level security;
create policy account_deletion_requests_read_owner on public.account_deletion_requests for select to authenticated using(user_id=auth.uid());
revoke all on public.account_deletion_requests from public,anon,authenticated;
grant select(id,user_id,status,created_at,updated_at,reviewed_at,resolution_note) on public.account_deletion_requests to authenticated;

create or replace function public.can_view_marketplace_job(p_job_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $$
  select exists(
    select 1 from public.marketplace_jobs job
    where job.id=p_job_id and (
      job.created_by=auth.uid() or public.has_marketplace_admin_role()
      or (not job.moderation_hold and (job.status='published'
        or exists(select 1 from public.marketplace_proposals proposal where proposal.job_id=job.id and proposal.freelancer_id=auth.uid())))
    )
  );
$$;

create or replace function public.moderation_queue_for_admin()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare jobs jsonb; conversations jsonb; deletion_requests jsonb;
begin
  if auth.uid() is null or not public.has_marketplace_admin_role() then
    raise exception 'Marketplace administrator access is required.' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',report.id,'jobTitle',job.title,'reason',report.reason,'details',report.details,'status',report.status,
    'decision',report.decision,'resolutionNote',report.resolution_note,'createdAt',report.created_at,'reviewedAt',report.reviewed_at,
    'moderationHold',job.moderation_hold
  ) order by report.created_at desc),'[]'::jsonb) into jobs
  from (select * from public.marketplace_job_reports order by created_at desc limit 100) report
  join public.marketplace_jobs job on job.id=report.job_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',report.id,'projectTitle',project_row.title,'reason',report.reason,'details',report.details,
    'reportedMessage',left(coalesce(message.body,''),2000),'status',report.status,'decision',report.decision,
    'resolutionNote',report.resolution_note,'createdAt',report.created_at,'reviewedAt',report.reviewed_at
  ) order by report.created_at desc),'[]'::jsonb) into conversations
  from (select * from public.conversation_abuse_reports order by created_at desc limit 100) report
  join public.project_conversations conversation on conversation.id=report.conversation_id
  join public.projects project_row on project_row.id=conversation.project_id
  left join public.project_messages message on message.id=report.message_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',request.id,'displayName',coalesce(profile.display_name,'Account'),'status',request.status,
    'createdAt',request.created_at,'reviewedAt',request.reviewed_at,'resolutionNote',request.resolution_note
  ) order by request.created_at desc),'[]'::jsonb) into deletion_requests
  from (select * from public.account_deletion_requests where status in ('requested','under_review') order by created_at desc limit 100) request
  left join public.profiles profile on profile.id=request.user_id;
  return jsonb_build_object('jobReports',jobs,'conversationReports',conversations,'deletionRequests',deletion_requests);
end;
$$;

create or replace function public.review_marketplace_job_report(p_report_id uuid,p_decision text,p_note text default '')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); report_row public.marketplace_job_reports%rowtype; note_value text:=trim(coalesce(p_note,'')); hold_value boolean;
begin
  if actor_id is null or not public.has_marketplace_admin_role() then raise exception 'Marketplace administrator access is required.' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('hide_listing','restore_listing','no_action','escalate') or char_length(note_value)>2000 then
    raise exception 'Choose a valid listing-review decision and a short note.' using errcode='22023';
  end if;
  select * into report_row from public.marketplace_job_reports where id=p_report_id for update;
  if not found or report_row.status<>'pending' then raise exception 'This report is already reviewed or unavailable.' using errcode='55000'; end if;
  if p_decision in ('hide_listing','restore_listing') then
    update public.marketplace_jobs set moderation_hold=(p_decision='hide_listing'),
      moderation_hold_at=case when p_decision='hide_listing' then now() else null end where id=report_row.job_id;
  end if;
  update public.marketplace_job_reports set status='reviewed',decision=p_decision,reviewed_by=actor_id,reviewed_at=now(),resolution_note=note_value
    where id=report_row.id;
  insert into public.moderation_actions(moderator_id,target_type,target_id,action,details)
    values(actor_id,'marketplace_job_report',report_row.id,p_decision,jsonb_build_object('jobId',report_row.job_id,'note',note_value));
  select moderation_hold into hold_value from public.marketplace_jobs where id=report_row.job_id;
  return jsonb_build_object('reportId',report_row.id,'status','reviewed','decision',p_decision,'moderationHold',hold_value);
end;
$$;

create or replace function public.review_conversation_abuse_report(p_report_id uuid,p_decision text,p_note text default '')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); report_row public.conversation_abuse_reports%rowtype; note_value text:=trim(coalesce(p_note,''));
begin
  if actor_id is null or not public.has_marketplace_admin_role() then raise exception 'Marketplace administrator access is required.' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('no_action','escalate') or char_length(note_value)>2000 then
    raise exception 'Choose a valid report decision and a short note.' using errcode='22023';
  end if;
  select * into report_row from public.conversation_abuse_reports where id=p_report_id for update;
  if not found or report_row.status<>'pending' then raise exception 'This report is already reviewed or unavailable.' using errcode='55000'; end if;
  update public.conversation_abuse_reports set status='reviewed',decision=p_decision,reviewed_by=actor_id,reviewed_at=now(),resolution_note=note_value
    where id=report_row.id;
  insert into public.moderation_actions(moderator_id,target_type,target_id,action,details)
    values(actor_id,'conversation_abuse_report',report_row.id,p_decision,jsonb_build_object('note',note_value));
  return jsonb_build_object('reportId',report_row.id,'status','reviewed','decision',p_decision);
end;
$$;

create or replace function public.request_account_deletion(p_confirmation text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare actor_id uuid:=auth.uid(); request_row public.account_deletion_requests%rowtype;
begin
  if actor_id is null then raise exception 'Authentication is required.' using errcode='28000'; end if;
  if p_confirmation is distinct from 'REQUEST DELETION' then raise exception 'Type REQUEST DELETION to confirm the request.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text,17));
  select * into request_row from public.account_deletion_requests where user_id=actor_id and status in ('requested','under_review') for update;
  if found then return jsonb_build_object('requestId',request_row.id,'status',request_row.status,'alreadyRequested',true); end if;
  insert into public.account_deletion_requests(user_id) values(actor_id) returning * into request_row;
  return jsonb_build_object('requestId',request_row.id,'status',request_row.status,'alreadyRequested',false);
end;
$$;

create or replace function public.cancel_account_deletion_request()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); request_id uuid;
begin
  if actor_id is null then raise exception 'Authentication is required.' using errcode='28000'; end if;
  update public.account_deletion_requests set status='cancelled',updated_at=now()
    where user_id=actor_id and status='requested' returning id into request_id;
  if request_id is null then raise exception 'No pending deletion request can be cancelled.' using errcode='55000'; end if;
  return jsonb_build_object('requestId',request_id,'status','cancelled');
end;
$$;

create or replace function public.review_account_deletion_request(p_request_id uuid,p_decision text,p_note text default '')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); request_row public.account_deletion_requests%rowtype; note_value text:=trim(coalesce(p_note,''));
begin
  if actor_id is null or not public.has_marketplace_admin_role() then raise exception 'Marketplace administrator access is required.' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('under_review','declined') or char_length(note_value)>2000 then raise exception 'Choose a valid deletion-request review status.' using errcode='22023'; end if;
  select * into request_row from public.account_deletion_requests where id=p_request_id for update;
  if not found or request_row.status not in ('requested','under_review') then raise exception 'This account request is unavailable.' using errcode='55000'; end if;
  update public.account_deletion_requests set status=p_decision,updated_at=now(),reviewed_by=actor_id,reviewed_at=now(),resolution_note=note_value where id=request_row.id;
  insert into public.moderation_actions(moderator_id,target_type,target_id,action,details)
    values(actor_id,'account_deletion_request',request_row.id,case when p_decision='under_review' then 'begin_deletion_review' else 'decline_deletion_request' end,jsonb_build_object('note',note_value));
  return jsonb_build_object('requestId',request_row.id,'status',p_decision);
end;
$$;

revoke all on function public.can_view_marketplace_job(uuid),public.moderation_queue_for_admin(),
  public.review_marketplace_job_report(uuid,text,text),public.review_conversation_abuse_report(uuid,text,text),
  public.request_account_deletion(text),public.cancel_account_deletion_request(),
  public.review_account_deletion_request(uuid,text,text) from public,anon;
grant execute on function public.can_view_marketplace_job(uuid) to authenticated;
grant execute on function public.moderation_queue_for_admin(),public.review_marketplace_job_report(uuid,text,text),
  public.review_conversation_abuse_report(uuid,text,text),public.request_account_deletion(text),
  public.cancel_account_deletion_request(),public.review_account_deletion_request(uuid,text,text) to authenticated;

grant select(id,job_id,reported_by,reason,details,created_at,status,decision,reviewed_at,resolution_note) on public.marketplace_job_reports to authenticated;
grant select(id,reporter_id,conversation_id,message_id,reason,details,created_at,status,decision,reviewed_at,resolution_note) on public.conversation_abuse_reports to authenticated;

commit;
