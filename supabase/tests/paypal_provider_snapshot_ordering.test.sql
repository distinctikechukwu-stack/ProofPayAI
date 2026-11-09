create extension if not exists pgtap with schema extensions;

begin;
select extensions.no_plan();

select extensions.is(
  (select status from public.invoices where id = '00000000-0000-4000-8000-000000000220'),
  'paid'::text,
  'migration 20 preserves the pre-existing paid invoice status'
);
select extensions.is(
  (select provider_status || '|' || provider_invoice_id || '|' || amount_minor::text || '|' || currency
   from public.invoices where id = '00000000-0000-4000-8000-000000000220'),
  'PAID|SYNTHETIC-COMPLETION-PAID-01|4000|USD'::text,
  'migration 20 preserves existing provider identity and exact invoice amount'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.paypal_invoice_snapshot_is_current(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.paypal_invoice_transition_allowed(text,text)', 'EXECUTE'),
  'the service role can execute the fixed-path snapshot and transition helpers'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.paypal_invoice_snapshot_is_current(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.paypal_invoice_transition_allowed(text,text)', 'EXECUTE'),
  'anon and authenticated roles cannot execute payment guard helpers'
);
select extensions.ok(
  (select provolatile = 'i' and 'search_path=pg_catalog' = any(proconfig)
   from pg_proc
   where oid = 'public.paypal_invoice_snapshot_is_current(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)'::regprocedure)
  and (select provolatile = 'i' and 'search_path=pg_catalog' = any(proconfig)
       from pg_proc
       where oid = 'public.paypal_invoice_transition_allowed(text,text)'::regprocedure),
  'snapshot and transition helpers are immutable and use only the catalog search path'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.complete_verified_paypal_webhook(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.complete_verified_paypal_webhook(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.complete_verified_paypal_webhook(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE'),
  'only the service role can execute the completion RPC'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.finalize_paypal_operation(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.record_paypal_invoice_state(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.finalize_paypal_operation(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_paypal_operation(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_paypal_invoice_state(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_paypal_invoice_state(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE'),
  'only the service role can execute the operation finalization and state reconciliation RPCs'
);
select extensions.ok(
  (select procedure.prosecdef and 'search_path=pg_catalog, public, auth' = any(procedure.proconfig)
   from pg_proc as procedure
   where procedure.oid = 'public.finalize_paypal_operation(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure)
  and (select procedure.prosecdef and 'search_path=pg_catalog, public, auth' = any(procedure.proconfig)
       from pg_proc as procedure
       where procedure.oid = 'public.record_paypal_invoice_state(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure),
  'both invoice update RPCs remain security-definer with a fixed safe search path'
);
select extensions.is(
  (select pronargdefaults from pg_proc where oid = 'public.finalize_paypal_operation(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure),
  7::smallint,
  'the provider timestamp is a trailing optional finalization argument'
);
select extensions.is(
  (select pronargdefaults from pg_proc where oid = 'public.record_paypal_invoice_state(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure),
  4::smallint,
  'the provider timestamp is a trailing optional reconciliation argument'
);
select extensions.ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as acl
    where procedure.oid = 'public.paypal_internal_operation_transition_allowed(uuid,text,text)'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege('service_role', 'public.paypal_internal_operation_transition_allowed(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.paypal_internal_operation_transition_allowed(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.paypal_internal_operation_transition_allowed(uuid,text,text)', 'EXECUTE'),
  'the trigger-only internal transition helper is not directly executable by API roles'
);
select extensions.ok(
  (select procedure.prosecdef
   from pg_proc as procedure
   where procedure.oid = 'public.complete_verified_paypal_webhook(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure)
  and (select 'search_path=pg_catalog, public, auth' = any(procedure.proconfig)
       from pg_proc as procedure
       where procedure.oid = 'public.complete_verified_paypal_webhook(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure),
  'the completion RPC remains security-definer with a fixed safe search path'
);
select extensions.is(
  (select pronargdefaults from pg_proc where oid = 'public.complete_verified_paypal_webhook(uuid,uuid,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure),
  6::smallint,
  'the new provider timestamp remains an optional trailing RPC argument for old seven-argument callers'
);
select extensions.ok(
  (select procedure.prosecdef
   from pg_proc as procedure
   where procedure.oid = 'public.prevent_paypal_paid_invoice_regression()'::regprocedure)
  and (select 'search_path=pg_catalog, public' = any(procedure.proconfig)
       from pg_proc as procedure
       where procedure.oid = 'public.prevent_paypal_paid_invoice_regression()'::regprocedure),
  'the invoice trigger uses a fixed-path definer context for its private guard helper'
);
select extensions.ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as acl
    where procedure.oid = 'public.paypal_invoice_snapshot_rejection_reason(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege('anon', 'public.paypal_invoice_snapshot_rejection_reason(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.paypal_invoice_snapshot_rejection_reason(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.paypal_invoice_snapshot_rejection_reason(timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text)', 'EXECUTE'),
  'snapshot rejection diagnostics remain private to the definer RPC and trigger'
);
select extensions.ok(
  exists (
    select 1 from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.invoices'::regclass
      and trigger_row.tgname = 'invoices_prevent_paypal_paid_regression'
      and not trigger_row.tgisinternal
      and pg_get_triggerdef(trigger_row.oid) ilike '%provider_updated_at%'
  ),
  'the invoice guard trigger observes provider-version updates'
);

create function pg_temp.apply_snapshot(
  p_event_id uuid,
  p_lease_token uuid,
  p_provider_event_id text,
  p_invoice_id text,
  p_provider_status text,
  p_provider_updated_at timestamptz,
  p_observed_at timestamptz,
  p_legacy_seven_argument_call boolean default false
)
returns jsonb
language plpgsql
as $test$
declare
  event_payload jsonb;
begin
  event_payload := jsonb_build_object(
    'id', p_provider_event_id,
    'event_type', 'INVOICING.INVOICE.UPDATED',
    'resource', jsonb_build_object('id', p_invoice_id, 'status', p_provider_status)
  );
  insert into public.paypal_webhook_events (
    id, provider_event_id, event_type, resource_id, payload, verified_at,
    attempt_count, lease_token, lease_expires_at
  ) values (
    p_event_id, p_provider_event_id, 'INVOICING.INVOICE.UPDATED', p_invoice_id,
    event_payload, clock_timestamp(), 1, p_lease_token, clock_timestamp() + interval '10 minutes'
  );
  if p_legacy_seven_argument_call then
    return public.complete_verified_paypal_webhook(
      p_event_id, p_lease_token, p_invoice_id, p_provider_status, null, null, p_observed_at
    );
  end if;
  return public.complete_verified_paypal_webhook(
    p_event_id, p_lease_token, p_invoice_id, p_provider_status, null, null, p_observed_at, p_provider_updated_at
  );
end;
$test$;

insert into public.invoices (
  id, project_id, milestone_id, created_by, provider_invoice_id,
  provider_invoice_number, status, amount_minor, currency, provider_status,
  provider_observed_at, provider_updated_at
)
select
  '00000000-0000-4000-8000-000000009300', project.id, milestone.id,
  '00000000-0000-4000-8000-000000000002', 'SYNTHETIC-SNAPSHOT-ORDERING-01',
  'TEST-SNAPSHOT-01', 'sent', milestone.amount_minor, milestone.currency,
  'SENT', '2026-11-07T10:00:00Z', '2026-11-07T10:00:00Z'
from public.projects as project
join public.milestones as milestone on milestone.project_id = project.id
where project.id = '00000000-0000-4000-8000-000000000900'
  and milestone.sequence = 1;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

create temporary table migration20_operation_test (
  name text primary key,
  invoice_id uuid not null,
  claim_id uuid not null,
  receipt jsonb not null
);

insert into migration20_operation_test (name, invoice_id, claim_id, receipt)
select 'create_initial',
       (receipt->'invoice'->>'id')::uuid,
       (receipt->'claim'->>'id')::uuid,
       receipt
from (
  select public.begin_paypal_invoice_create(
    (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000900' and sequence = 1),
    'TEST-PROVIDER-OP-CREATE-1',
    '00000000-0000-4000-8000-000000000002'
  ) as receipt
) as created;
select extensions.ok(
  (select receipt->>'claimed' = 'true'
     and receipt->'invoice'->>'status' = 'create_pending'
     and receipt->'claim'->>'state' = 'claimed'
   from migration20_operation_test where name = 'create_initial'),
  'begin_paypal_invoice_create commits a create claim before exposing create_pending'
);

select public.finalize_paypal_operation(
  claim_id, '00000000-0000-4000-8000-000000000002', 'rejected'
)
from migration20_operation_test where name = 'create_initial';
select extensions.is(
  (select status from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'create_initial')),
  'not_created'::text,
  'a definitive create rejection resolves create_pending to not_created'
);

insert into migration20_operation_test (name, invoice_id, claim_id, receipt)
select 'create_retry',
       (receipt->'invoice'->>'id')::uuid,
       (receipt->'claim'->>'id')::uuid,
       receipt
from (
  select public.begin_paypal_invoice_create(
    (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000900' and sequence = 1),
    'TEST-PROVIDER-OP-CREATE-2',
    '00000000-0000-4000-8000-000000000002'
  ) as receipt
) as retried;
select extensions.ok(
  (select receipt->>'claimed' = 'true'
     and receipt->'invoice'->>'status' = 'create_pending'
     and receipt->'claim'->>'state' = 'claimed'
   from migration20_operation_test where name = 'create_retry')
  and (select invoice_id = (select invoice_id from migration20_operation_test where name = 'create_initial')
       from migration20_operation_test where name = 'create_retry'),
  'a create retry preserves the invoice identity and transitions not_created to create_pending under a new claim'
);

select public.finalize_paypal_operation(
  claim_id,
  '00000000-0000-4000-8000-000000000002',
  'completed',
  'SYNTHETIC-OPERATION-INVOICE-01',
  'DRAFT',
  'draft',
  'https://www.sandbox.paypal.com/invoice/p/synthetic',
  null,
  '2026-11-07T11:01:00Z',
  '2026-11-07T11:00:00Z'
)
from migration20_operation_test where name = 'create_retry';
select extensions.ok(
  (select status = 'draft'
      and provider_status = 'DRAFT'
      and provider_updated_at = '2026-11-07T11:00:00Z'::timestamptz
      and provider_observed_at = '2026-11-07T11:01:00Z'::timestamptz
      and provider_invoice_id = 'SYNTHETIC-OPERATION-INVOICE-01'
   from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'create_retry')),
  'finalize_paypal_operation stores provider version separately from the local observation time'
);

insert into migration20_operation_test (name, invoice_id, claim_id, receipt)
select 'send_initial',
       (receipt->'invoice'->>'id')::uuid,
       (receipt->'claim'->>'id')::uuid,
       receipt
from (
  select public.begin_paypal_invoice_send(
    (select invoice_id from migration20_operation_test where name = 'create_retry'),
    '00000000-0000-4000-8000-000000000002'
  ) as receipt
) as sent;
select extensions.ok(
  (select receipt->>'claimed' = 'true'
     and receipt->'invoice'->>'status' = 'send_pending'
     and receipt->'claim'->>'state' = 'claimed'
   from migration20_operation_test where name = 'send_initial'),
  'begin_paypal_invoice_send transitions draft to send_pending only after inserting its claim'
);

select public.finalize_paypal_operation(
  claim_id,
  '00000000-0000-4000-8000-000000000002',
  'rejected',
  'SYNTHETIC-OPERATION-INVOICE-01',
  'DRAFT',
  'draft',
  'https://www.sandbox.paypal.com/invoice/p/synthetic',
  null,
  '2026-11-07T11:05:00Z',
  '2026-11-07T11:04:00Z'
)
from migration20_operation_test where name = 'send_initial';
select extensions.is(
  (select status from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'send_initial')),
  'draft'::text,
  'a verified DRAFT snapshot can safely resolve a failed send claim back to draft'
);

insert into migration20_operation_test (name, invoice_id, claim_id, receipt)
select 'send_retry',
       (receipt->'invoice'->>'id')::uuid,
       (receipt->'claim'->>'id')::uuid,
       receipt
from (
  select public.begin_paypal_invoice_send(
    (select invoice_id from migration20_operation_test where name = 'create_retry'),
    '00000000-0000-4000-8000-000000000002'
  ) as receipt
) as sent_again;
select extensions.ok(
  (select receipt->>'claimed' = 'true' and receipt->'invoice'->>'status' = 'send_pending'
   from migration20_operation_test where name = 'send_retry'),
  'a safe send retry can claim the same draft invoice after provider-confirmed DRAFT'
);
select public.finalize_paypal_operation(
  claim_id,
  '00000000-0000-4000-8000-000000000002',
  'completed',
  'SYNTHETIC-OPERATION-INVOICE-01',
  'SENT',
  'sent',
  'https://www.sandbox.paypal.com/invoice/p/synthetic',
  null,
  '2026-11-07T12:01:00Z',
  '2026-11-07T12:00:00Z'
)
from migration20_operation_test where name = 'send_retry';
select extensions.is(
  (select status from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'send_retry')),
  'sent'::text,
  'finalize_paypal_operation accepts a newer provider-confirmed SENT state'
);

select extensions.is(
  (public.record_paypal_invoice_state(
    (select invoice_id from migration20_operation_test where name = 'send_retry'),
    '00000000-0000-4000-8000-000000000002',
    'PARTIALLY_PAID', 'partially_paid', null, null,
    '2026-11-07T12:31:00Z', '2026-11-07T12:30:00Z'
  )->>'snapshotApplied')::boolean,
  true,
  'record_paypal_invoice_state accepts a newer provider version'
);
select extensions.ok(
  (select provider_updated_at = '2026-11-07T12:30:00Z'::timestamptz
      and provider_observed_at = '2026-11-07T12:31:00Z'::timestamptz
      and status = 'partially_paid'
   from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'send_retry')),
  'reconciliation stores provider version and local observation independently'
);
select extensions.is(
  (public.record_paypal_invoice_state(
    (select invoice_id from migration20_operation_test where name = 'send_retry'),
    '00000000-0000-4000-8000-000000000002',
    'PAID', 'paid', null, '2026-11-07T12:40:00Z',
    '2026-11-07T12:45:00Z', '2026-11-07T12:20:00Z'
  )->>'snapshotApplied')::boolean,
  false,
  'record_paypal_invoice_state rejects an older provider version even when observed later'
);
select extensions.is(
  (public.record_paypal_invoice_state(
    (select invoice_id from migration20_operation_test where name = 'send_retry'),
    '00000000-0000-4000-8000-000000000002',
    'PAID', 'paid', null, '2026-11-07T12:40:00Z',
    '2026-11-07T12:46:00Z', '2026-11-07T12:30:00Z'
  )->>'snapshotApplied')::boolean,
  false,
  'record_paypal_invoice_state rejects conflicting statuses at an equal provider version'
);
select extensions.is(
  (public.record_paypal_invoice_state(
    (select invoice_id from migration20_operation_test where name = 'send_retry'),
    '00000000-0000-4000-8000-000000000002',
    'PAID', 'paid', null, '2026-11-07T12:40:00Z',
    '2026-11-07T12:47:00Z'
  )->>'snapshotRejectionReason')::text,
  'missing_provider_version'::text,
  'legacy seven-argument reconciliation calls still resolve and cannot overwrite a versioned invoice'
);
select extensions.is(
  (public.record_paypal_invoice_state(
    (select invoice_id from migration20_operation_test where name = 'send_retry'),
    '00000000-0000-4000-8000-000000000002',
    'PARTIALLY_PAID', 'partially_paid', null, null,
    '2026-11-07T12:48:00Z', '2026-11-07T12:30:00Z'
  )->>'snapshotApplied')::boolean,
  true,
  'an identical status at an equal provider version is idempotently accepted'
);
select extensions.is(
  (public.record_paypal_invoice_state(
    (select invoice_id from migration20_operation_test where name = 'send_retry'),
    '00000000-0000-4000-8000-000000000002',
    'FUTURE_PROVIDER_STATE', 'unknown', null, null,
    '2026-11-07T12:51:00Z', '2026-11-07T12:50:00Z'
  )->>'snapshotApplied')::boolean,
  true,
  'a newer unrecognized provider state is stored as unknown without fabricating payment status'
);
select extensions.is(
  (public.record_paypal_invoice_state(
    (select invoice_id from migration20_operation_test where name = 'send_retry'),
    '00000000-0000-4000-8000-000000000002',
    'PAID', 'paid', null, '2026-11-07T12:55:00Z',
    '2026-11-07T12:56:00Z', '2026-11-07T12:55:00Z'
  )->>'snapshotApplied')::boolean,
  true,
  'a later recognized provider status resolves an earlier unknown status'
);
select extensions.ok(
  (select status = 'paid' and provider_status = 'PAID'
      and amount_minor = 10000 and currency = 'USD'
      and provider_invoice_id = 'SYNTHETIC-OPERATION-INVOICE-01'
   from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'send_retry')),
  'operation and reconciliation preserve the invoice identity, amount, and currency'
);

insert into migration20_operation_test (name, invoice_id, claim_id, receipt)
select 'finalize_probe_create',
       (receipt->'invoice'->>'id')::uuid,
       (receipt->'claim'->>'id')::uuid,
       receipt
from (
  select public.begin_paypal_invoice_create(
    (select id from public.milestones where project_id = '00000000-0000-4000-8000-000000000600' and sequence = 1),
    'TEST-PROVIDER-FINALIZE-01',
    '00000000-0000-4000-8000-000000000002'
  ) as receipt
) as created;
select public.finalize_paypal_operation(
  claim_id, '00000000-0000-4000-8000-000000000002', 'completed',
  'SYNTHETIC-FINALIZE-INVOICE-01', 'DRAFT', 'draft',
  'https://www.sandbox.paypal.com/invoice/p/synthetic', null,
  '2026-11-07T13:01:00Z', '2026-11-07T13:00:00Z'
)
from migration20_operation_test where name = 'finalize_probe_create';

insert into migration20_operation_test (name, invoice_id, claim_id, receipt)
select 'finalize_probe_send',
       (receipt->'invoice'->>'id')::uuid,
       (receipt->'claim'->>'id')::uuid,
       receipt
from (
  select public.begin_paypal_invoice_send(
    (select invoice_id from migration20_operation_test where name = 'finalize_probe_create'),
    '00000000-0000-4000-8000-000000000002'
  ) as receipt
) as sending;
select extensions.is(
  (public.finalize_paypal_operation(
    claim_id, '00000000-0000-4000-8000-000000000002', 'completed',
    'SYNTHETIC-FINALIZE-INVOICE-01', 'DRAFT', 'draft',
    'https://www.sandbox.paypal.com/invoice/p/synthetic', null,
    '2026-11-07T14:00:00Z', '2026-11-07T12:59:00Z'
  )->>'snapshotRejectionReason')::text,
  'stale_provider_version'::text,
  'finalize_paypal_operation rejects an older provider version observed later'
)
from migration20_operation_test where name = 'finalize_probe_send';
select extensions.ok(
  (select status = 'unknown' and provider_status = 'DRAFT'
      and provider_updated_at = '2026-11-07T13:00:00Z'::timestamptz
   from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'finalize_probe_send'))
  and (select state = 'unknown' and active_operation_key is not null
       from public.paypal_operation_claims where id = (select claim_id from migration20_operation_test where name = 'finalize_probe_send')),
  'a stale operation snapshot preserves the newer provider state and leaves the claim recoverable'
);
select extensions.is(
  (public.finalize_paypal_operation(
    claim_id, '00000000-0000-4000-8000-000000000002', 'completed',
    'SYNTHETIC-FINALIZE-INVOICE-01', 'PAID', 'paid',
    'https://www.sandbox.paypal.com/invoice/p/synthetic', '2026-11-07T14:01:00Z',
    '2026-11-07T14:02:00Z', '2026-11-07T13:00:00Z'
  )->>'snapshotRejectionReason')::text,
  'conflicting_equal_provider_version'::text,
  'finalize_paypal_operation rejects conflicting status changes at equal provider versions'
)
from migration20_operation_test where name = 'finalize_probe_send';
select extensions.is(
  (public.finalize_paypal_operation(
    claim_id, '00000000-0000-4000-8000-000000000002', 'rejected',
    'SYNTHETIC-FINALIZE-INVOICE-01', 'DRAFT', 'draft',
    'https://www.sandbox.paypal.com/invoice/p/synthetic', null,
    '2026-11-07T14:03:00Z', '2026-11-07T13:00:00Z'
  )->>'snapshotApplied')::boolean,
  true,
  'finalize_paypal_operation idempotently accepts the same provider status at an equal version'
)
from migration20_operation_test where name = 'finalize_probe_send';
select extensions.is(
  (select status from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'finalize_probe_send')),
  'draft'::text,
  'the equal-version provider-confirmed draft resolves the send claim without a false status change'
);

insert into migration20_operation_test (name, invoice_id, claim_id, receipt)
select 'finalize_probe_send_retry',
       (receipt->'invoice'->>'id')::uuid,
       (receipt->'claim'->>'id')::uuid,
       receipt
from (
  select public.begin_paypal_invoice_send(
    (select invoice_id from migration20_operation_test where name = 'finalize_probe_create'),
    '00000000-0000-4000-8000-000000000002'
  ) as receipt
) as sending_again;
select extensions.is(
  (public.finalize_paypal_operation(
    claim_id, '00000000-0000-4000-8000-000000000002', 'completed',
    'SYNTHETIC-FINALIZE-INVOICE-01', 'SENT', 'sent',
    'https://www.sandbox.paypal.com/invoice/p/synthetic', null,
    '2026-11-07T15:00:00Z'
  )->>'snapshotRejectionReason')::text,
  'missing_provider_version'::text,
  'legacy nine-argument finalization calls still resolve and cannot overwrite a versioned invoice'
)
from migration20_operation_test where name = 'finalize_probe_send_retry';
select extensions.ok(
  (select status = 'unknown' and provider_status = 'DRAFT'
      and provider_updated_at = '2026-11-07T13:00:00Z'::timestamptz
   from public.invoices where id = (select invoice_id from migration20_operation_test where name = 'finalize_probe_send_retry'))
  and (select state = 'unknown' and active_operation_key is not null
       from public.paypal_operation_claims where id = (select claim_id from migration20_operation_test where name = 'finalize_probe_send_retry')),
  'missing-version finalization preserves the prior provider snapshot and keeps the send claim recoverable'
);
select extensions.is(
  (public.finalize_paypal_operation(
    claim_id, '00000000-0000-4000-8000-000000000002', 'completed',
    'SYNTHETIC-FINALIZE-INVOICE-01', 'SENT', 'sent',
    'https://www.sandbox.paypal.com/invoice/p/synthetic', null,
    '2026-11-07T15:02:00Z', '2026-11-07T15:01:00Z'
  )->>'snapshotApplied')::boolean,
  true,
  'a later provider-confirmed SENT snapshot resolves the recoverable send claim'
)
from migration20_operation_test where name = 'finalize_probe_send_retry';

select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009301', '00000000-0000-4000-8000-000000009302',
    'SYNTHETIC-EVENT-OLDER-PAID', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'PAID',
    '2026-11-07T09:00:00Z', '2026-11-07T11:00:00Z'
  )->>'applied')::boolean,
  false,
  'an older PAID provider version is rejected even when observed later'
);
select extensions.is(
  (select status from public.invoices where provider_invoice_id = 'SYNTHETIC-SNAPSHOT-ORDERING-01'),
  'sent'::text,
  'rejecting the older PAID snapshot preserves the current SENT status'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009303', '00000000-0000-4000-8000-000000009304',
    'SYNTHETIC-EVENT-SENT-DRAFT', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'DRAFT',
    '2026-11-07T10:30:00Z', '2026-11-07T11:01:00Z'
  )->>'applied')::boolean,
  false,
  'a newer provider version still cannot move SENT back to DRAFT'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009305', '00000000-0000-4000-8000-000000009306',
    'SYNTHETIC-EVENT-PARTIAL', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'PARTIALLY_PAID',
    '2026-11-07T11:00:00Z', '2026-11-07T11:02:00Z'
  )->>'applied')::boolean,
  true,
  'SENT can advance to a provider-confirmed partial payment'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009307', '00000000-0000-4000-8000-000000009308',
    'SYNTHETIC-EVENT-PAID', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'PAID',
    '2026-11-07T12:00:00Z', '2026-11-07T12:03:00Z'
  )->>'applied')::boolean,
  true,
  'a partial payment can advance to PAID'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009309', '00000000-0000-4000-8000-000000009310',
    'SYNTHETIC-EVENT-PARTIAL-REFUND', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'PARTIALLY_REFUNDED',
    '2026-11-07T13:00:00Z', '2026-11-07T13:03:00Z'
  )->>'applied')::boolean,
  true,
  'PAID can advance to PARTIALLY_REFUNDED'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009311', '00000000-0000-4000-8000-000000009312',
    'SYNTHETIC-EVENT-REFUNDED', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'REFUNDED',
    '2026-11-07T14:00:00Z', '2026-11-07T14:03:00Z'
  )->>'applied')::boolean,
  true,
  'PARTIALLY_REFUNDED can advance to fully REFUNDED'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009313', '00000000-0000-4000-8000-000000009314',
    'SYNTHETIC-EVENT-REFUND-PAID-REGRESSION', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'PAID',
    '2026-11-07T15:00:00Z', '2026-11-07T15:03:00Z'
  )->>'applied')::boolean,
  false,
  'a newer PAID snapshot cannot overwrite REFUNDED'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009315', '00000000-0000-4000-8000-000000009316',
    'SYNTHETIC-EVENT-EQUAL-CONFLICT', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'PAID_EXTERNAL',
    '2026-11-07T14:00:00Z', '2026-11-07T15:04:00Z'
  )->>'applied')::boolean,
  false,
  'a conflicting status at the same provider version cannot overwrite REFUNDED'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009317', '00000000-0000-4000-8000-000000009318',
    'SYNTHETIC-EVENT-EQUAL-IDENTICAL', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'REFUNDED',
    '2026-11-07T14:00:00Z', '2026-11-07T15:05:00Z'
  )->>'applied')::boolean,
  true,
  'the same provider version and same raw status may be applied idempotently'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009319', '00000000-0000-4000-8000-000000009320',
    'SYNTHETIC-EVENT-MISSING-VERSION', 'SYNTHETIC-SNAPSHOT-ORDERING-01', 'PAID',
    null, '2026-11-07T15:06:00Z', true
  )->>'applied')::boolean,
  false,
  'a legacy seven-argument call with no provider version cannot replace a versioned invoice'
);
select extensions.is(
  (select status from public.invoices where provider_invoice_id = 'SYNTHETIC-SNAPSHOT-ORDERING-01'),
  'refunded'::text,
  'the invoice remains fully refunded after stale, conflicting, and versionless attempts'
);

