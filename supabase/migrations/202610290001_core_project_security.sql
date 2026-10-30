begin;

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  current_agreement_version_id uuid,
  title text not null check (char_length(title) between 1 and 160),
  description text not null check (char_length(description) between 1 and 5000),
  client_name text not null check (char_length(client_name) between 1 and 160),
  budget_minor bigint not null check (budget_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  deadline date,
  status text not null default 'draft' check (status in ('draft', 'awaiting_client_agreement', 'agreed', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index projects_creator_idempotency_idx on public.projects (created_by, idempotency_key);

create table public.project_members (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('freelancer', 'client')),
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.agreement_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  state text not null default 'draft' check (state in ('draft', 'awaiting_acceptance', 'accepted')),
  title text not null check (char_length(title) between 1 and 160),
  scope_text text not null check (char_length(scope_text) between 1 and 12000),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  total_minor bigint not null check (total_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  unique (project_id, id),
  unique (project_id, version_number)
);

alter table public.projects
  add constraint projects_current_agreement_version_fk
  foreign key (current_agreement_version_id) references public.agreement_versions (id) on delete set null;

create table public.agreement_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  agreement_version_id uuid not null references public.agreement_versions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  member_role text not null check (member_role in ('freelancer', 'client')),
  accepted_at timestamptz not null default now(),
  unique (agreement_version_id, user_id),
  unique (agreement_version_id, member_role)
);

create table public.milestones (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  agreement_version_id uuid not null,
  sequence integer not null check (sequence between 1 and 100),
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 2000),
  deliverables jsonb not null check (jsonb_typeof(deliverables) = 'array' and jsonb_array_length(deliverables) between 1 and 20),
  acceptance_criteria jsonb not null check (jsonb_typeof(acceptance_criteria) = 'array' and jsonb_array_length(acceptance_criteria) between 1 and 20),
  completion_conditions jsonb not null default '["Confirm completion against the agreed acceptance criteria."]'::jsonb check (jsonb_typeof(completion_conditions) = 'array' and jsonb_array_length(completion_conditions) between 1 and 20),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  due_date date,
  dependency_sequences integer[] not null default '{}',
  workflow_status text not null default 'draft' check (workflow_status in ('draft', 'awaiting_client_agreement', 'agreed', 'in_progress', 'submitted_for_review', 'revision_requested', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, agreement_version_id) references public.agreement_versions (project_id, id) on delete cascade,
  unique (agreement_version_id, sequence)
);

create table public.deliverables (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  description text not null check (char_length(description) between 1 and 2000),
  evidence_url text check (evidence_url is null or (char_length(evidence_url) <= 2048 and evidence_url ~ '^https://')),
  storage_object_path text check (storage_object_path is null or char_length(storage_object_path) <= 512),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  check ((evidence_url is not null)::integer + (storage_object_path is not null)::integer = 1)
);

create table public.milestone_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid not null references public.milestones (id) on delete cascade,
  deliverable_id uuid references public.deliverables (id) on delete set null,
  reviewed_by uuid not null references public.profiles (id) on delete restrict,
  decision text not null check (decision in ('approved', 'request_revision')),
  note text not null default '' check (char_length(note) <= 4000),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  check (decision <> 'request_revision' or char_length(trim(note)) >= 3)
);

create table public.change_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  based_on_agreement_version_id uuid not null references public.agreement_versions (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  request_text text not null check (char_length(request_text) between 1 and 6000),
  status text not null default 'pending_analysis' check (status in ('pending_analysis', 'analyzed', 'proposal_ready', 'resolved', 'withdrawn')),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  foreign key (project_id, based_on_agreement_version_id) references public.agreement_versions (project_id, id)
);

create table public.change_order_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  change_request_id uuid not null references public.change_requests (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 160),
  description text not null check (char_length(description) between 1 and 8000),
  amount_delta_minor bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  schedule_delta_days integer not null default 0 check (schedule_delta_days between -365 and 365),
  idempotency_key uuid not null unique,
  state text not null default 'draft' check (state in ('draft', 'awaiting_approval', 'accepted', 'rejected')),
  terms jsonb not null default '{}'::jsonb check (jsonb_typeof(terms) = 'object'),
  created_at timestamptz not null default now(),
  unique (change_request_id, version_number),
  unique (project_id, id),
  foreign key (project_id, change_request_id) references public.change_requests (project_id, id) on delete cascade
);

create table public.change_order_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  change_order_version_id uuid not null references public.change_order_versions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  member_role text not null check (member_role in ('freelancer', 'client')),
  accepted_at timestamptz not null default now(),
  unique (change_order_version_id, user_id),
  unique (change_order_version_id, member_role)
);

