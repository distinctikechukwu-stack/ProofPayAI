begin;

create table public.project_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table public.project_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.project_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  body text not null default '' check (char_length(body) <= 5000),
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments)='array' and jsonb_array_length(attachments) <= 5),
  created_at timestamptz not null default now(),
  unique (conversation_id,sender_id,idempotency_key),
  check (char_length(trim(body)) > 0 or jsonb_array_length(attachments) > 0)
);

create table public.project_message_receipts (
  message_id uuid not null references public.project_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id,user_id)
);

create table public.user_notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  notification_type text not null check (notification_type='message_received'),
  conversation_id uuid not null references public.project_conversations(id) on delete cascade,
  message_id uuid not null references public.project_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id,message_id)
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id,blocked_id),
  check (blocker_id<>blocked_id)
);

create table public.conversation_abuse_reports (
  id uuid primary key default extensions.gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  conversation_id uuid not null references public.project_conversations(id) on delete cascade,
  message_id uuid references public.project_messages(id) on delete set null,
  reason text not null check (reason in ('harassment','spam','unsafe_attachment','other')),
  details text not null default '' check (char_length(details)<=2000),
  created_at timestamptz not null default now()
);

create index project_messages_conversation_created_idx on public.project_messages(conversation_id,created_at desc);
create index project_message_receipts_user_read_idx on public.project_message_receipts(user_id,read_at);
create index user_notifications_recipient_created_idx on public.user_notifications(user_id,created_at desc);
create index user_blocks_blocked_idx on public.user_blocks(blocked_id,blocker_id);
create index conversation_abuse_reports_created_idx on public.conversation_abuse_reports(created_at desc);

create or replace function public.can_access_project_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $$
  select exists(
    select 1 from public.project_conversations c
    where c.id=p_conversation_id and public.is_project_member(c.project_id)
  );
$$;

create or replace function public.can_send_project_message(p_conversation_id uuid,p_actor_id uuid default auth.uid())
returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $$
  select p_actor_id=auth.uid() and exists(
    select 1
    from public.project_conversations c
    join public.project_members actor on actor.project_id=c.project_id and actor.user_id=p_actor_id
    where c.id=p_conversation_id
      and not exists(select 1 from public.project_members other
        join public.user_blocks b on (b.blocker_id=p_actor_id and b.blocked_id=other.user_id)
          or (b.blocker_id=other.user_id and b.blocked_id=p_actor_id)
        where other.project_id=c.project_id and other.user_id<>p_actor_id)
  );
$$;

create or replace function public.can_access_conversation_attachment(p_path text,p_upload boolean default false)
returns boolean language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare conversation_text text; conversation_id uuid;
begin
  if p_path is null or p_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._ -]{1,180}$' then
    return false;
  end if;
  conversation_text:=split_part(p_path,'/',1);
  conversation_id:=conversation_text::uuid;
  if p_upload then return public.can_send_project_message(conversation_id,auth.uid()); end if;
  return public.can_access_project_conversation(conversation_id);
end;
$$;

