begin;

alter table public.projects
  add column contract_type text not null default 'fixed' check (contract_type in ('fixed','hourly'));

alter table public.invoices alter column milestone_id drop not null;
alter table public.invoices add column hourly_batch_id uuid;

create table public.hourly_contracts (
  project_id uuid primary key references public.projects(id) on delete cascade,
  marketplace_offer_id uuid not null unique references public.marketplace_offers(id) on delete restrict,
  freelancer_id uuid not null references public.profiles(id) on delete restrict,
  client_id uuid not null references public.profiles(id) on delete restrict,
  hourly_rate_minor bigint not null check (hourly_rate_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  agreement_version_id uuid not null,
  status text not null default 'draft' check (status in ('draft','active','paused','closed')),
  created_at timestamptz not null default now(),
  foreign key (project_id,agreement_version_id) references public.agreement_versions(project_id,id) on delete restrict,
  check (freelancer_id<>client_id)
);

-- Earlier releases could record an hourly offer as accepted without creating its project.
-- Attach those accepted offers to a draft agreement so the existing decision can proceed safely.
do $$
declare
  offer_row record; new_project_id uuid; agreement_id uuid; client_name text;
begin
  for offer_row in
    select offer.id,offer.freelancer_id,offer.client_id,offer.job_id,offer.terms,offer.amount_minor,offer.currency,
      job.title,job.description
    from public.marketplace_offers offer
    join public.marketplace_jobs job on job.id=offer.job_id and job.project_type='hourly'
    where offer.status='accepted' and offer.project_id is null
    order by offer.created_at,offer.id
    for update of offer
  loop
    select coalesce(nullif(client.organization_name,''),nullif(account.display_name,''),'Client') into client_name
    from public.profiles account left join public.client_profiles client on client.user_id=account.id
    where account.id=offer_row.client_id;
    insert into public.projects(created_by,idempotency_key,request_hash,title,description,client_name,budget_minor,currency,contract_type)
      values(offer_row.freelancer_id,extensions.gen_random_uuid(),encode(extensions.digest('marketplace-offer:'||offer_row.id::text,'sha256'),'hex'),
        offer_row.title,left(offer_row.description,5000),coalesce(client_name,'Client'),offer_row.amount_minor,offer_row.currency,'hourly')
      returning id into new_project_id;
    insert into public.project_members(project_id,user_id,role,invited_by) values
      (new_project_id,offer_row.freelancer_id,'freelancer',offer_row.freelancer_id),(new_project_id,offer_row.client_id,'client',offer_row.freelancer_id);
    insert into public.agreement_versions(project_id,version_number,created_by,state,title,scope_text,terms,total_minor,currency)
      values(new_project_id,1,offer_row.freelancer_id,'draft',offer_row.title,offer_row.description,
        jsonb_build_object('marketplaceOfferId',offer_row.id,'jobId',offer_row.job_id,'offerTerms',offer_row.terms,
          'contractType','hourly','hourlyRateMinor',offer_row.amount_minor::text,'hourlyRateCurrency',offer_row.currency,
          'draftNotice','Review the hourly rate and written terms. Logged time is reviewed separately and only approved hours may be invoiced.'),
        offer_row.amount_minor,offer_row.currency)
      returning id into agreement_id;
    update public.projects set current_agreement_version_id=agreement_id where id=new_project_id;
    insert into public.hourly_contracts(project_id,marketplace_offer_id,freelancer_id,client_id,hourly_rate_minor,currency,agreement_version_id)
      values(new_project_id,offer_row.id,offer_row.freelancer_id,offer_row.client_id,offer_row.amount_minor,offer_row.currency,agreement_id);
    update public.marketplace_offers set project_id=new_project_id where id=offer_row.id;
    insert into public.activity_logs(project_id,actor_id,event_type,entity_type,entity_id,details)
      values(new_project_id,offer_row.freelancer_id,'marketplace.offer_accepted','agreement_version',agreement_id,jsonb_build_object('contractType','hourly','backfilled',true));
  end loop;
end;
$$;

create table public.hourly_timer_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agreement_version_id uuid not null,
  freelancer_id uuid not null references public.profiles(id) on delete restrict,
  description text not null check (char_length(trim(description)) between 1 and 1600),
  state text not null check (state in ('running','paused','stopped')),
  started_at timestamptz not null default now(),
  running_since timestamptz,
  accumulated_seconds integer not null default 0 check (accumulated_seconds between 0 and 604800),
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id,agreement_version_id) references public.agreement_versions(project_id,id) on delete restrict,
  check ((state='running')=(running_since is not null)),
  check ((state='stopped')=(stopped_at is not null))
);

create table public.hourly_timer_events (
  id uuid primary key default extensions.gen_random_uuid(),
  timer_id uuid not null references public.hourly_timer_sessions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('started','paused','resumed','stopped')),
  elapsed_seconds integer not null check (elapsed_seconds between 0 and 604800),
  created_at timestamptz not null default now()
);

