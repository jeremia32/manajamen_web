create extension if not exists vector with schema extensions;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text unique,
  status text not null default 'processing' check (status in ('processing', 'indexed', 'failed')),
  source_id text,
  source_name text,
  source_type text,
  external_id text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.documents add column if not exists source_id text;
alter table public.documents add column if not exists source_name text;
alter table public.documents add column if not exists source_type text;
alter table public.documents add column if not exists external_id text;
alter table public.documents add column if not exists source_updated_at timestamptz;
alter table public.documents alter column storage_path drop not null;

create table if not exists public.knowledge_sources (
  id text primary key,
  name text not null,
  type text not null,
  status text not null default 'not_synced' check (status in ('connected', 'syncing', 'error', 'not_synced')),
  document_count integer not null default 0 check (document_count >= 0),
  credentials_encrypted text,
  last_sync timestamptz,
  created_at timestamptz not null default now()
);

alter table public.knowledge_sources add column if not exists credentials_encrypted text;

create table if not exists public.workspace_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  title text not null,
  detail text not null default '',
  source_id text,
  document_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists workspace_events_created_at_idx on public.workspace_events (created_at desc);
create index if not exists workspace_events_event_type_idx on public.workspace_events (event_type);

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_conversations_updated_at_idx on public.chat_conversations (updated_at desc);
create index if not exists chat_messages_conversation_id_idx on public.chat_messages (conversation_id, created_at);

