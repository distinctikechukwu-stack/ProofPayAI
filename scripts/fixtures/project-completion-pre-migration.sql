-- Synthetic-only fixture loaded after migrations 1-18 and before migration 19.
-- It represents an already-approved project which must remain in progress until
-- a participant explicitly invokes the new completion recheck RPC.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_super_admin, is_sso_user, is_anonymous
)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'completion-client@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Synthetic Client"}', now(), now(), false, false, false),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'completion-freelancer@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Synthetic Freelancer"}', now(), now(), false, false, false),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'completion-unrelated@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Synthetic Unrelated User"}', now(), now(), false, false, false)
on conflict (id) do nothing;

create schema if not exists proofpay_validation;

create or replace function proofpay_validation.add_project(
  p_project_id uuid,
  p_agreement_id uuid,
  p_contract_type text,
  p_project_status text,
  p_milestone_statuses text[],
  p_milestone_amounts bigint[],
  p_hourly_rate_minor bigint default null
)
returns void
language plpgsql
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  milestone_index integer;
  project_total_minor bigint;
  hourly_job_id uuid;
  hourly_proposal_id uuid;
  hourly_offer_id uuid;
begin
  if p_contract_type = 'fixed' then
    if cardinality(p_milestone_statuses) <> cardinality(p_milestone_amounts)
       or cardinality(p_milestone_amounts) < 1
       or p_hourly_rate_minor is not null then
      raise exception 'Synthetic fixed-price fixture inputs do not match.';
    end if;
    select sum(amount)::bigint into project_total_minor
    from unnest(p_milestone_amounts) as expanded(amount);
  elsif p_contract_type = 'hourly' then
    if cardinality(p_milestone_statuses) <> 0
       or cardinality(p_milestone_amounts) <> 0
       or p_hourly_rate_minor is null or p_hourly_rate_minor <= 0 then
      raise exception 'Synthetic hourly fixture requires a positive rate and no milestones.';
    end if;
    project_total_minor := p_hourly_rate_minor;
  else
    raise exception 'Synthetic fixture contract type is invalid.';
  end if;

  insert into public.projects (
    id, created_by, idempotency_key, request_hash, title, description,
    client_name, budget_minor, currency, contract_type, status
  ) values (
    p_project_id,
    '00000000-0000-4000-8000-000000000001',
    p_project_id,
    repeat('a', 64),
    'Synthetic completion validation project',
    'Disposable PostgreSQL integration-test project with fictional records.',
    'Synthetic Client',
    project_total_minor,
    'USD', p_contract_type, p_project_status
  );

  insert into public.project_members (project_id, user_id, role)
  values
    (p_project_id, '00000000-0000-4000-8000-000000000001', 'client'),
    (p_project_id, '00000000-0000-4000-8000-000000000002', 'freelancer');

  insert into public.agreement_versions (
    id, project_id, version_number, created_by, state, title, scope_text,
    terms, total_minor, currency
  ) values (
    p_agreement_id, p_project_id, 1,
    '00000000-0000-4000-8000-000000000001', 'accepted',
    'Synthetic accepted agreement',
    'Fictional synthetic scope for isolated migration validation.',
    case when p_contract_type = 'hourly' then
      jsonb_build_object(
        'contractType', 'hourly',
        'hourlyRateMinor', p_hourly_rate_minor::text,
        'hourlyRateCurrency', 'USD'
      )
    else jsonb_build_object('contractType', 'fixed') end,
    project_total_minor,
    'USD'
  );

  update public.projects
  set current_agreement_version_id = p_agreement_id
  where id = p_project_id;

  insert into public.agreement_acceptances (agreement_version_id, user_id, member_role)
  values
    (p_agreement_id, '00000000-0000-4000-8000-000000000001', 'client'),
    (p_agreement_id, '00000000-0000-4000-8000-000000000002', 'freelancer');

  if p_contract_type = 'fixed' then
    for milestone_index in 1..cardinality(p_milestone_amounts) loop
      insert into public.milestones (
        project_id, agreement_version_id, sequence, title, description,
        deliverables, acceptance_criteria, completion_conditions,
        amount_minor, currency, workflow_status
      ) values (
        p_project_id, p_agreement_id, milestone_index,
        'Synthetic milestone ' || milestone_index,
        'Fictional test milestone used only by the disposable PostgreSQL workflow.',
        '["Synthetic deliverable"]'::jsonb,
        '["Synthetic acceptance criterion"]'::jsonb,
        '["Synthetic completion condition"]'::jsonb,
        p_milestone_amounts[milestone_index], 'USD', p_milestone_statuses[milestone_index]
      );
    end loop;
  else
    -- Accepted hourly agreements require a real synthetic hourly contract,
    -- offer linkage, and no fixed-price milestones.
    hourly_job_id := extensions.gen_random_uuid();
    hourly_proposal_id := extensions.gen_random_uuid();
    hourly_offer_id := extensions.gen_random_uuid();

    insert into public.marketplace_jobs (
      id, created_by, idempotency_key, request_hash, title, summary, description,
      requirements, category, experience_level, project_type,
      hourly_rate_min_minor, hourly_rate_max_minor, currency, status, published_at
    ) values (
      hourly_job_id, '00000000-0000-4000-8000-000000000001', extensions.gen_random_uuid(), repeat('c', 64),
      'Synthetic hourly validation job', 'Fictional hourly validation summary',
      'Fictional hourly job description for the isolated completion test fixture.',
      array['Synthetic hourly requirement'], 'validation', 'entry', 'hourly',
      p_hourly_rate_minor, p_hourly_rate_minor, 'USD', 'published', now()
    );

    insert into public.marketplace_proposals (
      job_id, freelancer_id, cover_letter, quote_minor, currency, timeline_days, status
    ) values (
      hourly_job_id, '00000000-0000-4000-8000-000000000002',
      'Synthetic proposal for the isolated hourly completion validation fixture.',
      p_hourly_rate_minor, 'USD', 1, 'accepted'
    ) returning id into hourly_proposal_id;

    insert into public.marketplace_offers (
      id, proposal_id, job_id, client_id, freelancer_id, idempotency_key,
      request_hash, terms, amount_minor, currency, timeline_days, status, project_id
    ) values (
      hourly_offer_id, hourly_proposal_id, hourly_job_id,
      '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
      extensions.gen_random_uuid(), repeat('d', 64),
      'Synthetic accepted hourly offer terms for validation.', p_hourly_rate_minor,
      'USD', 1, 'accepted', p_project_id
    );

    insert into public.hourly_contracts (
      project_id, marketplace_offer_id, freelancer_id, client_id,
      hourly_rate_minor, currency, agreement_version_id, status
    ) values (
      p_project_id, hourly_offer_id,
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
      p_hourly_rate_minor, 'USD', p_agreement_id, 'active'
    );
  end if;
end;
$$;

select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000110',
  'fixed', 'in_progress', array['approved', 'approved'], array[4000, 6000]::bigint[]
);

commit;
