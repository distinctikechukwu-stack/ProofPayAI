begin;

-- Keep the existing RPC surface and ACLs; correct aliases and PL/pgSQL name resolution.
create or replace function public.save_my_freelancer_profile(p_profile jsonb, p_portfolio jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  rate_text text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profile_roles where user_id = actor_id and role = 'freelancer') then
    raise exception 'Freelancer role required' using errcode = '42501';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) is distinct from 'object'
     or p_portfolio is null or jsonb_typeof(p_portfolio) is distinct from 'array' then
    raise exception 'Invalid freelancer profile' using errcode = '22023';
  end if;
  if jsonb_array_length(p_portfolio) > 12 then raise exception 'Portfolio limit reached' using errcode = '22023'; end if;
  rate_text := nullif(p_profile->>'hourly_rate_minor', '');

  insert into public.freelancer_profiles (
    user_id, public_slug, headline, biography, skills, experience_summary, education_summary,
    languages, category, hourly_rate_minor, currency, availability, is_public
  ) values (
    actor_id,
    lower(trim(p_profile->>'public_slug')),
    coalesce(p_profile->>'headline', ''),
    coalesce(p_profile->>'biography', ''),
    array(select jsonb_array_elements_text(coalesce(p_profile->'skills', '[]'::jsonb))),
    coalesce(p_profile->>'experience_summary', ''),
    coalesce(p_profile->>'education_summary', ''),
    array(select jsonb_array_elements_text(coalesce(p_profile->'languages', '[]'::jsonb))),
    coalesce(p_profile->>'category', ''),
    case when rate_text is null then null else rate_text::bigint end,
    coalesce(p_profile->>'currency', 'USD'),
    coalesce(p_profile->>'availability', 'available'),
    coalesce((p_profile->>'is_public')::boolean, false)
  ) on conflict (user_id) do update set
    public_slug = excluded.public_slug,
    headline = excluded.headline,
    biography = excluded.biography,
    skills = excluded.skills,
    experience_summary = excluded.experience_summary,
    education_summary = excluded.education_summary,
    languages = excluded.languages,
    category = excluded.category,
    hourly_rate_minor = excluded.hourly_rate_minor,
    currency = excluded.currency,
    availability = excluded.availability,
    is_public = excluded.is_public;

  delete from public.freelancer_portfolio_items where user_id = actor_id;
  insert into public.freelancer_portfolio_items (user_id, title, description, project_url, image_url, featured, position)
  select actor_id, item.title, coalesce(item.description, ''), item.project_url, item.image_url,
    coalesce(item.featured, false), (entries.ordinality - 1)::integer
  from jsonb_array_elements(p_portfolio) with ordinality as entries(value, ordinality)
  cross join lateral jsonb_to_record(entries.value) as item(
    title text, description text, project_url text, image_url text, featured boolean
  );

  update public.profiles
  set display_name = trim(p_profile->>'display_name'), avatar_url = nullif(p_profile->>'avatar_url', '')
  where id = actor_id and char_length(trim(p_profile->>'display_name')) between 2 and 80;
  if not found then raise exception 'Invalid profile display name' using errcode = '22023'; end if;
  return true;
end;
$$;

create or replace function public.notify_project_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_project_id uuid;
  participant record;
begin
  select conversation_row.project_id into target_project_id
  from public.project_conversations as conversation_row
  where conversation_row.id = new.conversation_id;
  if target_project_id is null then
    raise exception 'Project conversation was not found.' using errcode = 'P0002';
  end if;

  update public.project_conversations as conversation_row
  set last_message_at = new.created_at
  where conversation_row.id = new.conversation_id;

  for participant in
    select member_row.user_id
    from public.project_members as member_row
    where member_row.project_id = target_project_id
      and member_row.user_id <> new.sender_id
  loop
    insert into public.user_notifications(user_id, actor_id, notification_type, conversation_id, message_id)
    values (participant.user_id, new.sender_id, 'message_received', new.conversation_id, new.id)
    on conflict (user_id, message_id) do nothing;
  end loop;
  return new;
