begin;

alter table public.invoices
  add column provider_updated_at timestamptz;

create or replace function public.paypal_invoice_snapshot_is_current(
  p_current_updated_at timestamptz,
  p_current_observed_at timestamptz,
  p_incoming_updated_at timestamptz,
  p_incoming_observed_at timestamptz,
  p_current_status text,
  p_incoming_status text,
  p_current_provider_status text,
  p_incoming_provider_status text
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_incoming_observed_at is null then false
    when p_incoming_updated_at is not null then case
      when p_current_updated_at is null then true
      when p_incoming_updated_at > p_current_updated_at then true
      when p_incoming_updated_at = p_current_updated_at then
        p_current_status is not distinct from p_incoming_status
        and upper(p_current_provider_status) is not distinct from upper(p_incoming_provider_status)
      else false
    end
    when p_current_updated_at is not null then false
    when p_current_observed_at is null then true
    when p_incoming_observed_at > p_current_observed_at then true
    when p_incoming_observed_at = p_current_observed_at then
      p_current_status is not distinct from p_incoming_status
      and upper(p_current_provider_status) is not distinct from upper(p_incoming_provider_status)
    else false
  end;
$$;

create or replace function public.paypal_invoice_transition_allowed(
  p_current_status text,
  p_next_status text
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_current_status is null or p_next_status is null then false
    when p_current_status = p_next_status then true
    -- PayPal documents that a sent invoice cannot return to DRAFT and that a
    -- draft cannot be cancelled. A draft may be sent or scheduled.
    when p_current_status = 'draft' then p_next_status in ('sent', 'scheduled', 'unknown')
    when p_current_status = 'scheduled' then p_next_status in ('sent', 'cancelled', 'unknown')
    -- Sent/Unpaid invoices remain open through pending, partial, and full
    -- payments. The API supports cancelling sent invoices and refund states.
    when p_current_status in ('sent', 'payment_pending') then
      p_next_status in ('sent', 'payment_pending', 'partially_paid', 'paid', 'paid_external', 'cancelled', 'partially_refunded', 'refunded', 'refunded_external', 'unknown')
    when p_current_status = 'partially_paid' then
      p_next_status in ('sent', 'payment_pending', 'paid', 'paid_external', 'cancelled', 'partially_refunded', 'refunded', 'refunded_external', 'unknown')
    when p_current_status = 'paid' then
      p_next_status in ('partially_refunded', 'refunded')
    -- Manual payments/refunds may be removed using the documented external
    -- payment/refund operations. These reversals stay in the external-payment
    -- family unless PayPal subsequently reports another current state.
    when p_current_status = 'paid_external' then
      p_next_status in ('sent', 'payment_pending', 'partially_paid', 'paid', 'cancelled', 'partially_refunded', 'refunded', 'refunded_external', 'unknown')
    when p_current_status = 'partially_refunded' then
      p_next_status in ('partially_paid', 'paid', 'paid_external', 'refunded', 'refunded_external')
    when p_current_status = 'refunded_external' then
      p_next_status in ('sent', 'partially_paid', 'paid_external', 'partially_refunded', 'refunded')
    when p_current_status = 'refunded' then false
    when p_current_status = 'cancelled' then false
    when p_current_status in ('not_created', 'create_pending', 'send_pending') then
      p_next_status in ('draft', 'scheduled', 'sent', 'payment_pending', 'partially_paid', 'paid', 'paid_external', 'cancelled', 'partially_refunded', 'refunded', 'refunded_external', 'unknown')
    -- Unknown is used for provider states this version does not map. A later,
    -- newer provider snapshot may resolve it to any recognized invoice state.
    when p_current_status = 'unknown' then
      p_next_status in ('draft', 'scheduled', 'sent', 'payment_pending', 'partially_paid', 'paid', 'paid_external', 'cancelled', 'partially_refunded', 'refunded', 'refunded_external', 'unknown')
    else false
  end;
$$;

-- Internal operation markers share invoices.status for compatibility with the
-- existing API. Only the matching transactional claim may advance or resolve
-- one of these states; provider snapshots are handled by separate RPC logic.
create or replace function public.paypal_internal_operation_transition_allowed(
  p_invoice_id uuid,
  p_current_status text,
  p_next_status text
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select case
    when p_current_status = 'not_created' and p_next_status = 'create_pending' then exists (
      select 1 from public.paypal_operation_claims claim
      where claim.invoice_id = p_invoice_id and claim.operation = 'create' and claim.state = 'claimed'
    )
    when p_current_status = 'draft' and p_next_status = 'send_pending' then exists (
      select 1 from public.paypal_operation_claims claim
      where claim.invoice_id = p_invoice_id and claim.operation = 'send' and claim.state = 'claimed'
    )
    when p_current_status = 'create_pending' and p_next_status = 'not_created' then exists (
      select 1 from public.paypal_operation_claims claim
      where claim.invoice_id = p_invoice_id and claim.operation = 'create' and claim.state = 'rejected'
    )
    when p_current_status = 'create_pending' and p_next_status = 'unknown' then exists (
      select 1 from public.paypal_operation_claims claim
      where claim.invoice_id = p_invoice_id and claim.operation = 'create' and claim.state = 'unknown'
    )
    when p_current_status = 'send_pending' and p_next_status = 'draft' then exists (
      select 1 from public.paypal_operation_claims claim
      where claim.invoice_id = p_invoice_id and claim.operation = 'send' and claim.state = 'rejected'
    )
    when p_current_status = 'send_pending' and p_next_status = 'unknown' then exists (
      select 1 from public.paypal_operation_claims claim
      where claim.invoice_id = p_invoice_id and claim.operation = 'send' and claim.state = 'unknown'
    )
    else false
  end;
$$;

create or replace function public.paypal_invoice_snapshot_rejection_reason(
  p_current_updated_at timestamptz,
  p_current_observed_at timestamptz,
  p_incoming_updated_at timestamptz,
  p_incoming_observed_at timestamptz,
  p_current_status text,
  p_incoming_status text,
  p_current_provider_status text,
  p_incoming_provider_status text
)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_incoming_observed_at is null then 'missing_observation_time'
    when p_incoming_updated_at is not null and p_current_updated_at is not null
      and p_incoming_updated_at < p_current_updated_at then 'stale_provider_version'
    when p_incoming_updated_at is not null and p_current_updated_at is not null
      and p_incoming_updated_at = p_current_updated_at
      and (p_current_status is distinct from p_incoming_status
        or upper(p_current_provider_status) is distinct from upper(p_incoming_provider_status))
      then 'conflicting_equal_provider_version'
    when p_incoming_updated_at is null and p_current_updated_at is not null then 'missing_provider_version'
    when p_incoming_updated_at is null and p_current_updated_at is null
      and p_current_observed_at is not null and p_incoming_observed_at < p_current_observed_at
      then 'stale_observation'
    when p_incoming_updated_at is null and p_current_updated_at is null
      and p_current_observed_at = p_incoming_observed_at
      and (p_current_status is distinct from p_incoming_status
        or upper(p_current_provider_status) is distinct from upper(p_incoming_provider_status))
      then 'conflicting_equal_observation'
    else null
  end;
$$;

create or replace function public.prevent_paypal_paid_invoice_regression()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  provider_snapshot_changed boolean;
  current_provider_status text;
  next_provider_status text;
begin
  if old.provider <> 'paypal' then return new; end if;

  if new.provider is distinct from 'paypal'
     or (old.provider_invoice_id is not null and new.provider_invoice_id is distinct from old.provider_invoice_id) then
    raise exception 'The PayPal provider and invoice identity are immutable once linked.' using errcode = '23514';
  end if;

  provider_snapshot_changed :=
    new.provider_invoice_id is distinct from old.provider_invoice_id
    or new.provider_status is distinct from old.provider_status
    or new.invoice_url is distinct from old.invoice_url
    or new.paid_at is distinct from old.paid_at
    or new.provider_observed_at is distinct from old.provider_observed_at
    or new.provider_updated_at is distinct from old.provider_updated_at;

  if not provider_snapshot_changed then
    if new.status is distinct from old.status
       and not public.paypal_internal_operation_transition_allowed(old.id, old.status, new.status) then
      raise exception 'The invoice status change is neither an authorized operation transition nor a provider snapshot.' using errcode = '23514';
    end if;
    return new;
  end if;

  current_provider_status := case
    when old.provider_status is null then old.status
    else public.paypal_invoice_status(old.provider_status)
  end;
  next_provider_status := public.paypal_invoice_status(new.provider_status);
  if public.paypal_invoice_snapshot_rejection_reason(
       old.provider_updated_at, old.provider_observed_at,
       new.provider_updated_at, new.provider_observed_at,
       current_provider_status, next_provider_status,
       old.provider_status, new.provider_status
     ) is not null
     or not public.paypal_invoice_transition_allowed(current_provider_status, next_provider_status) then
    raise exception 'The PayPal invoice snapshot is stale, conflicting, or an invalid provider transition.' using errcode = '40001';
  end if;

  if old.provider_observed_at is not null
     and (new.provider_observed_at is null or new.provider_observed_at < old.provider_observed_at) then
    new.provider_observed_at := old.provider_observed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_prevent_paypal_paid_regression on public.invoices;
create trigger invoices_prevent_paypal_paid_regression
before update of provider, provider_invoice_id, status, provider_status, invoice_url,
  paid_at, provider_observed_at, provider_updated_at on public.invoices
for each row execute function public.prevent_paypal_paid_invoice_regression();

create or replace function public.begin_paypal_invoice_create(
  p_milestone_id uuid,
  p_invoice_number text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
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
  if auth.role() is distinct from 'service_role'
     or p_actor_id is null
     or p_invoice_number is null
     or char_length(p_invoice_number) not between 5 and 25 then
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
    and exists (
      select 1 from public.project_members pm
      where pm.project_id = p.id and pm.user_id = p_actor_id and pm.role = 'freelancer'
    )
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
      'claim', case when target_claim.id is null then null
                    else jsonb_build_object('id', target_claim.id, 'state', target_claim.state) end
    );
  end if;

  operation_key := 'create:' || p_milestone_id::text || ':' || target_agreement_id::text;
  if target_invoice.id is null then
    insert into public.invoices (
      project_id, milestone_id, created_by, provider_invoice_number, status,
      amount_minor, currency, accepted_agreement_version_id
    ) values (
      target_project_id, p_milestone_id, p_actor_id, p_invoice_number, 'not_created',
      target_amount, target_currency, target_agreement_id
    ) returning * into target_invoice;
  end if;

  insert into public.paypal_operation_claims (
    project_id, milestone_id, invoice_id, operation, operation_key,
    active_operation_key, invoice_number, state, claimed_by
  ) values (
    target_project_id, p_milestone_id, target_invoice.id, 'create', operation_key,
    operation_key, p_invoice_number, 'claimed', p_actor_id
  ) returning * into target_claim;

  update public.invoices set
    created_by = p_actor_id,
    provider_invoice_number = p_invoice_number,
    status = 'create_pending',
    amount_minor = target_amount,
    currency = target_currency,
    accepted_agreement_version_id = target_agreement_id,
    updated_at = clock_timestamp()
  where id = target_invoice.id
  returning * into target_invoice;

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

drop function public.finalize_paypal_operation(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz);

create function public.finalize_paypal_operation(
  p_claim_id uuid,
  p_actor_id uuid,
  p_outcome text,
  p_provider_invoice_id text default null,
  p_provider_status text default null,
  p_invoice_status text default null,
  p_invoice_url text default null,
  p_paid_at timestamptz default null,
  p_observed_at timestamptz default null,
  p_provider_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_claim public.paypal_operation_claims%rowtype;
  target_invoice public.invoices%rowtype;
  current_provider_status text;
  mapped_status text;
  rejection_reason text;
  has_snapshot boolean;
  apply_snapshot boolean := false;
  next_claim_state text;
begin
  if auth.role() is distinct from 'service_role' or p_actor_id is null then
    raise exception 'Only the claiming freelancer can finalize this invoice operation.' using errcode = '42501';
  end if;
  if p_outcome not in ('completed', 'unknown', 'rejected') then
    raise exception 'Invalid PayPal operation outcome.' using errcode = '22023';
  end if;

  select * into target_claim
  from public.paypal_operation_claims
  where id = p_claim_id
  for update;
  if target_claim.id is null then
    raise exception 'PayPal operation claim was not found.' using errcode = 'P0002';
  end if;
  if p_actor_id is distinct from target_claim.claimed_by then
    raise exception 'Only the claiming freelancer can finalize this invoice operation.' using errcode = '42501';
  end if;
  if target_claim.state not in ('claimed', 'unknown') then
    select * into target_invoice from public.invoices where id = target_claim.invoice_id;
    return jsonb_build_object(
      'reused', true,
      'invoice', to_jsonb(target_invoice),
      'claimState', target_claim.state,
      'snapshotRequired', false,
      'snapshotApplied', false
    );
  end if;

  select * into target_invoice
  from public.invoices
  where id = target_claim.invoice_id
  for update;
  if target_invoice.id is null then
    raise exception 'The invoice for this PayPal operation was not found.' using errcode = 'P0002';
  end if;

  has_snapshot := p_provider_invoice_id is not null
    or p_provider_status is not null
    or p_invoice_status is not null
    or p_invoice_url is not null
    or p_paid_at is not null
    or p_observed_at is not null
    or p_provider_updated_at is not null;
  if has_snapshot then
    if p_provider_invoice_id is null
       or char_length(p_provider_invoice_id) not between 1 and 255
       or p_provider_status is null
       or char_length(p_provider_status) not between 1 and 80
       or p_invoice_status is null
       or p_observed_at is null then
      raise exception 'The provider invoice snapshot is incomplete.' using errcode = '22023';
    end if;
    mapped_status := public.paypal_invoice_status(p_provider_status);
    if p_invoice_status is distinct from mapped_status then
      raise exception 'The mapped invoice status does not match the provider status.' using errcode = '22023';
    end if;
    if target_invoice.provider_invoice_id is not null
       and target_invoice.provider_invoice_id is distinct from p_provider_invoice_id then
      raise exception 'The PayPal invoice identity cannot be reassigned.' using errcode = '23514';
    end if;
    current_provider_status := case
      when target_invoice.provider_status is null then target_invoice.status
      else public.paypal_invoice_status(target_invoice.provider_status)
    end;
    rejection_reason := public.paypal_invoice_snapshot_rejection_reason(
      target_invoice.provider_updated_at,
      target_invoice.provider_observed_at,
      p_provider_updated_at,
      p_observed_at,
      current_provider_status,
      mapped_status,
      target_invoice.provider_status,
      p_provider_status
    );
    if rejection_reason is null
       and not public.paypal_invoice_transition_allowed(current_provider_status, mapped_status) then
      rejection_reason := 'invalid_provider_transition';
    end if;
    apply_snapshot := rejection_reason is null;
  elsif p_outcome = 'completed' then
    raise exception 'A provider invoice snapshot is required to complete this claim.' using errcode = '22023';
  end if;

  next_claim_state := case
    when has_snapshot and not apply_snapshot then 'unknown'
    when p_outcome = 'rejected' and has_snapshot and mapped_status <> 'draft' then 'unknown'
    else p_outcome
  end;
  update public.paypal_operation_claims
  set state = next_claim_state,
      active_operation_key = case when next_claim_state = 'rejected' then null else active_operation_key end,
      updated_at = clock_timestamp()
  where id = target_claim.id
  returning * into target_claim;

  if apply_snapshot then
    update public.invoices
    set provider_invoice_id = coalesce(provider_invoice_id, p_provider_invoice_id),
        provider_status = left(p_provider_status, 80),
        status = mapped_status,
        invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
        paid_at = case when mapped_status = 'paid' then coalesce(p_paid_at, paid_at) else paid_at end,
        provider_observed_at = case
          when provider_observed_at is null or p_observed_at > provider_observed_at then p_observed_at
          else provider_observed_at
        end,
        provider_updated_at = p_provider_updated_at,
        updated_at = clock_timestamp()
    where id = target_invoice.id
    returning * into target_invoice;
  elsif has_snapshot and next_claim_state = 'unknown'
        and target_invoice.status in ('create_pending', 'send_pending') then
    update public.invoices set status = 'unknown', updated_at = clock_timestamp()
    where id = target_invoice.id
    returning * into target_invoice;
  elsif not has_snapshot and next_claim_state = 'unknown'
        and target_invoice.status in ('create_pending', 'send_pending') then
    update public.invoices set status = 'unknown', updated_at = clock_timestamp()
    where id = target_invoice.id
    returning * into target_invoice;
  elsif not has_snapshot and next_claim_state = 'rejected' then
    if target_claim.operation = 'create' and target_invoice.status = 'create_pending' then
      update public.invoices set status = 'not_created', updated_at = clock_timestamp()
      where id = target_invoice.id
      returning * into target_invoice;
    elsif target_claim.operation = 'send' and target_invoice.status = 'send_pending' then
      update public.invoices set status = 'draft', updated_at = clock_timestamp()
      where id = target_invoice.id
      returning * into target_invoice;
    end if;
  end if;

  return jsonb_build_object(
    'reused', false,
    'invoice', to_jsonb(target_invoice),
    'claimState', target_claim.state,
    'snapshotRequired', has_snapshot,
    'snapshotApplied', apply_snapshot,
    'snapshotRejectionReason', rejection_reason
  );
end;
$$;

drop function public.record_paypal_invoice_state(uuid, uuid, text, text, text, timestamptz, timestamptz);

create function public.record_paypal_invoice_state(
  p_invoice_id uuid,
  p_actor_id uuid,
  p_provider_status text,
  p_invoice_status text,
  p_invoice_url text default null,
  p_paid_at timestamptz default null,
  p_observed_at timestamptz default null,
  p_provider_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_invoice public.invoices%rowtype;
  current_provider_status text;
  mapped_status text;
  rejection_reason text;
begin
  if auth.role() is distinct from 'service_role' or p_actor_id is null then
    raise exception 'Only a verified server-side reconciliation can update PayPal state.' using errcode = '42501';
  end if;
  if p_provider_status is null or char_length(p_provider_status) not between 1 and 80 or p_observed_at is null then
    raise exception 'A provider invoice status and observation time are required.' using errcode = '22023';
  end if;

  select * into target_invoice
  from public.invoices i
  where i.id = p_invoice_id
    and i.provider = 'paypal'
    and i.provider_invoice_id is not null
    and exists (
      select 1 from public.project_members pm
      where pm.project_id = i.project_id and pm.user_id = p_actor_id and pm.role = 'freelancer'
    )
  for update;
  if target_invoice.id is null then
    raise exception 'The invoice is not available to this freelancer.' using errcode = '42501';
  end if;

  mapped_status := public.paypal_invoice_status(p_provider_status);
  if p_invoice_status is distinct from mapped_status then
    raise exception 'The mapped invoice status does not match the provider status.' using errcode = '22023';
  end if;
  current_provider_status := case
    when target_invoice.provider_status is null then target_invoice.status
    else public.paypal_invoice_status(target_invoice.provider_status)
  end;
  rejection_reason := public.paypal_invoice_snapshot_rejection_reason(
    target_invoice.provider_updated_at,
    target_invoice.provider_observed_at,
    p_provider_updated_at,
    p_observed_at,
    current_provider_status,
    mapped_status,
    target_invoice.provider_status,
    p_provider_status
  );
  if rejection_reason is null
     and not public.paypal_invoice_transition_allowed(current_provider_status, mapped_status) then
    rejection_reason := 'invalid_provider_transition';
  end if;

  if rejection_reason is null then
    update public.invoices
    set provider_status = left(p_provider_status, 80),
        status = mapped_status,
        invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
        paid_at = case when mapped_status = 'paid' then coalesce(p_paid_at, paid_at) else paid_at end,
        provider_observed_at = case
          when provider_observed_at is null or p_observed_at > provider_observed_at then p_observed_at
          else provider_observed_at
        end,
        provider_updated_at = p_provider_updated_at,
        updated_at = clock_timestamp()
    where id = target_invoice.id
    returning * into target_invoice;
  end if;

  return jsonb_build_object(
    'invoice', to_jsonb(target_invoice),
    'snapshotRequired', true,
    'snapshotApplied', rejection_reason is null,
    'snapshotRejectionReason', rejection_reason
  );
end;
$$;

drop function public.complete_verified_paypal_webhook(uuid, uuid, text, text, text, timestamptz, timestamptz);

create function public.complete_verified_paypal_webhook(
  p_event_id uuid,
  p_lease_token uuid,
  p_provider_invoice_id text default null,
  p_provider_status text default null,
  p_invoice_url text default null,
  p_paid_at timestamptz default null,
  p_observed_at timestamptz default null,
  p_provider_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_event public.paypal_webhook_events%rowtype;
  target_invoice public.invoices%rowtype;
  current_provider_status text;
  mapped_status text;
  rejection_reason text;
  applied boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This function accepts only the server webhook worker.' using errcode = '42501';
  end if;
  select * into target_event from public.paypal_webhook_events where id = p_event_id for update;
  if target_event.id is null then
    raise exception 'The verified webhook event does not exist.' using errcode = '22023';
  end if;
  if target_event.processed_at is not null then
    return jsonb_build_object('duplicate', true, 'matched', false, 'status', 'processed');
  end if;
  if target_event.dead_lettered_at is not null
     or target_event.lease_token is distinct from p_lease_token
     or target_event.lease_expires_at is null
     or target_event.lease_expires_at <= clock_timestamp() then
    raise exception 'The webhook processing lease is no longer current.' using errcode = '55000';
  end if;

  if p_provider_invoice_id is null then
    if p_provider_status is not null or p_observed_at is not null or p_provider_updated_at is not null then
      raise exception 'A missing provider invoice cannot include a state snapshot.' using errcode = '22023';
    end if;
    update public.paypal_webhook_events
    set processed_at = clock_timestamp(), processing_error = 'provider_invoice_not_found',
        lease_token = null, lease_expires_at = null
    where id = target_event.id;
    return jsonb_build_object('duplicate', false, 'matched', false, 'status', 'provider_invoice_not_found');
  end if;

  if p_provider_invoice_id is distinct from target_event.resource_id
     or p_provider_status is null or char_length(p_provider_status) not between 1 and 80
     or p_observed_at is null then
    raise exception 'The PayPal invoice snapshot does not match the verified event.' using errcode = '22023';
  end if;
  mapped_status := public.paypal_invoice_status(p_provider_status);

  select * into target_invoice
  from public.invoices
  where provider = 'paypal' and provider_invoice_id = p_provider_invoice_id
  for update;

  if target_invoice.id is not null
  then
    current_provider_status := case
      when target_invoice.provider_status is null then target_invoice.status
      else public.paypal_invoice_status(target_invoice.provider_status)
    end;
    rejection_reason := public.paypal_invoice_snapshot_rejection_reason(
       target_invoice.provider_updated_at,
       target_invoice.provider_observed_at,
       p_provider_updated_at,
       p_observed_at,
       current_provider_status,
       mapped_status,
       target_invoice.provider_status,
       p_provider_status
     );
    if rejection_reason is null
       and not public.paypal_invoice_transition_allowed(current_provider_status, mapped_status) then
      rejection_reason := 'invalid_provider_transition';
    end if;
  end if;

  if target_invoice.id is not null and rejection_reason is null then
    update public.invoices
    set provider_status = left(p_provider_status, 80),
        status = mapped_status,
        invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
        paid_at = case when mapped_status = 'paid' then coalesce(p_paid_at, paid_at) else paid_at end,
        provider_observed_at = case
          when target_invoice.provider_observed_at is null or p_observed_at > target_invoice.provider_observed_at then p_observed_at
          else target_invoice.provider_observed_at
        end,
        provider_updated_at = coalesce(p_provider_updated_at, provider_updated_at),
        updated_at = clock_timestamp()
    where id = target_invoice.id
      and provider = 'paypal'
    returning * into target_invoice;
    applied := found;
  end if;

  update public.paypal_webhook_events
  set processed_at = clock_timestamp(),
      processing_error = case
        when target_invoice.id is null then 'invoice_not_linked_locally'
        when rejection_reason is not null then 'snapshot_' || rejection_reason
        else null
      end,
      lease_token = null,
      lease_expires_at = null
  where id = target_event.id;

  return jsonb_build_object(
    'duplicate', false,
    'matched', target_invoice.id is not null,
    'applied', applied,
    'snapshotApplied', applied,
    'snapshotRejectionReason', rejection_reason,
    'invoiceId', target_invoice.id,
    'status', target_invoice.status
  );
end;
$$;

revoke all on function public.paypal_invoice_snapshot_is_current(timestamptz, timestamptz, timestamptz, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.paypal_invoice_transition_allowed(text, text)
  from public, anon, authenticated;
revoke all on function public.paypal_internal_operation_transition_allowed(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.paypal_invoice_snapshot_rejection_reason(timestamptz, timestamptz, timestamptz, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.paypal_invoice_snapshot_is_current(timestamptz, timestamptz, timestamptz, timestamptz, text, text, text, text)
  to service_role;
grant execute on function public.paypal_invoice_transition_allowed(text, text)
  to service_role;
revoke all on function public.finalize_paypal_operation(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.finalize_paypal_operation(uuid, uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;
revoke all on function public.record_paypal_invoice_state(uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_paypal_invoice_state(uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;
revoke all on function public.complete_verified_paypal_webhook(uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_verified_paypal_webhook(uuid, uuid, text, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;

commit;