create table public.invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid not null unique references public.milestones (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  provider text not null default 'paypal' check (provider = 'paypal'),
  provider_invoice_id text unique,
  provider_invoice_number text not null,
  status text not null default 'not_created' check (status in ('not_created', 'create_pending', 'draft', 'send_pending', 'sent', 'paid', 'cancelled', 'unknown')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  invoice_url text check (invoice_url is null or (char_length(invoice_url) <= 2048 and invoice_url ~ '^https://')),
  due_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.paypal_webhook_events (
  id uuid primary key default extensions.gen_random_uuid(),
  provider_event_id text not null unique,
  event_type text not null,
  resource_id text,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create table public.activity_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 120),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create table public.ai_analysis_records (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  change_request_id uuid references public.change_requests (id) on delete set null,
  agreement_version_id uuid references public.agreement_versions (id) on delete set null,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  provider text not null,
  model text,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

create index projects_created_by_idx on public.projects (created_by, created_at desc);
create index project_members_user_idx on public.project_members (user_id, project_id);
create index agreement_versions_project_state_idx on public.agreement_versions (project_id, state, version_number desc);
create index milestones_project_status_idx on public.milestones (project_id, workflow_status, sequence);
create index milestones_agreement_idx on public.milestones (agreement_version_id, sequence);
create index deliverables_milestone_time_idx on public.deliverables (milestone_id, created_at desc);
create index milestone_reviews_milestone_time_idx on public.milestone_reviews (milestone_id, created_at desc);
create index change_requests_project_time_idx on public.change_requests (project_id, created_at desc);
create index change_order_versions_project_idx on public.change_order_versions (project_id, created_at desc);
create index invoices_project_status_idx on public.invoices (project_id, status, created_at desc);
create index paypal_webhook_events_unprocessed_idx on public.paypal_webhook_events (received_at) where processed_at is null;
create index activity_logs_project_time_idx on public.activity_logs (project_id, created_at desc);
create index ai_analysis_records_project_time_idx on public.ai_analysis_records (project_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger milestones_set_updated_at before update on public.milestones for each row execute function public.set_updated_at();
create trigger invoices_set_updated_at before update on public.invoices for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = target_project_id and pm.user_id = auth.uid()
  );
$$;

create or replace function public.has_project_role(target_project_id uuid, required_role text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.project_members pm
    where pm.project_id = target_project_id
      and pm.user_id = auth.uid()
      and pm.role = required_role
  );
$$;

create or replace function public.is_project_owner(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.projects p
    where p.id = target_project_id and p.created_by = auth.uid()
  );
$$;

create or replace function public.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select target_user_id = auth.uid() or exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = target_user_id
  );
$$;

revoke all on function public.is_project_member(uuid) from public, anon;
revoke all on function public.has_project_role(uuid, text) from public, anon;
revoke all on function public.is_project_owner(uuid) from public, anon;
revoke all on function public.can_view_profile(uuid) from public, anon, authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.has_project_role(uuid, text) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;

create or replace function public.prevent_accepted_agreement_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.state = 'accepted' then
    raise exception 'Accepted agreement versions are immutable.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_accepted_change_order_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.state = 'accepted' then
    raise exception 'Accepted change-order versions are immutable.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger change_order_version_immutable
  before update or delete on public.change_order_versions
  for each row execute function public.prevent_accepted_change_order_mutation();

create trigger agreement_version_immutable
  before update or delete on public.agreement_versions
  for each row execute function public.prevent_accepted_agreement_mutation();

create or replace function public.prevent_accepted_milestone_content_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.agreement_versions av
    where av.id = old.agreement_version_id and av.state = 'accepted'
  ) and (
    new.project_id is distinct from old.project_id or
    new.agreement_version_id is distinct from old.agreement_version_id or
    new.sequence is distinct from old.sequence or
    new.title is distinct from old.title or
    new.description is distinct from old.description or
    new.deliverables is distinct from old.deliverables or
    new.acceptance_criteria is distinct from old.acceptance_criteria or
    new.completion_conditions is distinct from old.completion_conditions or
    new.amount_minor is distinct from old.amount_minor or
    new.currency is distinct from old.currency or
    new.due_date is distinct from old.due_date or
    new.dependency_sequences is distinct from old.dependency_sequences
  ) then
    raise exception 'Milestone terms in an accepted agreement version are immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger accepted_milestone_terms_immutable
  before update on public.milestones
  for each row execute function public.prevent_accepted_milestone_content_mutation();

create or replace function public.assert_accepted_agreement_total()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  target_version_id uuid;
  expected_total bigint;
  actual_total bigint;
  version_state text;
begin
  if tg_table_name = 'agreement_versions' then
    target_version_id := new.id;
  elsif tg_op = 'DELETE' then
    target_version_id := old.agreement_version_id;
  else
    target_version_id := new.agreement_version_id;
  end if;

  select av.total_minor, av.state into expected_total, version_state
  from public.agreement_versions av where av.id = target_version_id;
  if version_state = 'accepted' then
    select coalesce(sum(m.amount_minor), 0) into actual_total
    from public.milestones m where m.agreement_version_id = target_version_id;
    if actual_total <> expected_total then
      raise exception 'Accepted milestone total % does not match agreement total %.', actual_total, expected_total using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger accepted_agreement_total_from_milestones
  after insert or update or delete on public.milestones
  deferrable initially deferred for each row execute function public.assert_accepted_agreement_total();
create constraint trigger accepted_agreement_total_from_agreement
  after insert or update on public.agreement_versions
  deferrable initially deferred for each row execute function public.assert_accepted_agreement_total();

create or replace function public.create_project_draft(p_project jsonb, p_milestones jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  new_project_id uuid;
  new_agreement_id uuid;
  expected_total bigint;
  actual_total bigint;
  milestone_count integer;
  distinct_sequences integer;
  request_hash text;
  existing_project_id uuid;
  existing_agreement_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  if p_project is null or p_milestones is null
     or jsonb_typeof(p_project) <> 'object' or jsonb_typeof(p_milestones) <> 'array' then
    raise exception 'Invalid project draft payload.' using errcode = '22023';
  end if;
  if nullif(p_project ->> 'idempotency_key', '') is null then
    raise exception 'A project idempotency key is required.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_id::text || ':' || (p_project ->> 'idempotency_key'), 0));
  request_hash := encode(extensions.digest(p_project::text || E'\n' || p_milestones::text, 'sha256'), 'hex');
  select p.id into existing_project_id from public.projects p
  where p.created_by = actor_id and p.idempotency_key = (p_project ->> 'idempotency_key')::uuid;
  if existing_project_id is not null then
    select av.id into existing_agreement_id from public.agreement_versions av
    where av.project_id = existing_project_id order by av.version_number desc limit 1;
    if not exists (
      select 1 from public.projects p where p.id = existing_project_id and p.request_hash = request_hash
    ) then
      raise exception 'Project idempotency key was already used for different details.' using errcode = '23505';
    end if;
    return jsonb_build_object('projectId', existing_project_id, 'agreementVersionId', existing_agreement_id, 'status', 'draft', 'alreadyCreated', true);
  end if;

  expected_total := (p_project ->> 'budget_minor')::bigint;
  select count(*), count(distinct (item ->> 'sequence')::integer), coalesce(sum((item ->> 'amount_minor')::bigint), 0)
  into milestone_count, distinct_sequences, actual_total
  from jsonb_array_elements(p_milestones) as items(item);
  if milestone_count < 1 or milestone_count > 20 or distinct_sequences <> milestone_count then
    raise exception 'Project draft requires 1–20 milestones with unique sequence values.' using errcode = '22023';
  end if;
  if actual_total <> expected_total then
    raise exception 'Milestone amounts must equal the project budget.' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_milestones) as items(item),
         lateral jsonb_array_elements_text(coalesce(item -> 'dependency_sequences', '[]'::jsonb)) dependency(value)
    where dependency.value::integer >= (item ->> 'sequence')::integer
       or not exists (
         select 1 from jsonb_array_elements(p_milestones) as earlier(item)
         where (earlier.item ->> 'sequence')::integer = dependency.value::integer
       )
  ) then
    raise exception 'Milestone dependencies must reference earlier milestones in this project.' using errcode = '22023';
  end if;

  insert into public.projects (created_by, idempotency_key, request_hash, title, description, client_name, budget_minor, currency, deadline)
  values (
    actor_id,
    (p_project ->> 'idempotency_key')::uuid,
    request_hash,
    trim(p_project ->> 'title'),
    trim(p_project ->> 'description'),
    trim(p_project ->> 'client_name'),
    expected_total,
    p_project ->> 'currency',
    nullif(p_project ->> 'deadline', '')::date
  ) returning id into new_project_id;

  insert into public.project_members (project_id, user_id, role, invited_by)
  values (new_project_id, actor_id, 'freelancer', actor_id);

  insert into public.agreement_versions (project_id, version_number, created_by, title, scope_text, terms, total_minor, currency)
  values (
    new_project_id,
    1,
    actor_id,
    trim(p_project ->> 'title'),
    trim(p_project ->> 'description'),
    jsonb_build_object('requirements', p_project -> 'requirements'),
    expected_total,
    p_project ->> 'currency'
  ) returning id into new_agreement_id;

  insert into public.milestones (
    project_id, agreement_version_id, sequence, title, description, deliverables,
    acceptance_criteria, completion_conditions, amount_minor, currency, due_date, dependency_sequences
  )
  select
    new_project_id,
    new_agreement_id,
    (item ->> 'sequence')::integer,
    trim(item ->> 'title'),
    trim(item ->> 'description'),
    item -> 'deliverables',
    item -> 'acceptance_criteria',
    coalesce(item -> 'completion_conditions', item -> 'acceptance_criteria'),
    (item ->> 'amount_minor')::bigint,
    p_project ->> 'currency',
    nullif(item ->> 'due_date', '')::date,
    coalesce(array(select jsonb_array_elements_text(coalesce(item -> 'dependency_sequences', '[]'::jsonb))::integer), '{}')
  from jsonb_array_elements(p_milestones) as items(item)
  order by (item ->> 'sequence')::integer;

  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
  values (new_project_id, actor_id, 'project.draft_created', 'project', new_project_id);

  return jsonb_build_object('projectId', new_project_id, 'agreementVersionId', new_agreement_id, 'status', 'draft');
