begin;

-- Serialize project workflow decisions before any child-row lock is taken.
-- The project row lock is the durable coordination point; the transaction-scoped
-- advisory lock also gives all cooperating RPCs an explicit, consistent order.
create or replace function public.lock_project_completion_workflow(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  project_state text;
begin
  if p_project_id is null then
    raise exception 'Project was not found.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('project-workflow:' || p_project_id::text, 0));
  select project_row.status into project_state
  from public.projects as project_row
  where project_row.id = p_project_id
  for update;
  if project_state is null then
    raise exception 'Project was not found.' using errcode = 'P0002';
  end if;
  return project_state;
end;
$$;

revoke all on function public.lock_project_completion_workflow(uuid) from public, anon, authenticated, service_role;

create or replace function public.try_complete_fixed_price_project(
  p_project_id uuid,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  actor_id uuid := auth.uid();
  project_row public.projects%rowtype;
  agreement_row public.agreement_versions%rowtype;
  milestone_count integer;
  unapproved_count integer;
  milestone_total numeric;
  currency_mismatch_count integer;
begin
  if p_source is null or p_source not in ('milestone_review', 'participant_recheck') then
    raise exception 'Invalid project-completion source.' using errcode = '22023';
  end if;
  perform public.lock_project_completion_workflow(p_project_id);
  select * into project_row from public.projects as project_record
  where project_record.id = p_project_id;
  if not found then
    return jsonb_build_object('completed', false, 'changed', false, 'status', null, 'reason', 'project_not_found');
  end if;
  if actor_id is null or not public.is_project_member(p_project_id) then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'unauthorized');
  end if;
  if project_row.status = 'completed' then
    return jsonb_build_object('completed', true, 'changed', false, 'status', 'completed', 'reason', 'already_completed');
  end if;
  if project_row.status not in ('agreed', 'in_progress') then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'project_not_active');
  end if;
  if project_row.contract_type is distinct from 'fixed' then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'not_fixed_price');
  end if;
  if project_row.current_agreement_version_id is null then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'current_agreement_missing');
  end if;

  select * into agreement_row from public.agreement_versions as agreement_record
  where agreement_record.id = project_row.current_agreement_version_id
    and agreement_record.project_id = p_project_id;
  if not found or agreement_row.state is distinct from 'accepted' then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'agreement_not_accepted');
  end if;
  if exists (
    select 1 from public.agreement_versions as newer_agreement
    where newer_agreement.project_id = p_project_id
      and newer_agreement.version_number > agreement_row.version_number
  ) then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'newer_agreement_exists');
  end if;
  if not exists (
    select 1 from public.agreement_acceptances as acceptance
    join public.project_members as member_row
      on member_row.project_id = p_project_id
     and member_row.user_id = acceptance.user_id
     and member_row.role = acceptance.member_role
    where acceptance.agreement_version_id = agreement_row.id
      and acceptance.member_role = 'client'
  ) or not exists (
    select 1 from public.agreement_acceptances as acceptance
    join public.project_members as member_row
      on member_row.project_id = p_project_id
     and member_row.user_id = acceptance.user_id
     and member_row.role = acceptance.member_role
    where acceptance.agreement_version_id = agreement_row.id
      and acceptance.member_role = 'freelancer'
  ) then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'both_parties_must_accept');
  end if;

  select count(*),
    count(*) filter (where milestone_row.workflow_status <> 'approved'),
    coalesce(sum(milestone_row.amount_minor::numeric), 0),
    count(*) filter (where milestone_row.currency is distinct from agreement_row.currency)
  into milestone_count, unapproved_count, milestone_total, currency_mismatch_count
  from public.milestones as milestone_row
  where milestone_row.project_id = p_project_id
    and milestone_row.agreement_version_id = agreement_row.id;
  if milestone_count = 0 then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'no_current_agreement_milestones');
  end if;
  if unapproved_count > 0 then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'milestones_not_all_approved');
  end if;
  if milestone_total is distinct from agreement_row.total_minor::numeric
     or agreement_row.total_minor is distinct from project_row.budget_minor
     or currency_mismatch_count > 0
     or agreement_row.currency is distinct from project_row.currency then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'agreement_milestone_totals_mismatch');
  end if;

  -- Pending analysis, analyzed requests, proposals, or unaccepted drafts block
  -- completion. Rejected and withdrawn changes are resolved. Accepted change
  -- orders also block because this schema has no milestone linkage that proves
  -- their added work is included in completion criteria.
  if exists (
    select 1 from public.change_requests as request_row
    where request_row.project_id = p_project_id
      and (
        request_row.status in ('pending_analysis', 'proposal_ready')
        or (request_row.status = 'analyzed' and not exists (
          select 1 from public.change_order_versions as rejected_change
          where rejected_change.project_id = request_row.project_id
            and rejected_change.change_request_id = request_row.id
            and rejected_change.state = 'rejected'
        ))
      )
  ) then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'scope_workflow_unresolved');
  end if;
  if exists (
    select 1 from public.change_order_versions as change_order
    where change_order.project_id = p_project_id
      and change_order.state in ('draft', 'awaiting_approval', 'accepted')
  ) then
    return jsonb_build_object('completed', false, 'changed', false, 'status', project_row.status, 'reason', 'amendment_unresolved_or_unrepresented');
  end if;

  update public.projects as project_record
  set status = 'completed', updated_at = clock_timestamp()
  where project_record.id = p_project_id
    and project_record.status in ('agreed', 'in_progress')
    and project_record.current_agreement_version_id = agreement_row.id;
  if not found then
    raise exception 'Project state changed during completion; reload and try again.' using errcode = '40001';
  end if;

  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id, details)
  values (
    p_project_id,
    actor_id,
    'project.completed',
    'project',
    p_project_id,
    jsonb_build_object('agreementVersionId', agreement_row.id, 'source', p_source)
  );
  return jsonb_build_object('completed', true, 'changed', true, 'status', 'completed', 'reason', null);
