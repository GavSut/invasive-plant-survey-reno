-- Invasive Plant Transect System - Supabase schema v1.0.0
-- Run this entire file once in the Supabase SQL Editor as the project owner.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term text not null default '',
  access_code_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, term)
);

create table if not exists public.class_members (
  class_id uuid not null references public.classes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create table if not exists public.transects (
  id text primary key,
  class_id uuid not null references public.classes(id),
  owner_id uuid not null references auth.users(id),
  payload jsonb not null,
  entry_method text not null check (entry_method in ('digital_field', 'paper_transcription')),
  protocol_version text not null,
  species_list_version text not null,
  original_submitted_at timestamptz not null,
  client_modified_at timestamptz not null,
  server_created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  sync_state text not null default 'submitted' check (sync_state in ('submitted', 'upload_partially_complete')),
  submission_count integer not null default 1,
  instructor_note text,
  instructor_reviewed_at timestamptz
);

alter table public.transects add column if not exists instructor_note text;
alter table public.transects add column if not exists instructor_reviewed_at timestamptz;

create index if not exists transects_class_id_idx on public.transects(class_id);
create index if not exists transects_owner_id_idx on public.transects(owner_id);
create index if not exists transects_server_updated_idx on public.transects(server_updated_at desc);

create table if not exists public.transect_revisions (
  revision_id bigint generated always as identity primary key,
  transect_id text not null,
  class_id uuid not null,
  owner_id uuid not null,
  revision_number integer not null,
  payload jsonb not null,
  client_modified_at timestamptz not null,
  archived_at timestamptz not null default now()
);

create index if not exists revisions_transect_id_idx on public.transect_revisions(transect_id, revision_number);

create table if not exists public.photos (
  id text primary key,
  transect_id text not null references public.transects(id),
  owner_id uuid not null references auth.users(id),
  storage_path text not null unique,
  scope text not null check (scope in ('meter', 'cell', 'observation')),
  segment_index integer not null check (segment_index between 0 and 29),
  side text check (side in ('left', 'right')),
  band_start_m integer check (band_start_m between 0 and 4),
  species_code text,
  unknown_id text,
  note text,
  captured_at timestamptz not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  uploaded_at timestamptz not null default now()
);

create index if not exists photos_transect_id_idx on public.photos(transect_id);

create table if not exists public.enrollment_attempts (
  id bigint generated always as identity primary key,
  subject_hash text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists enrollment_attempts_subject_time_idx
  on public.enrollment_attempts(subject_hash, attempted_at desc);

alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.transects enable row level security;
alter table public.transect_revisions enable row level security;
alter table public.photos enable row level security;
alter table public.enrollment_attempts enable row level security;

revoke all on public.classes from anon, authenticated;
revoke all on public.enrollment_attempts from anon, authenticated;
revoke all on public.transect_revisions from anon, authenticated;

grant select on public.class_members to authenticated;
grant select on public.transects to authenticated;
grant insert (id, class_id, owner_id, payload, entry_method, protocol_version, species_list_version, original_submitted_at, client_modified_at)
  on public.transects to authenticated;
grant update (id, class_id, owner_id, payload, entry_method, protocol_version, species_list_version, original_submitted_at, client_modified_at, sync_state)
  on public.transects to authenticated;
grant select, insert, update on public.photos to authenticated;

drop policy if exists "Members read only their membership" on public.class_members;
create policy "Members read only their membership"
on public.class_members for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Owners read their transects" on public.transects;
create policy "Owners read their transects"
on public.transects for select to authenticated
using (owner_id = auth.uid());

drop policy if exists "Members insert their transects" on public.transects;
create policy "Members insert their transects"
on public.transects for insert to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.class_members m
    where m.class_id = transects.class_id and m.user_id = auth.uid()
  )
);

drop policy if exists "Owners update their transects" on public.transects;
create policy "Owners update their transects"
on public.transects for update to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.class_members m
    where m.class_id = transects.class_id and m.user_id = auth.uid()
  )
);

drop policy if exists "Owners read their photo metadata" on public.photos;
create policy "Owners read their photo metadata"
on public.photos for select to authenticated
using (owner_id = auth.uid());

drop policy if exists "Owners insert their photo metadata" on public.photos;
create policy "Owners insert their photo metadata"
on public.photos for insert to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.transects t
    where t.id = photos.transect_id and t.owner_id = auth.uid()
  )
);

drop policy if exists "Owners update their photo metadata" on public.photos;
create policy "Owners update their photo metadata"
on public.photos for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create or replace function public.archive_transect_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.payload is distinct from new.payload then
    insert into public.transect_revisions (
      transect_id, class_id, owner_id, revision_number, payload, client_modified_at
    ) values (
      old.id, old.class_id, old.owner_id, old.submission_count, old.payload, old.client_modified_at
    );
    new.submission_count := old.submission_count + 1;
  else
    new.submission_count := old.submission_count;
  end if;
  new.server_updated_at := now();
  new.owner_id := old.owner_id;
  new.class_id := old.class_id;
  new.original_submitted_at := old.original_submitted_at;
  return new;
end;
$$;

drop trigger if exists archive_transect_revision_trigger on public.transects;
create trigger archive_transect_revision_trigger
before update on public.transects
for each row execute function public.archive_transect_revision();

