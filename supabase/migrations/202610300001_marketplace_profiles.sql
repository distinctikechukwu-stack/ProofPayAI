begin;

create table public.profile_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('freelancer', 'client', 'admin')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.freelancer_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  public_slug text not null unique check (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(public_slug) between 3 and 48),
  headline text not null default '' check (char_length(headline) <= 120),
  biography text not null default '' check (char_length(biography) <= 2400),
  skills text[] not null default '{}' check (cardinality(skills) <= 20),
  experience_summary text not null default '' check (char_length(experience_summary) <= 1800),
  education_summary text not null default '' check (char_length(education_summary) <= 1200),
  languages text[] not null default '{}' check (cardinality(languages) <= 12),
  category text not null default '' check (char_length(category) <= 80),
  hourly_rate_minor bigint check (hourly_rate_minor is null or hourly_rate_minor > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  availability text not null default 'available' check (availability in ('available', 'limited', 'unavailable')),
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.freelancer_portfolio_items (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.freelancer_profiles (user_id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  project_url text check (project_url is null or (char_length(project_url) <= 2048 and project_url ~ '^https://')),
  image_url text check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https://')),
  featured boolean not null default false,
  position integer not null default 0 check (position between 0 and 11),
  created_at timestamptz not null default now()
);

create index freelancer_portfolio_owner_position_idx on public.freelancer_portfolio_items (user_id, position, created_at);

create table public.client_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  account_type text not null default 'individual' check (account_type in ('individual', 'business')),
  organization_name text not null default '' check (char_length(organization_name) <= 160),
  organization_description text not null default '' check (char_length(organization_description) <= 1800),
  website_url text check (website_url is null or (char_length(website_url) <= 2048 and website_url ~ '^https://')),
  billing_email text check (billing_email is null or (char_length(billing_email) <= 254 and billing_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger freelancer_profiles_set_updated_at before update on public.freelancer_profiles for each row execute function public.set_updated_at();
create trigger client_profiles_set_updated_at before update on public.client_profiles for each row execute function public.set_updated_at();

alter table public.profile_roles enable row level security;
alter table public.freelancer_profiles enable row level security;
alter table public.freelancer_portfolio_items enable row level security;
alter table public.client_profiles enable row level security;

create policy profile_roles_read_self on public.profile_roles for select to authenticated using (user_id = auth.uid());
create policy freelancer_profiles_read_self on public.freelancer_profiles for select to authenticated using (user_id = auth.uid());
create policy freelancer_portfolio_read_self on public.freelancer_portfolio_items for select to authenticated using (user_id = auth.uid());
create policy client_profiles_read_self on public.client_profiles for select to authenticated using (user_id = auth.uid());

revoke all on public.profile_roles, public.freelancer_profiles, public.freelancer_portfolio_items, public.client_profiles from anon, authenticated;
grant select on public.profile_roles, public.freelancer_profiles, public.freelancer_portfolio_items, public.client_profiles to authenticated;

create or replace function public.set_my_marketplace_roles(p_roles text[])
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  selected_roles text[];
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_roles is null or cardinality(p_roles) not between 1 and 2
     or exists (select 1 from unnest(p_roles) as candidate(role) where candidate.role not in ('freelancer', 'client'))
     or cardinality(p_roles) <> (select count(distinct candidate.role) from unnest(p_roles) as candidate(role)) then
    raise exception 'Select freelancer, client, or both roles' using errcode = '22023';
  end if;

  insert into public.profile_roles (user_id, role)
  select actor_id, selected.role from unnest(p_roles) as selected(role)
  on conflict (user_id, role) do nothing;

  delete from public.profile_roles existing
  where existing.user_id = actor_id
    and existing.role in ('freelancer', 'client')
    and not (existing.role = any(p_roles));

  if not ('freelancer' = any(p_roles)) then
    update public.freelancer_profiles set is_public = false where user_id = actor_id;
  end if;

  select coalesce(array_agg(role order by role), '{}'::text[]) into selected_roles
  from public.profile_roles where user_id = actor_id;
  return selected_roles;
end;
$$;

create or replace function public.save_my_account_display(p_display_name text, p_avatar_url text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 2 and 80
     or (p_avatar_url is not null and (char_length(p_avatar_url) > 2048 or p_avatar_url !~ '^https://')) then
    raise exception 'Invalid profile details' using errcode = '22023';
  end if;
  update public.profiles set display_name = trim(p_display_name), avatar_url = p_avatar_url where id = actor_id;
  if not found then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  return true;
end;
$$;

create or replace function public.save_my_freelancer_profile(p_profile jsonb, p_portfolio jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  rate_text text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profile_roles where user_id = actor_id and role = 'freelancer') then
    raise exception 'Freelancer role required' using errcode = '42501';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) is distinct from 'object'
     or p_portfolio is null or jsonb_typeof(p_portfolio) is distinct from 'array' then
    raise exception 'Invalid freelancer profile' using errcode = '22023';
  end if;
  if jsonb_array_length(p_portfolio) > 12 then raise exception 'Portfolio limit reached' using errcode = '22023'; end if;
  rate_text := nullif(p_profile->>'hourly_rate_minor', '');
  insert into public.freelancer_profiles (
    user_id, public_slug, headline, biography, skills, experience_summary, education_summary,
    languages, category, hourly_rate_minor, currency, availability, is_public
  ) values (
    actor_id,
    lower(trim(p_profile->>'public_slug')),
    coalesce(p_profile->>'headline', ''),
    coalesce(p_profile->>'biography', ''),
    array(select jsonb_array_elements_text(coalesce(p_profile->'skills', '[]'::jsonb))),
    coalesce(p_profile->>'experience_summary', ''),
    coalesce(p_profile->>'education_summary', ''),
    array(select jsonb_array_elements_text(coalesce(p_profile->'languages', '[]'::jsonb))),
    coalesce(p_profile->>'category', ''),
    case when rate_text is null then null else rate_text::bigint end,
    coalesce(p_profile->>'currency', 'USD'),
    coalesce(p_profile->>'availability', 'available'),
    coalesce((p_profile->>'is_public')::boolean, false)
  ) on conflict (user_id) do update set
    public_slug = excluded.public_slug,
    headline = excluded.headline,
    biography = excluded.biography,
    skills = excluded.skills,
    experience_summary = excluded.experience_summary,
    education_summary = excluded.education_summary,
    languages = excluded.languages,
    category = excluded.category,
    hourly_rate_minor = excluded.hourly_rate_minor,
    currency = excluded.currency,
    availability = excluded.availability,
    is_public = excluded.is_public;

  delete from public.freelancer_portfolio_items where user_id = actor_id;
  insert into public.freelancer_portfolio_items (user_id, title, description, project_url, image_url, featured, position)
  select actor_id, item.title, coalesce(item.description, ''), item.project_url, item.image_url,
    coalesce(item.featured, false), (item.ordinality - 1)::integer
  from jsonb_array_elements(p_portfolio) with ordinality as entries(value, ordinality)
  cross join lateral jsonb_to_record(entries.value) as item(
    title text, description text, project_url text, image_url text, featured boolean
  );

  update public.profiles
  set display_name = trim(p_profile->>'display_name'), avatar_url = nullif(p_profile->>'avatar_url', '')
  where id = actor_id and char_length(trim(p_profile->>'display_name')) between 2 and 80;
  if not found then raise exception 'Invalid profile display name' using errcode = '22023'; end if;
  return true;
end;
$$;

create or replace function public.save_my_client_profile(p_profile jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.profile_roles where user_id = actor_id and role = 'client') then
    raise exception 'Client role required' using errcode = '42501';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) is distinct from 'object' then raise exception 'Invalid client profile' using errcode = '22023'; end if;
  insert into public.client_profiles (user_id, account_type, organization_name, organization_description, website_url, billing_email)
  values (
    actor_id,
    coalesce(p_profile->>'account_type', 'individual'),
    coalesce(p_profile->>'organization_name', ''),
    coalesce(p_profile->>'organization_description', ''),
    nullif(p_profile->>'website_url', ''),
    nullif(p_profile->>'billing_email', '')
  ) on conflict (user_id) do update set
    account_type = excluded.account_type,
    organization_name = excluded.organization_name,
    organization_description = excluded.organization_description,
    website_url = excluded.website_url,
    billing_email = excluded.billing_email;
  return true;
end;
$$;

create view public.public_freelancer_profiles with (security_barrier = true) as
select
  freelancer.public_slug as slug,
  account.display_name as display_name,
  account.avatar_url as avatar_url,
  freelancer.headline as headline,
  freelancer.biography as biography,
  freelancer.skills as skills,
  freelancer.experience_summary as experience_summary,
  freelancer.education_summary as education_summary,
  freelancer.languages as languages,
  freelancer.category as category,
  freelancer.hourly_rate_minor::text as hourly_rate_minor,
  freelancer.currency as currency,
  freelancer.availability as availability,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'title', work.title, 'description', work.description, 'projectUrl', work.project_url,
      'imageUrl', work.image_url, 'featured', work.featured
    ) order by work.featured desc, work.position asc)
    from public.freelancer_portfolio_items work where work.user_id = freelancer.user_id
  ), '[]'::jsonb) as portfolio
from public.freelancer_profiles freelancer
join public.profiles account on account.id = freelancer.user_id
join public.profile_roles roles on roles.user_id = freelancer.user_id and roles.role = 'freelancer'
where freelancer.is_public;

revoke all on public.public_freelancer_profiles from public, anon, authenticated;
grant select on public.public_freelancer_profiles to anon, authenticated;

revoke all on function public.set_my_marketplace_roles(text[]), public.save_my_account_display(text, text),
  public.save_my_freelancer_profile(jsonb, jsonb), public.save_my_client_profile(jsonb) from public, anon;
grant execute on function public.set_my_marketplace_roles(text[]), public.save_my_account_display(text, text),
  public.save_my_freelancer_profile(jsonb, jsonb), public.save_my_client_profile(jsonb) to authenticated;

comment on view public.public_freelancer_profiles is 'Explicit public projection; excludes email, billing preferences, roles, and account identifiers. Rows exist only for opted-in freelancer profiles.';
comment on function public.set_my_marketplace_roles(text[]) is 'Users may choose freelancer/client roles; admin grants are reserved for trusted database operators.';

commit;
