begin;

alter table public.invoices
  add column accepted_agreement_version_id uuid,
  add column provider_status text,
  add column provider_observed_at timestamptz,
  add constraint invoices_accepted_agreement_fk
    foreign key (project_id, accepted_agreement_version_id)
    references public.agreement_versions (project_id, id) on delete restrict;

alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check check (status in (
  'not_created', 'create_pending', 'draft', 'send_pending', 'sent', 'scheduled',
  'payment_pending', 'partially_paid', 'paid', 'paid_external', 'cancelled', 'refunded',
  'refunded_external', 'partially_refunded', 'unknown'
));

create table public.paypal_operation_claims (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid not null references public.milestones (id) on delete restrict,
  invoice_id uuid references public.invoices (id) on delete cascade,
  operation text not null check (operation in ('create', 'send')),
  operation_key text not null,
  active_operation_key text,
  invoice_number text not null check (char_length(invoice_number) between 5 and 25),
  state text not null check (state in ('claimed', 'unknown', 'completed', 'rejected')),
  claimed_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state in ('claimed', 'unknown', 'completed')) = (active_operation_key is not null))
);

create unique index paypal_operation_claims_active_key_idx
  on public.paypal_operation_claims (active_operation_key)
  where active_operation_key is not null;
create unique index paypal_operation_claims_invoice_number_idx
  on public.paypal_operation_claims (invoice_number);
create index paypal_operation_claims_invoice_idx
  on public.paypal_operation_claims (invoice_id, operation, created_at desc);

alter table public.paypal_operation_claims enable row level security;
revoke all on public.paypal_operation_claims from public, anon, authenticated;

