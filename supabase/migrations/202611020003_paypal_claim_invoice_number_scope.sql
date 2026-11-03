begin;

-- PayPal invoice numbers identify create operations. A send operation reuses
-- the provider invoice number and must be able to keep its own durable claim.
drop index if exists public.paypal_operation_claims_invoice_number_idx;

create unique index paypal_operation_claims_invoice_number_idx
  on public.paypal_operation_claims (invoice_number)
  where operation = 'create';

commit;
