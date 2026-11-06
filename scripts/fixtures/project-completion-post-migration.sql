-- Synthetic-only fixtures loaded after migration 19 into the disposable stack.
\echo fixture_step=begin
begin;

\echo fixture_step=project_200
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000210',
  'fixed', 'in_progress', array['submitted_for_review', 'submitted_for_review'], array[4000, 6000]::bigint[]
);
\echo fixture_step=project_300
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000300', '00000000-0000-4000-8000-000000000310',
  'fixed', 'in_progress', array['revision_requested'], array[10000]::bigint[]
);
\echo fixture_step=project_400
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000410',
  'fixed', 'in_progress', array['approved'], array[10000]::bigint[]
);
\echo fixture_step=project_500
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000500', '00000000-0000-4000-8000-000000000510',
  'fixed', 'in_progress', array['approved'], array[10000]::bigint[]
);
\echo fixture_step=project_600
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000600', '00000000-0000-4000-8000-000000000610',
  'fixed', 'in_progress', array['approved'], array[10000]::bigint[]
);
\echo fixture_step=project_700
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000700', '00000000-0000-4000-8000-000000000710',
  'hourly', 'in_progress', array['approved'], array[10000]::bigint[]
);
\echo fixture_step=project_800
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000800', '00000000-0000-4000-8000-000000000810',
  'fixed', 'in_progress', array['submitted_for_review', 'submitted_for_review'], array[4000, 6000]::bigint[]
);
\echo fixture_step=project_900
select proofpay_validation.add_project(
  '00000000-0000-4000-8000-000000000900', '00000000-0000-4000-8000-000000000910',
  'fixed', 'in_progress', array['approved'], array[10000]::bigint[]
);

\echo fixture_step=paid_invoice
insert into public.invoices (
  id, project_id, milestone_id, created_by, provider_invoice_id,
  provider_invoice_number, status, amount_minor, currency,
  accepted_agreement_version_id, provider_status, provider_observed_at, paid_at
)
select
  '00000000-0000-4000-8000-000000000220',
  milestone.project_id,
  milestone.id,
  '00000000-0000-4000-8000-000000000002',
  'SYNTHETIC-COMPLETION-PAID-01',
  'TEST-COMP-PAID-001',
  'paid', milestone.amount_minor, milestone.currency,
  milestone.agreement_version_id, 'PAID', now(), now()
from public.milestones as milestone
where milestone.project_id = '00000000-0000-4000-8000-000000000200'
  and milestone.sequence = 1;

\echo fixture_step=scope_requests
insert into public.change_requests (
  id, project_id, based_on_agreement_version_id, created_by, request_text,
  status, idempotency_key
)
values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000410', '00000000-0000-4000-8000-000000000001', 'Synthetic pending scope change.', 'pending_analysis', '00000000-0000-4000-8000-000000000401'),
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000500', '00000000-0000-4000-8000-000000000510', '00000000-0000-4000-8000-000000000001', 'Synthetic analyzed scope change without a resolved outcome.', 'analyzed', '00000000-0000-4000-8000-000000000501'),
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000600', '00000000-0000-4000-8000-000000000610', '00000000-0000-4000-8000-000000000001', 'Synthetic accepted amendment with unrepresented work.', 'resolved', '00000000-0000-4000-8000-000000000601'),
  ('00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000900', '00000000-0000-4000-8000-000000000910', '00000000-0000-4000-8000-000000000001', 'Synthetic rejected scope change.', 'analyzed', '00000000-0000-4000-8000-000000000901');

\echo fixture_step=change_order_versions
insert into public.change_order_versions (
  id, project_id, change_request_id, version_number, created_by,
  title, description, amount_delta_minor, currency, idempotency_key, state
)
values
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000600', '00000000-0000-4000-8000-000000000601', 1, '00000000-0000-4000-8000-000000000001', 'Synthetic accepted scope', 'This synthetic accepted amendment is intentionally missing linked completion milestones.', 500, 'USD', '00000000-0000-4000-8000-000000000602', 'accepted'),
  ('00000000-0000-4000-8000-000000000902', '00000000-0000-4000-8000-000000000900', '00000000-0000-4000-8000-000000000901', 1, '00000000-0000-4000-8000-000000000001', 'Synthetic rejected scope', 'A rejected synthetic change must not block the original accepted scope.', 500, 'USD', '00000000-0000-4000-8000-000000000902', 'rejected');

\echo fixture_step=commit
commit;