insert into public.invoices (
  id, project_id, milestone_id, created_by, provider_invoice_id,
  provider_invoice_number, status, amount_minor, currency, provider_status,
  provider_observed_at
)
select
  '00000000-0000-4000-8000-000000009330', project.id, milestone.id,
  '00000000-0000-4000-8000-000000000002', 'SYNTHETIC-SNAPSHOT-OBSERVATION-01',
  'TEST-SNAPSHOT-02', 'sent', milestone.amount_minor, milestone.currency,
  'SENT', '2026-11-07T10:00:00Z'
from public.projects as project
join public.milestones as milestone on milestone.project_id = project.id
where project.id = '00000000-0000-4000-8000-000000000400'
  and milestone.sequence = 1;
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009331', '00000000-0000-4000-8000-000000009332',
    'SYNTHETIC-EVENT-VERSIONLESS-PARTIAL', 'SYNTHETIC-SNAPSHOT-OBSERVATION-01', 'PARTIALLY_PAID',
    null, '2026-11-07T11:00:00Z'
  )->>'applied')::boolean,
  true,
  'a newer local observation orders versionless snapshots only before a provider version is known'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009333', '00000000-0000-4000-8000-000000009334',
    'SYNTHETIC-EVENT-VERSIONLESS-EQUAL', 'SYNTHETIC-SNAPSHOT-OBSERVATION-01', 'PAID',
    null, '2026-11-07T11:00:00Z'
  )->>'applied')::boolean,
  false,
  'conflicting statuses at equal local observation times cannot overwrite a versionless row'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009335', '00000000-0000-4000-8000-000000009336',
    'SYNTHETIC-EVENT-VERSIONLESS-OLDER', 'SYNTHETIC-SNAPSHOT-OBSERVATION-01', 'SENT',
    null, '2026-11-07T10:30:00Z'
  )->>'applied')::boolean,
  false,
  'an older local observation cannot overwrite a versionless snapshot'
);

