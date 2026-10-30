begin;

create or replace function public.is_valid_freelancer_service_packages(p_packages jsonb)
returns boolean
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare package_data jsonb; deliverable_data jsonb; price_text text; days_text text; package_count integer; deliverable_count integer; distinct_count integer;
begin
  if jsonb_typeof(p_packages) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_packages) not between 1 and 3 then return false; end if;
  for package_data in select value from jsonb_array_elements(p_packages) as entry(value) loop
    if jsonb_typeof(package_data) is distinct from 'object'
      or package_data - array['title','description','priceMinor','deliveryDays','deliverables'] <> '{}'::jsonb
      or jsonb_typeof(package_data->'title') is distinct from 'string'
      or char_length(package_data->>'title') not between 3 and 80
      or jsonb_typeof(package_data->'description') is distinct from 'string'
      or char_length(package_data->>'description') not between 5 and 500
      or jsonb_typeof(package_data->'priceMinor') is distinct from 'string'
      or jsonb_typeof(package_data->'deliveryDays') is distinct from 'number'
      or jsonb_typeof(package_data->'deliverables') is distinct from 'array' then
      return false;
    end if;
    price_text:=package_data->>'priceMinor';
    days_text:=package_data->>'deliveryDays';
    if price_text !~ '^[1-9][0-9]{0,18}$' or days_text !~ '^[1-9][0-9]{0,2}$' then return false; end if;
    begin
      if price_text::bigint <= 0 or days_text::integer not between 1 and 365 then return false; end if;
    exception when numeric_value_out_of_range or invalid_text_representation then
      return false;
    end;
    select count(*),count(distinct lower(btrim(item.value #>> '{}')))
      into deliverable_count,distinct_count
      from jsonb_array_elements(package_data->'deliverables') as item(value);
    if deliverable_count not between 1 and 20 or deliverable_count<>distinct_count then return false; end if;
    for deliverable_data in select value from jsonb_array_elements(package_data->'deliverables') as item(value) loop
      if jsonb_typeof(deliverable_data) is distinct from 'string'
        or char_length(btrim(deliverable_data #>> '{}')) not between 1 and 300 then return false; end if;
    end loop;
  end loop;
  return true;
end;
$$;

revoke all on function public.is_valid_freelancer_service_packages(jsonb) from public,anon,authenticated;

create table public.marketplace_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  title text not null check (char_length(title) between 5 and 160),
  summary text not null check (char_length(summary) between 10 and 240),
  description text not null check (char_length(description) between 30 and 8000),
  requirements text[] not null check (cardinality(requirements) between 1 and 30),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  category text not null check (char_length(category) between 2 and 80),
  experience_level text not null check (experience_level in ('entry', 'intermediate', 'expert')),
  project_type text not null check (project_type in ('fixed', 'hourly')),
  fixed_budget_minor bigint,
  hourly_rate_min_minor bigint,
  hourly_rate_max_minor bigint,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  estimated_days integer check (estimated_days is null or estimated_days between 1 and 3650),
  status text not null default 'draft' check (status in ('draft', 'published', 'closed', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, idempotency_key),
  check (
    (project_type = 'fixed' and fixed_budget_minor > 0 and hourly_rate_min_minor is null and hourly_rate_max_minor is null)
    or
    (project_type = 'hourly' and fixed_budget_minor is null and hourly_rate_min_minor > 0 and hourly_rate_max_minor >= hourly_rate_min_minor)
  )
);

create index marketplace_jobs_browse_idx on public.marketplace_jobs (status, created_at desc);
create index marketplace_jobs_owner_status_idx on public.marketplace_jobs (created_by, status, updated_at desc);
create index marketplace_jobs_skill_idx on public.marketplace_jobs using gin (skills);
create trigger marketplace_jobs_set_updated_at before update on public.marketplace_jobs for each row execute function public.set_updated_at();

create table public.marketplace_job_favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid not null references public.marketplace_jobs (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create table public.marketplace_job_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.marketplace_jobs (id) on delete cascade,
  reported_by uuid not null references public.profiles (id) on delete restrict,
  reason text not null check (reason in ('suspicious', 'misleading', 'prohibited', 'other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  unique (job_id, reported_by)
);

create table public.marketplace_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references public.marketplace_jobs (id) on delete restrict,
  freelancer_id uuid not null references public.profiles (id) on delete restrict,
  cover_letter text not null check (char_length(cover_letter) between 30 and 5000),
  quote_minor bigint not null check (quote_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timeline_days integer not null check (timeline_days between 1 and 3650),
  portfolio_item_ids uuid[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'withdrawn', 'shortlisted', 'rejected', 'interview_invited', 'offer_sent', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, freelancer_id)
);

create index marketplace_proposals_job_status_idx on public.marketplace_proposals (job_id, status, created_at);
create index marketplace_proposals_freelancer_idx on public.marketplace_proposals (freelancer_id, updated_at desc);
create trigger marketplace_proposals_set_updated_at before update on public.marketplace_proposals for each row execute function public.set_updated_at();

create table public.marketplace_proposal_events (
  id uuid primary key default extensions.gen_random_uuid(),
  proposal_id uuid not null references public.marketplace_proposals (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  from_status text,
  to_status text not null,
  action text not null check (action in ('draft_saved', 'submitted', 'withdrawn', 'shortlisted', 'rejected', 'interview_invited', 'offer_created', 'offer_accepted', 'offer_declined')),
  created_at timestamptz not null default now()
);

create index marketplace_proposal_events_proposal_idx on public.marketplace_proposal_events (proposal_id, created_at);

create table public.marketplace_offers (
  id uuid primary key default extensions.gen_random_uuid(),
  proposal_id uuid not null references public.marketplace_proposals (id) on delete restrict,
  job_id uuid not null references public.marketplace_jobs (id) on delete restrict,
  client_id uuid not null references public.profiles (id) on delete restrict,
  freelancer_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null unique,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  terms text not null check (char_length(terms) between 20 and 5000),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  timeline_days integer not null check (timeline_days between 1 and 3650),
  status text not null default 'sent' check (status in ('sent', 'accepted', 'declined', 'withdrawn')),
  project_id uuid unique references public.projects (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index marketplace_offers_one_open_per_proposal_idx on public.marketplace_offers (proposal_id) where status in ('sent', 'accepted');
create index marketplace_offers_freelancer_status_idx on public.marketplace_offers (freelancer_id, status, created_at desc);

create table public.freelancer_services (
  id uuid primary key default extensions.gen_random_uuid(),
  freelancer_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 5 and 140),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 64),
  description text not null check (char_length(description) between 30 and 5000),
  category text not null check (char_length(category) between 2 and 80),
  starting_price_minor bigint not null check (starting_price_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  delivery_days integer not null check (delivery_days between 1 and 365),
  deliverables text[] not null check (cardinality(deliverables) between 1 and 20),
  packages jsonb not null check (public.is_valid_freelancer_service_packages(packages)),
  portfolio_item_ids uuid[] not null default '{}',
  is_public boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (freelancer_id, slug)
);

create index freelancer_services_browse_idx on public.freelancer_services (status, category, created_at desc);
create index freelancer_services_owner_idx on public.freelancer_services (freelancer_id, status, updated_at desc);
create trigger freelancer_services_set_updated_at before update on public.freelancer_services for each row execute function public.set_updated_at();

create table public.service_hiring_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  service_id uuid not null references public.freelancer_services (id) on delete restrict,
  client_id uuid not null references public.profiles (id) on delete restrict,
  freelancer_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null unique,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  request_text text not null check (char_length(request_text) between 20 and 4000),
  budget_minor bigint check (budget_minor is null or budget_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index service_hiring_requests_owner_status_idx on public.service_hiring_requests (freelancer_id, status, created_at desc);

create or replace function public.has_marketplace_admin_role()
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.profile_roles where user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.has_marketplace_role(p_user_id uuid, p_role text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select p_user_id = auth.uid() and exists (
    select 1 from public.profile_roles where user_id = auth.uid() and role = p_role
  );
$$;

create or replace function public.is_marketplace_job_owner(p_job_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.marketplace_jobs where id = p_job_id and created_by = auth.uid());
$$;

create or replace function public.can_view_marketplace_job(p_job_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.marketplace_jobs job
    where job.id = p_job_id and (
      job.status = 'published' or job.created_by = auth.uid()
      or exists (select 1 from public.marketplace_proposals proposal where proposal.job_id = job.id and proposal.freelancer_id = auth.uid())
    )
  );
$$;

create or replace function public.can_view_marketplace_proposal(p_proposal_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.marketplace_proposals proposal
    where proposal.id = p_proposal_id
      and (proposal.freelancer_id = auth.uid() or public.is_marketplace_job_owner(proposal.job_id))
  );
$$;

create or replace function public.can_view_marketplace_service_request(p_request_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.service_hiring_requests request
    where request.id = p_request_id and (request.client_id = auth.uid() or request.freelancer_id = auth.uid() or public.has_marketplace_admin_role())
  );
$$;

alter table public.marketplace_jobs enable row level security;
alter table public.marketplace_job_favorites enable row level security;
alter table public.marketplace_job_reports enable row level security;
alter table public.marketplace_proposals enable row level security;
alter table public.marketplace_proposal_events enable row level security;
alter table public.marketplace_offers enable row level security;
alter table public.freelancer_services enable row level security;
alter table public.service_hiring_requests enable row level security;

create policy marketplace_jobs_read_visible on public.marketplace_jobs for select to authenticated using (public.can_view_marketplace_job(id));
create policy marketplace_job_favorites_read_self on public.marketplace_job_favorites for select to authenticated using (user_id = auth.uid());
create policy marketplace_job_reports_read_owner_or_admin on public.marketplace_job_reports for select to authenticated using (reported_by = auth.uid() or public.has_marketplace_admin_role());
create policy marketplace_proposals_read_participant on public.marketplace_proposals for select to authenticated using (public.can_view_marketplace_proposal(id));
create policy marketplace_proposal_events_read_participant on public.marketplace_proposal_events for select to authenticated using (public.can_view_marketplace_proposal(proposal_id));
create policy marketplace_offers_read_participant on public.marketplace_offers for select to authenticated using (client_id = auth.uid() or freelancer_id = auth.uid());
create policy freelancer_services_read_owner on public.freelancer_services for select to authenticated using (freelancer_id = auth.uid());
create policy service_requests_read_participant on public.service_hiring_requests for select to authenticated using (client_id = auth.uid() or freelancer_id = auth.uid() or public.has_marketplace_admin_role());

revoke all on public.marketplace_jobs, public.marketplace_job_favorites, public.marketplace_job_reports,
  public.marketplace_proposals, public.marketplace_proposal_events, public.marketplace_offers,
  public.freelancer_services, public.service_hiring_requests from public, anon, authenticated;
grant select (user_id,job_id,created_at) on public.marketplace_job_favorites to authenticated;
grant select on public.freelancer_services to authenticated;

create or replace function public.save_marketplace_job(p_input jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare actor_id uuid := auth.uid(); job_id uuid; result_status text; key_id uuid; request_hash text; existing_hash text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.has_marketplace_role(actor_id, 'client') then raise exception 'Client role required' using errcode = '42501'; end if;
  if p_input is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid job details' using errcode = '22023'; end if;
  job_id := nullif(p_input->>'id', '')::uuid;
  if job_id is null then
    key_id:=(p_input->>'idempotency_key')::uuid;
    perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||key_id::text,0));
    request_hash:=encode(extensions.digest(p_input::text,'sha256'),'hex');
    select id,marketplace_jobs.request_hash into job_id,existing_hash from public.marketplace_jobs where created_by=actor_id and idempotency_key=key_id;
    if job_id is not null then
      if existing_hash<>request_hash then raise exception 'Job key conflicts with prior details' using errcode = '23505'; end if;
      select status into result_status from public.marketplace_jobs where id=job_id;
      return jsonb_build_object('jobId',job_id,'status',result_status,'alreadyCreated',true);
    end if;
    insert into public.marketplace_jobs (
      created_by,idempotency_key,request_hash,title,summary,description,requirements,skills,category,experience_level,project_type,
      fixed_budget_minor,hourly_rate_min_minor,hourly_rate_max_minor,currency,estimated_days
    ) values (
      actor_id,key_id,request_hash,trim(p_input->>'title'),trim(p_input->>'summary'),trim(p_input->>'description'),
      array(select jsonb_array_elements_text(p_input->'requirements')),
      array(select jsonb_array_elements_text(coalesce(p_input->'skills','[]'::jsonb))),
      trim(p_input->>'category'),p_input->>'experience_level',p_input->>'project_type',
      nullif(p_input->>'fixed_budget_minor','')::bigint,
      nullif(p_input->>'hourly_rate_min_minor','')::bigint,
      nullif(p_input->>'hourly_rate_max_minor','')::bigint,
      p_input->>'currency',nullif(p_input->>'estimated_days','')::integer
    ) returning id,status into job_id,result_status;
  else
    update public.marketplace_jobs set
      title=trim(p_input->>'title'),summary=trim(p_input->>'summary'),description=trim(p_input->>'description'),
      requirements=array(select jsonb_array_elements_text(p_input->'requirements')),
      skills=array(select jsonb_array_elements_text(coalesce(p_input->'skills','[]'::jsonb))),
      category=trim(p_input->>'category'),experience_level=p_input->>'experience_level',project_type=p_input->>'project_type',
      fixed_budget_minor=nullif(p_input->>'fixed_budget_minor','')::bigint,
      hourly_rate_min_minor=nullif(p_input->>'hourly_rate_min_minor','')::bigint,
      hourly_rate_max_minor=nullif(p_input->>'hourly_rate_max_minor','')::bigint,
      currency=p_input->>'currency',estimated_days=nullif(p_input->>'estimated_days','')::integer
    where id=job_id and created_by=actor_id and status in ('draft','published')
    returning id,status into job_id,result_status;
    if not found then raise exception 'Editable job not found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('jobId',job_id,'status',result_status);
end;
$$;

create or replace function public.set_marketplace_job_status(p_job_id uuid,p_action text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid := auth.uid(); current_status text; next_status text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select status into current_status from public.marketplace_jobs where id=p_job_id and created_by=actor_id for update;
  if not found then raise exception 'Job not found' using errcode = 'P0002'; end if;
  if p_action='publish' and current_status='draft' then next_status='published';
  elsif p_action='close' and current_status='published' then next_status='closed';
  elsif p_action='reopen' and current_status='closed' then next_status='published';
  elsif p_action='archive' and current_status in ('draft','published','closed') then next_status='archived';
  elsif p_action='delete' and current_status='draft'
    and not exists(select 1 from public.marketplace_proposals where job_id=p_job_id)
    and not exists(select 1 from public.marketplace_job_reports where job_id=p_job_id) then
    delete from public.marketplace_jobs where id=p_job_id;
    return jsonb_build_object('jobId',p_job_id,'status','deleted');
  else raise exception 'Job action is not valid for its current state' using errcode = '55000';
  end if;
  update public.marketplace_jobs set status=next_status,
    published_at=case when next_status='published' then coalesce(published_at,now()) else published_at end
  where id=p_job_id;
  return jsonb_build_object('jobId',p_job_id,'status',next_status);
end;
$$;

create or replace function public.set_marketplace_job_favorite(p_job_id uuid,p_saved boolean)
returns boolean language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.has_marketplace_role(actor_id,'freelancer') then raise exception 'Freelancer role required' using errcode = '42501'; end if;
  if p_saved then
    if not exists(select 1 from public.marketplace_jobs job where job.id=p_job_id and job.status='published') then
      raise exception 'Published job not found' using errcode = 'P0002';
    end if;
    insert into public.marketplace_job_favorites(user_id,job_id) values(actor_id,p_job_id) on conflict(user_id,job_id) do nothing;
  else
    delete from public.marketplace_job_favorites where user_id=actor_id and job_id=p_job_id;
  end if;
  return p_saved;
end;
$$;

create or replace function public.report_marketplace_job(p_job_id uuid,p_reason text,p_details text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare actor_id uuid := auth.uid(); report_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if exists(select 1 from public.marketplace_jobs where id=p_job_id and created_by=actor_id) then raise exception 'You cannot report your own job' using errcode = '42501'; end if;
  insert into public.marketplace_job_reports(job_id,reported_by,reason,details)
  select p_job_id,actor_id,p_reason,coalesce(p_details,'') where exists(select 1 from public.marketplace_jobs where id=p_job_id)
  returning id into report_id;
  if report_id is null then raise exception 'Job not found' using errcode = 'P0002'; end if;
  return report_id;
end;
$$;

create or replace function public.save_marketplace_proposal(p_job_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid(); job_row public.marketplace_jobs%rowtype;
  proposal_id uuid; current_status text; refs uuid[];
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.has_marketplace_role(actor_id,'freelancer') then raise exception 'Freelancer role required' using errcode = '42501'; end if;
  select * into job_row from public.marketplace_jobs where id=p_job_id and status='published';
  if not found or job_row.created_by=actor_id then raise exception 'Published job not found' using errcode = 'P0002'; end if;
  if p_input is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid proposal' using errcode = '22023'; end if;
  refs:=array(select jsonb_array_elements_text(coalesce(p_input->'portfolio_item_ids','[]'::jsonb))::uuid);
  if cardinality(refs)>12 or cardinality(refs)<>(select count(distinct item_id) from unnest(refs) as selected(item_id))
    or exists(select 1 from unnest(refs) selected(item_id) where not exists(select 1 from public.freelancer_portfolio_items item where item.id=selected.item_id and item.user_id=actor_id)) then
    raise exception 'Portfolio references must belong to your account' using errcode = '42501';
  end if;
  select id,status into proposal_id,current_status from public.marketplace_proposals where job_id=p_job_id and freelancer_id=actor_id for update;
  if found then
    if current_status<>'draft' then raise exception 'This job already has a non-editable proposal' using errcode = '23505'; end if;
    update public.marketplace_proposals set cover_letter=trim(p_input->>'cover_letter'),quote_minor=(p_input->>'quote_minor')::bigint,
      currency=job_row.currency,timeline_days=(p_input->>'timeline_days')::integer,portfolio_item_ids=refs
    where id=proposal_id;
  else
    insert into public.marketplace_proposals(job_id,freelancer_id,cover_letter,quote_minor,currency,timeline_days,portfolio_item_ids)
    values(p_job_id,actor_id,trim(p_input->>'cover_letter'),(p_input->>'quote_minor')::bigint,job_row.currency,(p_input->>'timeline_days')::integer,refs)
    returning id into proposal_id;
    current_status:=null;
  end if;
  insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
  values(proposal_id,actor_id,current_status,'draft','draft_saved');
  return jsonb_build_object('proposalId',proposal_id,'status','draft');
end;
$$;

create or replace function public.transition_marketplace_proposal(p_proposal_id uuid,p_action text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid:=auth.uid(); proposal public.marketplace_proposals%rowtype;
  job_owner uuid; next_status text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into proposal from public.marketplace_proposals where id=p_proposal_id for update;
  if not found then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  select created_by into job_owner from public.marketplace_jobs where id=proposal.job_id;
  if actor_id=proposal.freelancer_id and p_action='submit' and proposal.status='draft' then
    if not exists(select 1 from public.marketplace_jobs where id=proposal.job_id and status='published') then raise exception 'Job is no longer open' using errcode = '55000'; end if;
    next_status:='submitted';
  elsif actor_id=proposal.freelancer_id and p_action='withdraw' and proposal.status in ('submitted','shortlisted','interview_invited') then next_status:='withdrawn';
  elsif actor_id=job_owner and p_action='shortlist' and proposal.status in ('submitted','shortlisted') then next_status:='shortlisted';
  elsif actor_id=job_owner and p_action='reject' and proposal.status in ('submitted','shortlisted','interview_invited') then next_status:='rejected';
  elsif actor_id=job_owner and p_action='invite_interview' and proposal.status in ('submitted','shortlisted') then next_status:='interview_invited';
  else raise exception 'Proposal action is not allowed in its current state' using errcode = '55000';
  end if;
  update public.marketplace_proposals set status=next_status where id=p_proposal_id;
  insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
  values(p_proposal_id,actor_id,proposal.status,next_status,
    case p_action when 'submit' then 'submitted' when 'withdraw' then 'withdrawn'
      when 'shortlist' then 'shortlisted' when 'reject' then 'rejected'
      when 'invite_interview' then 'interview_invited' else p_action end);
  return jsonb_build_object('proposalId',p_proposal_id,'status',next_status);
end;
$$;

create or replace function public.create_marketplace_offer(p_proposal_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid:=auth.uid(); proposal public.marketplace_proposals%rowtype; job_row public.marketplace_jobs%rowtype;
  offer_id uuid; request_hash text; key_id uuid; existing_status text; existing_project uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  key_id:=(p_input->>'idempotency_key')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||key_id::text,0));
  request_hash:=encode(extensions.digest(p_proposal_id::text||E'\n'||p_input::text,'sha256'),'hex');
  select id into offer_id from public.marketplace_offers where idempotency_key=key_id;
  if offer_id is not null then
    if not exists(select 1 from public.marketplace_offers where id=offer_id and request_hash=request_hash and client_id=actor_id) then raise exception 'Offer key conflicts with prior details' using errcode = '23505'; end if;
    select status,project_id into existing_status,existing_project from public.marketplace_offers where id=offer_id;
    return jsonb_build_object('offerId',offer_id,'status',existing_status,'projectId',existing_project,'alreadyCreated',true);
  end if;
  select * into proposal from public.marketplace_proposals where id=p_proposal_id for update;
  if not found then raise exception 'Proposal not found' using errcode = 'P0002'; end if;
  select * into job_row from public.marketplace_jobs where id=proposal.job_id;
  if job_row.created_by<>actor_id or job_row.status not in ('published','closed')
    or proposal.status not in ('submitted','shortlisted','interview_invited') then raise exception 'Proposal is not eligible for an offer' using errcode = '42501'; end if;
  if (p_input->>'currency')<>job_row.currency then raise exception 'Offer currency must match the job' using errcode = '22023'; end if;
  insert into public.marketplace_offers(proposal_id,job_id,client_id,freelancer_id,idempotency_key,request_hash,terms,amount_minor,currency,timeline_days)
  values(p_proposal_id,proposal.job_id,actor_id,proposal.freelancer_id,key_id,request_hash,trim(p_input->>'terms'),(p_input->>'amount_minor')::bigint,job_row.currency,(p_input->>'timeline_days')::integer)
  returning id into offer_id;
  update public.marketplace_proposals set status='offer_sent' where id=p_proposal_id;
  insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
  values(p_proposal_id,actor_id,proposal.status,'offer_sent','offer_created');
  return jsonb_build_object('offerId',offer_id,'status','sent','projectId',null);
end;
$$;

create or replace function public.respond_marketplace_offer(p_offer_id uuid,p_decision text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid:=auth.uid(); offer public.marketplace_offers%rowtype;
  job_row public.marketplace_jobs%rowtype; client_name text; new_project_id uuid; agreement_id uuid; project_type text;
  project_description text; current_proposal_status text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into offer from public.marketplace_offers where id=p_offer_id for update;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  if offer.freelancer_id<>actor_id then raise exception 'Offer is not addressed to this account' using errcode = '42501'; end if;
  if offer.status='accepted' and p_decision='accept' then
    select marketplace_jobs.project_type into project_type from public.marketplace_jobs where marketplace_jobs.id=offer.job_id;
    return jsonb_build_object('offerId',offer.id,'status','accepted','contractType',project_type,'projectId',offer.project_id,'requiresHourlySetup',project_type='hourly');
  end if;
  if offer.status<>'sent' or p_decision not in ('accept','decline') then raise exception 'Offer cannot be changed now' using errcode = '55000'; end if;
  select * into job_row from public.marketplace_jobs where id=offer.job_id;
  if p_decision='decline' then
    update public.marketplace_offers set status='declined',responded_at=now() where id=p_offer_id;
    select status into current_proposal_status from public.marketplace_proposals where id=offer.proposal_id;
    update public.marketplace_proposals set status='declined' where id=offer.proposal_id;
    insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
    values(offer.proposal_id,actor_id,current_proposal_status,'declined','offer_declined');
    return jsonb_build_object('offerId',offer.id,'status','declined','projectId',null);
  end if;

  update public.marketplace_offers set status='accepted',responded_at=now() where id=p_offer_id;
  select status into current_proposal_status from public.marketplace_proposals where id=offer.proposal_id;
  update public.marketplace_proposals set status='accepted' where id=offer.proposal_id;
  insert into public.marketplace_proposal_events(proposal_id,actor_id,from_status,to_status,action)
  values(offer.proposal_id,actor_id,current_proposal_status,'accepted','offer_accepted');

  if job_row.project_type='hourly' then
    return jsonb_build_object('offerId',offer.id,'status','accepted','contractType','hourly','projectId',null,'requiresHourlySetup',true);
  end if;

  select coalesce(nullif(client.organization_name,''),nullif(account.display_name,''),'Client') into client_name
  from public.profiles account left join public.client_profiles client on client.user_id=account.id
  where account.id=offer.client_id;
  project_description:=left(job_row.description,5000);
  insert into public.projects(created_by,idempotency_key,request_hash,title,description,client_name,budget_minor,currency)
  values(
    offer.freelancer_id,extensions.gen_random_uuid(),
    encode(extensions.digest('marketplace-offer:'||offer.id::text,'sha256'),'hex'),
    job_row.title,project_description,coalesce(client_name,'Client'),offer.amount_minor,offer.currency
  ) returning id into new_project_id;
  insert into public.project_members(project_id,user_id,role,invited_by) values
    (new_project_id,offer.freelancer_id,'freelancer',offer.freelancer_id),
    (new_project_id,offer.client_id,'client',offer.freelancer_id);
  insert into public.agreement_versions(project_id,version_number,created_by,state,title,scope_text,terms,total_minor,currency)
  values(
    new_project_id,1,offer.freelancer_id,'draft',job_row.title,job_row.description,
    jsonb_build_object('marketplaceOfferId',offer.id,'jobId',job_row.id,'offerTerms',offer.terms,'requirements',to_jsonb(job_row.requirements),'draftNotice','This hiring draft requires review, editable milestone details, and explicit approval from both parties.'),
    offer.amount_minor,offer.currency
  ) returning id into agreement_id;
  update public.projects set current_agreement_version_id=agreement_id where id=new_project_id;
  insert into public.milestones(project_id,agreement_version_id,sequence,title,description,deliverables,acceptance_criteria,completion_conditions,amount_minor,currency)
  values(
    new_project_id,agreement_id,1,'Draft delivery plan',
    'This initial milestone is a draft derived from the accepted job offer. Refine deliverables, acceptance criteria, and allocation before sharing the agreement.',
    jsonb_build_array('Deliverables to be agreed before the contract is shared'),
    jsonb_build_array('Both parties review and approve the final written milestone criteria'),
    jsonb_build_array('The freelancer submits evidence and the client records a review'),
    offer.amount_minor,offer.currency
  );
  update public.marketplace_offers offer_row set project_id=new_project_id where offer_row.id=p_offer_id;
  insert into public.activity_logs(project_id,actor_id,event_type,entity_type,entity_id)
  values(new_project_id,actor_id,'marketplace.offer_accepted','agreement_version',agreement_id);
  return jsonb_build_object('offerId',offer.id,'status','accepted','contractType','fixed','projectId',new_project_id,'agreementVersionId',agreement_id,'projectStatus','draft');
end;
$$;

create or replace function public.save_freelancer_service(p_input jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions
as $$
declare actor_id uuid:=auth.uid(); service_id uuid; current_status text; refs uuid[];
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.has_marketplace_role(actor_id,'freelancer') then raise exception 'Freelancer role required' using errcode = '42501'; end if;
  if p_input is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid service details' using errcode = '22023'; end if;
  refs:=array(select jsonb_array_elements_text(coalesce(p_input->'portfolio_item_ids','[]'::jsonb))::uuid);
  if cardinality(refs)>12 or cardinality(refs)<>(select count(distinct item_id) from unnest(refs) as selected(item_id))
    or exists(select 1 from unnest(refs) selected(item_id) where not exists(select 1 from public.freelancer_portfolio_items item where item.id=selected.item_id and item.user_id=actor_id)) then
    raise exception 'Portfolio references must belong to your account' using errcode = '42501';
  end if;
  service_id:=nullif(p_input->>'id','')::uuid;
  if service_id is null then
    insert into public.freelancer_services(freelancer_id,title,slug,description,category,starting_price_minor,currency,delivery_days,deliverables,packages,portfolio_item_ids,is_public)
    values(actor_id,trim(p_input->>'title'),lower(trim(p_input->>'slug')),trim(p_input->>'description'),trim(p_input->>'category'),
      (p_input->>'starting_price_minor')::bigint,p_input->>'currency',(p_input->>'delivery_days')::integer,
      array(select jsonb_array_elements_text(p_input->'deliverables')),p_input->'packages',refs,coalesce((p_input->>'is_public')::boolean,false))
    returning id,status into service_id,current_status;
  else
    update public.freelancer_services set title=trim(p_input->>'title'),slug=lower(trim(p_input->>'slug')),description=trim(p_input->>'description'),
      category=trim(p_input->>'category'),starting_price_minor=(p_input->>'starting_price_minor')::bigint,currency=p_input->>'currency',
      delivery_days=(p_input->>'delivery_days')::integer,deliverables=array(select jsonb_array_elements_text(p_input->'deliverables')),
      packages=p_input->'packages',portfolio_item_ids=refs,is_public=coalesce((p_input->>'is_public')::boolean,false)
    where id=service_id and freelancer_id=actor_id and status in ('draft','published') returning status into current_status;
    if not found then raise exception 'Editable service not found' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('serviceId',service_id,'status',current_status);
end;
$$;

create or replace function public.set_freelancer_service_status(p_service_id uuid,p_action text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid:=auth.uid(); current_status text; next_status text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select status into current_status from public.freelancer_services where id=p_service_id and freelancer_id=actor_id for update;
  if not found then raise exception 'Service not found' using errcode = 'P0002'; end if;
  if p_action='publish' and current_status='draft' then
    if not exists(select 1 from public.freelancer_profiles where user_id=actor_id and is_public) then
      raise exception 'Publish a public freelancer profile before listing services' using errcode = '22023';
    end if;
    next_status='published';
  elsif p_action='unpublish' and current_status='published' then next_status='draft';
  elsif p_action='archive' and current_status in ('draft','published') then next_status='archived';
  else raise exception 'Service action is not valid for its current state' using errcode = '55000'; end if;
  update public.freelancer_services set status=next_status where id=p_service_id;
  return jsonb_build_object('serviceId',p_service_id,'status',next_status);
end;
$$;

create or replace function public.request_freelancer_service(p_service_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid:=auth.uid(); service public.freelancer_services%rowtype; request_id uuid; key_id uuid; existing_status text; request_hash text; existing_hash text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.has_marketplace_role(actor_id,'client') then raise exception 'Client role required' using errcode = '42501'; end if;
  key_id:=(p_input->>'idempotency_key')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text||':'||key_id::text,0));
  request_hash:=encode(extensions.digest(p_service_id::text||E'\n'||p_input::text,'sha256'),'hex');
  select id,status,service_hiring_requests.request_hash into request_id,existing_status,existing_hash from public.service_hiring_requests where idempotency_key=key_id and client_id=actor_id;
  if request_id is not null then
    if existing_hash<>request_hash then raise exception 'Hiring request key conflicts with prior details' using errcode = '23505'; end if;
    return jsonb_build_object('requestId',request_id,'status',existing_status,'alreadyCreated',true);
  end if;
  select * into service from public.freelancer_services where id=p_service_id and status='published' and is_public;
  if not found or service.freelancer_id=actor_id then raise exception 'Public service not found' using errcode = 'P0002'; end if;
  insert into public.service_hiring_requests(service_id,client_id,freelancer_id,idempotency_key,request_hash,request_text,budget_minor,currency)
  values(p_service_id,actor_id,service.freelancer_id,key_id,request_hash,trim(p_input->>'request_text'),nullif(p_input->>'budget_minor','')::bigint,service.currency)
  returning id into request_id;
  return jsonb_build_object('requestId',request_id,'status','submitted','alreadyCreated',false);
end;
$$;

create or replace function public.respond_service_hiring_request(p_request_id uuid,p_decision text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor_id uuid:=auth.uid(); request_row public.service_hiring_requests%rowtype; next_status text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into request_row from public.service_hiring_requests where id=p_request_id for update;
  if not found then raise exception 'Hiring request not found' using errcode = 'P0002'; end if;
  if actor_id<>request_row.freelancer_id or p_decision not in ('accept','decline') then raise exception 'Hiring request cannot be changed' using errcode = '42501'; end if;
  if request_row.status='accepted' and p_decision='accept' then return jsonb_build_object('requestId',p_request_id,'status','accepted','alreadyResponded',true); end if;
  if request_row.status='declined' and p_decision='decline' then return jsonb_build_object('requestId',p_request_id,'status','declined','alreadyResponded',true); end if;
  if request_row.status<>'submitted' then raise exception 'Hiring request cannot be changed' using errcode = '55000'; end if;
  next_status:=case when p_decision='accept' then 'accepted' else 'declined' end;
  update public.service_hiring_requests set status=next_status,responded_at=now() where id=p_request_id;
  return jsonb_build_object('requestId',p_request_id,'status',next_status);
end;
$$;

create or replace function public.accept_agreement_version(p_agreement_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  target_project_id uuid;
  agreement_state text;
  agreement_total bigint;
  agreement_terms jsonb;
  project_total bigint;
  milestone_count integer;
  milestone_total numeric;
  actor_role text;
  accepted_count integer;
  final_state text;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  select av.project_id, av.state, av.total_minor, av.terms into target_project_id, agreement_state, agreement_total, agreement_terms
  from public.agreement_versions av
  where av.id = p_agreement_version_id
  for update;
  if target_project_id is null then
    raise exception 'Agreement version was not found.' using errcode = 'P0002';
  end if;
  select p.budget_minor into project_total from public.projects p where p.id=target_project_id;
  select pm.role into actor_role from public.project_members pm
  where pm.project_id = target_project_id and pm.user_id = actor_id;
  if actor_role is null then
    raise exception 'You are not a member of this project.' using errcode = '42501';
  end if;
  if agreement_state = 'accepted' then
    return jsonb_build_object('state', 'accepted', 'alreadyAccepted', true);
  end if;
  if agreement_terms ? 'marketplaceOfferId' and agreement_terms->>'milestonePlanReviewed' is distinct from 'true' then
    raise exception 'Review and save the hiring milestone plan before either party accepts.' using errcode = '23514';
  end if;

  select count(*), coalesce(sum(m.amount_minor),0)
  into milestone_count, milestone_total
  from public.milestones m
  where m.agreement_version_id = p_agreement_version_id;
  if milestone_count not between 1 and 20 or milestone_total <> agreement_total or agreement_total<>project_total
    or exists(select 1 from public.milestones m where m.agreement_version_id=p_agreement_version_id and m.workflow_status<>'draft') then
    raise exception 'Complete a draft milestone plan whose amounts equal the agreement before either party accepts.' using errcode = '23514';
  end if;

  insert into public.agreement_acceptances (agreement_version_id, user_id, member_role)
  values (p_agreement_version_id, actor_id, actor_role)
  on conflict (agreement_version_id, user_id) do nothing;

  if not found then
    select count(distinct aa.member_role) into accepted_count
    from public.agreement_acceptances aa where aa.agreement_version_id = p_agreement_version_id;
    return jsonb_build_object('state', agreement_state, 'acceptedRoleCount', accepted_count, 'alreadyAcceptedByYou', true);
  end if;

  select count(distinct aa.member_role) into accepted_count
  from public.agreement_acceptances aa where aa.agreement_version_id = p_agreement_version_id;
  if accepted_count = 2 then
    final_state := 'accepted';
    update public.agreement_versions set state = 'accepted' where id = p_agreement_version_id;
    update public.projects
      set current_agreement_version_id = p_agreement_version_id, status = 'agreed'
      where id = target_project_id;
    update public.milestones
      set workflow_status = 'agreed'
      where agreement_version_id = p_agreement_version_id and workflow_status = 'draft';
  else
    final_state := 'awaiting_acceptance';
    update public.agreement_versions set state = 'awaiting_acceptance' where id = p_agreement_version_id;
    update public.projects set status = 'awaiting_client_agreement' where id = target_project_id;
  end if;

  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id, details)
  values (target_project_id, actor_id, 'agreement.accepted_by_member', 'agreement_version', p_agreement_version_id, jsonb_build_object('role', actor_role, 'acceptedRoles', accepted_count));

  return jsonb_build_object('state', final_state, 'acceptedRoleCount', accepted_count);
end;
$$;

create or replace function public.save_draft_project_milestones(p_project_id uuid,p_milestones jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id uuid:=auth.uid(); project_row public.projects%rowtype; agreement_row public.agreement_versions%rowtype;
  item jsonb; field_name text; list_item jsonb; dependency_item jsonb; sequence_value integer; dependency_value integer;
  milestone_index integer:=0; milestone_count integer; expected_total numeric; actual_total numeric:=0; amount_text text; due_text text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not public.has_marketplace_role(actor_id,'freelancer') then raise exception 'Freelancer role required' using errcode = '42501'; end if;
  select * into project_row from public.projects where id=p_project_id for update;
  if not found or project_row.created_by<>actor_id then raise exception 'Draft project not found' using errcode = 'P0002'; end if;
  if project_row.status<>'draft' or project_row.current_agreement_version_id is null then
    raise exception 'Milestones can only be edited before the draft agreement is shared' using errcode = '55000';
  end if;
  select * into agreement_row from public.agreement_versions
  where id=project_row.current_agreement_version_id and project_id=p_project_id for update;
  if not found or agreement_row.state<>'draft'
    or exists(select 1 from public.agreement_acceptances where agreement_version_id=agreement_row.id)
    or exists(select 1 from public.milestones where agreement_version_id=agreement_row.id and workflow_status<>'draft') then
    raise exception 'Draft agreement terms are no longer editable' using errcode = '55000';
  end if;
  if jsonb_typeof(p_milestones) is distinct from 'array' then raise exception 'Milestones must be an array' using errcode = '22023'; end if;
  milestone_count:=jsonb_array_length(p_milestones);
  if milestone_count not between 1 and 20 then raise exception 'Provide between one and twenty milestones' using errcode = '22023'; end if;

  for item in select value from jsonb_array_elements(p_milestones) as entry(value) loop
    milestone_index:=milestone_index+1;
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'sequence') is distinct from 'number'
      or coalesce(item->>'sequence','') !~ '^[1-9][0-9]{0,1}$' then
      raise exception 'Milestone sequence is invalid' using errcode = '22023';
    end if;
    sequence_value:=(item->>'sequence')::integer;
    if sequence_value<>milestone_index then raise exception 'Milestones must be ordered from one without gaps' using errcode = '22023'; end if;
    if jsonb_typeof(item->'title') is distinct from 'string' or char_length(trim(item->>'title')) not between 1 and 120
      or jsonb_typeof(item->'description') is distinct from 'string' or char_length(trim(item->>'description')) not between 2 and 2000 then
      raise exception 'Milestone title or description is invalid' using errcode = '22023';
    end if;
    amount_text:=item->>'amount_minor';
    if amount_text is null or amount_text !~ '^[1-9][0-9]{0,18}$' then
      raise exception 'Milestone amount must be positive integer minor units' using errcode = '22023';
    end if;
    if amount_text::numeric > 9223372036854775807 then
      raise exception 'Milestone amount exceeds the supported integer range' using errcode = '22023';
    end if;
    actual_total:=actual_total+amount_text::bigint;
    foreach field_name in array array['deliverables','acceptance_criteria','completion_conditions'] loop
      if jsonb_typeof(item->field_name) is distinct from 'array' then
        raise exception 'Milestone criteria and deliverables must be arrays' using errcode = '22023';
      end if;
      if jsonb_array_length(item->field_name) not between 1 and 20 then
        raise exception 'Milestone criteria and deliverables must be non-empty arrays' using errcode = '22023';
      end if;
      for list_item in select value from jsonb_array_elements(item->field_name) as entry(value) loop
        if jsonb_typeof(list_item) is distinct from 'string'
          or char_length(trim(list_item #>> '{}')) not between 1 and 500 then
          raise exception 'Milestone criteria and deliverables must contain text' using errcode = '22023';
        end if;
      end loop;
    end loop;
    if jsonb_typeof(item->'dependency_sequences') is distinct from 'array' then
      raise exception 'Milestone dependencies must be an array' using errcode = '22023';
    end if;
    if jsonb_array_length(item->'dependency_sequences')>20 then
      raise exception 'Milestone dependencies must be an array' using errcode = '22023';
    end if;
    for dependency_item in select value from jsonb_array_elements(item->'dependency_sequences') as entry(value) loop
      if jsonb_typeof(dependency_item) is distinct from 'number'
        or coalesce(dependency_item #>> '{}','') !~ '^[1-9][0-9]{0,1}$' then
        raise exception 'Milestone dependency is invalid' using errcode = '22023';
      end if;
      dependency_value:=(dependency_item #>> '{}')::integer;
      if dependency_value>=sequence_value then raise exception 'Dependencies must refer to earlier milestones' using errcode = '22023'; end if;
      if (select count(*) from jsonb_array_elements(item->'dependency_sequences') as selected(value) where selected.value=dependency_item)>1 then
        raise exception 'Duplicate milestone dependencies are not allowed' using errcode = '22023';
      end if;
    end loop;
    due_text:=item->>'due_date';
    if item ? 'due_date' and jsonb_typeof(item->'due_date') <> 'null' then
      if jsonb_typeof(item->'due_date') is distinct from 'string' or due_text !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Milestone due date must use YYYY-MM-DD format' using errcode = '22023';
      end if;
      perform due_text::date;
    end if;
  end loop;
  expected_total:=project_row.budget_minor;
  if actual_total<>expected_total then raise exception 'Milestone amounts must equal the project budget exactly' using errcode = '23514'; end if;

  delete from public.milestones where agreement_version_id=agreement_row.id;
  insert into public.milestones(
    project_id,agreement_version_id,sequence,title,description,deliverables,acceptance_criteria,completion_conditions,
    amount_minor,currency,due_date,dependency_sequences
  )
  select p_project_id,agreement_row.id,(value->>'sequence')::integer,trim(value->>'title'),trim(value->>'description'),
    value->'deliverables',value->'acceptance_criteria',value->'completion_conditions',(value->>'amount_minor')::bigint,
    project_row.currency,nullif(value->>'due_date','')::date,
    array(select jsonb_array_elements_text(value->'dependency_sequences')::integer)
  from jsonb_array_elements(p_milestones) as milestones(value);
  update public.agreement_versions
  set terms=jsonb_set(coalesce(terms,'{}'::jsonb),'{milestonePlanReviewed}','true'::jsonb,true)
  where id=agreement_row.id;
  insert into public.activity_logs(project_id,actor_id,event_type,entity_type,entity_id)
  values(p_project_id,actor_id,'marketplace.draft_milestones_saved','agreement_version',agreement_row.id);
  return jsonb_build_object('projectId',p_project_id,'agreementVersionId',agreement_row.id,'status','draft','milestoneCount',milestone_count,'totalMinor',actual_total::text);
end;
$$;

create view public.public_freelancer_services with (security_barrier = true) as
select service.id,profile.public_slug as freelancer_slug,account.display_name as freelancer_name,
  service.slug,service.title,service.description,service.category,service.starting_price_minor::text as starting_price_minor,
  service.currency,service.delivery_days,service.deliverables,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'title',package.value->>'title',
      'description',package.value->>'description',
      'priceMinor',package.value->>'priceMinor',
      'deliveryDays',package.value->'deliveryDays',
      'deliverables',package.value->'deliverables'
    ) order by package.ordinality)
    from jsonb_array_elements(service.packages) with ordinality as package(value,ordinality)
  ),'[]'::jsonb) as packages
from public.freelancer_services service
join public.freelancer_profiles profile on profile.user_id=service.freelancer_id and profile.is_public
join public.profile_roles roles on roles.user_id=service.freelancer_id and roles.role='freelancer'
join public.profiles account on account.id=service.freelancer_id
where service.status='published' and service.is_public;

create view public.marketplace_jobs_for_user with (security_barrier = true) as
select job.id,job.title,job.summary,job.description,job.requirements,job.skills,job.category,job.experience_level,
  job.project_type,job.fixed_budget_minor,job.hourly_rate_min_minor,job.hourly_rate_max_minor,job.currency,
  job.estimated_days,job.status,job.published_at,job.created_at,job.updated_at,(job.created_by=auth.uid()) as is_owner
from public.marketplace_jobs job
where job.status='published' or job.created_by=auth.uid()
  or exists(select 1 from public.marketplace_proposals proposal where proposal.job_id=job.id and proposal.freelancer_id=auth.uid());

create view public.marketplace_proposals_for_user with (security_barrier = true) as
select proposal.id,proposal.job_id,(proposal.freelancer_id=auth.uid()) as is_mine,proposal.cover_letter,
  proposal.quote_minor,proposal.currency,proposal.timeline_days,proposal.portfolio_item_ids,
  proposal.status,proposal.created_at,proposal.updated_at
from public.marketplace_proposals proposal
where proposal.freelancer_id=auth.uid() or public.is_marketplace_job_owner(proposal.job_id);

create view public.marketplace_offers_for_user with (security_barrier = true) as
select offer.id,offer.proposal_id,offer.job_id,(offer.freelancer_id=auth.uid()) as is_recipient,
  offer.terms,offer.amount_minor,offer.currency,offer.timeline_days,offer.status,offer.project_id,offer.created_at,offer.responded_at
from public.marketplace_offers offer
where offer.client_id=auth.uid() or offer.freelancer_id=auth.uid();

create view public.service_hiring_requests_for_user with (security_barrier = true) as
select request.id,request.service_id,
  case when request.client_id=auth.uid() then 'requester' else 'provider' end as participant_role,
  request.request_text,request.budget_minor,request.currency,request.status,request.created_at,request.responded_at
from public.service_hiring_requests request
where request.client_id=auth.uid() or request.freelancer_id=auth.uid() or public.has_marketplace_admin_role();

revoke all on public.public_freelancer_services from public,anon,authenticated;
grant select on public.public_freelancer_services to anon,authenticated;
revoke all on public.marketplace_jobs_for_user,public.marketplace_proposals_for_user,public.marketplace_offers_for_user,public.service_hiring_requests_for_user from public,anon,authenticated;
grant select on public.marketplace_jobs_for_user,public.marketplace_proposals_for_user,public.marketplace_offers_for_user,public.service_hiring_requests_for_user to authenticated;

revoke all on function public.has_marketplace_admin_role(),public.has_marketplace_role(uuid,text),public.is_marketplace_job_owner(uuid),
  public.can_view_marketplace_job(uuid),public.can_view_marketplace_proposal(uuid),public.can_view_marketplace_service_request(uuid) from public,anon;
grant execute on function public.has_marketplace_admin_role(),public.has_marketplace_role(uuid,text),public.is_marketplace_job_owner(uuid),
  public.can_view_marketplace_job(uuid),public.can_view_marketplace_proposal(uuid),public.can_view_marketplace_service_request(uuid) to authenticated;
revoke all on function public.save_marketplace_job(jsonb),public.set_marketplace_job_status(uuid,text),public.set_marketplace_job_favorite(uuid,boolean),
  public.report_marketplace_job(uuid,text,text),public.save_marketplace_proposal(uuid,jsonb),public.transition_marketplace_proposal(uuid,text),
  public.create_marketplace_offer(uuid,jsonb),public.respond_marketplace_offer(uuid,text),public.save_freelancer_service(jsonb),
  public.set_freelancer_service_status(uuid,text),public.request_freelancer_service(uuid,jsonb),public.respond_service_hiring_request(uuid,text),
  public.save_draft_project_milestones(uuid,jsonb) from public,anon;
grant execute on function public.save_marketplace_job(jsonb),public.set_marketplace_job_status(uuid,text),public.set_marketplace_job_favorite(uuid,boolean),
  public.report_marketplace_job(uuid,text,text),public.save_marketplace_proposal(uuid,jsonb),public.transition_marketplace_proposal(uuid,text),
  public.create_marketplace_offer(uuid,jsonb),public.respond_marketplace_offer(uuid,text),public.save_freelancer_service(jsonb),
  public.set_freelancer_service_status(uuid,text),public.request_freelancer_service(uuid,jsonb),public.respond_service_hiring_request(uuid,text),
  public.save_draft_project_milestones(uuid,jsonb) to authenticated;

comment on table public.marketplace_proposals is 'One application per freelancer and job; status transitions are recorded in the append-only marketplace_proposal_events table.';
comment on function public.respond_marketplace_offer(uuid,text) is 'Accepting a fixed-price offer creates a draft project and agreement; it does not activate the project, alter approved scope, create an invoice, or imply payment protection. Hourly conversion is deferred to Phase 11.';

commit;