end;
$$;

create or replace function public.start_milestone(p_milestone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  target_project_id uuid;
  milestone_state text;
  target_dependency_sequences integer[];
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  select target_milestone.project_id, target_milestone.workflow_status, target_milestone.dependency_sequences
    into target_project_id, milestone_state, target_dependency_sequences
  from public.milestones as target_milestone
  where target_milestone.id = p_milestone_id
  for update;
  if target_project_id is null then
    raise exception 'Milestone was not found.' using errcode = 'P0002';
  end if;
  if not public.has_project_role(target_project_id, 'freelancer') then
    raise exception 'Only the project freelancer may start a milestone.' using errcode = '42501';
  end if;
  if milestone_state in ('in_progress', 'submitted_for_review', 'revision_requested', 'approved') then
    return jsonb_build_object('milestoneId', p_milestone_id, 'status', milestone_state, 'alreadyStarted', true);
  end if;
  if milestone_state <> 'agreed' then
    raise exception 'Only an agreed milestone can be started.' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.milestones as dependency_row
    where dependency_row.project_id = target_project_id
      and dependency_row.sequence = any(target_dependency_sequences)
      and dependency_row.workflow_status <> 'approved'
  ) then
    raise exception 'Complete dependent milestones before starting this milestone.' using errcode = '55000';
  end if;
  update public.milestones as milestone_row
  set workflow_status = 'in_progress'
  where milestone_row.id = p_milestone_id;
  update public.projects as project_row
  set status = 'in_progress'
  where project_row.id = target_project_id and project_row.status = 'agreed';
  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
  values (target_project_id, actor_id, 'milestone.started', 'milestone', p_milestone_id);
  return jsonb_build_object('milestoneId', p_milestone_id, 'status', 'in_progress');
end;
$$;

