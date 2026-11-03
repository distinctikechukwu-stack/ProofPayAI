begin;

create or replace function public.begin_paypal_invoice_create(p_milestone_id uuid, p_invoice_number text, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := p_actor_id;
  target_project_id uuid;
  target_agreement_id uuid;
  target_title text;
  target_amount bigint;
  target_currency text;
  target_client_email text;
  target_client_name text;
  target_invoice public.invoices%rowtype;
  target_claim public.paypal_operation_claims%rowtype;
  operation_key text;
begin
  if auth.role() is distinct from 'service_role' or actor_id is null or p_invoice_number is null or char_length(p_invoice_number) not between 5 and 25 then
    raise exception 'A signed-in freelancer and valid invoice number are required.' using errcode = '22023';
  end if;

  select p.id, av.id, m.title, m.amount_minor, m.currency, p.client_name
    into target_project_id, target_agreement_id, target_title, target_amount, target_currency, target_client_name
  from public.milestones m
  join public.projects p on p.id = m.project_id
  join public.agreement_versions av on av.id = m.agreement_version_id and av.project_id = p.id
  where m.id = p_milestone_id
    and p.current_agreement_version_id = av.id
    and av.state = 'accepted'
    and m.workflow_status = 'approved'
    and exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = actor_id and pm.role = 'freelancer')
    and (select count(distinct aa.member_role) from public.agreement_acceptances aa where aa.agreement_version_id = av.id) = 2
  for update of p, m;
  if target_project_id is null then
    raise exception 'Only a project freelancer can invoice a client-approved milestone in the current accepted agreement.' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(client_profile.billing_email), ''), nullif(btrim(auth_user.email), ''))
    into target_client_email
  from public.project_members project_client
  join auth.users auth_user on auth_user.id = project_client.user_id
  left join public.client_profiles client_profile on client_profile.user_id = project_client.user_id
  where project_client.project_id = target_project_id and project_client.role = 'client'
  order by project_client.joined_at
  limit 1;
  if target_client_email is null or target_client_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'The approved project client needs a valid account email before an invoice can be created.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_milestone_id::text, 0));
  select * into target_invoice from public.invoices where milestone_id = p_milestone_id for update;
  if found and target_invoice.status <> 'not_created' then
    select * into target_claim from public.paypal_operation_claims
      where invoice_id = target_invoice.id and operation = 'create'
      order by created_at desc limit 1;
    return jsonb_build_object(
      'claimed', false,
      'invoice', to_jsonb(target_invoice),
      'claim', case when target_claim.id is null then null else jsonb_build_object('id', target_claim.id, 'state', target_claim.state) end
    );
  end if;

  operation_key := 'create:' || p_milestone_id::text || ':' || target_agreement_id::text;
  if target_invoice.id is null then
    insert into public.invoices (
      project_id, milestone_id, created_by, provider_invoice_number, status,
      amount_minor, currency, accepted_agreement_version_id
    ) values (
      target_project_id, p_milestone_id, actor_id, p_invoice_number, 'create_pending',
      target_amount, target_currency, target_agreement_id
    ) returning * into target_invoice;
  else
    update public.invoices set
      created_by = actor_id,
      provider_invoice_number = p_invoice_number,
      provider_invoice_id = null,
      provider_status = null,
      status = 'create_pending',
      amount_minor = target_amount,
      currency = target_currency,
      accepted_agreement_version_id = target_agreement_id,
      invoice_url = null,
      paid_at = null,
      updated_at = now()
    where id = target_invoice.id returning * into target_invoice;
  end if;

  insert into public.paypal_operation_claims (
    project_id, milestone_id, invoice_id, operation, operation_key,
    active_operation_key, invoice_number, state, claimed_by
  ) values (
    target_project_id, p_milestone_id, target_invoice.id, 'create', operation_key,
    operation_key, p_invoice_number, 'claimed', actor_id
  ) returning * into target_claim;

  return jsonb_build_object(
    'claimed', true,
    'invoice', to_jsonb(target_invoice),
    'claim', jsonb_build_object('id', target_claim.id, 'state', target_claim.state),
    'clientEmail', target_client_email,
    'clientName', target_client_name,
    'milestoneTitle', target_title
  );
end;
$$;

commit;