create table if not exists public.microsoft_oauth_states (
  state text primary key,
  flow jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.microsoft_connections (
  id uuid primary key default gen_random_uuid(),
  microsoft_user_id text not null,
  tenant_id text,
  display_name text not null default '',
  email text not null default '',
  token_cache_encrypted text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists microsoft_connections_user_idx on public.microsoft_connections (microsoft_user_id);
create unique index if not exists microsoft_connections_user_unique_idx on public.microsoft_connections (microsoft_user_id);

create table if not exists public.google_drive_oauth_states (
  state text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.google_drive_connections (
  id uuid primary key default gen_random_uuid(),
  google_user_id text not null unique,
  display_name text not null default '',
  email text not null default '',
  credentials_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.microsoft_teams (
  id text not null,
  connection_id uuid not null references public.microsoft_connections(id) on delete cascade,
  display_name text not null,
  description text not null default '',
  updated_at timestamptz not null default now(),
  primary key (connection_id, id)
);

create table if not exists public.microsoft_channels (
  id text not null,
  connection_id uuid not null references public.microsoft_connections(id) on delete cascade,
  team_id text not null,
  display_name text not null,
  description text not null default '',
  membership_type text,
  updated_at timestamptz not null default now(),
  primary key (connection_id, team_id, id),
  foreign key (connection_id, team_id) references public.microsoft_teams(connection_id, id) on delete cascade
);

create table if not exists public.platform_messages (
  id bigint generated always as identity primary key,
  platform text not null check (platform in ('microsoft_teams', 'telegram')),
  external_message_id text not null,
  connection_id uuid references public.microsoft_connections(id) on delete set null,
  team_id text,
  channel_id text,
  sender_id text,
  sender_name text,
  message_text text not null default '',
  created_at timestamptz,
  raw_message jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  unique (platform, external_message_id)
);

create index if not exists platform_messages_channel_time_idx on public.platform_messages (platform, team_id, channel_id, created_at desc);

create index if not exists documents_source_id_idx on public.documents (source_id);

create table if not exists public.document_chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  embedding extensions.vector(1536),
  embedding_hf extensions.vector(1024),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

alter table public.document_chunks
  add column if not exists embedding_hf extensions.vector(1024);

create index if not exists document_chunks_embedding_idx
  on public.document_chunks using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists document_chunks_embedding_hf_idx
  on public.document_chunks using hnsw (embedding_hf extensions.vector_cosine_ops);

drop function if exists public.match_document_chunks(extensions.vector, integer, jsonb);

create or replace function public.match_document_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 5,
  filter jsonb default '{}'::jsonb,
  source_ids text[] default null
)
returns table (
  id bigint,
  document_id uuid,
  document_name text,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    chunks.id,
    chunks.document_id,
    documents.name,
    chunks.content,
    chunks.metadata,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from public.document_chunks as chunks
  join public.documents as documents on documents.id = chunks.document_id
  where chunks.embedding is not null
    and chunks.metadata @> filter
    and (source_ids is null or cardinality(source_ids) = 0 or documents.source_id = any(source_ids))
  order by chunks.embedding <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

create or replace function public.match_document_chunks_hf(
  query_embedding extensions.vector(1024),
  match_count integer default 5,
  filter jsonb default '{}'::jsonb,
  source_ids text[] default null
)
returns table (
  id bigint,
  document_id uuid,
  document_name text,
  content text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
as $$
  select
    chunks.id,
    chunks.document_id,
    documents.name,
    chunks.content,
    chunks.metadata,
    1 - (chunks.embedding_hf <=> query_embedding) as similarity
  from public.document_chunks as chunks
  join public.documents as documents on documents.id = chunks.document_id
  where chunks.embedding_hf is not null
    and chunks.metadata @> filter
    and (source_ids is null or cardinality(source_ids) = 0 or documents.source_id = any(source_ids))
  order by chunks.embedding_hf <=> query_embedding
  limit greatest(1, least(match_count, 50));
$$;

create or replace function public.update_document_chunk_embeddings(p_items jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
  updated_count integer;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  update public.document_chunks as chunks
  set embedding_hf = (batch.item ->> 'embedding')::extensions.vector(1024)
  from jsonb_array_elements(p_items) as batch(item)
  where chunks.id = (batch.item ->> 'id')::bigint;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.update_document_chunk_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.update_document_chunk_embeddings(jsonb) to service_role;

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.workspace_events enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.microsoft_oauth_states enable row level security;
alter table public.microsoft_connections enable row level security;
alter table public.google_drive_oauth_states enable row level security;
alter table public.google_drive_connections enable row level security;
alter table public.microsoft_teams enable row level security;
alter table public.microsoft_channels enable row level security;
alter table public.platform_messages enable row level security;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  profile_photo_url text,
  position text not null default '',
  department text not null default '',
  account_status text not null default 'active' check (account_status in ('active', 'suspended')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_directory_idx on public.profiles (department, position, full_name);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (user_id, email, full_name, profile_photo_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

insert into public.profiles (user_id, email, full_name, profile_photo_url)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', ''),
  coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture')
from auth.users
on conflict (user_id) do nothing;

create table if not exists public.meeting_google_oauth_states (
  state text primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_google_connection (
  singleton boolean primary key default true check (singleton),
  google_user_id text not null,
  display_name text not null default '',
  email text not null default '',
  credentials_encrypted text not null,
  connected_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  organizer_id uuid not null references public.profiles(user_id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Jakarta',
  location text not null default '',
  meeting_type text not null default 'team',
  google_calendar_event_id text unique,
  google_meet_link text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'ongoing', 'completed', 'cancelled')),
  schedule_version integer not null default 1 check (schedule_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists meetings_starts_at_idx on public.meetings (starts_at);
create index if not exists meetings_organizer_starts_at_idx on public.meetings (organizer_id, starts_at desc);
create index if not exists meetings_status_starts_at_idx on public.meetings (status, starts_at);

create table if not exists public.meeting_participants (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  invitation_status text not null default 'invited' check (invitation_status in ('invited', 'accepted', 'declined')),
  attendance_status text not null default 'pending' check (attendance_status in ('pending', 'attended', 'absent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);

create index if not exists meeting_participants_user_idx on public.meeting_participants (user_id, meeting_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  title text not null,
  message text not null default '',
  notification_type text not null,
  dedupe_key text unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

create table if not exists public.meeting_reminders (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  reminder_type text not null check (reminder_type in ('4d', '1d', '30m', 'start')),
  schedule_version integer not null,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (meeting_id, user_id, reminder_type, schedule_version)
);

create index if not exists meeting_reminders_due_idx on public.meeting_reminders (scheduled_at) where status = 'pending';

create or replace function public.create_meeting_transaction(
  p_title text,
  p_description text,
  p_organizer_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_location text,
  p_meeting_type text,
  p_google_calendar_event_id text,
  p_google_meet_link text,
  p_participant_ids uuid[]
)
returns uuid
language plpgsql
as $$
declare
  v_meeting_id uuid;
begin
  if p_starts_at <= now() or p_ends_at <= p_starts_at then
    raise exception 'Jadwal meeting tidak valid.';
  end if;

  insert into public.meetings (
    title, description, organizer_id, starts_at, ends_at, timezone,
    location, meeting_type, google_calendar_event_id, google_meet_link
  )
  values (
    trim(p_title), coalesce(p_description, ''), p_organizer_id, p_starts_at, p_ends_at,
    coalesce(nullif(p_timezone, ''), 'Asia/Jakarta'), coalesce(p_location, ''),
    coalesce(nullif(p_meeting_type, ''), 'team'), p_google_calendar_event_id, p_google_meet_link
  )
  returning id into v_meeting_id;

  insert into public.meeting_participants (meeting_id, user_id)
  select v_meeting_id, selected.user_id
  from (select distinct unnest(coalesce(p_participant_ids, '{}'::uuid[])) as user_id) as selected
  join public.profiles as profile on profile.user_id = selected.user_id
  where selected.user_id <> p_organizer_id and profile.account_status = 'active';

  insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
  select participant.user_id, v_meeting_id, 'Undangan meeting baru', trim(p_title),
         'meeting_invitation', 'invite:' || v_meeting_id::text || ':' || participant.user_id::text
  from public.meeting_participants as participant
  where participant.meeting_id = v_meeting_id;

  insert into public.meeting_reminders (meeting_id, user_id, reminder_type, schedule_version, scheduled_at)
  select v_meeting_id, attendee.user_id, reminder.reminder_type, 1, p_starts_at - reminder.offset_by
  from (
    select p_organizer_id as user_id
    union
    select participant.user_id from public.meeting_participants as participant where participant.meeting_id = v_meeting_id
  ) as attendee
  cross join (values
    ('4d'::text, interval '4 days'),
    ('1d'::text, interval '1 day'),
    ('30m'::text, interval '30 minutes'),
    ('start'::text, interval '0 minutes')
  ) as reminder(reminder_type, offset_by)
  where p_starts_at - reminder.offset_by > now();

  return v_meeting_id;
end;
$$;

create or replace function public.update_meeting_transaction(
  p_meeting_id uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_location text,
  p_meeting_type text,
  p_google_calendar_event_id text,
  p_google_meet_link text,
  p_participant_ids uuid[]
)
returns integer
language plpgsql
as $$
declare
  v_schedule_version integer;
begin
  if p_starts_at <= now() or p_ends_at <= p_starts_at then
    raise exception 'Jadwal meeting tidak valid.';
  end if;

  update public.meetings
  set title = trim(p_title),
      description = coalesce(p_description, ''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      timezone = coalesce(nullif(p_timezone, ''), 'Asia/Jakarta'),
      location = coalesce(p_location, ''),
      meeting_type = coalesce(nullif(p_meeting_type, ''), 'team'),
      google_calendar_event_id = p_google_calendar_event_id,
      google_meet_link = p_google_meet_link,
      schedule_version = schedule_version + 1,
      updated_at = now()
  where id = p_meeting_id and status = 'scheduled'
  returning schedule_version into v_schedule_version;

  if v_schedule_version is null then
    raise exception 'Meeting tidak ditemukan atau tidak dapat diubah.';
  end if;

  update public.meeting_reminders
  set status = 'cancelled'
  where meeting_id = p_meeting_id and status = 'pending';

  insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
  select existing.user_id, null, 'Undangan meeting diperbarui', 'Anda tidak lagi diundang ke ' || trim(p_title) || '.',
         'meeting_rescheduled', 'removed:' || p_meeting_id::text || ':' || v_schedule_version::text || ':' || existing.user_id::text
  from public.meeting_participants as existing
  where existing.meeting_id = p_meeting_id
    and not (existing.user_id = any(coalesce(p_participant_ids, '{}'::uuid[])));

  delete from public.meeting_participants as existing
  where existing.meeting_id = p_meeting_id
    and not (existing.user_id = any(coalesce(p_participant_ids, '{}'::uuid[])));

  with new_participants as (
    insert into public.meeting_participants (meeting_id, user_id)
    select p_meeting_id, selected.user_id
    from (select distinct unnest(coalesce(p_participant_ids, '{}'::uuid[])) as user_id) as selected
    join public.profiles as profile on profile.user_id = selected.user_id
    join public.meetings as meeting on meeting.id = p_meeting_id
    where selected.user_id <> meeting.organizer_id and profile.account_status = 'active'
    on conflict (meeting_id, user_id) do nothing
    returning user_id
  )
  insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
  select new_participants.user_id, p_meeting_id, 'Undangan meeting baru', trim(p_title),
         'meeting_invitation', 'invite:' || p_meeting_id::text || ':' || v_schedule_version::text || ':' || new_participants.user_id::text
  from new_participants;

  insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
  select participant.user_id, p_meeting_id, 'Jadwal meeting diperbarui', trim(p_title),
         'meeting_rescheduled', 'rescheduled:' || p_meeting_id::text || ':' || v_schedule_version::text || ':' || participant.user_id::text
  from public.meeting_participants as participant
  where participant.meeting_id = p_meeting_id;

  insert into public.meeting_reminders (meeting_id, user_id, reminder_type, schedule_version, scheduled_at)
  select p_meeting_id, attendee.user_id, reminder.reminder_type, v_schedule_version, p_starts_at - reminder.offset_by
  from (
    select meeting.organizer_id as user_id from public.meetings as meeting where meeting.id = p_meeting_id
    union
    select participant.user_id from public.meeting_participants as participant where participant.meeting_id = p_meeting_id
  ) as attendee
  cross join (values
    ('4d'::text, interval '4 days'),
    ('1d'::text, interval '1 day'),
    ('30m'::text, interval '30 minutes'),
    ('start'::text, interval '0 minutes')
  ) as reminder(reminder_type, offset_by)
  where (attendee.user_id not in (
      select declined.user_id from public.meeting_participants as declined
      where declined.meeting_id = p_meeting_id and declined.invitation_status = 'declined'
    ) or attendee.user_id = (select meeting.organizer_id from public.meetings as meeting where meeting.id = p_meeting_id))
    and p_starts_at - reminder.offset_by > now();

  return v_schedule_version;
end;
$$;

create or replace function public.add_meeting_participants_transaction(
  p_meeting_id uuid,
  p_participant_ids uuid[]
)
returns integer
language plpgsql
as $$
declare
  v_schedule_version integer;
  v_starts_at timestamptz;
  v_title text;
  v_added_count integer;
begin
  select schedule_version, starts_at, title
  into v_schedule_version, v_starts_at, v_title
  from public.meetings
  where id = p_meeting_id and status = 'scheduled';

  if v_schedule_version is null then
    raise exception 'Meeting tidak ditemukan atau tidak dapat ditambah pesertanya.';
  end if;

  with new_participants as (
    insert into public.meeting_participants (meeting_id, user_id)
    select p_meeting_id, selected.user_id
    from (select distinct unnest(coalesce(p_participant_ids, '{}'::uuid[])) as user_id) as selected
    join public.profiles as profile on profile.user_id = selected.user_id
    join public.meetings as meeting on meeting.id = p_meeting_id
    where selected.user_id <> meeting.organizer_id and profile.account_status = 'active'
    on conflict (meeting_id, user_id) do nothing
    returning user_id
  ), invitation_notifications as (
    insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
    select participant.user_id, p_meeting_id, 'Undangan meeting baru', v_title,
           'meeting_invitation', 'invite:' || p_meeting_id::text || ':' || v_schedule_version::text || ':' || participant.user_id::text
    from new_participants as participant
    on conflict (dedupe_key) do nothing
    returning id
  ), reminders as (
    insert into public.meeting_reminders (meeting_id, user_id, reminder_type, schedule_version, scheduled_at)
    select p_meeting_id, participant.user_id, reminder.reminder_type, v_schedule_version, v_starts_at - reminder.offset_by
    from new_participants as participant
    cross join (values
      ('4d'::text, interval '4 days'),
      ('1d'::text, interval '1 day'),
      ('30m'::text, interval '30 minutes'),
      ('start'::text, interval '0 minutes')
    ) as reminder(reminder_type, offset_by)
    where v_starts_at - reminder.offset_by > now()
    on conflict (meeting_id, user_id, reminder_type, schedule_version) do nothing
    returning id
  )
  select count(*) into v_added_count from new_participants;

  return v_added_count;
end;
$$;

create or replace function public.cancel_meeting_transaction(p_meeting_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_title text;
  v_schedule_version integer;
begin
  update public.meetings
  set status = 'cancelled', updated_at = now()
  where id = p_meeting_id and status in ('scheduled', 'ongoing')
  returning title, schedule_version into v_title, v_schedule_version;

  if v_schedule_version is null then
    raise exception 'Meeting tidak ditemukan atau sudah selesai.';
  end if;

  update public.meeting_reminders
  set status = 'cancelled'
  where meeting_id = p_meeting_id and status = 'pending';

  insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
  select participant.user_id, p_meeting_id, 'Meeting dibatalkan', v_title,
         'meeting_cancelled', 'cancelled:' || p_meeting_id::text || ':' || participant.user_id::text
  from public.meeting_participants as participant
  where participant.meeting_id = p_meeting_id
  on conflict (dedupe_key) do nothing;

  return true;
end;
$$;

create or replace function public.respond_to_meeting_transaction(
  p_meeting_id uuid,
  p_user_id uuid,
  p_invitation_status text
)
returns boolean
language plpgsql
as $$
declare
  v_organizer_id uuid;
  v_title text;
  v_responded_user_id uuid;
begin
  if p_invitation_status not in ('accepted', 'declined') then
    raise exception 'Respons meeting tidak valid.';
  end if;

  update public.meeting_participants
  set invitation_status = p_invitation_status, updated_at = now()
  where meeting_id = p_meeting_id and user_id = p_user_id
  returning user_id into v_responded_user_id;

  if v_responded_user_id is null then
    raise exception 'Undangan meeting tidak ditemukan.';
  end if;

  select organizer_id, title into v_organizer_id, v_title
  from public.meetings where id = p_meeting_id;

  insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
  values (
    v_organizer_id, p_meeting_id,
    case when p_invitation_status = 'accepted' then 'Peserta menerima undangan' else 'Peserta menolak undangan' end,
    v_title, 'attendee_response',
    'response:' || p_meeting_id::text || ':' || v_responded_user_id::text || ':' || p_invitation_status || ':' || gen_random_uuid()::text
  );
  return true;
end;
$$;

create or replace function public.process_due_meeting_reminders()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update public.meetings
  set status = 'completed', updated_at = now()
  where status = 'ongoing' and ends_at <= now();

  update public.meetings
  set status = 'ongoing', updated_at = now()
  where status = 'scheduled' and starts_at <= now() and ends_at > now();

  with due as (
    update public.meeting_reminders as reminder
    set status = 'sent', sent_at = now()
    where reminder.id in (
      select pending.id
      from public.meeting_reminders as pending
      join public.meetings as meeting on meeting.id = pending.meeting_id
      where pending.status = 'pending'
        and pending.scheduled_at <= now()
        and meeting.status in ('scheduled', 'ongoing')
      order by pending.scheduled_at
      limit 100
      for update of pending skip locked
    )
    returning reminder.id, reminder.meeting_id, reminder.user_id, reminder.reminder_type
  )
  insert into public.notifications (user_id, meeting_id, title, message, notification_type, dedupe_key)
  select due.user_id, due.meeting_id,
         case due.reminder_type
           when '4d' then 'Meeting dalam 4 hari'
           when '1d' then 'Meeting besok'
           when '30m' then 'Meeting dimulai 30 menit lagi'
           else 'Meeting sedang dimulai'
         end,
         meeting.title,
         'meeting_reminder',
         'reminder:' || due.id::text
  from due
  join public.meetings as meeting on meeting.id = due.meeting_id
  on conflict (dedupe_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.profiles enable row level security;
alter table public.meeting_google_oauth_states enable row level security;
alter table public.meeting_google_connection enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_participants enable row level security;
alter table public.notifications enable row level security;
alter table public.meeting_reminders enable row level security;

revoke all on function public.create_meeting_transaction(text, text, uuid, timestamptz, timestamptz, text, text, text, text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.update_meeting_transaction(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text, uuid[]) from public, anon, authenticated;
revoke all on function public.add_meeting_participants_transaction(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.cancel_meeting_transaction(uuid) from public, anon, authenticated;
revoke all on function public.respond_to_meeting_transaction(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.process_due_meeting_reminders() from public, anon, authenticated;
grant execute on function public.create_meeting_transaction(text, text, uuid, timestamptz, timestamptz, text, text, text, text, text, uuid[]) to service_role;
grant execute on function public.update_meeting_transaction(uuid, text, text, timestamptz, timestamptz, text, text, text, text, text, uuid[]) to service_role;
grant execute on function public.add_meeting_participants_transaction(uuid, uuid[]) to service_role;
grant execute on function public.cancel_meeting_transaction(uuid) to service_role;
grant execute on function public.respond_to_meeting_transaction(uuid, uuid, text) to service_role;
grant execute on function public.process_due_meeting_reminders() to service_role;

notify pgrst, 'reload schema';