create table public.hourly_time_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agreement_version_id uuid not null,
  freelancer_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid,
  request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  timer_session_id uuid unique references public.hourly_timer_sessions(id) on delete restrict,
  work_date date not null,
  duration_seconds integer not null check (duration_seconds between 1 and 604800),
  description text not null check (char_length(trim(description)) between 1 and 1600),
  source text not null check (source in ('manual','timer')),
  status text not null default 'draft' check (status in ('draft','submitted','approved','disputed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  foreign key (project_id,agreement_version_id) references public.agreement_versions(project_id,id) on delete restrict,
  unique (freelancer_id,idempotency_key),
  check ((idempotency_key is null)=(request_hash is null)),
  check ((source='timer')=(timer_session_id is not null)),
  check ((status='draft' and submitted_at is null) or (status in ('submitted','approved','disputed') and submitted_at is not null))
);

create table public.hourly_time_entry_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  entry_id uuid not null references public.hourly_time_entries(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check (decision in ('approved','disputed')),
  details text not null default '' check (char_length(details)<=2000),
  created_at timestamptz not null default now()
);

create table public.hourly_time_entry_events (
  id uuid primary key default extensions.gen_random_uuid(),
  entry_id uuid not null references public.hourly_time_entries(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in ('created','edited','submitted','approved','disputed')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
  created_at timestamptz not null default now()
);

create table public.hourly_invoice_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  agreement_version_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  source_set_hash text not null check (source_set_hash ~ '^[0-9a-f]{64}$'),
  attempt_number integer not null check (attempt_number>0),
  operation_key text not null unique,
  invoice_number text not null unique check (char_length(invoice_number) between 5 and 25),
  total_seconds bigint not null check (total_seconds>0),
  amount_minor bigint not null check (amount_minor>0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  work_date_start date not null,
  work_date_end date not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (project_id,agreement_version_id) references public.agreement_versions(project_id,id) on delete restrict,
  unique (source_set_hash,attempt_number),
  check (work_date_end>=work_date_start)
);

alter table public.invoices add constraint invoices_hourly_batch_fk
  foreign key (hourly_batch_id) references public.hourly_invoice_batches(id) on delete restrict;

create table public.hourly_invoice_batch_entries (
  batch_id uuid not null references public.hourly_invoice_batches(id) on delete restrict,
  entry_id uuid not null references public.hourly_time_entries(id) on delete restrict,
  primary key (batch_id,entry_id)
);

alter table public.invoices add constraint invoices_hourly_batch_source_check
  check ((milestone_id is null)=(hourly_batch_id is not null));
alter table public.invoices add constraint invoices_hourly_batch_unique unique(hourly_batch_id);
create index invoices_project_created_idx on public.invoices(project_id,created_at desc);

alter table public.paypal_operation_claims alter column milestone_id drop not null;
alter table public.paypal_operation_claims add column hourly_batch_id uuid references public.hourly_invoice_batches(id) on delete restrict;
alter table public.paypal_operation_claims add constraint paypal_operation_claims_source_check
  check ((milestone_id is null)=(hourly_batch_id is not null));
create index hourly_entries_project_status_date_idx on public.hourly_time_entries(project_id,status,work_date desc);
create index hourly_entries_freelancer_created_idx on public.hourly_time_entries(freelancer_id,created_at desc);
create index hourly_entry_reviews_history_idx on public.hourly_time_entry_reviews(entry_id,created_at desc);
create unique index hourly_one_open_timer_per_freelancer_idx on public.hourly_timer_sessions(freelancer_id) where state in ('running','paused');
create index hourly_timer_project_created_idx on public.hourly_timer_sessions(project_id,created_at desc);
create index hourly_batch_project_created_idx on public.hourly_invoice_batches(project_id,created_at desc);
create index hourly_batch_entries_entry_idx on public.hourly_invoice_batch_entries(entry_id,batch_id);
create unique index marketplace_offers_project_unique_idx on public.marketplace_offers(project_id) where project_id is not null;

alter table public.hourly_contracts enable row level security;
alter table public.hourly_time_entries enable row level security;
alter table public.hourly_time_entry_reviews enable row level security;
alter table public.hourly_time_entry_events enable row level security;
alter table public.hourly_timer_sessions enable row level security;
alter table public.hourly_timer_events enable row level security;
alter table public.hourly_invoice_batches enable row level security;
alter table public.hourly_invoice_batch_entries enable row level security;

create policy hourly_contracts_read_member on public.hourly_contracts for select to authenticated using(public.is_project_member(project_id));
create policy hourly_entries_read_member on public.hourly_time_entries for select to authenticated using(public.is_project_member(project_id));
create policy hourly_entry_reviews_read_member on public.hourly_time_entry_reviews for select to authenticated
  using(exists(select 1 from public.hourly_time_entries entry where entry.id=entry_id and public.is_project_member(entry.project_id)));
create policy hourly_entry_events_read_member on public.hourly_time_entry_events for select to authenticated
  using(exists(select 1 from public.hourly_time_entries entry where entry.id=entry_id and public.is_project_member(entry.project_id)));
create policy hourly_timer_sessions_read_owner on public.hourly_timer_sessions for select to authenticated using(freelancer_id=auth.uid());
create policy hourly_timer_events_read_owner on public.hourly_timer_events for select to authenticated using(actor_id=auth.uid());
create policy hourly_invoice_batches_read_member on public.hourly_invoice_batches for select to authenticated using(public.is_project_member(project_id));
create policy hourly_invoice_batch_entries_read_member on public.hourly_invoice_batch_entries for select to authenticated
  using(exists(select 1 from public.hourly_invoice_batches batch where batch.id=batch_id and public.is_project_member(batch.project_id)));

revoke all on public.hourly_contracts,public.hourly_time_entries,public.hourly_time_entry_reviews,public.hourly_time_entry_events,
  public.hourly_timer_sessions,public.hourly_timer_events,public.hourly_invoice_batches,public.hourly_invoice_batch_entries from public,anon,authenticated;

create or replace function public.is_active_hourly_project(p_project_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $$
  select exists(select 1 from public.hourly_contracts contract_row
    join public.projects project_row on project_row.id=contract_row.project_id
    join public.agreement_versions agreement on agreement.id=contract_row.agreement_version_id and agreement.project_id=project_row.id
    where contract_row.project_id=p_project_id and contract_row.status='active'
      and project_row.contract_type='hourly' and project_row.current_agreement_version_id=agreement.id
      and agreement.state='accepted'
      and (select count(distinct accepted.member_role) from public.agreement_acceptances accepted where accepted.agreement_version_id=agreement.id)=2);
$$;

create or replace function public.validate_hourly_marketplace_offer_rate()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare job_row public.marketplace_jobs%rowtype;
begin
  select * into job_row from public.marketplace_jobs where id=new.job_id;
  if job_row.project_type='hourly' and (new.amount_minor<job_row.hourly_rate_min_minor or new.amount_minor>job_row.hourly_rate_max_minor) then
    raise exception 'The offered hourly rate must be within the listing range.' using errcode='22023';
  end if;
  return new;
end;
$$;
create trigger marketplace_offer_hourly_rate_guard before insert on public.marketplace_offers
for each row execute function public.validate_hourly_marketplace_offer_rate();

create or replace function public.accept_agreement_version(p_agreement_version_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  actor_id uuid:=auth.uid(); target_project_id uuid; agreement_state text; agreement_total bigint; agreement_currency text;
  agreement_terms jsonb; project_total bigint; project_currency text; contract_kind text; rate_minor bigint;
  rate_currency text; milestone_count integer; milestone_total numeric; actor_role text; accepted_count integer; final_state text;
begin
  if actor_id is null then raise exception 'Authentication is required.' using errcode='28000'; end if;
  select av.project_id,av.state,av.total_minor,av.currency,av.terms into target_project_id,agreement_state,agreement_total,agreement_currency,agreement_terms
  from public.agreement_versions av where av.id=p_agreement_version_id for update;
  if target_project_id is null then raise exception 'Agreement version was not found.' using errcode='P0002'; end if;
  select p.budget_minor,p.currency,p.contract_type into project_total,project_currency,contract_kind from public.projects p where p.id=target_project_id for update;
  select pm.role into actor_role from public.project_members pm where pm.project_id=target_project_id and pm.user_id=actor_id;
  if actor_role is null then raise exception 'You are not a member of this project.' using errcode='42501'; end if;
  if agreement_state='accepted' then return jsonb_build_object('state','accepted','alreadyAccepted',true); end if;
  if agreement_terms ? 'contractType' and agreement_terms->>'contractType' is distinct from contract_kind then
    raise exception 'The marketplace contract type does not match the project.' using errcode='23514';
  end if;
  if contract_kind='hourly' then
    select contract_row.hourly_rate_minor,contract_row.currency into rate_minor,rate_currency
    from public.hourly_contracts contract_row where contract_row.project_id=target_project_id and contract_row.agreement_version_id=p_agreement_version_id and contract_row.status='draft' for update;
    if rate_minor is null or agreement_total<>rate_minor or project_total<>rate_minor or agreement_currency<>rate_currency or project_currency<>rate_currency
      or agreement_terms->>'hourlyRateMinor'<>rate_minor::text or agreement_terms->>'hourlyRateCurrency'<>rate_currency
      or (select count(*) from public.milestones where agreement_version_id=p_agreement_version_id)<>0 then
      raise exception 'Review the hourly rate and contract details before accepting.' using errcode='23514';
    end if;
  else
    if agreement_terms ? 'marketplaceOfferId' and agreement_terms->>'milestonePlanReviewed' is distinct from 'true' then
      raise exception 'Review and save the hiring milestone plan before either party accepts.' using errcode='23514';
    end if;
    select count(*),coalesce(sum(m.amount_minor),0) into milestone_count,milestone_total
    from public.milestones m where m.agreement_version_id=p_agreement_version_id;
    if milestone_count not between 1 and 20 or milestone_total<>agreement_total or agreement_total<>project_total or agreement_currency<>project_currency
      or exists(select 1 from public.milestones m where m.agreement_version_id=p_agreement_version_id and m.workflow_status<>'draft') then
      raise exception 'Complete a draft milestone plan whose amounts equal the agreement before either party accepts.' using errcode='23514';
    end if;
  end if;

  insert into public.agreement_acceptances(agreement_version_id,user_id,member_role)
    values(p_agreement_version_id,actor_id,actor_role) on conflict(agreement_version_id,user_id) do nothing;
  if not found then
    select count(distinct aa.member_role) into accepted_count from public.agreement_acceptances aa where aa.agreement_version_id=p_agreement_version_id;
    return jsonb_build_object('state',agreement_state,'acceptedRoleCount',accepted_count,'alreadyAcceptedByYou',true);
  end if;
  select count(distinct aa.member_role) into accepted_count from public.agreement_acceptances aa where aa.agreement_version_id=p_agreement_version_id;
  if accepted_count=2 then
    final_state:='accepted';
    update public.agreement_versions set state='accepted' where id=p_agreement_version_id;
    update public.projects set current_agreement_version_id=p_agreement_version_id,status='agreed' where id=target_project_id;
    update public.milestones set workflow_status='agreed' where agreement_version_id=p_agreement_version_id and workflow_status='draft';
    if contract_kind='hourly' then update public.hourly_contracts set status='active' where project_id=target_project_id and agreement_version_id=p_agreement_version_id; end if;
  else
    final_state:='awaiting_acceptance';
    update public.agreement_versions set state='awaiting_acceptance' where id=p_agreement_version_id;
    update public.projects set status='awaiting_client_agreement' where id=target_project_id;
  end if;
  insert into public.activity_logs(project_id,actor_id,event_type,entity_type,entity_id,details)
  values(target_project_id,actor_id,'agreement.accepted_by_member','agreement_version',p_agreement_version_id,jsonb_build_object('role',actor_role,'acceptedRoles',accepted_count,'contractType',contract_kind));
  return jsonb_build_object('state',final_state,'acceptedRoleCount',accepted_count);
end;
$$;

create or replace function public.respond_marketplace_offer(p_offer_id uuid,p_decision text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare
  actor_id uuid:=auth.uid(); offer public.marketplace_offers%rowtype; job_row public.marketplace_jobs%rowtype;
  client_name text; new_project_id uuid; agreement_id uuid; current_proposal_status text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into offer from public.marketplace_offers where id=p_offer_id for update;
  if not found then raise exception 'Offer not found' using errcode='P0002'; end if;
  if offer.freelancer_id<>actor_id then raise exception 'Offer is not addressed to this account' using errcode='42501'; end if;
  if offer.status='accepted' and p_decision='accept' then
    return jsonb_build_object('offerId',offer.id,'status','accepted','contractType',(select job.project_type from public.marketplace_jobs job where job.id=offer.job_id),'projectId',offer.project_id,'requiresHourlySetup',false);
  end if;
  if offer.status<>'sent' or p_decision not in ('accept','decline') then raise exception 'Offer cannot be changed now' using errcode='55000'; end if;
  select * into job_row from public.marketplace_jobs where id=offer.job_id;
  if p_decision='decline' then
    update public.marketplace_offers set status='declined',responded_at=now() where id=p_offer_id;
    select status into current_proposal_status from public.marketplace_proposals where id=offer.proposal_id;
    update public.marketplace_proposals set status='declined' where id=offer.proposal_id;
    insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
      values(offer.proposal_id,actor_id,current_proposal_status,'declined','offer_declined');
    return jsonb_build_object('offerId',offer.id,'status','declined','projectId',null);
  end if;
  if job_row.project_type='hourly' and (offer.amount_minor<job_row.hourly_rate_min_minor or offer.amount_minor>job_row.hourly_rate_max_minor) then
    raise exception 'The accepted hourly rate no longer fits the job terms.' using errcode='23514';
  end if;
  update public.marketplace_offers set status='accepted',responded_at=now() where id=p_offer_id;
  select status into current_proposal_status from public.marketplace_proposals where id=offer.proposal_id;
  update public.marketplace_proposals set status='accepted' where id=offer.proposal_id;
  insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
    values(offer.proposal_id,actor_id,current_proposal_status,'accepted','offer_accepted');
  select coalesce(nullif(client.organization_name,''),nullif(account.display_name,''),'Client') into client_name
  from public.profiles account left join public.client_profiles client on client.user_id=account.id where account.id=offer.client_id;
  insert into public.projects(created_by,idempotency_key,request_hash,title,description,client_name,budget_minor,currency,contract_type)
    values(offer.freelancer_id,extensions.gen_random_uuid(),encode(extensions.digest('marketplace-offer:'||offer.id::text,'sha256'),'hex'),
      job_row.title,left(job_row.description,5000),coalesce(client_name,'Client'),offer.amount_minor,offer.currency,job_row.project_type)
    returning id into new_project_id;
  insert into public.project_members(project_id,user_id,role,invited_by) values
    (new_project_id,offer.freelancer_id,'freelancer',offer.freelancer_id),(new_project_id,offer.client_id,'client',offer.freelancer_id);
  insert into public.agreement_versions(project_id,version_number,created_by,state,title,scope_text,terms,total_minor,currency)
    values(new_project_id,1,offer.freelancer_id,'draft',job_row.title,job_row.description,
      jsonb_build_object('marketplaceOfferId',offer.id,'jobId',job_row.id,'offerTerms',offer.terms,'requirements',to_jsonb(job_row.requirements),
        'contractType',job_row.project_type,'hourlyRateMinor',case when job_row.project_type='hourly' then offer.amount_minor::text else null end,
        'hourlyRateCurrency',case when job_row.project_type='hourly' then offer.currency else null end,
        'draftNotice',case when job_row.project_type='hourly' then 'Review the hourly rate and written terms. Logged time is reviewed separately and only approved hours may be invoiced.'
          else 'This hiring draft requires review, editable milestone details, and explicit approval from both parties.' end),
      offer.amount_minor,offer.currency)
    returning id into agreement_id;
  update public.projects set current_agreement_version_id=agreement_id where id=new_project_id;
  if job_row.project_type='hourly' then
    insert into public.hourly_contracts(project_id,marketplace_offer_id,freelancer_id,client_id,hourly_rate_minor,currency,agreement_version_id)
      values(new_project_id,offer.id,offer.freelancer_id,offer.client_id,offer.amount_minor,offer.currency,agreement_id);
  else
    insert into public.milestones(project_id,agreement_version_id,sequence,title,description,deliverables,acceptance_criteria,completion_conditions,amount_minor,currency)
      values(new_project_id,agreement_id,1,'Draft delivery plan',
        'This initial milestone is a draft derived from the accepted job offer. Refine deliverables, acceptance criteria, and allocation before sharing the agreement.',
        jsonb_build_array('Deliverables to be agreed before the contract is shared'),
        jsonb_build_array('Both parties review and approve the final written milestone criteria'),
        jsonb_build_array('The freelancer submits evidence and the client records a review'),offer.amount_minor,offer.currency);
  end if;
  update public.marketplace_offers set project_id=new_project_id where id=p_offer_id;
  insert into public.activity_logs(project_id,actor_id,event_type,entity_type,entity_id,details)
    values(new_project_id,actor_id,'marketplace.offer_accepted','agreement_version',agreement_id,jsonb_build_object('contractType',job_row.project_type));
  return jsonb_build_object('offerId',offer.id,'status','accepted','contractType',job_row.project_type,'projectId',new_project_id,
    'agreementVersionId',agreement_id,'projectStatus','draft','requiresHourlySetup',false);
end;
$$;

create or replace function public.create_manual_hourly_time_entry(p_project_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare actor_id uuid:=auth.uid(); contract_row public.hourly_contracts%rowtype; entry_id uuid; key_id uuid; request_hash text; existing_hash text; date_value date; seconds_value integer; description_value text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['idempotencyKey','workDate','durationSeconds','description']<>'{}'::jsonb
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string'
    or (p_input->>'idempotencyKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'workDate') is distinct from 'string' or (p_input->>'workDate') !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(p_input->'durationSeconds') is distinct from 'number' or (p_input->>'durationSeconds') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'description') is distinct from 'string' then
    raise exception 'Time entry details are invalid' using errcode='22023';
  end if;
  key_id:=(p_input->>'idempotencyKey')::uuid;
  date_value:=(p_input->>'workDate')::date;
  seconds_value:=(p_input->>'durationSeconds')::integer;
  description_value:=trim(p_input->>'description');
  if seconds_value not between 1 and 86400 or char_length(description_value) not between 1 and 1600 then
    raise exception 'Use a duration up to 24 hours and a short work description.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||key_id::text,0));
  select * into contract_row from public.hourly_contracts where project_id=p_project_id for update;
  if not found or contract_row.freelancer_id<>actor_id or contract_row.status<>'active' or not public.is_active_hourly_project(p_project_id) then
    raise exception 'Only the freelancer on an active hourly contract can log time.' using errcode='42501';
  end if;
  request_hash:=encode(extensions.digest(jsonb_build_object('projectId',p_project_id,'agreementVersionId',contract_row.agreement_version_id,
    'workDate',date_value,'durationSeconds',seconds_value,'description',description_value)::text,'sha256'),'hex');
  select id,request_hash into entry_id,existing_hash from public.hourly_time_entries where freelancer_id=actor_id and idempotency_key=key_id;
  if entry_id is not null then
    if existing_hash<>request_hash then raise exception 'This time-entry key was already used with different details.' using errcode='23505'; end if;
    return jsonb_build_object('entryId',entry_id,'status','draft','alreadyCreated',true);
  end if;
  insert into public.hourly_time_entries(project_id,agreement_version_id,freelancer_id,idempotency_key,request_hash,work_date,duration_seconds,description,source)
    values(p_project_id,contract_row.agreement_version_id,actor_id,key_id,request_hash,date_value,seconds_value,description_value,'manual') returning id into entry_id;
  insert into public.hourly_time_entry_events(entry_id,actor_id,event_type) values(entry_id,actor_id,'created');
  return jsonb_build_object('entryId',entry_id,'status','draft','alreadyCreated',false);
end;
$$;

create or replace function public.edit_draft_hourly_time_entry(p_entry_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); entry_row public.hourly_time_entries%rowtype; date_value date; seconds_value integer; description_value text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' or p_input-array['workDate','durationSeconds','description']<>'{}'::jsonb
    or jsonb_typeof(p_input->'workDate') is distinct from 'string' or (p_input->>'workDate') !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(p_input->'durationSeconds') is distinct from 'number' or (p_input->>'durationSeconds') !~ '^[0-9]+$'
    or jsonb_typeof(p_input->'description') is distinct from 'string' then
    raise exception 'Time entry details are invalid' using errcode='22023';
  end if;
  date_value:=(p_input->>'workDate')::date; seconds_value:=(p_input->>'durationSeconds')::integer; description_value:=trim(p_input->>'description');
  if seconds_value not between 1 and 604800 or char_length(description_value) not between 1 and 1600 then raise exception 'Time entry details are invalid' using errcode='22023'; end if;
  select * into entry_row from public.hourly_time_entries where id=p_entry_id for update;
  if not found or entry_row.freelancer_id<>actor_id or entry_row.status not in ('draft','disputed')
    or not public.is_active_hourly_project(entry_row.project_id) then raise exception 'Editable manual draft not found.' using errcode='42501'; end if;
  update public.hourly_time_entries set work_date=date_value,duration_seconds=seconds_value,description=description_value,
    status='draft',submitted_at=null,updated_at=now() where id=p_entry_id;
  insert into public.hourly_time_entry_events(entry_id,actor_id,event_type) values(p_entry_id,actor_id,'edited');
  return jsonb_build_object('entryId',p_entry_id,'status','draft');
end;
$$;

create or replace function public.submit_hourly_time_entry(p_entry_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); entry_row public.hourly_time_entries%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into entry_row from public.hourly_time_entries where id=p_entry_id;
  if not found then raise exception 'Time entry not found.' using errcode='P0002'; end if;
  perform 1 from public.projects where id=entry_row.project_id for update;
  select * into entry_row from public.hourly_time_entries where id=p_entry_id for update;
  if entry_row.freelancer_id<>actor_id or entry_row.status<>'draft' or not public.is_active_hourly_project(entry_row.project_id)
    or not exists(select 1 from public.hourly_contracts contract_row where contract_row.project_id=entry_row.project_id and contract_row.agreement_version_id=entry_row.agreement_version_id and contract_row.freelancer_id=actor_id) then
    raise exception 'Only your draft entry on the active hourly contract can be submitted.' using errcode='42501';
  end if;
  update public.hourly_time_entries set status='submitted',submitted_at=now(),updated_at=now() where id=p_entry_id;
  insert into public.hourly_time_entry_events(entry_id,actor_id,event_type) values(p_entry_id,actor_id,'submitted');
  return jsonb_build_object('entryId',p_entry_id,'status','submitted');
end;
$$;

create or replace function public.review_hourly_time_entry(p_entry_id uuid,p_decision text,p_details text default '')
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); entry_row public.hourly_time_entries%rowtype; contract_row public.hourly_contracts%rowtype; details_value text:=trim(coalesce(p_details,''));
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into entry_row from public.hourly_time_entries where id=p_entry_id;
  if not found then raise exception 'Time entry not found.' using errcode='P0002'; end if;
  perform 1 from public.projects where id=entry_row.project_id for update;
  select * into entry_row from public.hourly_time_entries where id=p_entry_id for update;
  select * into contract_row from public.hourly_contracts where project_id=entry_row.project_id for update;
  if contract_row.client_id<>actor_id or entry_row.status<>'submitted' or not public.is_active_hourly_project(entry_row.project_id)
    or p_decision not in ('approved','disputed') or char_length(details_value)>2000
    or (p_decision='disputed' and char_length(details_value)<8) then
    raise exception 'This submitted entry cannot be reviewed with those details.' using errcode='42501';
  end if;
  insert into public.hourly_time_entry_reviews(entry_id,reviewer_id,decision,details) values(p_entry_id,actor_id,p_decision,details_value);
  update public.hourly_time_entries set status=p_decision,updated_at=now() where id=p_entry_id;
  insert into public.hourly_time_entry_events(entry_id,actor_id,event_type,details)
    values(p_entry_id,actor_id,p_decision,jsonb_build_object('details',details_value));
  return jsonb_build_object('entryId',p_entry_id,'status',p_decision);
end;
$$;

create or replace function public.start_hourly_timer(p_project_id uuid,p_description text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare actor_id uuid:=auth.uid(); contract_row public.hourly_contracts%rowtype; existing_row public.hourly_timer_sessions%rowtype; timer_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_description,''))) not between 1 and 1600 then raise exception 'Add a brief description before starting the timer.' using errcode='22023'; end if;
  select * into contract_row from public.hourly_contracts where project_id=p_project_id for update;
  if not found or contract_row.freelancer_id<>actor_id or contract_row.status<>'active' or not public.is_active_hourly_project(p_project_id) then
    raise exception 'Only the freelancer on an active hourly contract can start a timer.' using errcode='42501';
  end if;
  select * into existing_row from public.hourly_timer_sessions where freelancer_id=actor_id and state in ('running','paused') for update;
  if found then
    if existing_row.project_id<>p_project_id then raise exception 'Pause or stop the other active timer first.' using errcode='55000'; end if;
    return jsonb_build_object('timerId',existing_row.id,'state',existing_row.state,'elapsedSeconds',existing_row.accumulated_seconds,'runningSince',existing_row.running_since,'alreadyActive',true);
  end if;
  insert into public.hourly_timer_sessions(project_id,agreement_version_id,freelancer_id,description,state,running_since)
    values(p_project_id,contract_row.agreement_version_id,actor_id,trim(p_description),'running',now()) returning id into timer_id;
  insert into public.hourly_timer_events(timer_id,project_id,actor_id,event_type,elapsed_seconds) values(timer_id,p_project_id,actor_id,'started',0);
  return jsonb_build_object('timerId',timer_id,'state','running','elapsedSeconds',0,'runningSince',now(),'alreadyActive',false);
end;
$$;

create or replace function public.control_hourly_timer(p_timer_id uuid,p_action text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare actor_id uuid:=auth.uid(); timer_row public.hourly_timer_sessions%rowtype; elapsed integer; entry_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into timer_row from public.hourly_timer_sessions where id=p_timer_id and freelancer_id=actor_id for update;
  if not found then raise exception 'Active timer not found.' using errcode='P0002'; end if;
  if timer_row.state='stopped' then return jsonb_build_object('timerId',p_timer_id,'state','stopped','elapsedSeconds',timer_row.accumulated_seconds); end if;
  elapsed:=timer_row.accumulated_seconds;
  if timer_row.state='running' then elapsed:=elapsed+greatest(0,floor(extract(epoch from now()-timer_row.running_since))::integer); end if;
  if p_action='pause' and timer_row.state='running' then
    update public.hourly_timer_sessions set state='paused',running_since=null,accumulated_seconds=elapsed where id=p_timer_id;
    insert into public.hourly_timer_events(timer_id,project_id,actor_id,event_type,elapsed_seconds) values(p_timer_id,timer_row.project_id,actor_id,'paused',elapsed);
    return jsonb_build_object('timerId',p_timer_id,'state','paused','elapsedSeconds',elapsed);
  elsif p_action='resume' and timer_row.state='paused' then
    update public.hourly_timer_sessions set state='running',running_since=now() where id=p_timer_id;
    insert into public.hourly_timer_events(timer_id,project_id,actor_id,event_type,elapsed_seconds) values(p_timer_id,timer_row.project_id,actor_id,'resumed',elapsed);
    return jsonb_build_object('timerId',p_timer_id,'state','running','elapsedSeconds',elapsed,'runningSince',now());
  elsif p_action='stop' and timer_row.state in ('running','paused') then
    if elapsed<1 or elapsed>604800 then raise exception 'The timer must record between one second and seven days.' using errcode='22023'; end if;
    update public.hourly_timer_sessions set state='stopped',running_since=null,accumulated_seconds=elapsed,stopped_at=now() where id=p_timer_id;
    insert into public.hourly_time_entries(project_id,agreement_version_id,freelancer_id,timer_session_id,work_date,duration_seconds,description,source)
      values(timer_row.project_id,timer_row.agreement_version_id,actor_id,p_timer_id,now()::date,elapsed,timer_row.description,'timer') returning id into entry_id;
    insert into public.hourly_time_entry_events(entry_id,actor_id,event_type) values(entry_id,actor_id,'created');
    insert into public.hourly_timer_events(timer_id,project_id,actor_id,event_type,elapsed_seconds) values(p_timer_id,timer_row.project_id,actor_id,'stopped',elapsed);
    return jsonb_build_object('timerId',p_timer_id,'state','stopped','elapsedSeconds',elapsed,'entryId',entry_id);
  end if;
  raise exception 'That timer action is not valid for its current state.' using errcode='55000';
end;
$$;

create view public.hourly_contracts_for_user with (security_barrier=true) as
select contract_row.project_id,contract_row.hourly_rate_minor,contract_row.currency,contract_row.status,contract_row.agreement_version_id,
  (contract_row.freelancer_id=auth.uid()) as is_freelancer
from public.hourly_contracts contract_row where public.is_project_member(contract_row.project_id);

create view public.hourly_time_entries_for_user with (security_barrier=true) as
select entry.id,entry.project_id,entry.work_date,entry.duration_seconds,entry.description,entry.source,entry.status,entry.created_at,entry.submitted_at,
  (entry.freelancer_id=auth.uid()) as is_mine,review.decision as review_decision,review.details as review_details,review.created_at as reviewed_at
from public.hourly_time_entries entry
left join lateral (select history.decision,history.details,history.created_at from public.hourly_time_entry_reviews history
  where history.entry_id=entry.id order by history.created_at desc,history.id desc limit 1) review on true
where public.is_project_member(entry.project_id);

create view public.hourly_timer_sessions_for_user with (security_barrier=true) as
select id,project_id,description,state,started_at,running_since,accumulated_seconds,stopped_at
from public.hourly_timer_sessions where freelancer_id=auth.uid() and state in ('running','paused');

create view public.hourly_invoice_candidates_for_user with (security_barrier=true) as
select project_row.id as project_id,project_row.title as project_title,project_row.client_name,contract_row.hourly_rate_minor,contract_row.currency,
  sum(entry.duration_seconds)::bigint as approved_seconds,round(contract_row.hourly_rate_minor::numeric*sum(entry.duration_seconds)::numeric/3600)::bigint as amount_minor,
  min(entry.work_date) as work_date_start,max(entry.work_date) as work_date_end,count(*)::integer as entry_count
from public.hourly_contracts contract_row
join public.projects project_row on project_row.id=contract_row.project_id
join public.hourly_time_entries entry on entry.project_id=contract_row.project_id and entry.agreement_version_id=contract_row.agreement_version_id and entry.status='approved'
where contract_row.freelancer_id=auth.uid() and contract_row.status='active' and public.is_active_hourly_project(project_row.id)
  and not exists(select 1 from public.hourly_invoice_batch_entries link_row
    join public.hourly_invoice_batches batch_row on batch_row.id=link_row.batch_id and batch_row.released_at is null
    where link_row.entry_id=entry.id)
group by project_row.id,project_row.title,project_row.client_name,contract_row.hourly_rate_minor,contract_row.currency
having round(contract_row.hourly_rate_minor::numeric*sum(entry.duration_seconds)::numeric/3600)>0;

revoke all on function public.is_active_hourly_project(uuid) from public,anon,authenticated;
revoke all on function public.validate_hourly_marketplace_offer_rate() from public,anon,authenticated;
revoke all on function public.create_manual_hourly_time_entry(uuid,jsonb),public.edit_draft_hourly_time_entry(uuid,jsonb),
  public.submit_hourly_time_entry(uuid),public.review_hourly_time_entry(uuid,text,text),public.start_hourly_timer(uuid,text),
  public.control_hourly_timer(uuid,text) from public,anon;
grant execute on function public.create_manual_hourly_time_entry(uuid,jsonb),public.edit_draft_hourly_time_entry(uuid,jsonb),
  public.submit_hourly_time_entry(uuid),public.review_hourly_time_entry(uuid,text,text),public.start_hourly_timer(uuid,text),
  public.control_hourly_timer(uuid,text) to authenticated;
grant select on public.hourly_contracts_for_user,public.hourly_time_entries_for_user,public.hourly_timer_sessions_for_user,
  public.hourly_invoice_candidates_for_user to authenticated;

create or replace function public.release_rejected_hourly_invoice_batch()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
begin
  if new.operation='create' and new.hourly_batch_id is not null and new.state='rejected' and old.state is distinct from new.state then
    update public.hourly_invoice_batches set released_at=coalesce(released_at,now()) where id=new.hourly_batch_id;
  end if;
  return new;
end;
$$;
create trigger paypal_rejected_hourly_create_release after update of state on public.paypal_operation_claims
for each row execute function public.release_rejected_hourly_invoice_batch();

create or replace function public.begin_paypal_hourly_invoice_create(p_project_id uuid,p_invoice_number text,p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,auth,extensions
as $$
declare
  actor_id uuid:=p_actor_id; project_row public.projects%rowtype; contract_row public.hourly_contracts%rowtype;
  entry_ids uuid[]; entry_seconds bigint; date_start date; date_end date; batch_hash text; batch_operation_key text; attempt_no integer;
  amount_value bigint; client_email text; batch_id uuid; invoice_row public.invoices%rowtype; claim_row public.paypal_operation_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' or actor_id is null or p_invoice_number is null or char_length(p_invoice_number) not between 5 and 25 then
    raise exception 'A signed-in freelancer and valid invoice number are required.' using errcode='22023';
  end if;
  select * into project_row from public.projects where id=p_project_id and contract_type='hourly' for update;
  if not found then raise exception 'The hourly project was not found.' using errcode='P0002'; end if;
  select * into contract_row from public.hourly_contracts where project_id=p_project_id for update;
  if not found or contract_row.freelancer_id<>actor_id or contract_row.status<>'active' or not public.is_active_hourly_project(p_project_id)
    or project_row.current_agreement_version_id<>contract_row.agreement_version_id then
    raise exception 'Only the freelancer on an active hourly agreement can invoice approved time.' using errcode='42501';
  end if;
  select u.email into client_email from auth.users u where u.id=contract_row.client_id;
  if client_email is null or client_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'The hourly project client needs a valid account email before an invoice can be created.' using errcode='22023';
  end if;

  select array_agg(entry.id order by entry.id),sum(entry.duration_seconds)::bigint,min(entry.work_date),max(entry.work_date)
    into entry_ids,entry_seconds,date_start,date_end
  from public.hourly_time_entries entry
  where entry.project_id=p_project_id and entry.agreement_version_id=contract_row.agreement_version_id and entry.status='approved'
    and not exists(select 1 from public.hourly_invoice_batch_entries link_row
      join public.hourly_invoice_batches batch_row on batch_row.id=link_row.batch_id and batch_row.released_at is null
      where link_row.entry_id=entry.id);

  if coalesce(cardinality(entry_ids),0)=0 then
    select batch_row.id into batch_id from public.hourly_invoice_batches batch_row
      where batch_row.project_id=p_project_id and batch_row.released_at is null order by batch_row.created_at desc limit 1;
    if batch_id is null then raise exception 'There are no approved, uninvoiced hours for this project.' using errcode='55000'; end if;
    select * into invoice_row from public.invoices where hourly_batch_id=batch_id;
    select * into claim_row from public.paypal_operation_claims where invoice_id=invoice_row.id and operation='create' order by created_at desc limit 1;
    return jsonb_build_object('claimed',false,'invoice',to_jsonb(invoice_row),
      'claim',case when claim_row.id is null then null else jsonb_build_object('id',claim_row.id,'state',claim_row.state) end);
  end if;

  amount_value:=round(contract_row.hourly_rate_minor::numeric*entry_seconds::numeric/3600)::bigint;
  if amount_value<=0 then raise exception 'The approved hours do not yet round to one currency minor unit.' using errcode='22023'; end if;
  batch_hash:=encode(extensions.digest(array_to_string(entry_ids,','),'sha256'),'hex');
  select batch_row.id into batch_id from public.hourly_invoice_batches batch_row
    where batch_row.source_set_hash=batch_hash and batch_row.released_at is null;
  if batch_id is not null then
    select * into invoice_row from public.invoices where hourly_batch_id=batch_id;
    select * into claim_row from public.paypal_operation_claims where invoice_id=invoice_row.id and operation='create' order by created_at desc limit 1;
    return jsonb_build_object('claimed',false,'invoice',to_jsonb(invoice_row),
      'claim',case when claim_row.id is null then null else jsonb_build_object('id',claim_row.id,'state',claim_row.state) end);
  end if;
  select coalesce(max(batch_row.attempt_number),0)+1 into attempt_no from public.hourly_invoice_batches batch_row where batch_row.source_set_hash=batch_hash;
  batch_operation_key:='hourly-create:'||p_project_id::text||':'||contract_row.agreement_version_id::text||':'||batch_hash||':'||attempt_no::text;
  insert into public.hourly_invoice_batches(project_id,agreement_version_id,created_by,source_set_hash,attempt_number,operation_key,invoice_number,total_seconds,amount_minor,currency,work_date_start,work_date_end)
    values(p_project_id,contract_row.agreement_version_id,actor_id,batch_hash,attempt_no,batch_operation_key,p_invoice_number,entry_seconds,amount_value,contract_row.currency,date_start,date_end)
    returning id into batch_id;
  insert into public.hourly_invoice_batch_entries(batch_id,entry_id)
    select batch_id,selected.id from unnest(entry_ids) as selected(id);
  insert into public.invoices(project_id,milestone_id,hourly_batch_id,created_by,provider_invoice_number,status,amount_minor,currency,accepted_agreement_version_id)
    values(p_project_id,null,batch_id,actor_id,p_invoice_number,'create_pending',amount_value,contract_row.currency,contract_row.agreement_version_id)
    returning * into invoice_row;
  insert into public.paypal_operation_claims(project_id,milestone_id,hourly_batch_id,invoice_id,operation,operation_key,active_operation_key,invoice_number,state,claimed_by)
    values(p_project_id,null,batch_id,invoice_row.id,'create',batch_operation_key,batch_operation_key,p_invoice_number,'claimed',actor_id)
    returning * into claim_row;
  return jsonb_build_object('claimed',true,'invoice',to_jsonb(invoice_row),
    'claim',jsonb_build_object('id',claim_row.id,'state',claim_row.state),'clientEmail',client_email,'clientName',project_row.client_name,
    'hourlySummary',left('Approved hourly work · '||project_row.title||' · '||date_start::text||'–'||date_end::text,200));
end;
$$;

revoke all on function public.release_rejected_hourly_invoice_batch() from public,anon,authenticated;
revoke all on function public.begin_paypal_hourly_invoice_create(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.begin_paypal_hourly_invoice_create(uuid,text,uuid) to service_role;

create or replace function public.begin_paypal_invoice_send(p_invoice_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,auth
as $$
declare actor_id uuid:=p_actor_id; target_invoice public.invoices%rowtype; target_claim public.paypal_operation_claims%rowtype; operation_key text;
begin
  if auth.role() is distinct from 'service_role' or actor_id is null then raise exception 'Sign in as the project freelancer to send an invoice.' using errcode='42501'; end if;
  select i.* into target_invoice
  from public.invoices i
  join public.projects p on p.id=i.project_id
  join public.agreement_versions av on av.id=i.accepted_agreement_version_id and av.project_id=p.id
  left join public.milestones m on m.id=i.milestone_id and m.project_id=p.id
  left join public.hourly_invoice_batches batch_row on batch_row.id=i.hourly_batch_id and batch_row.project_id=p.id
  where i.id=p_invoice_id
    and exists(select 1 from public.project_members member where member.project_id=p.id and member.user_id=actor_id and member.role='freelancer')
    and p.current_agreement_version_id=av.id and av.state='accepted'
    and (select count(distinct accepted.member_role) from public.agreement_acceptances accepted where accepted.agreement_version_id=av.id)=2
    and ((i.milestone_id is not null and m.workflow_status='approved' and av.id=m.agreement_version_id)
      or (i.hourly_batch_id is not null and batch_row.released_at is null and batch_row.agreement_version_id=av.id
        and exists(select 1 from public.hourly_invoice_batch_entries link_row where link_row.batch_id=batch_row.id)))
  for update of i;
  if target_invoice.id is null then raise exception 'The invoice is not available to this freelancer or its approved work is no longer eligible.' using errcode='42501'; end if;
  if target_invoice.status<>'draft' then
    select * into target_claim from public.paypal_operation_claims where invoice_id=target_invoice.id and operation='send' order by created_at desc limit 1;
    return jsonb_build_object('claimed',false,'invoice',to_jsonb(target_invoice),
      'claim',case when target_claim.id is null then null else jsonb_build_object('id',target_claim.id,'state',target_claim.state) end);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_invoice_id::text,1));
  operation_key:='send:'||p_invoice_id::text;
  insert into public.paypal_operation_claims(project_id,milestone_id,hourly_batch_id,invoice_id,operation,operation_key,active_operation_key,invoice_number,state,claimed_by)
    values(target_invoice.project_id,target_invoice.milestone_id,target_invoice.hourly_batch_id,target_invoice.id,'send',operation_key,
      operation_key,target_invoice.provider_invoice_number,'claimed',actor_id) returning * into target_claim;
  update public.invoices set status='send_pending',updated_at=now() where id=target_invoice.id returning * into target_invoice;
  return jsonb_build_object('claimed',true,'invoice',to_jsonb(target_invoice),'claim',jsonb_build_object('id',target_claim.id,'state',target_claim.state));
end;
$$;

revoke all on function public.begin_paypal_invoice_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_paypal_invoice_send(uuid,uuid) to service_role;

commit;
