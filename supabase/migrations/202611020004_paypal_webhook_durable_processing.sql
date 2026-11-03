begin;

-- Keep verified deliveries as a durable inbox. Existing rows are deliberately not
-- assumed verified by this queue; only the enqueue RPC sets verified_at.
alter table public.paypal_webhook_events
  add column verified_at timestamptz,
  add column attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  add column next_attempt_at timestamptz not null default now(),
  add column last_attempt_at timestamptz,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column dead_lettered_at timestamptz;

drop index if exists public.paypal_webhook_events_unprocessed_idx;
create index paypal_webhook_events_retry_idx
  on public.paypal_webhook_events (next_attempt_at, received_at, id)
  where processed_at is null and dead_lettered_at is null and verified_at is not null;

revoke all on public.paypal_webhook_events from public, anon, authenticated;

create or replace function public.paypal_invoice_status(p_provider_status text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case upper(coalesce(p_provider_status, ''))
    when 'DRAFT' then 'draft'
    when 'SENT' then 'sent'
    when 'UNPAID' then 'sent'
    when 'SCHEDULED' then 'scheduled'
    when 'PAYMENT_PENDING' then 'payment_pending'
    when 'PARTIALLY_PAID' then 'partially_paid'
    when 'PAID' then 'paid'
    when 'MARKED_AS_PAID' then 'paid_external'
    when 'PAID_EXTERNAL' then 'paid_external'
    when 'CANCELLED' then 'cancelled'
    when 'AUTO_CANCELLED' then 'cancelled'
    when 'REFUNDED' then 'refunded'
    when 'MARKED_AS_REFUNDED' then 'refunded_external'
    when 'REFUNDED_EXTERNAL' then 'refunded_external'
    when 'PARTIALLY_REFUNDED' then 'partially_refunded'
    else 'unknown'
  end;
$$;

create or replace function public.enqueue_verified_paypal_webhook(
  p_provider_event_id text,
  p_event_type text,
  p_resource_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  inserted_event_id uuid;
  existing_event public.paypal_webhook_events%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This function accepts only server-verified PayPal webhook events.' using errcode = '42501';
  end if;
  if p_provider_event_id is null or char_length(p_provider_event_id) not between 1 and 255
     or p_event_type is null or p_event_type not in (
       'INVOICING.INVOICE.CREATED', 'INVOICING.INVOICE.SENT', 'INVOICING.INVOICE.PAID',
       'INVOICING.INVOICE.CANCELLED', 'INVOICING.INVOICE.REFUNDED', 'INVOICING.INVOICE.UPDATED',
       'INVOICING.INVOICE.SCHEDULED'
     )
     or p_resource_id is null or char_length(p_resource_id) not between 1 and 255
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'id' is distinct from p_provider_event_id
     or p_payload->>'event_type' is distinct from p_event_type
     or p_payload#>>'{resource,id}' is distinct from p_resource_id then
    raise exception 'Invalid verified PayPal invoice event.' using errcode = '22023';
  end if;

  insert into public.paypal_webhook_events (
    provider_event_id, event_type, resource_id, payload, verified_at
  ) values (
    p_provider_event_id, p_event_type, p_resource_id, p_payload, clock_timestamp()
  )
  on conflict (provider_event_id) do nothing
  returning id into inserted_event_id;

  if inserted_event_id is null then
    select * into existing_event
    from public.paypal_webhook_events
    where provider_event_id = p_provider_event_id;
    if existing_event.id is null
       or existing_event.event_type is distinct from p_event_type
       or existing_event.resource_id is distinct from p_resource_id
       or existing_event.payload is distinct from p_payload then
      raise exception 'A PayPal event identifier conflicts with stored event data.' using errcode = '23505';
    end if;
    if existing_event.verified_at is null and existing_event.processed_at is null then
      update public.paypal_webhook_events
      set verified_at = clock_timestamp(), next_attempt_at = clock_timestamp(),
          attempt_count = 0, dead_lettered_at = null, lease_token = null, lease_expires_at = null
      where id = existing_event.id;
    end if;
    return jsonb_build_object(
      'duplicate', true,
      'processed', existing_event.processed_at is not null,
      'pending', existing_event.processed_at is null and existing_event.dead_lettered_at is null
    );
  end if;

  return jsonb_build_object('duplicate', false, 'processed', false, 'pending', true);
end;
$$;

create or replace function public.claim_paypal_webhook_event()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth, extensions
as $$
declare
  target_event public.paypal_webhook_events%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This function accepts only the server webhook worker.' using errcode = '42501';
  end if;

  update public.paypal_webhook_events e
  set dead_lettered_at = clock_timestamp(),
      processing_error = 'worker_attempts_exhausted',
      lease_token = null,
      lease_expires_at = null
  where e.verified_at is not null
    and e.processed_at is null
    and e.dead_lettered_at is null
    and e.attempt_count >= 8
    and (e.lease_expires_at is null or e.lease_expires_at <= clock_timestamp());

  with candidate as (
    select e.id
    from public.paypal_webhook_events e
    where e.verified_at is not null
      and e.processed_at is null
      and e.dead_lettered_at is null
      and e.attempt_count < 8
      and e.next_attempt_at <= clock_timestamp()
      and (e.lease_expires_at is null or e.lease_expires_at <= clock_timestamp())
    order by e.next_attempt_at, e.received_at, e.id
    for update skip locked
    limit 1
  )
  update public.paypal_webhook_events e
  set attempt_count = e.attempt_count + 1,
      last_attempt_at = clock_timestamp(),
      lease_token = extensions.gen_random_uuid(),
      lease_expires_at = clock_timestamp() + interval '45 seconds',
      processing_error = null
  from candidate c
  where e.id = c.id
  returning e.* into target_event;

  if target_event.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'event_id', target_event.id,
    'provider_event_id', target_event.provider_event_id,
    'event_type', target_event.event_type,
    'resource_id', target_event.resource_id,
    'payload', target_event.payload,
    'lease_token', target_event.lease_token,
    'attempt_count', target_event.attempt_count
  );
end;
$$;

create or replace function public.complete_verified_paypal_webhook(
  p_event_id uuid,
  p_lease_token uuid,
  p_provider_invoice_id text default null,
  p_provider_status text default null,
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
  target_event public.paypal_webhook_events%rowtype;
  target_invoice public.invoices%rowtype;
  mapped_status text;
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
    if p_provider_status is not null or p_observed_at is not null then
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
     and (target_invoice.provider_observed_at is null or p_observed_at >= target_invoice.provider_observed_at) then
    update public.invoices
    set provider_status = left(p_provider_status, 80),
        status = mapped_status,
        invoice_url = case when p_invoice_url ~ '^https://' then p_invoice_url else invoice_url end,
        paid_at = case when mapped_status = 'paid' then coalesce(p_paid_at, paid_at) else paid_at end,
        provider_observed_at = p_observed_at,
        updated_at = clock_timestamp()
    where id = target_invoice.id
      and provider = 'paypal'
    returning * into target_invoice;
    applied := found;
  end if;

  update public.paypal_webhook_events
  set processed_at = clock_timestamp(),
      processing_error = case when target_invoice.id is null then 'invoice_not_linked_locally' else null end,
      lease_token = null,
      lease_expires_at = null
  where id = target_event.id;

  return jsonb_build_object(
    'duplicate', false,
    'matched', target_invoice.id is not null,
    'applied', applied,
    'invoiceId', target_invoice.id,
    'status', target_invoice.status
  );
end;
$$;

create or replace function public.retry_paypal_webhook_event(
  p_event_id uuid,
  p_lease_token uuid,
  p_failure_code text,
  p_permanent boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  target_event public.paypal_webhook_events%rowtype;
  should_dead_letter boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This function accepts only the server webhook worker.' using errcode = '42501';
  end if;
  if p_failure_code is null or p_failure_code not in (
    'provider_read_failed', 'provider_http_400', 'provider_http_401', 'provider_http_403',
    'provider_http_429', 'provider_http_5xx', 'provider_invoice_mismatch',
    'database_completion_failed', 'database_timeout'
  ) then
    raise exception 'Invalid webhook processing failure code.' using errcode = '22023';
  end if;
  select * into target_event from public.paypal_webhook_events where id = p_event_id for update;
  if target_event.id is null then
    raise exception 'The verified webhook event does not exist.' using errcode = '22023';
  end if;
  if target_event.processed_at is not null then
    return jsonb_build_object('status', 'processed');
  end if;
  if target_event.lease_token is distinct from p_lease_token
     or target_event.lease_expires_at is null
     or target_event.lease_expires_at <= clock_timestamp() then
    raise exception 'The webhook processing lease is no longer current.' using errcode = '55000';
  end if;

  should_dead_letter := p_permanent or target_event.attempt_count >= 8;
  update public.paypal_webhook_events
  set processing_error = p_failure_code,
      dead_lettered_at = case when should_dead_letter then clock_timestamp() else null end,
      next_attempt_at = case when should_dead_letter then next_attempt_at
        else clock_timestamp() + make_interval(secs => least(
          3600::numeric,
          5::numeric * power(2::numeric, greatest(attempt_count - 1, 0))
        )::double precision) end,
      lease_token = null,
      lease_expires_at = null
  where id = target_event.id;

  return jsonb_build_object(
    'status', case when should_dead_letter then 'dead_lettered' else 'retry_scheduled' end,
    'attempt_count', target_event.attempt_count
  );
end;
$$;

create or replace function public.requeue_dead_lettered_paypal_webhook(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  changed_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'This function accepts only an authorized server operator.' using errcode = '42501';
  end if;
  update public.paypal_webhook_events
  set attempt_count = 0,
      next_attempt_at = clock_timestamp(),
      last_attempt_at = null,
      lease_token = null,
      lease_expires_at = null,
      dead_lettered_at = null,
      processing_error = null
  where id = p_event_id
    and verified_at is not null
    and processed_at is null
    and dead_lettered_at is not null;
  get diagnostics changed_count = row_count;
  return changed_count = 1;
end;
$$;

create or replace function public.prevent_paypal_paid_invoice_regression()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.provider = 'paypal'
     and old.status = 'paid'
     and new.provider = 'paypal'
     and new.status not in ('paid', 'partially_refunded', 'refunded', 'refunded_external') then
    new.status := old.status;
    new.provider_status := old.provider_status;
    new.paid_at := old.paid_at;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_prevent_paypal_paid_regression on public.invoices;
create trigger invoices_prevent_paypal_paid_regression
before update of provider, status, provider_status, paid_at on public.invoices
for each row execute function public.prevent_paypal_paid_invoice_regression();

-- Retire the synchronous state-write RPC. New writes must complete a persisted
-- queue lease through complete_verified_paypal_webhook.
revoke all on function public.apply_verified_paypal_webhook(text, text, text, jsonb, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.paypal_invoice_status(text) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_verified_paypal_webhook(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.claim_paypal_webhook_event() from public, anon, authenticated, service_role;
revoke all on function public.complete_verified_paypal_webhook(uuid, uuid, text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.retry_paypal_webhook_event(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.requeue_dead_lettered_paypal_webhook(uuid) from public, anon, authenticated, service_role;
revoke all on function public.prevent_paypal_paid_invoice_regression() from public, anon, authenticated, service_role;

grant execute on function public.enqueue_verified_paypal_webhook(text, text, text, jsonb) to service_role;
grant execute on function public.claim_paypal_webhook_event() to service_role;
grant execute on function public.complete_verified_paypal_webhook(uuid, uuid, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.retry_paypal_webhook_event(uuid, uuid, text, boolean) to service_role;
grant execute on function public.requeue_dead_lettered_paypal_webhook(uuid) to service_role;

commit;