create or replace function public.create_project_conversation(p_project_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions
as $$
declare actor_id uuid:=auth.uid(); conversation_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.is_project_member(p_project_id) then raise exception 'Project conversation not found' using errcode='P0002'; end if;
  insert into public.project_conversations(project_id,created_by)
  values(p_project_id,actor_id)
  on conflict(project_id) do update set project_id=excluded.project_id
  returning id into conversation_id;
  return jsonb_build_object('conversationId',conversation_id);
end;
$$;

create or replace function public.notify_project_message()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare project_id uuid; participant record;
begin
  select c.project_id into project_id from public.project_conversations c where c.id=new.conversation_id;
  update public.project_conversations set last_message_at=new.created_at where id=new.conversation_id;
  for participant in select pm.user_id from public.project_members pm
    where pm.project_id=project_id and pm.user_id<>new.sender_id
  loop
    insert into public.user_notifications(user_id,actor_id,notification_type,conversation_id,message_id)
    values(participant.user_id,new.sender_id,'message_received',new.conversation_id,new.id)
    on conflict(user_id,message_id) do nothing;
  end loop;
  return new;
end;
$$;

create trigger project_messages_notify_after_insert after insert on public.project_messages
for each row execute function public.notify_project_message();

create or replace function public.send_project_message(p_conversation_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,extensions,storage
as $$
declare
  actor_id uuid:=auth.uid(); message_body text; attachments jsonb; attachment jsonb;
  key_id uuid; input_hash text; message_id uuid; existing_hash text; attachment_path text;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform 1 from public.project_conversations where id=p_conversation_id for update;
  if not found then raise exception 'Conversation not found' using errcode='P0002'; end if;
  if not public.can_send_project_message(p_conversation_id,actor_id) then raise exception 'You cannot message in this conversation.' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or jsonb_typeof(p_input->'idempotencyKey') is distinct from 'string'
    or (p_input->>'idempotencyKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (p_input ? 'body' and jsonb_typeof(p_input->'body') is distinct from 'string')
    or p_input - array['idempotencyKey','body','attachments'] <> '{}'::jsonb then
    raise exception 'Message request is invalid' using errcode='22023';
  end if;
  key_id:=(p_input->>'idempotencyKey')::uuid;
  message_body:=trim(coalesce(p_input->>'body',''));
  attachments:=coalesce(p_input->'attachments','[]'::jsonb);
  if char_length(message_body)>5000 or jsonb_typeof(attachments) is distinct from 'array' then
    raise exception 'Message text or attachments are invalid' using errcode='22023';
  end if;
  if jsonb_array_length(attachments)>5 or (message_body='' and jsonb_array_length(attachments)=0) then
    raise exception 'Message text or attachments are invalid' using errcode='22023';
  end if;
  for attachment in select value from jsonb_array_elements(attachments) as file(value) loop
    attachment_path:=attachment->>'path';
    if jsonb_typeof(attachment) is distinct from 'object'
      or attachment - array['path','fileName'] <> '{}'::jsonb
      or jsonb_typeof(attachment->'fileName') is distinct from 'string'
      or char_length(trim(attachment->>'fileName')) not between 1 and 180
      or position('/' in (attachment->>'fileName'))>0
      or position(chr(92) in (attachment->>'fileName'))>0
      or (attachment->>'fileName') ~ '[[:cntrl:]]'
      or not public.can_access_conversation_attachment(attachment_path,true)
      or split_part(attachment_path,'/',1)<>p_conversation_id::text
      or not exists(select 1 from storage.objects object_row
        where object_row.bucket_id='conversation-attachments' and object_row.name=attachment_path and object_row.owner_id=actor_id) then
      raise exception 'One or more attachments are not accessible to this sender' using errcode='42501';
    end if;
  end loop;
  input_hash:=encode(extensions.digest(jsonb_build_object('body',message_body,'attachments',attachments)::text,'sha256'),'hex');
  select id,request_hash into message_id,existing_hash from public.project_messages
  where conversation_id=p_conversation_id and sender_id=actor_id and idempotency_key=key_id;
  if found then
    if existing_hash<>input_hash then raise exception 'Idempotency key was already used with different message content' using errcode='23505'; end if;
    return jsonb_build_object('messageId',message_id,'alreadyCreated',true);
  end if;
  insert into public.project_messages(conversation_id,sender_id,idempotency_key,request_hash,body,attachments)
  values(p_conversation_id,actor_id,key_id,input_hash,message_body,attachments)
  returning id into message_id;
  return jsonb_build_object('messageId',message_id,'alreadyCreated',false);
end;
$$;

create or replace function public.mark_project_conversation_read(p_conversation_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); inserted_count integer;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.can_access_project_conversation(p_conversation_id) then raise exception 'Conversation not found' using errcode='P0002'; end if;
  insert into public.project_message_receipts(message_id,user_id)
  select m.id,actor_id from public.project_messages m
  where m.conversation_id=p_conversation_id and m.sender_id<>actor_id
  on conflict(message_id,user_id) do update set read_at=excluded.read_at;
  get diagnostics inserted_count = row_count;
  update public.user_notifications set read_at=coalesce(read_at,now())
  where user_id=actor_id and conversation_id=p_conversation_id and read_at is null;
  return jsonb_build_object('conversationId',p_conversation_id,'readMessages',inserted_count);
end;
$$;

create or replace function public.set_project_conversation_block(p_conversation_id uuid,p_blocked boolean)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); other_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_blocked is null then raise exception 'Block action is invalid' using errcode='22023'; end if;
  perform 1 from public.project_conversations where id=p_conversation_id and public.is_project_member(project_id) for update;
  if not found then raise exception 'Conversation not found' using errcode='P0002'; end if;
  select pm.user_id into other_id from public.project_conversations c
  join public.project_members pm on pm.project_id=c.project_id and pm.user_id<>actor_id
  where c.id=p_conversation_id and public.is_project_member(c.project_id) limit 1;
  if other_id is null then raise exception 'Conversation not found' using errcode='P0002'; end if;
  if p_blocked then
    insert into public.user_blocks(blocker_id,blocked_id) values(actor_id,other_id) on conflict do nothing;
  else
    delete from public.user_blocks where blocker_id=actor_id and blocked_id=other_id;
  end if;
  return jsonb_build_object('blocked',p_blocked);
end;
$$;

create or replace function public.report_project_conversation(p_conversation_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); message_id uuid; report_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.can_access_project_conversation(p_conversation_id) then raise exception 'Conversation not found' using errcode='P0002'; end if;
  if jsonb_typeof(p_input) is distinct from 'object'
    or p_input - array['messageId','reason','details'] <> '{}'::jsonb
    or coalesce(p_input->>'reason','') not in ('harassment','spam','unsafe_attachment','other')
    or (p_input ? 'messageId' and p_input->'messageId' <> 'null'::jsonb and jsonb_typeof(p_input->'messageId') is distinct from 'string')
    or (p_input ? 'details' and jsonb_typeof(p_input->'details') is distinct from 'string')
    or char_length(coalesce(p_input->>'details',''))>2000 then
    raise exception 'Report details are invalid' using errcode='22023';
  end if;
  if nullif(p_input->>'messageId','') is not null then
    message_id:=(p_input->>'messageId')::uuid;
    if not exists(select 1 from public.project_messages m where m.id=message_id and m.conversation_id=p_conversation_id) then
      raise exception 'Reported message was not found in this conversation' using errcode='P0002';
    end if;
  end if;
  insert into public.conversation_abuse_reports(reporter_id,conversation_id,message_id,reason,details)
  values(actor_id,p_conversation_id,message_id,p_input->>'reason',trim(coalesce(p_input->>'details','')))
  returning id into report_id;
  return jsonb_build_object('reportId',report_id,'saved',true);
end;
$$;

create or replace function public.mark_user_notification_read(p_notification_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); notification_row public.user_notifications%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  update public.user_notifications set read_at=coalesce(read_at,now())
  where id=p_notification_id and user_id=actor_id returning * into notification_row;
  if not found then raise exception 'Notification not found' using errcode='P0002'; end if;
  insert into public.project_message_receipts(message_id,user_id)
  values(notification_row.message_id,actor_id) on conflict(message_id,user_id) do update set read_at=excluded.read_at;
  return jsonb_build_object('notificationId',p_notification_id,'read',true);
end;
$$;

create or replace function public.count_user_unread_notifications()
returns integer language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare actor_id uuid:=auth.uid(); unread_count integer;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select count(*)::integer into unread_count from public.user_notifications where user_id=actor_id and read_at is null;
  return unread_count;
end;
$$;

create view public.project_conversations_for_user with (security_barrier=true) as
select c.id,c.project_id,p.title as project_title,c.created_at,c.last_message_at,
  (select member.role from public.project_members member where member.project_id=c.project_id and member.user_id=auth.uid()) as participant_role,
  coalesce((select profile.display_name from public.project_members other
    join public.profiles profile on profile.id=other.user_id
    where other.project_id=c.project_id and other.user_id<>auth.uid() limit 1),'Project participant') as other_display_name,
  coalesce((select left(m.body,180) from public.project_messages m where m.conversation_id=c.id order by m.created_at desc limit 1),'') as last_message_preview,
  (select count(*)::integer from public.project_messages m
    where m.conversation_id=c.id and m.sender_id<>auth.uid()
      and not exists(select 1 from public.project_message_receipts receipt where receipt.message_id=m.id and receipt.user_id=auth.uid())) as unread_count,
  exists(select 1 from public.project_members actor join public.project_members other on other.project_id=actor.project_id and other.user_id<>actor.user_id
    join public.user_blocks block_row on block_row.blocker_id=auth.uid() and block_row.blocked_id=other.user_id
    where actor.project_id=c.project_id and actor.user_id=auth.uid()) as blocked_by_me,
  exists(select 1 from public.project_members actor join public.project_members other on other.project_id=actor.project_id and other.user_id<>actor.user_id
    join public.user_blocks block_row on block_row.blocker_id=other.user_id and block_row.blocked_id=auth.uid()
    where actor.project_id=c.project_id and actor.user_id=auth.uid()) as blocked_by_other
from public.project_conversations c
join public.projects p on p.id=c.project_id
where public.is_project_member(c.project_id);

create view public.project_messages_for_user with (security_barrier=true) as
select m.id,m.conversation_id,m.body,m.attachments,m.created_at,
  (m.sender_id=auth.uid()) as is_mine,
  coalesce(sender.display_name,'Project participant') as sender_display_name,
  exists(select 1 from public.project_message_receipts receipt where receipt.message_id=m.id and receipt.user_id<>m.sender_id) as read_by_other
from public.project_messages m
join public.project_conversations c on c.id=m.conversation_id
left join public.profiles sender on sender.id=m.sender_id
where public.is_project_member(c.project_id);

create view public.user_notifications_for_user with (security_barrier=true) as
select notification.id,notification.conversation_id,c.project_id,p.title as project_title,
  coalesce(actor.display_name,'Project participant') as actor_display_name,
  left(msg.body,180) as message_preview,notification.created_at,notification.read_at,
  (notification.read_at is null) as is_unread
from public.user_notifications notification
join public.project_conversations c on c.id=notification.conversation_id
join public.projects p on p.id=c.project_id
join public.project_messages msg on msg.id=notification.message_id
left join public.profiles actor on actor.id=notification.actor_id
where notification.user_id=auth.uid();

alter table public.project_conversations enable row level security;
alter table public.project_messages enable row level security;
alter table public.project_message_receipts enable row level security;
alter table public.user_notifications enable row level security;
alter table public.user_blocks enable row level security;
alter table public.conversation_abuse_reports enable row level security;

create policy project_conversations_read_member on public.project_conversations for select to authenticated
  using (public.is_project_member(project_id));
create policy project_messages_read_member on public.project_messages for select to authenticated
  using (public.can_access_project_conversation(conversation_id));
create policy project_message_receipts_read_member on public.project_message_receipts for select to authenticated
  using (user_id=auth.uid() or exists(select 1 from public.project_messages m where m.id=message_id and m.sender_id=auth.uid()));
create policy user_notifications_read_self on public.user_notifications for select to authenticated using (user_id=auth.uid());
create policy user_blocks_read_self on public.user_blocks for select to authenticated using (blocker_id=auth.uid());
create policy conversation_reports_read_reporter_or_admin on public.conversation_abuse_reports for select to authenticated
  using (reporter_id=auth.uid() or public.has_marketplace_admin_role());

revoke all on public.project_conversations,public.project_messages,public.project_message_receipts,
  public.user_notifications,public.user_blocks,public.conversation_abuse_reports from public,anon,authenticated;
grant select on public.project_conversations_for_user,public.project_messages_for_user,public.user_notifications_for_user to authenticated;
grant select(id,conversation_id,sender_id,body,attachments,created_at) on public.project_messages to authenticated;
grant select(reporter_id,conversation_id,message_id,reason,details,created_at) on public.conversation_abuse_reports to authenticated;

revoke all on function public.can_access_project_conversation(uuid),public.can_send_project_message(uuid,uuid),
  public.can_access_conversation_attachment(text,boolean) from public,anon;
grant execute on function public.can_access_project_conversation(uuid),public.can_send_project_message(uuid,uuid),
  public.can_access_conversation_attachment(text,boolean) to authenticated;
revoke all on function public.create_project_conversation(uuid),public.send_project_message(uuid,jsonb),
  public.mark_project_conversation_read(uuid),public.set_project_conversation_block(uuid,boolean),
  public.report_project_conversation(uuid,jsonb),public.mark_user_notification_read(uuid),public.count_user_unread_notifications() from public,anon;
grant execute on function public.create_project_conversation(uuid),public.send_project_message(uuid,jsonb),
  public.mark_project_conversation_read(uuid),public.set_project_conversation_block(uuid,boolean),
  public.report_project_conversation(uuid,jsonb),public.mark_user_notification_read(uuid),public.count_user_unread_notifications() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('conversation-attachments','conversation-attachments',false,10485760,
  array['application/pdf','image/jpeg','image/png','image/webp','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy conversation_attachments_read_participant on storage.objects for select to authenticated
  using(bucket_id='conversation-attachments' and public.can_access_conversation_attachment(name,false));
create policy conversation_attachments_upload_participant on storage.objects for insert to authenticated
  with check(bucket_id='conversation-attachments' and owner_id=auth.uid()::text and public.can_access_conversation_attachment(name,true));
create policy conversation_attachments_delete_unattached on storage.objects for delete to authenticated
  using(bucket_id='conversation-attachments' and owner_id=auth.uid()::text
    and public.can_access_conversation_attachment(name,false)
    and not exists(select 1 from public.project_messages stored_message
      where stored_message.conversation_id::text=split_part(name,'/',1)
        and stored_message.attachments @> jsonb_build_array(jsonb_build_object('path',name))));

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_messages') then
    execute 'alter publication supabase_realtime add table public.project_messages';
  end if;
end;
$$;

comment on table public.project_messages is 'Append-only participant-scoped project messages. All sends and reads use auth.uid()-derived RPCs; message delivery never changes project or payment state.';
comment on table public.user_notifications is 'Private recipient-scoped in-app message notifications; message content is projected only to authorized project participants.';

commit;
