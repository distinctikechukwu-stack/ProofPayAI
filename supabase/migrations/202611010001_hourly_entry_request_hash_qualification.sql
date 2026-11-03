begin;

-- Preserve the existing authenticated freelancer checks and idempotency flow.
-- Qualify the request_hash column so it cannot collide with the PL/pgSQL local.
create or replace function public.create_manual_hourly_time_entry(p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare actor_id uuid:=auth.uid(); contract_row public.hourly_contracts%rowtype; entry_id uuid; key_id uuid; request_hash text; existing_hash text; date_value date; seconds_value integer; description_value text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['idempotencyKey','workDate','durationSeconds','description']<>'{}'::jsonb
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string'
    or (p_input->>'idempotencyKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'workDate') is distinct from 'string' or (p_input->>'workDate') !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(p_input->'durationSeconds') is distinct from 'number' or (p_input->>'durationSeconds') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'description') is distinct from 'string' then
    raise exception 'Time entry details are invalid' using errcode='22023';
  end if;
  key_id:=(p_input->>'idempotencyKey')::uuid;
  date_value:=(p_input->>'workDate')::date;
  seconds_value:=(p_input->>'durationSeconds')::integer;
  description_value:=trim(p_input->>'description');
  if seconds_value not between 1 and 86400 or char_length(description_value) not between 1 and 1600 then
    raise exception 'Use a duration up to 24 hours and a short work description.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||key_id::text,0));
  select * into contract_row from public.hourly_contracts where project_id=p_project_id for update;
  if not found or contract_row.freelancer_id<>actor_id or contract_row.status<>'active' or not public.is_active_hourly_project(p_project_id) then
    raise exception 'Only the freelancer on an active hourly contract can log time.' using errcode='42501';
  end if;
  request_hash:=encode(extensions.digest(jsonb_build_object('projectId',p_project_id,'agreementVersionId',contract_row.agreement_version_id,
    'workDate',date_value,'durationSeconds',seconds_value,'description',description_value)::text,'sha256'),'hex');
  select entry_row.id,entry_row.request_hash into entry_id,existing_hash
    from public.hourly_time_entries as entry_row
    where entry_row.freelancer_id=actor_id and entry_row.idempotency_key=key_id;
  if entry_id is not null then
    if existing_hash<>request_hash then raise exception 'This time-entry key was already used with different details.' using errcode='23505'; end if;
    return jsonb_build_object('entryId',entry_id,'status','draft','alreadyCreated',true);
  end if;
  insert into public.hourly_time_entries(project_id,agreement_version_id,freelancer_id,idempotency_key,request_hash,work_date,duration_seconds,description,source)
    values(p_project_id,contract_row.agreement_version_id,actor_id,key_id,request_hash,date_value,seconds_value,description_value,'manual') returning id into entry_id;
  insert into public.hourly_time_entry_events(entry_id,actor_id,event_type) values(entry_id,actor_id,'created');
  return jsonb_build_object('entryId',entry_id,'status','draft','alreadyCreated',false);
end;
$$;

commit;