insert into public.invoices (
  id, project_id, milestone_id, created_by, provider_invoice_id,
  provider_invoice_number, status, amount_minor, currency, provider_status,
  provider_observed_at, provider_updated_at
)
select
  '00000000-0000-4000-8000-000000009340', project.id, milestone.id,
  '00000000-0000-4000-8000-000000000002', 'SYNTHETIC-SNAPSHOT-CANCEL-01',
  'TEST-SNAPSHOT-03', 'sent', milestone.amount_minor, milestone.currency,
  'SENT', '2026-11-07T10:00:00Z', '2026-11-07T10:00:00Z'
from public.projects as project
join public.milestones as milestone on milestone.project_id = project.id
where project.id = '00000000-0000-4000-8000-000000000500'
  and milestone.sequence = 1;
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009341', '00000000-0000-4000-8000-000000009342',
    'SYNTHETIC-EVENT-CANCEL', 'SYNTHETIC-SNAPSHOT-CANCEL-01', 'CANCELLED',
    '2026-11-07T11:00:00Z', '2026-11-07T11:01:00Z'
  )->>'applied')::boolean,
  true,
  'SENT can advance to CANCELLED'
);
select extensions.is(
  (pg_temp.apply_snapshot(
    '00000000-0000-4000-8000-000000009343', '00000000-0000-4000-8000-000000009344',
    'SYNTHETIC-EVENT-CANCEL-REFUND', 'SYNTHETIC-SNAPSHOT-CANCEL-01', 'REFUNDED',
    '2026-11-07T12:00:00Z', '2026-11-07T12:01:00Z'
  )->>'applied')::boolean,
  false,
  'a cancelled invoice cannot accept a later refund status'
);
select extensions.is(
  (select status from public.invoices where provider_invoice_id = 'SYNTHETIC-SNAPSHOT-CANCEL-01'),
  'cancelled'::text,
  'CANCELLED remains terminal because PayPal rejects refunds for cancelled invoices'
);