create or replace function public.mark_project_conversation_read(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  inserted_count integer;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.can_access_project_conversation(p_conversation_id) then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  insert into public.project_message_receipts(message_id, user_id)
  select message_row.id, current_user_id
  from public.project_messages as message_row
  where message_row.conversation_id = p_conversation_id
    and message_row.sender_id <> current_user_id
  on conflict (message_id, user_id) do update set read_at = excluded.read_at;
  get diagnostics inserted_count = row_count;

  update public.user_notifications as notification_row
  set read_at = coalesce(notification_row.read_at, now())
  where notification_row.user_id = current_user_id
    and notification_row.conversation_id = p_conversation_id
    and notification_row.read_at is null;
  return jsonb_build_object('conversationId', p_conversation_id, 'readMessages', inserted_count);
end;
$$;

create or replace function public.mark_user_notification_read(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  notification_row public.user_notifications%rowtype;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  update public.user_notifications as target_notification
  set read_at = coalesce(target_notification.read_at, now())
  where target_notification.id = p_notification_id
    and target_notification.user_id = current_user_id
  returning target_notification.* into notification_row;
  if not found then raise exception 'Notification not found' using errcode = 'P0002'; end if;
  insert into public.project_message_receipts(message_id, user_id)
  values (notification_row.message_id, current_user_id)
  on conflict (message_id, user_id) do update set read_at = excluded.read_at;
  return jsonb_build_object('notificationId', p_notification_id, 'read', true);
end;
$$;

create or replace function public.count_user_unread_notifications()
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  unread_count integer;
begin
  if current_user_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select count(*)::integer into unread_count
  from public.user_notifications as notification_row
  where notification_row.user_id = current_user_id
    and notification_row.read_at is null;
  return unread_count;
end;
$$;

-- Preserve the two-party workflow and strengthen the hourly-specific checks.
create or replace function public.accept_agreement_version(p_agreement_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  target_project_id uuid;
  agreement_state text;
  agreement_total bigint;
  agreement_currency text;
  agreement_terms jsonb;
  project_total bigint;
  project_currency text;
  contract_kind text;
  rate_minor bigint;
  rate_currency text;
  contract_freelancer_id uuid;
  contract_client_id uuid;
  milestone_count integer;
  milestone_total numeric;
  actor_role text;
  accepted_count integer;
  acceptance_inserted_count integer;
  final_state text;
  activated_contract_count integer;
begin
  if actor_id is null then raise exception 'Authentication is required.' using errcode = '28000'; end if;
  select agreement_row.project_id, agreement_row.state, agreement_row.total_minor, agreement_row.currency, agreement_row.terms
    into target_project_id, agreement_state, agreement_total, agreement_currency, agreement_terms
  from public.agreement_versions as agreement_row
  where agreement_row.id = p_agreement_version_id
  for update;
  if target_project_id is null then raise exception 'Agreement version was not found.' using errcode = 'P0002'; end if;

  select project_row.budget_minor, project_row.currency, project_row.contract_type
    into project_total, project_currency, contract_kind
  from public.projects as project_row
  where project_row.id = target_project_id
  for update;
  select member_row.role into actor_role
  from public.project_members as member_row
  where member_row.project_id = target_project_id and member_row.user_id = actor_id;
  if actor_role is null or actor_role not in ('client', 'freelancer') then
    raise exception 'You are not a member of this project.' using errcode = '42501';
  end if;
  if agreement_state = 'accepted' then
    return jsonb_build_object('state', 'accepted', 'alreadyAccepted', true);
  end if;
  if agreement_terms ? 'contractType'
     and agreement_terms->>'contractType' is distinct from contract_kind then
    raise exception 'The marketplace contract type does not match the project.' using errcode = '23514';
  end if;

  if contract_kind = 'hourly' then
    select contract_row.hourly_rate_minor, contract_row.currency, contract_row.freelancer_id, contract_row.client_id
      into rate_minor, rate_currency, contract_freelancer_id, contract_client_id
    from public.hourly_contracts as contract_row
    where contract_row.project_id = target_project_id
      and contract_row.agreement_version_id = p_agreement_version_id
      and contract_row.status = 'draft'
    for update;
    if not found then
      raise exception 'Review the hourly rate and contract details before accepting.' using errcode = '23514';
    end if;
    if not ((actor_role = 'freelancer' and actor_id = contract_freelancer_id)
         or (actor_role = 'client' and actor_id = contract_client_id)) then
      raise exception 'Only the named hourly contract parties may accept this agreement.' using errcode = '42501';
    end if;
    if agreement_total is distinct from rate_minor
       or project_total is distinct from rate_minor
       or agreement_currency is distinct from rate_currency
       or project_currency is distinct from rate_currency
       or agreement_terms->>'contractType' is distinct from 'hourly'
       or agreement_terms->>'hourlyRateMinor' is distinct from rate_minor::text
       or agreement_terms->>'hourlyRateCurrency' is distinct from rate_currency
       or not exists (
         select 1 from public.project_members as freelancer_member
         where freelancer_member.project_id = target_project_id
           and freelancer_member.user_id = contract_freelancer_id
           and freelancer_member.role = 'freelancer'
       )
       or not exists (
         select 1 from public.project_members as client_member
         where client_member.project_id = target_project_id
           and client_member.user_id = contract_client_id
           and client_member.role = 'client'
       ) then
      raise exception 'Review the hourly rate and contract details before accepting.' using errcode = '23514';
    end if;
    select count(*) into milestone_count
    from public.milestones as milestone_row
    where milestone_row.agreement_version_id = p_agreement_version_id;
    if milestone_count <> 0 then
      raise exception 'Hourly agreements cannot contain fixed-price milestones.' using errcode = '23514';
    end if;
  elsif contract_kind = 'fixed' then
    if agreement_terms ? 'marketplaceOfferId'
       and agreement_terms->>'milestonePlanReviewed' is distinct from 'true' then
      raise exception 'Review and save the hiring milestone plan before either party accepts.' using errcode = '23514';
    end if;
    select count(*), coalesce(sum(milestone_row.amount_minor), 0)
      into milestone_count, milestone_total
    from public.milestones as milestone_row
    where milestone_row.agreement_version_id = p_agreement_version_id;
    if milestone_count not between 1 and 20
       or milestone_total is distinct from agreement_total::numeric
       or agreement_total is distinct from project_total
       or agreement_currency is distinct from project_currency
       or exists (
         select 1 from public.milestones as milestone_row
         where milestone_row.agreement_version_id = p_agreement_version_id
           and milestone_row.workflow_status <> 'draft'
       ) then
      raise exception 'Complete a draft milestone plan whose amounts equal the agreement before either party accepts.' using errcode = '23514';
    end if;
  else
    raise exception 'The project contract type is invalid.' using errcode = '23514';
  end if;

  insert into public.agreement_acceptances(agreement_version_id, user_id, member_role)
  values (p_agreement_version_id, actor_id, actor_role)
  on conflict (agreement_version_id, user_id) do nothing;
  get diagnostics acceptance_inserted_count = row_count;
  if acceptance_inserted_count = 0 then
    select count(distinct acceptance.member_role) into accepted_count
    from public.agreement_acceptances as acceptance
    join public.project_members as accepted_member
      on accepted_member.project_id = target_project_id
     and accepted_member.user_id = acceptance.user_id
     and accepted_member.role = acceptance.member_role
    where acceptance.agreement_version_id = p_agreement_version_id;
    return jsonb_build_object('state', agreement_state, 'acceptedRoleCount', accepted_count, 'alreadyAcceptedByYou', true);
  end if;
  select count(distinct acceptance.member_role) into accepted_count
  from public.agreement_acceptances as acceptance
  join public.project_members as accepted_member
    on accepted_member.project_id = target_project_id
   and accepted_member.user_id = acceptance.user_id
   and accepted_member.role = acceptance.member_role
  where acceptance.agreement_version_id = p_agreement_version_id;
  if accepted_count = 2 then
    final_state := 'accepted';
    update public.agreement_versions as agreement_row
    set state = 'accepted'
    where agreement_row.id = p_agreement_version_id;
    update public.projects as project_row
    set current_agreement_version_id = p_agreement_version_id, status = 'agreed'
    where project_row.id = target_project_id;
    update public.milestones as milestone_row
    set workflow_status = 'agreed'
    where milestone_row.agreement_version_id = p_agreement_version_id
      and milestone_row.workflow_status = 'draft';
    if contract_kind = 'hourly' then
      update public.hourly_contracts as contract_row
      set status = 'active'
      where contract_row.project_id = target_project_id
        and contract_row.agreement_version_id = p_agreement_version_id
        and contract_row.status = 'draft';
      get diagnostics activated_contract_count = row_count;
      if activated_contract_count <> 1 then
        raise exception 'The hourly contract could not be activated.' using errcode = '23514';
      end if;
    end if;
  else
    final_state := 'awaiting_acceptance';
    update public.agreement_versions as agreement_row
    set state = 'awaiting_acceptance'
    where agreement_row.id = p_agreement_version_id;
    update public.projects as project_row
    set status = 'awaiting_client_agreement'
    where project_row.id = target_project_id;
  end if;

  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id, details)
  values (target_project_id, actor_id, 'agreement.accepted_by_member', 'agreement_version', p_agreement_version_id,
    jsonb_build_object('role', actor_role, 'acceptedRoles', accepted_count, 'contractType', contract_kind));
  return jsonb_build_object('state', final_state, 'acceptedRoleCount', accepted_count);
end;
$$;

create or replace function public.assert_accepted_agreement_total()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  target_version_id uuid;
  target_project_id uuid;
  expected_total bigint;
  expected_currency text;
  actual_total numeric;
  version_state text;
  contract_kind text;
  project_total bigint;
  project_currency text;
  current_agreement_version_id uuid;
  accepted_role_count integer;
  milestone_count integer;
  contract_rate bigint;
  contract_currency text;
  contract_status text;
  contract_freelancer_id uuid;
  contract_client_id uuid;
  agreement_terms jsonb;
begin
  if tg_table_name = 'agreement_versions' then
    target_version_id := new.id;
  elsif tg_op = 'DELETE' then
    target_version_id := old.agreement_version_id;
  else
    target_version_id := new.agreement_version_id;
  end if;

  select agreement_row.project_id, agreement_row.total_minor, agreement_row.currency,
         agreement_row.state, agreement_row.terms
    into target_project_id, expected_total, expected_currency, version_state, agreement_terms
  from public.agreement_versions as agreement_row
  where agreement_row.id = target_version_id;
  if version_state is distinct from 'accepted' then return null; end if;

  select project_row.contract_type, project_row.budget_minor, project_row.currency,
         project_row.current_agreement_version_id
    into contract_kind, project_total, project_currency, current_agreement_version_id
  from public.projects as project_row
  where project_row.id = target_project_id;
  if not found then
    raise exception 'Accepted agreement project is missing.' using errcode = '23514';
  end if;

  select count(distinct acceptance.member_role) into accepted_role_count
  from public.agreement_acceptances as acceptance
  join public.project_members as accepted_member
    on accepted_member.project_id = target_project_id
   and accepted_member.user_id = acceptance.user_id
   and accepted_member.role = acceptance.member_role
  where acceptance.agreement_version_id = target_version_id;
  if accepted_role_count <> 2 then
    raise exception 'An accepted agreement requires client and freelancer approval.' using errcode = '23514';
  end if;

  if contract_kind = 'fixed' then
    select count(*), coalesce(sum(milestone_row.amount_minor), 0)
      into milestone_count, actual_total
    from public.milestones as milestone_row
    where milestone_row.agreement_version_id = target_version_id;
    if milestone_count not between 1 and 20 or actual_total is distinct from expected_total::numeric then
      raise exception 'Accepted fixed-price milestone total % does not match agreement total %.', actual_total, expected_total using errcode = '23514';
    end if;
  elsif contract_kind = 'hourly' then
    select count(*) into milestone_count
    from public.milestones as milestone_row
    where milestone_row.agreement_version_id = target_version_id;
    select contract_row.hourly_rate_minor, contract_row.currency, contract_row.status,
           contract_row.freelancer_id, contract_row.client_id
      into contract_rate, contract_currency, contract_status, contract_freelancer_id, contract_client_id
    from public.hourly_contracts as contract_row
    where contract_row.project_id = target_project_id
      and contract_row.agreement_version_id = target_version_id;
    if not found
       or milestone_count <> 0
       or contract_status is distinct from 'active'
       or current_agreement_version_id is distinct from target_version_id
       or contract_rate is distinct from expected_total
       or contract_currency is distinct from expected_currency
       or project_total is distinct from expected_total
       or project_currency is distinct from expected_currency
       or agreement_terms->>'contractType' is distinct from 'hourly'
       or agreement_terms->>'hourlyRateMinor' is distinct from contract_rate::text
       or agreement_terms->>'hourlyRateCurrency' is distinct from contract_currency
       or not exists (
         select 1 from public.project_members as freelancer_member
         where freelancer_member.project_id = target_project_id
           and freelancer_member.user_id = contract_freelancer_id
           and freelancer_member.role = 'freelancer'
       )
       or not exists (
         select 1 from public.project_members as client_member
         where client_member.project_id = target_project_id
           and client_member.user_id = contract_client_id
           and client_member.role = 'client'
       )
       or not exists (
         select 1 from public.agreement_acceptances as freelancer_acceptance
         where freelancer_acceptance.agreement_version_id = target_version_id
           and freelancer_acceptance.user_id = contract_freelancer_id
           and freelancer_acceptance.member_role = 'freelancer'
       )
       or not exists (
         select 1 from public.agreement_acceptances as client_acceptance
         where client_acceptance.agreement_version_id = target_version_id
           and client_acceptance.user_id = contract_client_id
           and client_acceptance.member_role = 'client'
       ) then
      raise exception 'Accepted hourly agreement must have two party approvals and a matching active contract with no milestones.' using errcode = '23514';
    end if;
  else
    raise exception 'Accepted agreement has an invalid project contract type.' using errcode = '23514';
  end if;
  return null;
end;
$$;

commit;