end;
$$;

create or replace function public.add_project_client(p_project_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  member_id uuid;
begin
  if actor_id is null or not public.has_project_role(p_project_id, 'freelancer') or not public.is_project_owner(p_project_id) then
    raise exception 'Only the project freelancer may add a client.' using errcode = '42501';
  end if;
  if p_user_id is null or p_user_id = actor_id or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Choose an existing client account.' using errcode = '22023';
  end if;

  insert into public.project_members (project_id, user_id, role, invited_by)
  values (p_project_id, p_user_id, 'client', actor_id)
  on conflict (project_id, user_id) do nothing
  returning id into member_id;

  if member_id is null then
    select pm.id into member_id from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = p_user_id and pm.role = 'client';
    if member_id is null then
      raise exception 'That account already holds another role on this project.' using errcode = '23505';
    end if;
    return member_id;
  end if;

  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
  values (p_project_id, actor_id, 'project.client_added', 'project_member', member_id);
  update public.projects set status = 'awaiting_client_agreement' where id = p_project_id and status = 'draft';
  return member_id;
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
  actor_role text;
  accepted_count integer;
  final_state text;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  select av.project_id, av.state into target_project_id, agreement_state
  from public.agreement_versions av
  where av.id = p_agreement_version_id
  for update;
  if target_project_id is null then
    raise exception 'Agreement version was not found.' using errcode = 'P0002';
  end if;
  select pm.role into actor_role from public.project_members pm
  where pm.project_id = target_project_id and pm.user_id = actor_id;
  if actor_role is null then
    raise exception 'You are not a member of this project.' using errcode = '42501';
  end if;
  if agreement_state = 'accepted' then
    return jsonb_build_object('state', 'accepted', 'alreadyAccepted', true);
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

create or replace function public.start_milestone(p_milestone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  target_project_id uuid;
  milestone_state text;
  dependency_sequences integer[];
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  select m.project_id, m.workflow_status, m.dependency_sequences into target_project_id, milestone_state, dependency_sequences
  from public.milestones m where m.id = p_milestone_id for update;
  if target_project_id is null then
    raise exception 'Milestone was not found.' using errcode = 'P0002';
  end if;
  if not public.has_project_role(target_project_id, 'freelancer') then
    raise exception 'Only the project freelancer may start a milestone.' using errcode = '42501';
  end if;
  if milestone_state in ('in_progress', 'submitted_for_review', 'revision_requested', 'approved') then
    return jsonb_build_object('milestoneId', p_milestone_id, 'status', milestone_state, 'alreadyStarted', true);
  end if;
  if milestone_state <> 'agreed' then
    raise exception 'Only an agreed milestone can be started.' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.milestones dependency
    where dependency.project_id = target_project_id
      and dependency.sequence = any(dependency_sequences)
      and dependency.workflow_status <> 'approved'
  ) then
    raise exception 'Complete dependent milestones before starting this milestone.' using errcode = '55000';
  end if;
  update public.milestones set workflow_status = 'in_progress' where id = p_milestone_id;
  update public.projects set status = 'in_progress' where id = target_project_id and status = 'agreed';
  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
  values (target_project_id, actor_id, 'milestone.started', 'milestone', p_milestone_id);
  return jsonb_build_object('milestoneId', p_milestone_id, 'status', 'in_progress');
end;
$$;

create or replace function public.submit_milestone_deliverable(
  p_milestone_id uuid,
  p_description text,
  p_evidence_url text,
  p_storage_object_path text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  target_project_id uuid;
  milestone_state text;
  new_deliverable_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  select m.project_id, m.workflow_status into target_project_id, milestone_state
  from public.milestones m where m.id = p_milestone_id for update;
  if target_project_id is null then
    raise exception 'Milestone was not found.' using errcode = 'P0002';
  end if;
  if not public.has_project_role(target_project_id, 'freelancer') then
    raise exception 'Only the project freelancer may submit deliverables.' using errcode = '42501';
  end if;
  if p_description is null or char_length(trim(p_description)) not between 1 and 2000 then
    raise exception 'Provide a deliverable description of 1–2000 characters.' using errcode = '22023';
  end if;
  if (p_evidence_url is null) = (p_storage_object_path is null) then
    raise exception 'Provide exactly one evidence URL or storage path.' using errcode = '22023';
  end if;
  if p_evidence_url is not null and p_evidence_url !~ '^https://[^[:space:]]+' then
    raise exception 'Deliverable links must use HTTPS.' using errcode = '22023';
  end if;
  if p_storage_object_path is not null and p_storage_object_path not like target_project_id::text || '/' || p_milestone_id::text || '/%' then
    raise exception 'Storage path must be scoped to this project and milestone.' using errcode = '42501';
  end if;

  select d.id into new_deliverable_id from public.deliverables d
  where d.idempotency_key = p_idempotency_key;
  if new_deliverable_id is not null then
    if not exists (
      select 1 from public.deliverables d
      where d.id = new_deliverable_id and d.created_by = actor_id and d.milestone_id = p_milestone_id
        and d.description = trim(p_description)
        and d.evidence_url is not distinct from p_evidence_url
        and d.storage_object_path is not distinct from p_storage_object_path
    ) then
      raise exception 'Idempotency key was already used for a different submission.' using errcode = '23505';
    end if;
    return jsonb_build_object('deliverableId', new_deliverable_id, 'milestoneId', p_milestone_id, 'status', milestone_state);
  end if;
  if milestone_state not in ('agreed', 'in_progress', 'revision_requested') then
    raise exception 'This milestone is not ready for submission.' using errcode = '55000';
  end if;

  insert into public.deliverables (project_id, milestone_id, created_by, description, evidence_url, storage_object_path, idempotency_key)
  values (target_project_id, p_milestone_id, actor_id, trim(p_description), p_evidence_url, p_storage_object_path, p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into new_deliverable_id;

  if new_deliverable_id is null then
    select d.id into new_deliverable_id from public.deliverables d
    where d.idempotency_key = p_idempotency_key and d.created_by = actor_id and d.milestone_id = p_milestone_id;
    if new_deliverable_id is null then
      raise exception 'Idempotency key was already used for another submission.' using errcode = '23505';
    end if;
    if not exists (
      select 1 from public.deliverables d
      where d.id = new_deliverable_id and d.description = trim(p_description)
        and d.evidence_url is not distinct from p_evidence_url
        and d.storage_object_path is not distinct from p_storage_object_path
    ) then
      raise exception 'Idempotency key was already used for a different submission.' using errcode = '23505';
    end if;
  else
    update public.milestones set workflow_status = 'submitted_for_review', updated_at = now()
    where id = p_milestone_id;
    update public.projects set status = 'in_progress', updated_at = now()
    where id = target_project_id and status in ('agreed', 'awaiting_client_agreement');
    insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
    values (target_project_id, actor_id, 'milestone.deliverable_submitted', 'deliverable', new_deliverable_id);
  end if;

  select m.workflow_status into milestone_state from public.milestones m where m.id = p_milestone_id;
  return jsonb_build_object('deliverableId', new_deliverable_id, 'milestoneId', p_milestone_id, 'status', milestone_state);
end;
$$;

create or replace function public.review_milestone(
  p_milestone_id uuid,
  p_decision text,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  target_project_id uuid;
  milestone_state text;
  latest_deliverable_id uuid;
  review_id uuid;
  next_state text;
begin
  if actor_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;
  if p_decision is null or p_decision not in ('approved', 'request_revision') or (p_decision = 'request_revision' and char_length(trim(coalesce(p_note, ''))) < 3) then
    raise exception 'Choose a valid review decision and include a revision note when needed.' using errcode = '22023';
  end if;
  select m.project_id, m.workflow_status into target_project_id, milestone_state
  from public.milestones m where m.id = p_milestone_id for update;
  if target_project_id is null then
    raise exception 'Milestone was not found.' using errcode = 'P0002';
  end if;
  if not public.has_project_role(target_project_id, 'client') then
    raise exception 'Only a project client may review a deliverable.' using errcode = '42501';
  end if;
  next_state := case when p_decision = 'approved' then 'approved' else 'revision_requested' end;
  select r.id into review_id from public.milestone_reviews r
  where r.idempotency_key = p_idempotency_key;
  if review_id is not null then
    if not exists (
      select 1 from public.milestone_reviews r
      where r.id = review_id and r.reviewed_by = actor_id and r.milestone_id = p_milestone_id
        and r.decision = p_decision and r.note = coalesce(p_note, '')
    ) then
      raise exception 'Idempotency key was already used for a different review.' using errcode = '23505';
    end if;
    return jsonb_build_object('reviewId', review_id, 'milestoneId', p_milestone_id, 'status', milestone_state);
  end if;
  if milestone_state <> 'submitted_for_review' then
    raise exception 'Milestone is not awaiting client review.' using errcode = '55000';
  end if;
  select d.id into latest_deliverable_id from public.deliverables d
  where d.milestone_id = p_milestone_id order by d.created_at desc limit 1;
  insert into public.milestone_reviews (project_id, milestone_id, deliverable_id, reviewed_by, decision, note, idempotency_key)
  values (target_project_id, p_milestone_id, latest_deliverable_id, actor_id, p_decision, coalesce(p_note, ''), p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into review_id;

  if review_id is null then
    select r.id into review_id from public.milestone_reviews r
    where r.idempotency_key = p_idempotency_key and r.reviewed_by = actor_id and r.milestone_id = p_milestone_id;
    if review_id is null then
      raise exception 'Idempotency key was already used for another review.' using errcode = '23505';
    end if;
    if not exists (
      select 1 from public.milestone_reviews r
      where r.id = review_id and r.decision = p_decision and r.note = coalesce(p_note, '')
    ) then
      raise exception 'Idempotency key was already used for a different review.' using errcode = '23505';
    end if;
    select m.workflow_status into next_state from public.milestones m where m.id = p_milestone_id;
  else
    update public.milestones set workflow_status = next_state, updated_at = now()
    where id = p_milestone_id and workflow_status = 'submitted_for_review';
    if not found then
      raise exception 'Milestone review state changed; reload and try again.' using errcode = '40001';
    end if;
    insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id, details)
    values (target_project_id, actor_id, 'milestone.review_recorded', 'milestone_review', review_id, jsonb_build_object('decision', p_decision));
  end if;
  return jsonb_build_object('reviewId', review_id, 'milestoneId', p_milestone_id, 'status', next_state);
end;
$$;

create or replace function public.request_scope_change(p_project_id uuid, p_request_text text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  accepted_version_id uuid;
  request_id uuid;
begin
  if actor_id is null or not public.has_project_role(p_project_id, 'client') then
    raise exception 'Only a project client may request a scope change.' using errcode = '42501';
  end if;
  if p_request_text is null or char_length(trim(p_request_text)) not between 1 and 6000 then
    raise exception 'Provide a scope request of 1–6000 characters.' using errcode = '22023';
  end if;
  select p.current_agreement_version_id into accepted_version_id
  from public.projects p where p.id = p_project_id and p.current_agreement_version_id is not null;
  if accepted_version_id is null then
    raise exception 'An accepted agreement is required before requesting a scope change.' using errcode = '55000';
  end if;

  insert into public.change_requests (project_id, based_on_agreement_version_id, created_by, request_text, idempotency_key)
  values (p_project_id, accepted_version_id, actor_id, trim(p_request_text), p_idempotency_key)
  on conflict (idempotency_key) do nothing
  returning id into request_id;
  if request_id is null then
    select cr.id into request_id from public.change_requests cr
    where cr.idempotency_key = p_idempotency_key and cr.created_by = actor_id and cr.project_id = p_project_id;
    if request_id is null then
      raise exception 'Idempotency key was already used for another request.' using errcode = '23505';
    end if;
    if not exists (
      select 1 from public.change_requests cr
      where cr.id = request_id and cr.request_text = trim(p_request_text)
    ) then
      raise exception 'Idempotency key was already used for a different scope request.' using errcode = '23505';
    end if;
  else
    insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
    values (p_project_id, actor_id, 'scope.request_created', 'change_request', request_id);
  end if;
  return request_id;
end;
$$;

create or replace function public.record_scope_analysis(
  p_actor_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_agreement_version_id uuid,
  p_input_hash text,
  p_provider text,
  p_model text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := p_actor_id;
  request_state text;
  request_version_id uuid;
  current_version_id uuid;
  saved_record public.ai_analysis_records%rowtype;
  new_analysis_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Scope analysis persistence is restricted to the trusted API.' using errcode = '42501';
  end if;
  if actor_id is null or not public.is_project_member(p_project_id) then
    raise exception 'Only project members may record a scope analysis.' using errcode = '42501';
  end if;
  if p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$'
     or p_provider is distinct from 'openai'
     or p_result is null or jsonb_typeof(p_result) is distinct from 'object'
     or p_result ->> 'classification' is null
     or p_result ->> 'classification' not in ('covered', 'possibly_covered', 'outside_scope', 'clarification_required')
     or jsonb_typeof(p_result -> 'citations') is distinct from 'array'
     or jsonb_typeof(p_result -> 'affectedMilestoneSequences') is distinct from 'array'
     or jsonb_typeof(p_result #> '{proposedAmendment}') is distinct from 'object'
     or p_result #> '{proposedAmendment,amountDeltaMinor}' is distinct from 'null'::jsonb
     or p_result #> '{proposedAmendment,scheduleDeltaDays}' is distinct from 'null'::jsonb then
    raise exception 'Scope analysis result or audit metadata is invalid.' using errcode = '22023';
  end if;

  select cr.status, cr.based_on_agreement_version_id
    into request_state, request_version_id
  from public.change_requests cr
  where cr.id = p_request_id and cr.project_id = p_project_id
  for update;
  if request_version_id is null then
    raise exception 'Scope request was not found.' using errcode = 'P0002';
  end if;
  if request_version_id <> p_agreement_version_id then
    raise exception 'Scope request agreement version does not match.' using errcode = '40001';
  end if;
  select p.current_agreement_version_id into current_version_id
  from public.projects p
  where p.id = p_project_id;
  if current_version_id is distinct from p_agreement_version_id
     or not exists (
       select 1 from public.agreement_versions av
       where av.id = p_agreement_version_id and av.project_id = p_project_id and av.state = 'accepted'
     ) then
    raise exception 'Accepted agreement changed during scope analysis.' using errcode = '40001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_result -> 'citations') as citation(value)
    where jsonb_typeof(citation.value) is distinct from 'object'
      or jsonb_typeof(citation.value -> 'exactExcerpt') is distinct from 'string'
      or coalesce(citation.value ->> 'exactExcerpt', '') = ''
      or case citation.value ->> 'source'
        when 'agreement_scope' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'null'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'null'
          or not exists (
            select 1 from public.agreement_versions av
            where av.id = p_agreement_version_id and position(citation.value ->> 'exactExcerpt' in av.scope_text) > 0
          )
        when 'requirements' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'null'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'null'
          or not exists (
            select 1 from public.agreement_versions av,
              lateral jsonb_array_elements_text(coalesce(av.terms -> 'requirements', '[]'::jsonb)) as requirement(value)
            where av.id = p_agreement_version_id and position(citation.value ->> 'exactExcerpt' in requirement.value) > 0
          )
        when 'milestone' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'number'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'null'
          or coalesce(citation.value ->> 'milestoneSequence', '') !~ '^[1-9][0-9]{0,2}$'
          or not exists (
            select 1 from public.milestones m
            where m.project_id = p_project_id and m.agreement_version_id = p_agreement_version_id
              and m.sequence = case
                when coalesce(citation.value ->> 'milestoneSequence', '') ~ '^[1-9][0-9]{0,2}$'
                  then (citation.value ->> 'milestoneSequence')::integer
                else -1
              end
              and position(citation.value ->> 'exactExcerpt' in concat_ws(E'\n', m.title, m.description,
                coalesce((select string_agg(d.value, E'\n') from jsonb_array_elements_text(m.deliverables) as d(value)), ''),
                coalesce((select string_agg(a.value, E'\n') from jsonb_array_elements_text(m.acceptance_criteria) as a(value)), ''),
                coalesce((select string_agg(c.value, E'\n') from jsonb_array_elements_text(m.completion_conditions) as c(value)), ''))) > 0
          )
        when 'accepted_change_order' then
          jsonb_typeof(citation.value -> 'milestoneSequence') is distinct from 'null'
          or jsonb_typeof(citation.value -> 'changeOrderVersionId') is distinct from 'string'
          or coalesce(citation.value ->> 'changeOrderVersionId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          or not exists (
            select 1
            from public.change_order_versions cov
            join public.change_requests cr on cr.id = cov.change_request_id
            where cov.id = case
                when coalesce(citation.value ->> 'changeOrderVersionId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then (citation.value ->> 'changeOrderVersionId')::uuid
                else null::uuid
              end
              and cov.project_id = p_project_id and cov.state = 'accepted'
              and cr.based_on_agreement_version_id = p_agreement_version_id
              and position(citation.value ->> 'exactExcerpt' in concat_ws(E'\n', cov.title, cov.description,
                coalesce((select string_agg(d.value, E'\n') from jsonb_array_elements_text(cov.terms -> 'deliverables') as d(value)), ''),
                coalesce((select string_agg(q.value, E'\n') from jsonb_array_elements_text(cov.terms -> 'openQuestions') as q(value)), ''))) > 0
          )
        else true
      end
  ) then
    raise exception 'Scope analysis contains unverifiable citations.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_result -> 'affectedMilestoneSequences') as affected_item(value)
    where jsonb_typeof(affected_item.value) is distinct from 'number'
      or coalesce(affected_item.value #>> '{}', '') !~ '^[1-9][0-9]{0,2}$'
      or not exists (
        select 1 from public.milestones m
        where m.project_id = p_project_id and m.agreement_version_id = p_agreement_version_id
          and m.sequence = case
            when coalesce(affected_item.value #>> '{}', '') ~ '^[1-9][0-9]{0,2}$'
              then (affected_item.value #>> '{}')::integer
            else -1
          end
      )
  ) then
    raise exception 'Scope analysis references an unknown milestone.' using errcode = '22023';
  end if;

  select ar.* into saved_record
  from public.ai_analysis_records ar
  where ar.change_request_id = p_request_id
  order by ar.created_at desc
  limit 1;
  if request_state = 'analyzed' then
    if saved_record.id is null or saved_record.input_hash <> p_input_hash then
      raise exception 'Scope request already has an analysis for different evidence.' using errcode = '23505';
    end if;
    return jsonb_build_object('analysisId', saved_record.id, 'result', saved_record.result, 'reused', true);
  end if;
  if request_state <> 'pending_analysis' then
    raise exception 'Scope request is no longer available for analysis.' using errcode = '55000';
  end if;

  insert into public.ai_analysis_records (
    project_id, change_request_id, agreement_version_id, requested_by, provider, model, input_hash, result
  ) values (
    p_project_id, p_request_id, p_agreement_version_id, actor_id, 'openai', left(nullif(trim(p_model), ''), 160), p_input_hash, p_result
  ) returning id into new_analysis_id;
  update public.change_requests set status = 'analyzed' where id = p_request_id and status = 'pending_analysis';
  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id, details)
  values (p_project_id, actor_id, 'scope.analysis_recorded', 'ai_analysis', new_analysis_id,
    jsonb_build_object('changeRequestId', p_request_id, 'agreementVersionId', p_agreement_version_id));
  return jsonb_build_object('analysisId', new_analysis_id, 'result', p_result, 'reused', false);
end;
$$;

create or replace function public.create_change_order_draft(
  p_project_id uuid,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  request_state text;
  request_version_id uuid;
  project_total numeric;
  project_currency text;
  delta_minor bigint;
  schedule_delta integer;
  next_version integer;
  new_version_id uuid;
  saved_version public.change_order_versions%rowtype;
  amendment_terms jsonb;
begin
  if actor_id is null or not public.is_project_owner(p_project_id) or not public.has_project_role(p_project_id, 'freelancer') then
    raise exception 'Only the project freelancer may propose an amendment.' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_draft is null or jsonb_typeof(p_draft) is distinct from 'object'
     or jsonb_typeof(p_draft -> 'deliverables') is distinct from 'array'
     or jsonb_typeof(p_draft -> 'openQuestions') is distinct from 'array'
     or coalesce(p_draft ->> 'title', '') !~ '^.{1,160}$'
     or coalesce(p_draft ->> 'description', '') !~ '^.{1,8000}$'
     or coalesce(p_draft ->> 'amountDeltaMinor', '') !~ '^-?[0-9]{1,16}$'
     or coalesce(p_draft ->> 'scheduleDeltaDays', '') !~ '^-?[0-9]{1,3}$'
     or coalesce(p_draft ->> 'analysisId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Amendment draft fields are invalid.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_draft -> 'deliverables') > 20 or jsonb_array_length(p_draft -> 'openQuestions') > 20
     or exists (
       select 1 from jsonb_array_elements(p_draft -> 'deliverables') as item(value)
       where jsonb_typeof(item.value) is distinct from 'string' or char_length(trim(item.value #>> '{}')) not between 1 and 500
     )
     or exists (
       select 1 from jsonb_array_elements(p_draft -> 'openQuestions') as item(value)
       where jsonb_typeof(item.value) is distinct from 'string' or char_length(trim(item.value #>> '{}')) not between 1 and 500
     ) then
    raise exception 'Amendment deliverables and open questions must be non-empty text.' using errcode = '22023';
  end if;
  delta_minor := (p_draft ->> 'amountDeltaMinor')::bigint;
  schedule_delta := (p_draft ->> 'scheduleDeltaDays')::integer;
  if abs(delta_minor::numeric) > 9007199254740991 or schedule_delta not between -365 and 365 then
    raise exception 'Amendment amount or schedule is outside the supported range.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));
  select cov.* into saved_version
  from public.change_order_versions cov where cov.idempotency_key = p_idempotency_key;
  if saved_version.id is not null then
    amendment_terms := jsonb_build_object(
      'deliverables', p_draft -> 'deliverables',
      'openQuestions', p_draft -> 'openQuestions',
      'analysisId', p_draft -> 'analysisId'
    );
    if saved_version.project_id <> p_project_id or saved_version.change_request_id <> p_request_id
       or saved_version.created_by <> actor_id
       or saved_version.title <> trim(p_draft ->> 'title')
       or saved_version.description <> trim(p_draft ->> 'description')
       or saved_version.amount_delta_minor <> delta_minor
       or saved_version.schedule_delta_days <> schedule_delta
       or saved_version.terms <> amendment_terms then
      raise exception 'Idempotency key was already used for a different amendment.' using errcode = '23505';
    end if;
    return jsonb_build_object('changeOrderVersionId', saved_version.id, 'state', saved_version.state, 'reused', true);
  end if;

  select cr.status, cr.based_on_agreement_version_id
    into request_state, request_version_id
  from public.change_requests cr
  where cr.id = p_request_id and cr.project_id = p_project_id
  for update;
  if request_version_id is null then
    raise exception 'Scope request was not found.' using errcode = 'P0002';
  end if;
  if request_state not in ('analyzed', 'proposal_ready') then
    raise exception 'Analyze the scope request before proposing an amendment.' using errcode = '55000';
  end if;
  if exists (select 1 from public.change_order_versions cov where cov.change_request_id = p_request_id and cov.state = 'awaiting_approval') then
    raise exception 'This scope request already has an amendment awaiting approval.' using errcode = '23505';
  end if;
  select av.total_minor::numeric + coalesce((
      select sum(cov.amount_delta_minor)::numeric from public.change_order_versions cov
      where cov.project_id = p_project_id and cov.state = 'accepted'
    ), 0), av.currency into project_total, project_currency
  from public.projects p
  join public.agreement_versions av on av.id = p.current_agreement_version_id
  where p.id = p_project_id and p.current_agreement_version_id = request_version_id and av.state = 'accepted';
  if project_total is null then
    raise exception 'The scope request is not based on the current accepted agreement.' using errcode = '40001';
  end if;
  if project_total + delta_minor::numeric <= 0 or project_total + delta_minor::numeric > 9223372036854775807 then
    raise exception 'The amendment would make the total agreement value non-positive.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.ai_analysis_records ar
    where ar.id = (p_draft ->> 'analysisId')::uuid and ar.change_request_id = p_request_id
      and ar.agreement_version_id = request_version_id and ar.project_id = p_project_id
  ) then
    raise exception 'Amendment must reference the saved analysis for this request.' using errcode = '22023';
  end if;

  amendment_terms := jsonb_build_object(
    'deliverables', p_draft -> 'deliverables',
    'openQuestions', p_draft -> 'openQuestions',
    'analysisId', p_draft -> 'analysisId'
  );
  select coalesce(max(cov.version_number), 0) + 1 into next_version
  from public.change_order_versions cov where cov.change_request_id = p_request_id;
  insert into public.change_order_versions (
    project_id, change_request_id, version_number, created_by, title, description,
    amount_delta_minor, currency, schedule_delta_days, idempotency_key, state, terms
  ) values (
    p_project_id, p_request_id, next_version, actor_id, trim(p_draft ->> 'title'), trim(p_draft ->> 'description'),
    delta_minor, project_currency, schedule_delta, p_idempotency_key, 'awaiting_approval', amendment_terms
  ) returning id into new_version_id;
  insert into public.change_order_acceptances (change_order_version_id, user_id, member_role)
  values (new_version_id, actor_id, 'freelancer');
  update public.change_requests set status = 'proposal_ready' where id = p_request_id;
  insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id, details)
  values (p_project_id, actor_id, 'change_order.submitted', 'change_order_version', new_version_id,
    jsonb_build_object('requestId', p_request_id, 'amountDeltaMinor', delta_minor, 'scheduleDeltaDays', schedule_delta));
  return jsonb_build_object('changeOrderVersionId', new_version_id, 'state', 'awaiting_approval', 'reused', false);
end;
$$;

create or replace function public.decide_change_order(p_change_order_version_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor_id uuid := auth.uid();
  target_project_id uuid;
  target_request_id uuid;
  target_state text;
  actor_role text;
  prior_acceptor uuid;
  role_count integer;
  acceptance_id uuid;
begin
  if actor_id is null or p_decision is null or p_decision not in ('accept', 'reject') then
    raise exception 'Choose a valid change-order decision.' using errcode = '22023';
  end if;
  select cov.project_id, cov.change_request_id, cov.state
    into target_project_id, target_request_id, target_state
  from public.change_order_versions cov
  where cov.id = p_change_order_version_id
  for update;
  if target_project_id is null then
    raise exception 'Change-order version was not found.' using errcode = 'P0002';
  end if;
  select pm.role into actor_role from public.project_members pm
  where pm.project_id = target_project_id and pm.user_id = actor_id;
  if actor_role is null then
    raise exception 'Only project members may review an amendment.' using errcode = '42501';
  end if;
  if target_state = 'accepted' and p_decision = 'accept' then
    return jsonb_build_object('changeOrderVersionId', p_change_order_version_id, 'state', 'accepted', 'reused', true);
  end if;
  if target_state = 'rejected' and p_decision = 'reject' then
    return jsonb_build_object('changeOrderVersionId', p_change_order_version_id, 'state', 'rejected', 'reused', true);
  end if;
  if target_state <> 'awaiting_approval' then
    raise exception 'This amendment is no longer awaiting a decision.' using errcode = '55000';
  end if;

  if p_decision = 'reject' then
    if actor_role <> 'client' then
      raise exception 'Only the project client may reject an amendment.' using errcode = '42501';
    end if;
    update public.change_order_versions set state = 'rejected' where id = p_change_order_version_id and state = 'awaiting_approval';
    update public.change_requests set status = 'analyzed' where id = target_request_id and status = 'proposal_ready';
    insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
    values (target_project_id, actor_id, 'change_order.rejected', 'change_order_version', p_change_order_version_id);
    return jsonb_build_object('changeOrderVersionId', p_change_order_version_id, 'state', 'rejected', 'reused', false);
  end if;

  insert into public.change_order_acceptances (change_order_version_id, user_id, member_role)
  values (p_change_order_version_id, actor_id, actor_role)
  on conflict do nothing
  returning id into acceptance_id;
  select coa.user_id into prior_acceptor from public.change_order_acceptances coa
  where coa.change_order_version_id = p_change_order_version_id and coa.member_role = actor_role;
  if prior_acceptor is distinct from actor_id then
    raise exception 'Another project member already decided for this role.' using errcode = '23505';
  end if;
  if acceptance_id is not null then
    insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
    values (target_project_id, actor_id, 'change_order.accepted_by_role', 'change_order_version', p_change_order_version_id,
      jsonb_build_object('role', actor_role));
  end if;
  select count(distinct coa.member_role) into role_count
  from public.change_order_acceptances coa
  where coa.change_order_version_id = p_change_order_version_id and coa.member_role in ('freelancer', 'client');
  if role_count = 2 then
    update public.change_order_versions set state = 'accepted' where id = p_change_order_version_id and state = 'awaiting_approval';
    update public.change_requests set status = 'resolved' where id = target_request_id and status = 'proposal_ready';
    insert into public.activity_logs (project_id, actor_id, event_type, entity_type, entity_id)
    values (target_project_id, actor_id, 'change_order.dual_accepted', 'change_order_version', p_change_order_version_id);
    target_state := 'accepted';
  end if;
  return jsonb_build_object('changeOrderVersionId', p_change_order_version_id, 'state', coalesce(target_state, 'awaiting_approval'), 'reused', acceptance_id is null);
end;
$$;

revoke all on function public.create_project_draft(jsonb, jsonb) from public, anon;
revoke all on function public.add_project_client(uuid, uuid) from public, anon;
revoke all on function public.accept_agreement_version(uuid) from public, anon;
revoke all on function public.start_milestone(uuid) from public, anon;
revoke all on function public.submit_milestone_deliverable(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.review_milestone(uuid, text, text, uuid) from public, anon;
revoke all on function public.request_scope_change(uuid, text, uuid) from public, anon;
revoke all on function public.record_scope_analysis(uuid, uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.create_change_order_draft(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.decide_change_order(uuid, text) from public, anon;
grant execute on function public.create_project_draft(jsonb, jsonb) to authenticated;
grant execute on function public.add_project_client(uuid, uuid) to authenticated;
grant execute on function public.accept_agreement_version(uuid) to authenticated;
grant execute on function public.start_milestone(uuid) to authenticated;
grant execute on function public.submit_milestone_deliverable(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.review_milestone(uuid, text, text, uuid) to authenticated;
grant execute on function public.request_scope_change(uuid, text, uuid) to authenticated;
grant execute on function public.record_scope_analysis(uuid, uuid, uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.create_change_order_draft(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.decide_change_order(uuid, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.agreement_versions enable row level security;
alter table public.agreement_acceptances enable row level security;
alter table public.milestones enable row level security;
alter table public.deliverables enable row level security;
alter table public.milestone_reviews enable row level security;
alter table public.change_requests enable row level security;
alter table public.change_order_versions enable row level security;
alter table public.change_order_acceptances enable row level security;
alter table public.invoices enable row level security;
alter table public.paypal_webhook_events enable row level security;
alter table public.activity_logs enable row level security;
alter table public.ai_analysis_records enable row level security;

create policy profiles_read_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy projects_read_member on public.projects for select to authenticated using (public.is_project_member(id));
create policy project_members_read_member on public.project_members for select to authenticated using (public.is_project_member(project_id));
create policy agreement_versions_read_member on public.agreement_versions for select to authenticated using (public.is_project_member(project_id));
create policy agreement_acceptances_read_member on public.agreement_acceptances for select to authenticated
  using (exists (select 1 from public.agreement_versions av where av.id = agreement_version_id and public.is_project_member(av.project_id)));
create policy milestones_read_member on public.milestones for select to authenticated using (public.is_project_member(project_id));
create policy deliverables_read_member on public.deliverables for select to authenticated using (public.is_project_member(project_id));
create policy milestone_reviews_read_member on public.milestone_reviews for select to authenticated using (public.is_project_member(project_id));
create policy change_requests_read_member on public.change_requests for select to authenticated using (public.is_project_member(project_id));
create policy change_order_versions_read_member on public.change_order_versions for select to authenticated using (public.is_project_member(project_id));
create policy change_order_acceptances_read_member on public.change_order_acceptances for select to authenticated
  using (exists (select 1 from public.change_order_versions cov where cov.id = change_order_version_id and public.is_project_member(cov.project_id)));
create policy invoices_read_member on public.invoices for select to authenticated using (public.is_project_member(project_id));
create policy activity_logs_read_member on public.activity_logs for select to authenticated using (public.is_project_member(project_id));
create policy ai_analysis_records_read_member on public.ai_analysis_records for select to authenticated using (public.is_project_member(project_id));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.projects, public.project_members, public.agreement_versions,
  public.agreement_acceptances, public.milestones, public.deliverables, public.milestone_reviews,
  public.change_requests, public.change_order_versions, public.change_order_acceptances,
  public.invoices, public.activity_logs, public.ai_analysis_records to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-deliverables',
  'project-deliverables',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy project_deliverables_read_member on storage.objects for select to authenticated
  using (
    bucket_id = 'project-deliverables'
    and public.is_project_member((storage.foldername(name))[1]::uuid)
  );
create policy project_deliverables_upload_freelancer on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-deliverables'
    and public.has_project_role((storage.foldername(name))[1]::uuid, 'freelancer')
    and exists (
      select 1 from public.milestones m
      where m.id = (storage.foldername(name))[2]::uuid
        and m.project_id = (storage.foldername(name))[1]::uuid
    )
  );

commit;
