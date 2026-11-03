begin;

-- Extend the audited provider allow-list without changing validation, ownership, or function ACLs.
-- CREATE OR REPLACE preserves the existing owner and grants; execution remains service_role-only.
create or replace function public.record_scope_analysis(
  p_actor_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_agreement_version_id uuid,
  p_input_hash text,
  p_provider text,
  p_model text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := p_actor_id;
  request_state text;
  request_version_id uuid;
  current_version_id uuid;
  saved_record public.ai_analysis_records%rowtype;
  new_analysis_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Scope analysis persistence is restricted to the trusted API.' using errcode = '42501';
  end if;
  if actor_id is null or not public.is_project_member(p_project_id) then
    raise exception 'Only project members may record a scope analysis.' using errcode = '42501';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
     or (p_provider is distinct from 'openai' and p_provider is distinct from 'groq')
     or p_result is null or jsonb_typeof(p_result) is distinct from 'object'
     or p_result ->> 'classification' is null
     or p_result ->> 'classification' not in ('covered', 'possibly_covered', 'outside_scope', 'clarification_required')
     or jsonb_typeof(p_result -> 'citations') is distinct from 'array'
     or jsonb_typeof(p_result -> 'affectedMilestoneSequences') is distinct from 'array'
     or jsonb_typeof(p_result #> '{proposedAmendment}') is distinct from 'object'
     or p_result #> '{proposedAmendment,amountDeltaMinor}' is distinct from 'null'::jsonb
     or p_result #> '{proposedAmendment,scheduleDeltaDays}' is distinct from 'null'::jsonb then
    raise exception 'Scope analysis result or audit metadata is invalid.' using errcode = '22023';
  end if;

  select cr.status, cr.based_on_agreement_version_id
    into request_state, request_version_id
  from public.change_requests cr
  where cr.id = p_request_id and cr.project_id = p_project_id
  for update;
  if request_version_id is null then
    raise exception 'Scope request was not found.' using errcode = 'P0002';
  end if;
  if request_version_id <> p_agreement_version_id then
    raise exception 'Scope request agreement version does not match.' using errcode = '40001';
  end if;
  select p.current_agreement_version_id into current_version_id
  from public.projects p
  where p.id = p_project_id;
  if current_version_id is distinct from p_agreement_version_id
     or not exists (
       select 1 from public.agreement_versions av
       where av.id = p_agreement_version_id and av.project_id = p_project_id and av.state = 'accepted'
     ) then
    raise exception 'Accepted agreement changed during scope analysis.' using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_result -> 'citations') as citation(value)
    where jsonb_typeof(citation.value) is distinct from 'object'
      or jsonb_typeof(citation.value -> 'exactExcerpt') is distinct from 'string'
      or coalesce(citation.value ->> 'exactExcerpt', '') = ''
      or case citation.value ->> 'source'
        when 'agreement_scope' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'null'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'null'
          or not exists (
            select 1 from public.agreement_versions av
            where av.id = p_agreement_version_id and position(citation.value ->> 'exactExcerpt' in av.scope_text) > 0
          )
        when 'requirements' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'null'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'null'
          or not exists (
            select 1 from public.agreement_versions av,
              lateral jsonb_array_elements_text(coalesce(av.terms -> 'requirements', '[]'::jsonb)) as requirement(value)
            where av.id = p_agreement_version_id and position(citation.value ->> 'exactExcerpt' in requirement.value) > 0
          )
        when 'milestone' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'number'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'null'
          or coalesce(citation.value ->> 'milestoneSequence', '') !~ '^[1-9][0-9]{0,2}$'
          or not exists (
            select 1 from public.milestones m
            where m.project_id = p_project_id and m.agreement_version_id = p_agreement_version_id
              and m.sequence = case
                when coalesce(citation.value ->> 'milestoneSequence', '') ~ '^[1-9][0-9]{0,2}$'
                  then (citation.value ->> 'milestoneSequence')::integer
                else -1
              end
              and position(citation.value ->> 'exactExcerpt' in concat_ws(E'\n', m.title, m.description,
                coalesce((select string_agg(d.value, E'\n') from jsonb_array_elements_text(m.deliverables) as d(value)), ''),
                coalesce((select string_agg(a.value, E'\n') from jsonb_array_elements_text(m.acceptance_criteria) as a(value)), ''),
                coalesce((select string_agg(c.value, E'\n') from jsonb_array_elements_text(m.completion_conditions) as c(value)), ''))) > 0
          )
        when 'accepted_change_order' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'null'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'string'
          or coalesce(citation.value ->> 'changeOrderVersionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or not exists (
            select 1
            from public.change_order_versions cov
            join public.change_requests cr on cr.id = cov.change_request_id
            where cov.id = case
                when coalesce(citation.value ->> 'changeOrderVersionId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then (citation.value ->> 'changeOrderVersionId')::uuid
                else null::uuid
              end
              and cov.project_id = p_project_id and cov.state = 'accepted'
              and cr.based_on_agreement_version_id = p_agreement_version_id
              and position(citation.value ->> 'exactExcerpt' in concat_ws(E'\n', cov.title, cov.description,
                coalesce((select string_agg(d.value, E'\n') from jsonb_array_elements_text(cov.terms -> 'deliverables') as d(value)), ''),
                coalesce((select string_agg(q.value, E'\n') from jsonb_array_elements_text(cov.terms -> 'openQuestions') as q(value)), ''))) > 0
          )
        else true
      end
  ) then
    raise exception 'Scope analysis contains unverifiable citations.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_result -> 'affectedMilestoneSequences') as affected_item(value)
    where jsonb_typeof(affected_item.value) is distinct from 'number'
      or coalesce(affected_item.value #>> '{}', '') !~ '^[1-9][0-9]{0,2}$'
      or not exists (
        select 1 from public.milestones m
        where m.project_id = p_project_id and m.agreement_version_id = p_agreement_version_id
          and m.sequence = case
            when coalesce(affected_item.value #>> '{}', '') ~ '^[1-9][0-9]{0,2}$'
              then (affected_item.value #>> '{}')::integer
            else -1
          end
      )
  ) then
    raise exception 'Scope analysis references an unknown milestone.' using errcode = '22023';
  end if;

  select ar.* into saved_record
  from public.ai_analysis_records ar
  where ar.change_request_id = p_request_id
  order by ar.created_at desc
  limit 1;
  if request_state = 'analyzed' then
    if saved_record.id is null or saved_record.input_hash <> p_input_hash then
      raise exception 'Scope request already has an analysis for different evidence.' using errcode = '23505';
    end if;
    return jsonb_build_object('analysisId', saved_record.id, 'result', saved_record.result, 'reused', true);
  end if;
  if request_state <> 'pending_analysis' then
    raise exception 'Scope request is no longer available for analysis.' using errcode = '55000';
  end if;

  insert into public.ai_analysis_records (
    project_id, change_request_id, agreement_version_id, requested_by, provider, model, input_hash, result
  ) values (
    p_project_id, p_request_id, p_agreement_version_id, actor_id, p_provider, left(nullif(trim(p_model), ''), 160), p_input_hash, p_result
  ) returning id into new_analysis_id;
  update public.change_requests set status = 'analyzed' where id = p_request_id and status = 'pending_analysis';
  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id, details)
  values (p_project_id, actor_id, 'scope.analysis_recorded', 'ai_analysis', new_analysis_id,
    jsonb_build_object('changeRequestId', p_request_id, 'agreementVersionId', p_agreement_version_id));
  return jsonb_build_object('analysisId', new_analysis_id, 'result', p_result, 'reused', false);
end;
$$;

commit;
