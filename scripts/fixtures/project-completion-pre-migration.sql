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
  p_milestone_amounts bigint[]
)
returns void
language plpgsql
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  milestone_index integer;
begin
  if cardinality(p_milestone_statuses) <> cardinality(p_milestone_amounts)
     or cardinality(p_milestone_amounts) < 1 then
    raise exception 'Synthetic fixture milestone arrays do not match.';
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
    (select sum(amount) from unnest(p_milestone_amounts) as expanded(amount)),
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
    jsonb_build_object('contractType', p_contract_type),
    (select sum(amount) from unnest(p_milestone_amounts) as expanded(amount)),
    'USD'
  );

  update public.projects
  set current_agreement_version_id = p_agreement_id
  where id = p_project_id;

  insert into public.agreement_acceptances (agreement_version_id, user_id, member_role)
  values
    (p_agreement_id, '00000000-0000-4000-8000-000000000001', 'client'),
    (p_agreement_id, '00000000-0000-4000-8000-000000000002', 'freelancer');

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
end;
$$;

select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000110',
  'fixed', 'in_progress', array['approved', 'approved'], array[4000, 6000]::bigint[]
);

commit;