create or replace function public.list_paypal_invoice_candidates()
returns table (
  project_id uuid,
  project_title text,
  client_name text,
  milestone_id uuid,
  milestone_title text,
  amount_minor bigint,
  currency text,
  due_date date,
  invoice_id uuid,
  invoice_status text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.id, p.title, p.client_name, m.id, m.title, m.amount_minor, m.currency, m.due_date,
         i.id, i.status
  from public.projects p
  join public.project_members pm on pm.project_id = p.id and pm.user_id = auth.uid() and pm.role = 'freelancer'
  join public.milestones m on m.project_id = p.id
  join public.agreement_versions av on av.id = m.agreement_version_id and av.project_id = p.id
  left join public.invoices i on i.milestone_id = m.id
  where p.current_agreement_version_id = av.id
    and av.state = 'accepted'
    and m.workflow_status = 'approved'
    and (select count(distinct aa.member_role) from public.agreement_acceptances aa where aa.agreement_version_id = av.id) = 2
    and (i.id is null or i.status = 'not_created')
  order by p.updated_at desc, m.sequence;
$$;

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

  select u.email into target_client_email
  from public.project_members pm
  join auth.users u on u.id = pm.user_id
  where pm.project_id = target_project_id and pm.role = 'client'
  order by pm.joined_at
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

create or replace function public.begin_paypal_invoice_send(p_invoice_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := p_actor_id;
  target_invoice public.invoices%rowtype;
  target_claim public.paypal_operation_claims%rowtype;
  operation_key text;
begin
  if auth.role() is distinct from 'service_role' or actor_id is null then raise exception 'Sign in as the project freelancer to send an invoice.' using errcode = '42501'; end if;
  select i.*
    into target_invoice
  from public.invoices i
  join public.milestones m on m.id = i.milestone_id
  join public.projects p on p.id = i.project_id
  join public.agreement_versions av on av.id = m.agreement_version_id and av.project_id = p.id
  where i.id = p_invoice_id and exists (select 1 from public.project_members pm where pm.project_id = p.id and pm.user_id = actor_id and pm.role = 'freelancer')
    and p.current_agreement_version_id = av.id
    and i.accepted_agreement_version_id = av.id
    and av.state = 'accepted'
    and m.workflow_status = 'approved'
    and (select count(distinct aa.member_role) from public.agreement_acceptances aa where aa.agreement_version_id = av.id) = 2
  for update of i, m;
  if target_invoice.id is null then
    raise exception 'The invoice is not available to this freelancer or its milestone is no longer eligible.' using errcode = '42501';
  end if;
  if target_invoice.status <> 'draft' then
    select * into target_claim from public.paypal_operation_claims
      where invoice_id = target_invoice.id and operation = 'send'
      order by created_at desc limit 1;
    return jsonb_build_object(
      'claimed', false,
      'invoice', to_jsonb(target_invoice),
      'claim', case when target_claim.id is null then null else jsonb_build_object('id', target_claim.id, 'state', target_claim.state) end
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_invoice_id::text, 1));
  operation_key := 'send:' || p_invoice_id::text;
  insert into public.paypal_operation_claims (
    project_id, milestone_id, invoice_id, operation, operation_key,
    active_operation_key, invoice_number, state, claimed_by
  ) values (
    target_invoice.project_id, target_invoice.milestone_id, target_invoice.id, 'send', operation_key,
    operation_key, target_invoice.provider_invoice_number, 'claimed', actor_id
  ) returning * into target_claim;
  update public.invoices set status = 'send_pending', updated_at = now() where id = target_invoice.id returning * into target_invoice;
  return jsonb_build_object(
    'claimed', true,
    'invoice', to_jsonb(target_invoice),
    'claim', jsonb_build_object('id', target_claim.id, 'state', target_claim.state)
  );
end;
$$;

create or replace function public.finalize_paypal_operation(
  p_claim_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_provider_invoice_id text default null,
  p_provider_status text default null,
  p_invoice_status text default null,
  p_invoice_url text default null,
  p_paid_at timestamptz default null,
  p_observed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := p_actor_id;
  target_claim public.paypal_operation_claims%rowtype;
  target_invoice public.invoices%rowtype;
begin
  if p_outcome not in ('completed', 'unknown', 'rejected') then
    raise exception 'Invalid PayPal operation outcome.' using errcode = '22023';
  end if;
  select * into target_claim from public.paypal_operation_claims where id = p_claim_id for update;
  if target_claim.id is null then raise exception 'PayPal operation claim was not found.' using errcode = 'P0002'; end if;
  if auth.role() is distinct from 'service_role' or actor_id is null or actor_id <> target_claim.claimed_by then
    raise exception 'Only the claiming freelancer can finalize this invoice operation.' using errcode = '42501';
  end if;
  if target_claim.state not in ('claimed', 'unknown') then
    select * into target_invoice from public.invoices where id = target_claim.invoice_id;
    return jsonb_build_object('reused', true, 'invoice', to_jsonb(target_invoice), 'claimState', target_claim.state);
  end if;
  if p_outcome = 'completed' and (p_invoice_status is null or p_invoice_status not in (
    'draft', 'sent', 'scheduled', 'payment_pending', 'partially_paid', 'paid', 'paid_external', 'cancelled', 'refunded', 'refunded_external', 'partially_refunded', 'unknown'
  )) then
    raise exception 'A valid provider invoice state is required to complete this claim.' using errcode = '22023';
  end if;

  if p_outcome = 'unknown' then
    select * into target_invoice from public.invoices where id = target_claim.invoice_id for update;
    update public.paypal_operation_claims set state = 'unknown', updated_at = now()
      where id = target_claim.id;
    if (p_observed_at is not null and (target_invoice.provider_observed_at is null or p_observed_at >= target_invoice.provider_observed_at))
       or (p_observed_at is null and (target_invoice.provider_observed_at is null or target_invoice.provider_observed_at <= target_claim.created_at)) then
      update public.invoices set
        provider_invoice_id = coalesce(p_provider_invoice_id, provider_invoice_id),
        provider_status = coalesce(left(p_provider_status, 80), provider_status),
        status = 'unknown',
        invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
        provider_observed_at = coalesce(p_observed_at, provider_observed_at),
        updated_at = now()
      where id = target_claim.invoice_id returning * into target_invoice;
    end if;
  elsif p_outcome = 'rejected' then
    update public.paypal_operation_claims set state = 'rejected', active_operation_key = null, updated_at = now()
      where id = target_claim.id;
    update public.invoices set
      status = case when target_claim.operation = 'create' then 'not_created' else 'draft' end,
      provider_status = case when target_claim.operation = 'create' then null else provider_status end,
      provider_observed_at = coalesce(p_observed_at, provider_observed_at),
      invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
      updated_at = now()
    where id = target_claim.invoice_id returning * into target_invoice;
  else
    select * into target_invoice from public.invoices where id = target_claim.invoice_id for update;
    update public.paypal_operation_claims set state = 'completed', updated_at = now()
      where id = target_claim.id;
    if p_observed_at is null or target_invoice.provider_observed_at is null or p_observed_at >= target_invoice.provider_observed_at then
      update public.invoices set
        provider_invoice_id = coalesce(p_provider_invoice_id, provider_invoice_id),
        provider_status = left(p_provider_status, 80),
        status = p_invoice_status,
        invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
        paid_at = case when p_invoice_status = 'paid' then coalesce(p_paid_at, paid_at) else paid_at end,
        provider_observed_at = coalesce(p_observed_at, provider_observed_at),
        updated_at = now()
      where id = target_claim.invoice_id returning * into target_invoice;
    end if;
  end if;
  return jsonb_build_object('reused', false, 'invoice', to_jsonb(target_invoice), 'claimState', p_outcome);
end;
$$;

create or replace function public.get_paypal_invoice_reconciliation(p_invoice_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  actor_id uuid := p_actor_id;
  target_invoice public.invoices%rowtype;
  create_claim public.paypal_operation_claims%rowtype;
  send_claim public.paypal_operation_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' or actor_id is null then
    raise exception 'The invoice is not available to this freelancer.' using errcode = '42501';
  end if;
  select * into target_invoice from public.invoices i
  where i.id = p_invoice_id and exists (
    select 1 from public.project_members pm where pm.project_id = i.project_id and pm.user_id = actor_id and pm.role = 'freelancer'
  );
  if target_invoice.id is null then
    raise exception 'The invoice is not available to this freelancer.' using errcode = '42501';
  end if;
  select * into create_claim from public.paypal_operation_claims c
    where c.invoice_id = p_invoice_id and c.operation = 'create' and c.state in ('claimed', 'unknown')
    order by c.created_at desc limit 1;
  select * into send_claim from public.paypal_operation_claims c
    where c.invoice_id = p_invoice_id and c.operation = 'send' and c.state in ('claimed', 'unknown')
    order by c.created_at desc limit 1;
  return jsonb_build_object(
    'invoice', to_jsonb(target_invoice),
    'createClaim', case when create_claim.id is null then null else jsonb_build_object('id', create_claim.id, 'state', create_claim.state, 'invoiceNumber', create_claim.invoice_number) end,
    'sendClaim', case when send_claim.id is null then null else jsonb_build_object('id', send_claim.id, 'state', send_claim.state, 'invoiceNumber', send_claim.invoice_number) end
  );
end;
$$;

create or replace function public.record_paypal_invoice_state(
  p_invoice_id uuid,
  p_actor_id uuid,
  p_provider_status text,
  p_invoice_status text,
  p_invoice_url text default null,
  p_paid_at timestamptz default null,
  p_observed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_invoice public.invoices%rowtype;
begin
  if auth.role() is distinct from 'service_role' or p_actor_id is null then
    raise exception 'Only a verified server-side reconciliation can update PayPal state.' using errcode = '42501';
  end if;
  if p_invoice_status is null or p_invoice_status not in ('draft', 'sent', 'scheduled', 'payment_pending', 'partially_paid', 'paid', 'paid_external', 'cancelled', 'refunded', 'refunded_external', 'partially_refunded', 'unknown') then
    raise exception 'Invalid PayPal invoice state.' using errcode = '22023';
  end if;
  select * into target_invoice from public.invoices i
  where i.id = p_invoice_id and exists (
    select 1 from public.project_members pm where pm.project_id = i.project_id and pm.user_id = p_actor_id and pm.role = 'freelancer'
  )
  for update;
  if target_invoice.id is null then raise exception 'The invoice is not available to this freelancer.' using errcode = '42501'; end if;
  if p_observed_at is null or target_invoice.provider_observed_at is null or p_observed_at >= target_invoice.provider_observed_at then
    update public.invoices set
      provider_status = left(p_provider_status, 80),
      status = p_invoice_status,
      invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
      paid_at = case when p_invoice_status = 'paid' then coalesce(p_paid_at, paid_at) else paid_at end,
      provider_observed_at = coalesce(p_observed_at, provider_observed_at),
      updated_at = now()
    where id = p_invoice_id returning * into target_invoice;
  end if;
  return jsonb_build_object('invoice', to_jsonb(target_invoice));
end;
$$;

create or replace function public.apply_verified_paypal_webhook(
  p_provider_event_id text,
  p_event_type text,
  p_resource_id text,
  p_payload jsonb,
  p_provider_status text,
  p_invoice_status text,
  p_invoice_url text default null,
  p_paid_at timestamptz default null,
  p_observed_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  inserted_event_id uuid;
  target_invoice public.invoices%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This function accepts only verified server-side PayPal events.' using errcode = '42501';
  end if;
  if p_provider_event_id is null or char_length(p_provider_event_id) not between 1 and 255
     or p_event_type is null or char_length(p_event_type) not between 1 and 120
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid PayPal event payload.' using errcode = '22023';
  end if;
  if p_invoice_status is null or p_invoice_status not in ('draft', 'sent', 'scheduled', 'payment_pending', 'partially_paid', 'paid', 'paid_external', 'cancelled', 'refunded', 'refunded_external', 'partially_refunded', 'unknown') then
    raise exception 'Invalid PayPal invoice state.' using errcode = '22023';
  end if;
  insert into public.paypal_webhook_events (provider_event_id, event_type, resource_id, payload)
  values (p_provider_event_id, p_event_type, p_resource_id, p_payload)
  on conflict (provider_event_id) do nothing
  returning id into inserted_event_id;
  if inserted_event_id is null then
    return jsonb_build_object('duplicate', true, 'matched', false);
  end if;

  if p_resource_id is not null then
    select * into target_invoice from public.invoices where provider = 'paypal' and provider_invoice_id = p_resource_id for update;
    if target_invoice.id is not null
       and (p_observed_at is null or target_invoice.provider_observed_at is null or p_observed_at >= target_invoice.provider_observed_at) then
      update public.invoices set
        provider_status = left(p_provider_status, 80),
        status = p_invoice_status,
        invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
        paid_at = case when p_invoice_status = 'paid' then coalesce(p_paid_at, paid_at) else paid_at end,
        provider_observed_at = coalesce(p_observed_at, provider_observed_at),
        updated_at = now()
      where id = target_invoice.id
      returning * into target_invoice;
    end if;
  end if;
  update public.paypal_webhook_events set processed_at = now() where id = inserted_event_id;
  return jsonb_build_object('duplicate', false, 'matched', target_invoice.id is not null, 'invoiceId', target_invoice.id, 'status', target_invoice.status);
end;
$$;

revoke all on function public.list_paypal_invoice_candidates() from public, anon;
revoke all on function public.begin_paypal_invoice_create(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.begin_paypal_invoice_send(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finalize_paypal_operation(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.get_paypal_invoice_reconciliation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_paypal_invoice_state(uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.apply_verified_paypal_webhook(text, text, text, jsonb, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.list_paypal_invoice_candidates() to authenticated;
grant execute on function public.begin_paypal_invoice_create(uuid, text, uuid) to service_role;
grant execute on function public.begin_paypal_invoice_send(uuid, uuid) to service_role;
grant execute on function public.finalize_paypal_operation(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.get_paypal_invoice_reconciliation(uuid, uuid) to service_role;
grant execute on function public.record_paypal_invoice_state(uuid, uuid, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.apply_verified_paypal_webhook(text, text, text, jsonb, text, text, text, timestamptz, timestamptz) to service_role;

commit;