end;
$$;

revoke all on function public.try_complete_fixed_price_project(uuid, text) from public, anon, authenticated, service_role;

-- Keep completion terminal until a future, separately designed reopening
-- workflow can preserve the completion event and establish new scope safely.
create or replace function public.prevent_completed_project_reopen()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'completed'
     and (new.status is distinct from 'completed'
       or new.current_agreement_version_id is distinct from old.current_agreement_version_id) then
    raise exception 'Completed projects require an explicit reopening workflow.' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_completed_project_reopen() from public, anon, authenticated, service_role;
drop trigger if exists projects_prevent_completed_reopen on public.projects;
create trigger projects_prevent_completed_reopen
before update of status, current_agreement_version_id on public.projects
for each row execute function public.prevent_completed_project_reopen();

-- Preserve the existing RPC implementations and their validation. These
-- wrappers acquire the same project lock before the original functions lock
-- milestone/agreement/scope rows, eliminating stale decisions and lock-order
-- inversions while keeping the existing idempotency behavior intact.
alter function public.review_milestone(uuid, text, text, uuid) rename to review_milestone_unlocked;
revoke all on function public.review_milestone_unlocked(uuid, text, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.review_milestone(
  p_milestone_id uuid,
  p_decision text,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  target_project_id uuid;
  review_result jsonb;
  completion_result jsonb;
begin
  select milestone_row.project_id into target_project_id
  from public.milestones as milestone_row where milestone_row.id = p_milestone_id;
  if target_project_id is null then
    raise exception 'Milestone was not found.' using errcode = 'P0002';
  end if;
  perform public.lock_project_completion_workflow(target_project_id);
  review_result := public.review_milestone_unlocked(p_milestone_id, p_decision, p_note, p_idempotency_key);
  if p_decision = 'approved' and review_result ->> 'status' = 'approved' then
    completion_result := public.try_complete_fixed_price_project(target_project_id, 'milestone_review');
    return review_result || jsonb_build_object('projectCompletion', completion_result);
  end if;
  return review_result;
end;
$$;

revoke all on function public.review_milestone(uuid, text, text, uuid) from public, anon, service_role;
grant execute on function public.review_milestone(uuid, text, text, uuid) to authenticated;

alter function public.accept_agreement_version(uuid) rename to accept_agreement_version_unlocked;
revoke all on function public.accept_agreement_version_unlocked(uuid) from public, anon, authenticated, service_role;

create or replace function public.accept_agreement_version(p_agreement_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  target_project_id uuid;
  project_state text;
  current_version_id uuid;
  target_version_number integer;
  latest_version_number integer;
  target_version_state text;
begin
  select agreement_row.project_id into target_project_id
  from public.agreement_versions as agreement_row where agreement_row.id = p_agreement_version_id;
  if target_project_id is null then
    raise exception 'Agreement version was not found.' using errcode = 'P0002';
  end if;
  project_state := public.lock_project_completion_workflow(target_project_id);
  select project_row.current_agreement_version_id into current_version_id
  from public.projects as project_row where project_row.id = target_project_id;
  select agreement_row.version_number, agreement_row.state
    into target_version_number, target_version_state
  from public.agreement_versions as agreement_row
  where agreement_row.id = p_agreement_version_id and agreement_row.project_id = target_project_id;
  select max(agreement_row.version_number) into latest_version_number
  from public.agreement_versions as agreement_row where agreement_row.project_id = target_project_id;
  if target_version_number is null then
    raise exception 'Agreement version was not found.' using errcode = 'P0002';
  end if;
  if project_state = 'completed'
     and (target_version_state is distinct from 'accepted' or current_version_id is distinct from p_agreement_version_id) then
    raise exception 'A completed project cannot accept a new or stale agreement.' using errcode = '55000';
  end if;
  if current_version_id is distinct from p_agreement_version_id
     and target_version_number is distinct from latest_version_number then
    raise exception 'This agreement version is stale; review the latest version.' using errcode = '40001';
  end if;
  return public.accept_agreement_version_unlocked(p_agreement_version_id);
end;
$$;

revoke all on function public.accept_agreement_version(uuid) from public, anon, service_role;
grant execute on function public.accept_agreement_version(uuid) to authenticated;

alter function public.add_project_client(uuid, uuid) rename to add_project_client_unlocked;
revoke all on function public.add_project_client_unlocked(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.add_project_client(p_project_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  project_state text;
begin
  project_state := public.lock_project_completion_workflow(p_project_id);
  if project_state = 'completed' then
    raise exception 'Completed projects cannot add new participants.' using errcode = '55000';
  end if;
  return public.add_project_client_unlocked(p_project_id, p_user_id);
end;
$$;

revoke all on function public.add_project_client(uuid, uuid) from public, anon, service_role;
grant execute on function public.add_project_client(uuid, uuid) to authenticated;

alter function public.start_milestone(uuid) rename to start_milestone_unlocked;
revoke all on function public.start_milestone_unlocked(uuid) from public, anon, authenticated, service_role;

create or replace function public.start_milestone(p_milestone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  target_project_id uuid;
  project_state text;
begin
  select milestone_row.project_id into target_project_id
  from public.milestones as milestone_row where milestone_row.id = p_milestone_id;
  if target_project_id is null then
    raise exception 'Milestone was not found.' using errcode = 'P0002';
  end if;
  project_state := public.lock_project_completion_workflow(target_project_id);
  if project_state = 'completed' then
    raise exception 'Completed projects cannot start more milestone work.' using errcode = '55000';
  end if;
  return public.start_milestone_unlocked(p_milestone_id);
end;
$$;

revoke all on function public.start_milestone(uuid) from public, anon, service_role;
grant execute on function public.start_milestone(uuid) to authenticated;

alter function public.submit_milestone_deliverable(uuid, text, text, text, uuid) rename to submit_milestone_deliverable_unlocked;
revoke all on function public.submit_milestone_deliverable_unlocked(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.submit_milestone_deliverable(
  p_milestone_id uuid,
  p_description text,
  p_evidence_url text,
  p_storage_object_path text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  target_project_id uuid;
  project_state text;
begin
  select milestone_row.project_id into target_project_id
  from public.milestones as milestone_row where milestone_row.id = p_milestone_id;
  if target_project_id is null then
    raise exception 'Milestone was not found.' using errcode = 'P0002';
  end if;
  project_state := public.lock_project_completion_workflow(target_project_id);
  if project_state = 'completed' then
    raise exception 'Completed projects cannot accept new deliverables.' using errcode = '55000';
  end if;
  return public.submit_milestone_deliverable_unlocked(
    p_milestone_id, p_description, p_evidence_url, p_storage_object_path, p_idempotency_key
  );
end;
$$;

revoke all on function public.submit_milestone_deliverable(uuid, text, text, text, uuid) from public, anon, service_role;
grant execute on function public.submit_milestone_deliverable(uuid, text, text, text, uuid) to authenticated;

alter function public.request_scope_change(uuid, text, uuid) rename to request_scope_change_unlocked;
revoke all on function public.request_scope_change_unlocked(uuid, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.request_scope_change(p_project_id uuid, p_request_text text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  project_state text;
begin
  project_state := public.lock_project_completion_workflow(p_project_id);
  if project_state = 'completed' then
    raise exception 'Completed projects cannot accept new scope requests.' using errcode = '55000';
  end if;
  return public.request_scope_change_unlocked(p_project_id, p_request_text, p_idempotency_key);
end;
$$;

revoke all on function public.request_scope_change(uuid, text, uuid) from public, anon, service_role;
grant execute on function public.request_scope_change(uuid, text, uuid) to authenticated;

alter function public.create_change_order_draft(uuid, uuid, uuid, jsonb) rename to create_change_order_draft_unlocked;
revoke all on function public.create_change_order_draft_unlocked(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;

create or replace function public.create_change_order_draft(
  p_project_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  project_state text;
begin
  project_state := public.lock_project_completion_workflow(p_project_id);
  if project_state = 'completed' then
    raise exception 'Completed projects cannot accept new amendments.' using errcode = '55000';
  end if;
  return public.create_change_order_draft_unlocked(p_project_id, p_request_id, p_idempotency_key, p_draft);
end;
$$;

revoke all on function public.create_change_order_draft(uuid, uuid, uuid, jsonb) from public, anon, service_role;
grant execute on function public.create_change_order_draft(uuid, uuid, uuid, jsonb) to authenticated;

alter function public.decide_change_order(uuid, text) rename to decide_change_order_unlocked;
revoke all on function public.decide_change_order_unlocked(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.decide_change_order(p_change_order_version_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  target_project_id uuid;
  project_state text;
begin
  select change_order.project_id into target_project_id
  from public.change_order_versions as change_order
  where change_order.id = p_change_order_version_id;
  if target_project_id is null then
    raise exception 'Change-order version was not found.' using errcode = 'P0002';
  end if;
  project_state := public.lock_project_completion_workflow(target_project_id);
  if project_state = 'completed' then
    raise exception 'Completed projects cannot accept new amendment decisions.' using errcode = '55000';
  end if;
  return public.decide_change_order_unlocked(p_change_order_version_id, p_decision);
end;
$$;

revoke all on function public.decide_change_order(uuid, text) from public, anon, service_role;
grant execute on function public.decide_change_order(uuid, text) to authenticated;

create or replace function public.recheck_project_completion(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  actor_id uuid := auth.uid();
  project_state text;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  project_state := public.lock_project_completion_workflow(p_project_id);
  if not public.is_project_member(p_project_id) then
    raise exception 'Only a project participant may recheck project completion.' using errcode = '42501';
  end if;
  return public.try_complete_fixed_price_project(p_project_id, 'participant_recheck');
end;
$$;

revoke all on function public.recheck_project_completion(uuid) from public, anon, service_role;
grant execute on function public.recheck_project_completion(uuid) to authenticated;

commit;