select extensions.throws_ok(
  $$update public.invoices
    set status = 'paid', provider_status = 'PAID',
        provider_updated_at = '2026-11-07T13:00:00Z',
        provider_observed_at = '2026-11-07T15:10:00Z'
    where provider_invoice_id = 'SYNTHETIC-SNAPSHOT-ORDERING-01'$$,
  '40001',
  'The PayPal invoice snapshot is stale, conflicting, or an invalid provider transition.',
  'the database trigger rejects a direct paid-after-refund update instead of silently restoring fields'
);
select extensions.is(
  (select provider_updated_at from public.invoices where provider_invoice_id = 'SYNTHETIC-SNAPSHOT-ORDERING-01'),
  '2026-11-07T14:00:00Z'::timestamptz,
  'the trigger preserves the newer provider version when it rejects a stale write'
);
select extensions.throws_ok(
  $$update public.invoices
    set provider_invoice_id = 'SYNTHETIC-REASSIGNED-INVOICE'
    where provider_invoice_id = 'SYNTHETIC-SNAPSHOT-ORDERING-01'$$,
  '23514',
  'The PayPal provider and invoice identity are immutable once linked.',
  'the trigger refuses to reassign a linked PayPal invoice identity'
);
select extensions.is(
  (select provider_invoice_id || '|' || status from public.invoices
   where provider_invoice_id = 'SYNTHETIC-SNAPSHOT-ORDERING-01'),
  'SYNTHETIC-SNAPSHOT-ORDERING-01|refunded'::text,
  'a rejected identity reassignment leaves the linked PayPal invoice intact'
);
select extensions.ok(
  not public.paypal_invoice_snapshot_is_current(
    '2026-11-07T12:00:00Z', '2026-11-07T12:00:00Z',
    '2026-11-07T11:00:00Z', '2026-11-07T13:00:00Z',
    'refunded', 'paid', 'REFUNDED', 'PAID'
  ),
  'provider time remains distinct from a later local observation time'
);

select * from extensions.finish();
rollback;
