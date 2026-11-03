begin;

-- Rename the PL/pgSQL hash local and qualify stored offer fields in the replay check.
-- Preserve the existing caller, ownership, lock, hash, conflict, and creation semantics.
create or replace function public.create_marketplace_offer(p_proposal_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid:=auth.uid(); proposal public.marketplace_proposals%rowtype; job_row public.marketplace_jobs%rowtype;
  offer_id uuid; request_hash_value text; key_id uuid; existing_status text; existing_project uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  key_id:=(p_input->>'idempotency_key')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||key_id::text,0));
  request_hash_value:=encode(extensions.digest(p_proposal_id::text||E'\n'||p_input::text,'sha256'),'hex');
  select marketplace_offers.id into offer_id
    from public.marketplace_offers
    where marketplace_offers.idempotency_key=key_id;
  if offer_id is not null then
    if not exists (
      select 1
      from public.marketplace_offers as existing_offer
      where existing_offer.id=offer_id
        and existing_offer.request_hash=request_hash_value
        and existing_offer.client_id=actor_id
    ) then
      raise exception 'Offer key conflicts with prior details' using errcode = '23505';
    end if;
    select existing_offer.status,existing_offer.project_id
      into existing_status,existing_project
      from public.marketplace_offers as existing_offer
      where existing_offer.id=offer_id;
    return jsonb_build_object('offerId',offer_id,'status',existing_status,'projectId',existing_project,'alreadyCreated',true);
  end if;

  select * into proposal from public.marketplace_proposals where id=p_proposal_id for update;
  if not found then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  select * into job_row from public.marketplace_jobs where id=proposal.job_id;
  if job_row.created_by<>actor_id or job_row.status not in ('published','closed')
    or proposal.status not in ('submitted','shortlisted','interview_invited') then raise exception 'Proposal is not eligible for an offer' using errcode = '42501'; end if;
  if (p_input->>'currency')<>job_row.currency then raise exception 'Offer currency must match the job' using errcode = '22023'; end if;
  insert into public.marketplace_offers(proposal_id,job_id,client_id,freelancer_id,idempotency_key,request_hash,terms,amount_minor,currency,timeline_days)
  values(p_proposal_id,proposal.job_id,actor_id,proposal.freelancer_id,key_id,request_hash_value,trim(p_input->>'terms'),(p_input->>'amount_minor')::bigint,job_row.currency,(p_input->>'timeline_days')::integer)
  returning id into offer_id;
  update public.marketplace_proposals set status='offer_sent' where id=p_proposal_id;
  insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
  values(p_proposal_id,actor_id,proposal.status,'offer_sent','offer_created');
  return jsonb_build_object('offerId',offer_id,'status','sent','projectId',null);
end;
$$;

commit;