create or replace function public.create_or_rotate_class(
  p_name text,
  p_term text,
  p_access_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if length(trim(p_name)) < 2 then
    raise exception 'Class name is required.';
  end if;
  if length(p_access_code) < 12 then
    raise exception 'Use a class code with at least 12 characters.';
  end if;

  insert into public.classes (name, term, access_code_hash, active, updated_at)
  values (trim(p_name), coalesce(trim(p_term), ''), extensions.crypt(p_access_code, extensions.gen_salt('bf', 11)), true, now())
  on conflict (name, term) do update
    set access_code_hash = excluded.access_code_hash,
        active = true,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_or_rotate_class(text, text, text) from public, anon, authenticated;

create or replace function public.verify_class_code(p_access_code text)
returns table (class_id uuid, class_name text, class_term text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select c.id, c.name, c.term
  from public.classes c
  where c.active
    and c.access_code_hash = extensions.crypt(p_access_code, c.access_code_hash)
  order by c.updated_at desc
  limit 1;
end;
$$;

revoke all on function public.verify_class_code(text) from public, anon, authenticated;
grant execute on function public.verify_class_code(text) to service_role;

create or replace function public.enrollment_rate_allowed(p_subject_hash text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select count(*) < 10
  from public.enrollment_attempts
  where subject_hash = p_subject_hash
    and not succeeded
    and attempted_at > now() - interval '15 minutes';
$$;

create or replace function public.record_enrollment_attempt(p_subject_hash text, p_succeeded boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.enrollment_attempts(subject_hash, succeeded)
  values (p_subject_hash, p_succeeded);
  delete from public.enrollment_attempts where attempted_at < now() - interval '7 days';
end;
$$;

revoke all on function public.enrollment_rate_allowed(text) from public, anon, authenticated;
revoke all on function public.record_enrollment_attempt(text, boolean) from public, anon, authenticated;
grant execute on function public.enrollment_rate_allowed(text) to service_role;
grant execute on function public.record_enrollment_attempt(text, boolean) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'transect-photos',
  'transect-photos',
  false,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Owners upload transect photos" on storage.objects;
create policy "Owners upload transect photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'transect-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Owners update transect photos" on storage.objects;
create policy "Owners update transect photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'transect-photos'
  and owner_id = auth.uid()::text
)
with check (
  bucket_id = 'transect-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Owners read transect photos" on storage.objects;
create policy "Owners read transect photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'transect-photos'
  and owner_id = auth.uid()::text
);

create or replace view public.analysis_export_long
with (security_invoker = true)
as
select
  t.class_id,
  class_record.name as class_name,
  class_record.term as class_term,
  t.id as record_id,
  t.submission_count as revision_number,
  t.original_submitted_at as original_submission_timestamp,
  t.client_modified_at as last_modified_timestamp,
  t.payload #>> '{metadata,site}' as site,
  t.payload #>> '{metadata,trail}' as trail,
  t.payload #>> '{metadata,transectNumber}' as transect_number,
  t.payload #>> '{metadata,observers}' as observer_names,
  t.payload #>> '{metadata,surveyDate}' as survey_date,
  t.payload #>> '{metadata,startTime}' as start_time,
  t.payload #>> '{metadata,endTime}' as end_time,
  (t.payload #>> '{metadata,startGps,latitude}')::double precision as start_latitude,
  (t.payload #>> '{metadata,startGps,longitude}')::double precision as start_longitude,
  (t.payload #>> '{metadata,startGps,accuracy}')::double precision as start_accuracy_m,
  t.payload #>> '{metadata,startGps,timestamp}' as start_gps_timestamp,
  (t.payload #>> '{metadata,endGps,latitude}')::double precision as end_latitude,
  (t.payload #>> '{metadata,endGps,longitude}')::double precision as end_longitude,
  (t.payload #>> '{metadata,endGps,accuracy}')::double precision as end_accuracy_m,
  t.payload #>> '{metadata,endGps,timestamp}' as end_gps_timestamp,
  (segment.value ->> 'startM')::integer as segment_start_m,
  (segment.value ->> 'endM')::integer as segment_end_m,
  segment.value ->> 'label' as segment_label,
  cell.value ->> 'side' as side,
  (cell.value ->> 'bandStart')::integer as distance_band_start_m,
  (cell.value ->> 'bandEnd')::integer as distance_band_end_m,
  observation.species_code,
  cell.value ->> 'status' as survey_status,
  concat_ws(' | ', nullif(cell.value ->> 'note', ''), nullif(observation.observation_note, '')) as observation_note,
  t.entry_method,
  t.payload ->> 'transcriptionTimestamp' as transcription_timestamp,
  t.protocol_version,
  t.species_list_version,
  t.sync_state,
  t.instructor_note,
  t.instructor_reviewed_at
from public.transects t
join public.classes class_record on class_record.id = t.class_id
cross join lateral jsonb_array_elements(t.payload -> 'segments') as segment(value)
cross join lateral jsonb_array_elements(segment.value -> 'cells') as cell(value)
left join lateral (
  select species.value #>> '{}' as species_code, null::text as observation_note
  from jsonb_array_elements(coalesce(cell.value -> 'species', '[]'::jsonb)) as species(value)
  union all
  select 'UNKNOWN'::text as species_code, unknown_item.value ->> 'note' as observation_note
  from jsonb_array_elements(coalesce(cell.value -> 'unknowns', '[]'::jsonb)) as unknown_item(value)
) observation on true;

revoke all on public.analysis_export_long from public, anon, authenticated;

-- Example instructor command (replace all three values before running):
-- select public.create_or_rotate_class('BIO 101', 'Fall 2026', 'replace-with-4-random-words');
