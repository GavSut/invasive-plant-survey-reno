-- Invasive Plant Transect System - app/database release v2.1.1; ecological protocol v2.0.0
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
  entry_method text not null check (entry_method = 'digital_field'),
  protocol_version text not null check (protocol_version = '2.0.0'),
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
  band_start_m integer check (band_start_m between 0 and 2),
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
  global_bucket_hash text,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists enrollment_attempts_subject_time_idx
  on public.enrollment_attempts(subject_hash, attempted_at desc);
create index if not exists enrollment_attempts_global_time_idx
  on public.enrollment_attempts(global_bucket_hash, attempted_at desc);

create or replace function public.is_valid_gps_point(p_gps jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return coalesce(jsonb_typeof(p_gps) = 'object'
    and octet_length(p_gps::text) <= 1000
    and jsonb_typeof(p_gps -> 'latitude') = 'number'
    and jsonb_typeof(p_gps -> 'longitude') = 'number'
    and (p_gps ->> 'latitude')::numeric between -90 and 90
    and (p_gps ->> 'longitude')::numeric between -180 and 180
    and (
      not (p_gps ? 'accuracy')
      or jsonb_typeof(p_gps -> 'accuracy') = 'null'
      or (
        jsonb_typeof(p_gps -> 'accuracy') = 'number'
        and (p_gps ->> 'accuracy')::numeric between 0 and 1000000000
      )
    ), false);
exception when others then
  return false;
end;
$$;

create or replace function public.is_protocol_v2_payload(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment jsonb;
  v_cell jsonb;
  v_ordinal bigint;
  v_band integer;
  v_keys text[];
  v_status text;
  v_species jsonb;
  v_unknowns jsonb;
  v_gps jsonb;
  v_target_codes constant text[] := array[
    'SATR12', 'COMA2', 'CANU4', 'CESO3', 'CEDI3', 'CIIN', 'CIVU', 'CIAR4',
    'ONAC', 'CHTE2', 'LELA2', 'LEDR', 'ELAN', 'AECY', 'BRTE', 'POBU',
    'TACA8', 'CETE5', 'VETH', 'AIAL', 'TAMAR2', 'ULPU', 'TRTE'
  ];
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 2000000
     or jsonb_typeof(p_payload -> 'metadata') is distinct from 'object'
     or (p_payload ->> 'protocolVersion') is distinct from '2.0.0'
     or (p_payload ->> 'schemaVersion')::integer is distinct from 2
     or (p_payload ->> 'entryMethod') is distinct from 'digital_field'
     or (p_payload ->> 'speciesListVersion') is distinct from 'reno-2026.1'
     or jsonb_typeof(p_payload -> 'segments') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'segments') is distinct from 30 then
    return false;
  end if;

  foreach v_gps in array array[
    p_payload #> '{metadata,startGps}',
    p_payload #> '{metadata,endGps}'
  ] loop
    if v_gps is not null
       and jsonb_typeof(v_gps) <> 'null'
       and not public.is_valid_gps_point(v_gps) then
      return false;
    end if;
  end loop;

  for v_segment, v_ordinal in
    select value, ordinality from jsonb_array_elements(p_payload -> 'segments') with ordinality
  loop
    if (v_segment ->> 'index')::integer is distinct from (v_ordinal - 1)::integer
       or (v_segment ->> 'startM')::integer is distinct from (v_ordinal - 1)::integer
       or (v_segment ->> 'endM')::integer is distinct from v_ordinal::integer
       or (v_segment ->> 'label') is distinct from concat(v_ordinal - 1, '-', v_ordinal, ' m')
       or jsonb_typeof(v_segment -> 'cells') is distinct from 'array'
       or jsonb_array_length(v_segment -> 'cells') is distinct from 6 then
      return false;
    end if;
    v_keys := array[]::text[];
    for v_cell in select value from jsonb_array_elements(v_segment -> 'cells') loop
      v_band := (v_cell ->> 'bandStart')::integer;
      if (v_cell ->> 'side') is null
         or (v_cell ->> 'side') not in ('left', 'right')
         or v_band is null
         or v_band not between 0 and 2
         or (v_cell ->> 'bandEnd')::integer is distinct from v_band + 1
         or (v_cell ->> 'id') is distinct from concat('s', v_ordinal - 1, '_', v_cell ->> 'side', '_', v_band) then
        return false;
      end if;
      v_status := v_cell ->> 'status';
      v_species := coalesce(v_cell -> 'species', '[]'::jsonb);
      v_unknowns := coalesce(v_cell -> 'unknowns', '[]'::jsonb);
      if v_status is null
         or v_status not in ('detected', 'surveyed_no_target', 'not_surveyed', 'incomplete')
         or jsonb_typeof(v_species) is distinct from 'array'
         or jsonb_typeof(v_unknowns) is distinct from 'array'
         or exists (
           select 1 from jsonb_array_elements(v_species) as species_item(value)
           where jsonb_typeof(value) is distinct from 'string'
              or not ((value #>> '{}') = any (v_target_codes))
         )
         or exists (
           select 1 from jsonb_array_elements(v_unknowns) as unknown_item(value)
           where jsonb_typeof(value) is distinct from 'object'
              or coalesce(length(trim(value ->> 'id')), 0) = 0
         )
         or (select count(*) <> count(distinct value #>> '{}') from jsonb_array_elements(v_species) as species_item(value))
         or (v_status = 'detected' and jsonb_array_length(v_species) + jsonb_array_length(v_unknowns) = 0)
         or (v_status <> 'detected' and jsonb_array_length(v_species) + jsonb_array_length(v_unknowns) <> 0) then
        return false;
      end if;
      v_keys := array_append(v_keys, concat(v_cell ->> 'side', ':', v_band));
    end loop;
    if (select count(distinct key_value) from unnest(v_keys) as keys(key_value)) <> 6 then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.transects drop constraint if exists transects_current_payload_check;
alter table public.transects add constraint transects_current_payload_check
  check (public.is_protocol_v2_payload(payload));

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
  if length(p_access_code) < 12 or octet_length(p_access_code) > 72 then
    raise exception 'Use a class code with at least 12 characters and no more than 72 UTF-8 bytes.';
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
  if octet_length(coalesce(p_access_code, '')) > 72 then
    return;
  end if;
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

create or replace function public.record_enrollment_auth_attempt(
  p_subject_hash text,
  p_global_bucket_hash text,
  p_succeeded boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject_lock bigint;
  v_global_lock bigint;
  v_subject_failures integer;
  v_global_failures integer;
  v_subject_oldest timestamptz;
  v_global_oldest timestamptz;
  v_subject_retry integer := 0;
  v_global_retry integer := 0;
  v_now timestamptz;
begin
  if p_subject_hash !~ '^[a-f0-9]{64}$'
     or p_global_bucket_hash !~ '^[a-f0-9]{64}$'
     or p_subject_hash = p_global_bucket_hash then
    raise exception using errcode = '22023', message = 'Enrollment rate-limit subject is invalid.';
  end if;
  v_subject_lock := hashtextextended('enrollment-client:' || p_subject_hash, 0);
  v_global_lock := hashtextextended('enrollment-global:' || p_global_bucket_hash, 0);
  perform pg_advisory_xact_lock(least(v_subject_lock, v_global_lock));
  if v_subject_lock <> v_global_lock then
    perform pg_advisory_xact_lock(greatest(v_subject_lock, v_global_lock));
  end if;
  v_now := clock_timestamp();
  select count(*)::integer, min(attempted_at)
    into v_subject_failures, v_subject_oldest
  from public.enrollment_attempts
  where subject_hash = p_subject_hash and not succeeded
    and attempted_at > v_now - interval '15 minutes';
  select count(*)::integer, min(attempted_at)
    into v_global_failures, v_global_oldest
  from public.enrollment_attempts
  where global_bucket_hash = p_global_bucket_hash and not succeeded
    and attempted_at > v_now - interval '15 minutes';
  if v_subject_failures >= 10 or v_global_failures >= 200 then
    if v_subject_failures >= 10 then
      v_subject_retry := greatest(1, ceil(extract(epoch from
        (v_subject_oldest + interval '15 minutes' - v_now)))::integer);
    end if;
    if v_global_failures >= 200 then
      v_global_retry := greatest(1, ceil(extract(epoch from
        (v_global_oldest + interval '15 minutes' - v_now)))::integer);
    end if;
    return jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', greatest(v_subject_retry, v_global_retry),
      'scope', case
        when v_subject_failures >= 10 and v_global_failures >= 200 then 'client_and_global'
        when v_subject_failures >= 10 then 'client'
        else 'global'
      end
    );
  end if;
  insert into public.enrollment_attempts(subject_hash, global_bucket_hash, succeeded)
  values (p_subject_hash, p_global_bucket_hash, p_succeeded);
  delete from public.enrollment_attempts where attempted_at < v_now - interval '7 days';
  return jsonb_build_object('allowed', true, 'retryAfterSeconds', 0);
end;
$$;

-- Compatibility-only RPCs keep an already deployed pre-v2.1 enroll-class
-- function operational during the migration/redeploy maintenance window. They
-- remain service-role-only; the updated Edge function uses the atomic RPC above.
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

revoke all on function public.record_enrollment_auth_attempt(text, text, boolean) from public, anon, authenticated;
revoke all on function public.enrollment_rate_allowed(text) from public, anon, authenticated;
revoke all on function public.record_enrollment_attempt(text, boolean) from public, anon, authenticated;
grant execute on function public.record_enrollment_auth_attempt(text, text, boolean) to service_role;
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
  (t.payload ->> 'schemaVersion')::integer as schema_version,
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
) observation on true
where t.protocol_version = '2.0.0';

revoke all on public.analysis_export_long from public, anon, authenticated;

-- Example instructor command (replace all three values before running):
-- select public.create_or_rotate_class('BIO 101', 'Fall 2026', 'replace-with-4-random-words');

-- The following transactional section is also shipped as
-- migrations/20260910_instructor_dashboard_v2_1.sql for existing projects.
-- Keeping it here makes a fresh schema installation equivalent to a migrated
-- protocol-v2.1 installation.
-- Existing-project migration for the protocol-v2.1 instructor dashboard.
-- Run this file once in the Supabase SQL Editor as the project owner. It is
-- transactional and does not modify existing student payloads, class codes,
-- memberships, Auth users, or Storage objects.

begin;

-- This project was created with automatic table exposure disabled. The
-- enrollment Edge Function performs a direct class_members upsert, so retain
-- these explicit privileges in both the migration and fresh-install schema.
grant select, insert, update on table public.class_members to service_role;

-- Instructor reads happen only through the server-side Edge Function.
grant select on table public.classes, public.transects,
  public.transect_revisions, public.photos to service_role;

-- IDs are part of the canonical private-photo path. Enforce a safe format for
-- future rows without blocking this migration if an old test row is malformed.
alter table public.transects drop constraint if exists transects_id_format_check;
alter table public.transects add constraint transects_id_format_check
  check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$') not valid;
alter table public.transects drop constraint if exists transects_payload_identity_check;
alter table public.transects add constraint transects_payload_identity_check
  check (
    payload ->> 'id' is not distinct from id
    and payload ->> 'entryMethod' is not distinct from entry_method
    and payload ->> 'protocolVersion' is not distinct from protocol_version
    and payload ->> 'speciesListVersion' is not distinct from species_list_version
  ) not valid;
do $$
begin
  if not exists (
    select 1 from public.transects
    where id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$'
  ) then
    alter table public.transects validate constraint transects_id_format_check;
  end if;
  if not exists (
    select 1 from public.transects
    where payload ->> 'id' is distinct from id
       or payload ->> 'entryMethod' is distinct from entry_method
       or payload ->> 'protocolVersion' is distinct from protocol_version
       or payload ->> 'speciesListVersion' is distinct from species_list_version
  ) then
    alter table public.transects validate constraint transects_payload_identity_check;
  end if;
end;
$$;

-- Freeze stable identity/class/owner values on student edits. The client uses
-- UPSERT and includes these columns, so the trigger, rather than a narrower
-- column grant, preserves compatibility with the existing field application.
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
      old.id, old.class_id, old.owner_id, old.submission_count,
      old.payload, old.client_modified_at
    );
    new.submission_count := old.submission_count + 1;
  else
    new.submission_count := old.submission_count;
  end if;
  new.id := old.id;
  new.class_id := old.class_id;
  new.owner_id := old.owner_id;
  new.entry_method := old.entry_method;
  new.protocol_version := old.protocol_version;
  new.species_list_version := old.species_list_version;
  new.original_submitted_at := old.original_submitted_at;
  new.server_created_at := old.server_created_at;
  new.server_updated_at := now();
  return new;
end;
$$;

revoke all on function public.archive_transect_revision() from public, anon, authenticated;

create table if not exists public.target_species_catalog (
  species_list_version text not null,
  code text not null check (code ~ '^[A-Z0-9_-]{2,10}$' and code <> 'UNKNOWN'),
  common_name text not null default '',
  scientific_name text not null default '',
  primary key (species_list_version, code)
);

insert into public.target_species_catalog (species_list_version, code)
values
  ('reno-2026.1', 'SATR12'), ('reno-2026.1', 'COMA2'),
  ('reno-2026.1', 'CANU4'), ('reno-2026.1', 'CESO3'),
  ('reno-2026.1', 'CEDI3'), ('reno-2026.1', 'CIIN'),
  ('reno-2026.1', 'CIVU'), ('reno-2026.1', 'CIAR4'),
  ('reno-2026.1', 'ONAC'), ('reno-2026.1', 'CHTE2'),
  ('reno-2026.1', 'LELA2'), ('reno-2026.1', 'LEDR'),
  ('reno-2026.1', 'ELAN'), ('reno-2026.1', 'AECY'),
  ('reno-2026.1', 'BRTE'), ('reno-2026.1', 'POBU'),
  ('reno-2026.1', 'TACA8'), ('reno-2026.1', 'CETE5'),
  ('reno-2026.1', 'VETH'), ('reno-2026.1', 'AIAL'),
  ('reno-2026.1', 'TAMAR2'), ('reno-2026.1', 'ULPU'),
  ('reno-2026.1', 'TRTE')
on conflict do nothing;

create table if not exists public.instructor_record_state (
  transect_id text primary key references public.transects(id) on delete cascade,
  review_status text not null default 'unreviewed'
    check (review_status in (
      'unreviewed', 'reviewed', 'needs_follow_up', 'questionable', 'accepted'
    )),
  excluded_from_analysis boolean not null default false,
  test_data_status text not null default 'auto'
    check (test_data_status in ('auto', 'test', 'real')),
  flags text[] not null default array[]::text[],
  instructor_note text not null default '' check (length(instructor_note) <= 10000),
  purge_pending boolean not null default false,
  version integer not null default 1 check (version >= 1),
  trashed_at timestamptz,
  trashed_by text,
  trash_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null check (length(trim(updated_by)) between 2 and 80),
  check (cardinality(flags) <= 20),
  check (
    (trashed_at is null and trashed_by is null and trash_reason is null)
    or (
      trashed_at is not null
      and length(trim(coalesce(trashed_by, ''))) between 2 and 80
      and length(trim(coalesce(trash_reason, ''))) between 3 and 1000
    )
  )
);

create index if not exists instructor_record_state_review_idx
  on public.instructor_record_state(review_status);
create index if not exists instructor_record_state_trash_idx
  on public.instructor_record_state(trashed_at);
create index if not exists instructor_record_state_test_idx
  on public.instructor_record_state(test_data_status, excluded_from_analysis);

create table if not exists public.instructor_curations (
  transect_id text primary key references public.transects(id) on delete cascade,
  curated_payload jsonb,
  active boolean not null default true,
  source_submission_count integer not null check (source_submission_count >= 1),
  version integer not null default 1 check (version >= 1),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  reviewer_name text not null check (length(trim(reviewer_name)) between 2 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (active and curated_payload is not null and public.is_protocol_v2_payload(curated_payload))
    or (not active and curated_payload is null)
  )
);

create index if not exists instructor_curations_active_idx
  on public.instructor_curations(active, updated_at desc);

create table if not exists public.instructor_curation_revisions (
  revision_id bigint generated always as identity primary key,
  transect_id text not null references public.transects(id) on delete cascade,
  curated_payload jsonb,
  active boolean not null,
  source_submission_count integer not null check (source_submission_count >= 1),
  version integer not null check (version >= 1),
  reason text not null,
  reviewer_name text not null,
  archived_at timestamptz not null default now(),
  unique (transect_id, version)
);

create index if not exists instructor_curation_revisions_record_idx
  on public.instructor_curation_revisions(transect_id, version desc);

create table if not exists public.instructor_actions (
  action_id bigint generated always as identity primary key,
  request_id uuid not null,
  record_id text not null default '',
  action text not null check (action in (
    'login_success', 'login_failure', 'session_rejected',
    'curation_saved', 'curation_cleared', 'curation_reverted',
    'state_updated', 'trashed', 'restored', 'purge_started',
    'purge_completed', 'purge_partial', 'photo_accessed',
    'export_generated'
  )),
  reviewer_name text not null check (length(trim(reviewer_name)) between 2 and 80),
  reason text not null default '' check (length(reason) <= 1000),
  detail jsonb not null default '{}'::jsonb
    constraint instructor_actions_detail_size_check
    check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 10000),
  created_at timestamptz not null default now(),
  unique (request_id, action, record_id)
);

alter table public.instructor_actions
  drop constraint if exists instructor_actions_detail_size_check;
alter table public.instructor_actions
  add constraint instructor_actions_detail_size_check
  check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 10000);

create index if not exists instructor_actions_record_idx
  on public.instructor_actions(record_id, created_at desc);
create index if not exists instructor_actions_time_idx
  on public.instructor_actions(created_at desc);

create table if not exists public.instructor_login_attempts (
  attempt_id bigint generated always as identity primary key,
  subject_hash text not null,
  global_bucket_hash text,
  purpose text not null check (purpose in ('login', 'purge')),
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index if not exists instructor_login_attempts_subject_idx
  on public.instructor_login_attempts(subject_hash, purpose, attempted_at desc);
create index if not exists instructor_login_attempts_global_idx
  on public.instructor_login_attempts(global_bucket_hash, purpose, attempted_at desc);

create table if not exists public.instructor_purge_operations (
  operation_id uuid primary key,
  request_id uuid not null,
  record_id text not null,
  class_id uuid,
  status text not null default 'storage_pending'
    check (status in ('storage_pending', 'completed', 'failed')),
  requested_by text not null check (length(trim(requested_by)) between 2 and 80),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  source_submission_count integer not null check (source_submission_count >= 1),
  source_state_version integer not null check (source_state_version >= 1),
  storage_paths jsonb not null check (jsonb_typeof(storage_paths) = 'array'),
  storage_path_digest text not null check (storage_path_digest ~ '^[a-f0-9]{64}$'),
  photo_metadata_count integer not null default 0 check (photo_metadata_count >= 0),
  storage_object_count integer not null default 0 check (storage_object_count >= 0),
  record_snapshot jsonb not null check (jsonb_typeof(record_snapshot) = 'object'),
  last_error text not null default '' check (length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  redacted_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  constraint instructor_purge_lease_pair check (
    (lease_token is null) = (lease_expires_at is null)
  ),
  constraint instructor_purge_snapshot_shape check (
    (
      status = 'completed'
      and redacted_at is not null
      and last_error = ''
      and record_snapshot = '{}'::jsonb
      and storage_paths = '[]'::jsonb
    ) or (
      status in ('storage_pending', 'failed')
      and redacted_at is null
      and record_snapshot ?& array[
        'recordId', 'classId', 'protocolVersion', 'speciesListVersion',
        'submissionCount', 'photoMetadataCount', 'storageObjectCount'
      ]
      and record_snapshot - array[
        'recordId', 'classId', 'protocolVersion', 'speciesListVersion',
        'submissionCount', 'photoMetadataCount', 'storageObjectCount'
      ]::text[] = '{}'::jsonb
    ) or (
      status = 'failed'
      and redacted_at is not null
      and last_error = ''
      and record_snapshot = '{}'::jsonb
      and storage_paths = '[]'::jsonb
    )
  )
);

alter table public.instructor_purge_operations
  drop constraint if exists instructor_purge_operations_request_id_record_id_key;
alter table public.instructor_purge_operations
  add column if not exists redacted_at timestamptz;
alter table public.instructor_purge_operations
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;
alter table public.instructor_purge_operations
  drop constraint if exists instructor_purge_lease_pair;
alter table public.instructor_purge_operations
  add constraint instructor_purge_lease_pair check (
    (lease_token is null) = (lease_expires_at is null)
  );
alter table public.instructor_purge_operations
  drop constraint if exists instructor_purge_snapshot_shape;
-- A previous dashboard release already redacted the successful operation but
-- did not mark when that happened. Normalize those rows before tightening the
-- constraint, and scrub every retained attempt for records already tombstoned.
update public.instructor_purge_operations
set redacted_at = coalesce(redacted_at, completed_at, updated_at, now()),
    last_error = '', storage_paths = '[]'::jsonb,
    record_snapshot = '{}'::jsonb, lease_token = null, lease_expires_at = null
where status = 'completed';
alter table public.instructor_purge_operations
  add constraint instructor_purge_snapshot_shape check (
    (
      status = 'completed'
      and redacted_at is not null
      and last_error = ''
      and record_snapshot = '{}'::jsonb
      and storage_paths = '[]'::jsonb
    ) or (
      status in ('storage_pending', 'failed')
      and redacted_at is null
      and record_snapshot ?& array[
        'recordId', 'classId', 'protocolVersion', 'speciesListVersion',
        'submissionCount', 'photoMetadataCount', 'storageObjectCount'
      ]
      and record_snapshot - array[
        'recordId', 'classId', 'protocolVersion', 'speciesListVersion',
        'submissionCount', 'photoMetadataCount', 'storageObjectCount'
      ]::text[] = '{}'::jsonb
    ) or (
      status = 'failed'
      and redacted_at is not null
      and last_error = ''
      and record_snapshot = '{}'::jsonb
      and storage_paths = '[]'::jsonb
    )
  );

create index if not exists instructor_purge_operations_record_idx
  on public.instructor_purge_operations(record_id, created_at desc);
create unique index if not exists instructor_purge_operations_one_pending_idx
  on public.instructor_purge_operations(record_id)
  where status = 'storage_pending';

-- This intentionally has no FK to transects: it is the minimal durable record
-- after the source row is permanently removed and blocks cached resurrection.
create table if not exists public.instructor_purge_tombstones (
  record_id text primary key,
  operation_id uuid not null references public.instructor_purge_operations(operation_id),
  class_id uuid,
  protocol_version text,
  purged_by text not null,
  reason text not null,
  photo_count integer not null default 0,
  purged_at timestamptz not null default now()
);

-- If this schema upgrades an earlier dashboard attempt, a tombstone proves
-- the record is already gone. Retain attempt status/identity for audit while
-- removing every stored path, snapshot, and error for that record.
update public.instructor_purge_operations operation
set status = case
      when operation.status = 'storage_pending' then 'completed'
      else operation.status
    end,
    completed_at = case
      when operation.status = 'storage_pending'
        then coalesce(operation.completed_at, tombstone.purged_at, now())
      else operation.completed_at
    end,
    redacted_at = coalesce(operation.redacted_at, tombstone.purged_at, now()),
    updated_at = now(), last_error = '', storage_paths = '[]'::jsonb,
    record_snapshot = '{}'::jsonb, lease_token = null, lease_expires_at = null
from public.instructor_purge_tombstones tombstone
where tombstone.record_id = operation.record_id
  and operation.status in ('storage_pending', 'failed');

-- Return NULL when a curation is valid, otherwise a stable error message.
create or replace function public.instructor_curation_error(
  p_transect_id text,
  p_payload jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_original public.transects%rowtype;
  v_gps jsonb;
begin
  select * into v_original
  from public.transects
  where id = p_transect_id;
  if not found then return 'Original transect does not exist.'; end if;
  if octet_length(p_payload::text) > 2000000 then
    return 'Curated payload exceeds the 2 MB limit.';
  end if;
  if not public.is_protocol_v2_payload(p_payload) then
    return 'Curated payload failed protocol-v2 validation.';
  end if;
  if p_payload ->> 'id' is distinct from p_transect_id then
    return 'Curated payload record identity does not match.';
  end if;
  foreach v_gps in array array[
    p_payload #> '{metadata,startGps}',
    p_payload #> '{metadata,endGps}'
  ] loop
    if v_gps is not null and jsonb_typeof(v_gps) <> 'null' then
      if jsonb_typeof(v_gps) <> 'object'
         or jsonb_typeof(v_gps -> 'latitude') is distinct from 'number'
         or jsonb_typeof(v_gps -> 'longitude') is distinct from 'number'
         or (v_gps ->> 'latitude')::numeric not between -90 and 90
         or (v_gps ->> 'longitude')::numeric not between -180 and 180
         or (
           v_gps ? 'accuracy'
           and jsonb_typeof(v_gps -> 'accuracy') <> 'null'
           and (
             jsonb_typeof(v_gps -> 'accuracy') is distinct from 'number'
             or (v_gps ->> 'accuracy')::numeric < 0
           )
         ) then
        return 'Curated GPS must contain valid latitude, longitude, and nonnegative accuracy.';
      end if;
    end if;
  end loop;
  -- Only metadata and segment observations are curatable. Protocol identity,
  -- species-list version, photos, and all other top-level fields stay original.
  if (p_payload - 'metadata' - 'segments')
       is distinct from (v_original.payload - 'metadata' - 'segments') then
    return 'Only metadata and segment data may be curated.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'segments') segment
    cross join lateral jsonb_array_elements(segment.value -> 'cells') cell
    cross join lateral jsonb_array_elements(coalesce(cell.value -> 'species', '[]'::jsonb)) species
    where not exists (
      select 1
      from public.target_species_catalog catalog
      where catalog.species_list_version = v_original.species_list_version
        and catalog.code = species.value #>> '{}'
    )
  ) then
    return 'Curated payload contains a species code outside its target catalog.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_payload -> 'segments') segment
    cross join lateral jsonb_array_elements(segment.value -> 'cells') cell
    cross join lateral jsonb_array_elements(coalesce(cell.value -> 'unknowns', '[]'::jsonb)) unknown_item
    group by cell.value ->> 'id', unknown_item.value ->> 'id'
    having count(*) > 1
  ) then
    return 'Curated payload contains a duplicate unknown identifier.';
  end if;
  return null;
exception when others then
  return 'Curated payload could not be validated.';
end;
$$;

create or replace function public.instructor_record_action(
  p_request_id uuid,
  p_action text,
  p_reviewer_name text,
  p_record_id text default '',
  p_reason text default '',
  p_detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.instructor_actions%rowtype;
begin
  if length(trim(p_reviewer_name)) not between 2 and 80
     or length(p_reason) > 1000
     or jsonb_typeof(p_detail) is distinct from 'object'
     or octet_length(p_detail::text) > 10000 then
    raise exception using errcode = '22023', message = 'Invalid instructor audit event.';
  end if;
  insert into public.instructor_actions (
    request_id, record_id, action, reviewer_name, reason, detail
  ) values (
    p_request_id, coalesce(p_record_id, ''), p_action,
    trim(p_reviewer_name), p_reason, p_detail
  )
  on conflict (request_id, action, record_id) do update
    set request_id = excluded.request_id
  returning * into v_action;
  return to_jsonb(v_action);
end;
$$;

-- Atomically enforce and record authentication rate limits. Password checking
-- happens before this RPC, but every result (including a correct value during a
-- lockout) is denied when the rolling limit has already been reached.
create or replace function public.instructor_record_auth_attempt(
  p_subject_hash text,
  p_global_bucket_hash text,
  p_purpose text,
  p_succeeded boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_global_limit integer;
  v_subject_failures integer;
  v_global_failures integer;
  v_subject_oldest timestamptz;
  v_global_oldest timestamptz;
  v_subject_retry integer := 0;
  v_global_retry integer := 0;
  v_subject_lock bigint;
  v_global_lock bigint;
  v_now timestamptz;
begin
  if p_subject_hash !~ '^[a-f0-9]{64}$'
     or p_global_bucket_hash !~ '^[a-f0-9]{64}$'
     or p_subject_hash = p_global_bucket_hash
     or p_purpose not in ('login', 'purge') then
    raise exception using errcode = '22023', message = 'Invalid authentication-attempt input.';
  end if;
  v_limit := case when p_purpose = 'purge' then 5 else 8 end;
  v_global_limit := case when p_purpose = 'purge' then 50 else 200 end;
  v_subject_lock := hashtextextended('instructor-client:' || p_purpose || ':' || p_subject_hash, 0);
  v_global_lock := hashtextextended('instructor-global:' || p_purpose || ':' || p_global_bucket_hash, 0);
  perform pg_advisory_xact_lock(least(v_subject_lock, v_global_lock));
  if v_subject_lock <> v_global_lock then
    perform pg_advisory_xact_lock(greatest(v_subject_lock, v_global_lock));
  end if;
  v_now := clock_timestamp();
  select count(*)::integer, min(attempted_at)
    into v_subject_failures, v_subject_oldest
  from public.instructor_login_attempts
  where subject_hash = p_subject_hash
    and purpose = p_purpose
    and not succeeded
    and attempted_at > v_now - interval '15 minutes';
  select count(*)::integer, min(attempted_at)
    into v_global_failures, v_global_oldest
  from public.instructor_login_attempts
  where global_bucket_hash = p_global_bucket_hash
    and purpose = p_purpose
    and not succeeded
    and attempted_at > v_now - interval '15 minutes';
  if v_subject_failures >= v_limit or v_global_failures >= v_global_limit then
    if v_subject_failures >= v_limit then
      v_subject_retry := greatest(1, ceil(extract(epoch from
        (v_subject_oldest + interval '15 minutes' - v_now)))::integer);
    end if;
    if v_global_failures >= v_global_limit then
      v_global_retry := greatest(1, ceil(extract(epoch from
        (v_global_oldest + interval '15 minutes' - v_now)))::integer);
    end if;
    return jsonb_build_object(
      'allowed', false,
      'retryAfterSeconds', greatest(v_subject_retry, v_global_retry)
    );
  end if;
  insert into public.instructor_login_attempts(subject_hash, global_bucket_hash, purpose, succeeded)
  values (p_subject_hash, p_global_bucket_hash, p_purpose, p_succeeded);
  delete from public.instructor_login_attempts
  where attempted_at < v_now - interval '7 days';
  return jsonb_build_object('allowed', true, 'retryAfterSeconds', 0);
end;
$$;

-- Compatibility wrapper for an already deployed dashboard during the short
-- migration/redeploy window. It still receives a database-wide backstop.
create or replace function public.instructor_record_auth_attempt(
  p_subject_hash text,
  p_purpose text,
  p_succeeded boolean
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.instructor_record_auth_attempt(
    p_subject_hash,
    encode(extensions.digest('legacy-instructor-global:' || p_purpose, 'sha256'), 'hex'),
    p_purpose,
    p_succeeded
  );
$$;

create or replace function public.instructor_save_curation(
  p_transect_id text,
  p_curated_payload jsonb,
  p_expected_submission_count integer,
  p_expected_curation_version integer,
  p_reviewer_name text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transect public.transects%rowtype;
  v_current public.instructor_curations%rowtype;
  v_new public.instructor_curations%rowtype;
  v_error text;
  v_existing jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select detail into v_existing
  from public.instructor_actions
  where request_id = p_request_id and action = 'curation_saved' and record_id = p_transect_id;
  if found then
    select * into v_new from public.instructor_curations where transect_id = p_transect_id;
    return jsonb_build_object('curation', to_jsonb(v_new), 'idempotent', true);
  end if;
  if length(trim(p_reviewer_name)) not between 2 and 80
     or length(trim(p_reason)) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'Reviewer and correction reason are required.';
  end if;
  select * into v_transect from public.transects where id = p_transect_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Record was not found.'; end if;
  if v_transect.submission_count <> p_expected_submission_count then
    raise exception using errcode = '40001', message = 'Student submission changed; reload before curating.';
  end if;
  if exists (
    select 1 from public.instructor_record_state
    where transect_id = p_transect_id and purge_pending
  ) then
    raise exception using errcode = '55000', message = 'Record is being permanently purged.';
  end if;
  select * into v_current
  from public.instructor_curations
  where transect_id = p_transect_id
  for update;
  if coalesce(v_current.version, 0) <> p_expected_curation_version then
    raise exception using errcode = '40001', message = 'Curation changed; reload before saving.';
  end if;
  v_error := public.instructor_curation_error(p_transect_id, p_curated_payload);
  if v_error is not null then
    raise exception using errcode = '22023', message = v_error;
  end if;
  if v_current.transect_id is not null then
    insert into public.instructor_curation_revisions (
      transect_id, curated_payload, active, source_submission_count,
      version, reason, reviewer_name, archived_at
    ) values (
      v_current.transect_id, v_current.curated_payload, v_current.active,
      v_current.source_submission_count, v_current.version,
      v_current.reason, v_current.reviewer_name, now()
    );
    update public.instructor_curations
    set curated_payload = p_curated_payload,
        active = true,
        source_submission_count = v_transect.submission_count,
        version = v_current.version + 1,
        reason = trim(p_reason), reviewer_name = trim(p_reviewer_name),
        updated_at = now()
    where transect_id = p_transect_id
    returning * into v_new;
  else
    insert into public.instructor_curations (
      transect_id, curated_payload, active, source_submission_count,
      version, reason, reviewer_name
    ) values (
      p_transect_id, p_curated_payload, true, v_transect.submission_count,
      1, trim(p_reason), trim(p_reviewer_name)
    ) returning * into v_new;
  end if;
  perform public.instructor_record_action(
    p_request_id, 'curation_saved', p_reviewer_name, p_transect_id, p_reason,
    jsonb_build_object(
      'curationVersion', v_new.version,
      'sourceSubmissionCount', v_new.source_submission_count
    )
  );
  return jsonb_build_object('curation', to_jsonb(v_new), 'idempotent', false);
end;
$$;

create or replace function public.instructor_clear_curation(
  p_transect_id text,
  p_expected_submission_count integer,
  p_expected_curation_version integer,
  p_reviewer_name text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transect public.transects%rowtype;
  v_current public.instructor_curations%rowtype;
  v_new public.instructor_curations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  if exists (
    select 1 from public.instructor_actions
    where request_id = p_request_id and action = 'curation_cleared' and record_id = p_transect_id
  ) then
    select * into v_new from public.instructor_curations where transect_id = p_transect_id;
    return jsonb_build_object('curation', to_jsonb(v_new), 'idempotent', true);
  end if;
  select * into v_transect from public.transects where id = p_transect_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Record was not found.'; end if;
  if v_transect.submission_count <> p_expected_submission_count then
    raise exception using errcode = '40001', message = 'Student submission changed; reload before clearing curation.';
  end if;
  if exists (
    select 1 from public.instructor_record_state
    where transect_id = p_transect_id and purge_pending
  ) then
    raise exception using errcode = '55000', message = 'Record is being permanently purged.';
  end if;
  select * into v_current from public.instructor_curations
  where transect_id = p_transect_id for update;
  if not found or v_current.version <> p_expected_curation_version then
    raise exception using errcode = '40001', message = 'Curation changed; reload before clearing.';
  end if;
  if length(trim(p_reviewer_name)) not between 2 and 80
     or length(trim(p_reason)) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'Reviewer and reason are required.';
  end if;
  insert into public.instructor_curation_revisions (
    transect_id, curated_payload, active, source_submission_count,
    version, reason, reviewer_name, archived_at
  ) values (
    v_current.transect_id, v_current.curated_payload, v_current.active,
    v_current.source_submission_count, v_current.version,
    v_current.reason, v_current.reviewer_name, now()
  );
  update public.instructor_curations
  set curated_payload = null, active = false,
      source_submission_count = v_transect.submission_count,
      version = v_current.version + 1,
      reason = trim(p_reason), reviewer_name = trim(p_reviewer_name),
      updated_at = now()
  where transect_id = p_transect_id returning * into v_new;
  perform public.instructor_record_action(
    p_request_id, 'curation_cleared', p_reviewer_name, p_transect_id, p_reason,
    jsonb_build_object('curationVersion', v_new.version)
  );
  return jsonb_build_object('curation', to_jsonb(v_new), 'idempotent', false);
end;
$$;

create or replace function public.instructor_revert_curation(
  p_transect_id text,
  p_revision_id bigint,
  p_expected_submission_count integer,
  p_expected_curation_version integer,
  p_reviewer_name text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transect public.transects%rowtype;
  v_current public.instructor_curations%rowtype;
  v_revision public.instructor_curation_revisions%rowtype;
  v_new public.instructor_curations%rowtype;
  v_error text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  if exists (
    select 1 from public.instructor_actions
    where request_id = p_request_id and action = 'curation_reverted' and record_id = p_transect_id
  ) then
    select * into v_new from public.instructor_curations where transect_id = p_transect_id;
    return jsonb_build_object('curation', to_jsonb(v_new), 'idempotent', true);
  end if;
  select * into v_transect from public.transects where id = p_transect_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Record was not found.'; end if;
  if v_transect.submission_count <> p_expected_submission_count then
    raise exception using errcode = '40001', message = 'Student submission changed; reload before reverting.';
  end if;
  if exists (
    select 1 from public.instructor_record_state
    where transect_id = p_transect_id and purge_pending
  ) then
    raise exception using errcode = '55000', message = 'Record is being permanently purged.';
  end if;
  select * into v_current from public.instructor_curations
  where transect_id = p_transect_id for update;
  if not found or v_current.version <> p_expected_curation_version then
    raise exception using errcode = '40001', message = 'Curation changed; reload before reverting.';
  end if;
  select * into v_revision from public.instructor_curation_revisions
  where revision_id = p_revision_id and transect_id = p_transect_id;
  if not found then raise exception using errcode = 'P0002', message = 'Curation revision was not found.'; end if;
  -- Never relabel an archived payload as current. It is safe only when its
  -- original base is still the current student submission.
  if v_revision.source_submission_count <> v_transect.submission_count then
    raise exception using errcode = '40001', message = 'Archived curation is based on a different student revision.';
  end if;
  if v_revision.active then
    v_error := public.instructor_curation_error(p_transect_id, v_revision.curated_payload);
    if v_error is not null then raise exception using errcode = '22023', message = v_error; end if;
  end if;
  if length(trim(p_reviewer_name)) not between 2 and 80
     or length(trim(p_reason)) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'Reviewer and reason are required.';
  end if;
  insert into public.instructor_curation_revisions (
    transect_id, curated_payload, active, source_submission_count,
    version, reason, reviewer_name, archived_at
  ) values (
    v_current.transect_id, v_current.curated_payload, v_current.active,
    v_current.source_submission_count, v_current.version,
    v_current.reason, v_current.reviewer_name, now()
  );
  update public.instructor_curations
  set curated_payload = v_revision.curated_payload,
      active = v_revision.active,
      source_submission_count = v_revision.source_submission_count,
      version = v_current.version + 1,
      reason = trim(p_reason), reviewer_name = trim(p_reviewer_name),
      updated_at = now()
  where transect_id = p_transect_id returning * into v_new;
  perform public.instructor_record_action(
    p_request_id, 'curation_reverted', p_reviewer_name, p_transect_id, p_reason,
    jsonb_build_object(
      'curationVersion', v_new.version,
      'restoredRevisionId', p_revision_id,
      'sourceSubmissionCount', v_revision.source_submission_count
    )
  );
  return jsonb_build_object('curation', to_jsonb(v_new), 'idempotent', false);
end;
$$;

create or replace function public.instructor_save_state(
  p_transect_id text,
  p_expected_state_version integer,
  p_review_status text,
  p_excluded_from_analysis boolean,
  p_test_data_status text,
  p_flags text[],
  p_instructor_note text,
  p_reviewer_name text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.instructor_record_state%rowtype;
  v_new public.instructor_record_state%rowtype;
  v_before jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  if exists (
    select 1 from public.instructor_actions
    where request_id = p_request_id and action = 'state_updated' and record_id = p_transect_id
  ) then
    select * into v_new from public.instructor_record_state where transect_id = p_transect_id;
    return jsonb_build_object('state', to_jsonb(v_new), 'idempotent', true);
  end if;
  perform 1 from public.transects where id = p_transect_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Record was not found.'; end if;
  select * into v_current from public.instructor_record_state
  where transect_id = p_transect_id for update;
  if coalesce(v_current.version, 0) <> p_expected_state_version then
    raise exception using errcode = '40001', message = 'Review state changed; reload before saving.';
  end if;
  if coalesce(v_current.purge_pending, false) then
    raise exception using errcode = '55000', message = 'Record is being permanently purged.';
  end if;
  if p_review_status not in ('unreviewed', 'reviewed', 'needs_follow_up', 'questionable', 'accepted')
     or p_test_data_status not in ('auto', 'test', 'real')
     or cardinality(coalesce(p_flags, array[]::text[])) > 20
     or exists (select 1 from unnest(coalesce(p_flags, array[]::text[])) flag where length(trim(flag)) not between 1 and 80)
     or length(coalesce(p_instructor_note, '')) > 10000
     or length(trim(p_reviewer_name)) not between 2 and 80
     or length(coalesce(p_reason, '')) > 1000 then
    raise exception using errcode = '22023', message = 'Review-state values are invalid.';
  end if;
  v_before := case when v_current.transect_id is null then '{}'::jsonb else
    jsonb_build_object(
      'reviewStatus', v_current.review_status,
      'excludedFromAnalysis', v_current.excluded_from_analysis,
      'testDataStatus', v_current.test_data_status,
      'flags', v_current.flags
    ) end;
  if v_current.transect_id is null then
    insert into public.instructor_record_state (
      transect_id, review_status, excluded_from_analysis, test_data_status,
      flags, instructor_note, version, updated_by
    ) values (
      p_transect_id, p_review_status, p_excluded_from_analysis,
      p_test_data_status, coalesce(p_flags, array[]::text[]),
      coalesce(p_instructor_note, ''), 1, trim(p_reviewer_name)
    ) returning * into v_new;
  else
    update public.instructor_record_state
    set review_status = p_review_status,
        excluded_from_analysis = p_excluded_from_analysis,
        test_data_status = p_test_data_status,
        flags = coalesce(p_flags, array[]::text[]),
        instructor_note = coalesce(p_instructor_note, ''),
        version = v_current.version + 1,
        updated_by = trim(p_reviewer_name), updated_at = now()
    where transect_id = p_transect_id returning * into v_new;
  end if;
  perform public.instructor_record_action(
    p_request_id, 'state_updated', p_reviewer_name, p_transect_id,
    coalesce(p_reason, ''),
    jsonb_build_object(
      'before', v_before,
      'after', jsonb_build_object(
        'reviewStatus', v_new.review_status,
        'excludedFromAnalysis', v_new.excluded_from_analysis,
        'testDataStatus', v_new.test_data_status,
        'flags', v_new.flags
      ),
      'stateVersion', v_new.version
    )
  );
  return jsonb_build_object('state', to_jsonb(v_new), 'idempotent', false);
end;
$$;

create or replace function public.instructor_set_trash(
  p_transect_id text,
  p_expected_state_version integer,
  p_trash boolean,
  p_reviewer_name text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.instructor_record_state%rowtype;
  v_new public.instructor_record_state%rowtype;
  v_action text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  v_action := case when p_trash then 'trashed' else 'restored' end;
  if exists (
    select 1 from public.instructor_actions
    where request_id = p_request_id and action = v_action and record_id = p_transect_id
  ) then
    select * into v_new from public.instructor_record_state where transect_id = p_transect_id;
    return jsonb_build_object('state', to_jsonb(v_new), 'idempotent', true);
  end if;
  perform 1 from public.transects where id = p_transect_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Record was not found.'; end if;
  select * into v_current from public.instructor_record_state
  where transect_id = p_transect_id for update;
  if coalesce(v_current.version, 0) <> p_expected_state_version then
    raise exception using errcode = '40001', message = 'Record state changed; reload before moving it.';
  end if;
  if coalesce(v_current.purge_pending, false) then
    raise exception using errcode = '55000', message = 'Record is being permanently purged.';
  end if;
  if length(trim(p_reviewer_name)) not between 2 and 80
     or length(trim(p_reason)) not between 3 and 1000 then
    raise exception using errcode = '22023', message = 'Reviewer and reason are required.';
  end if;
  if v_current.transect_id is null then
    if not p_trash then
      raise exception using errcode = '22023', message = 'Record is not in trash.';
    end if;
    insert into public.instructor_record_state (
      transect_id, trashed_at, trashed_by, trash_reason, updated_by
    ) values (
      p_transect_id, now(), trim(p_reviewer_name), trim(p_reason), trim(p_reviewer_name)
    ) returning * into v_new;
  else
    if p_trash and v_current.trashed_at is not null then
      raise exception using errcode = '22023', message = 'Record is already in trash.';
    elsif not p_trash and v_current.trashed_at is null then
      raise exception using errcode = '22023', message = 'Record is not in trash.';
    end if;
    update public.instructor_record_state
    set trashed_at = case when p_trash then now() else null end,
        trashed_by = case when p_trash then trim(p_reviewer_name) else null end,
        trash_reason = case when p_trash then trim(p_reason) else null end,
        version = v_current.version + 1,
        updated_by = trim(p_reviewer_name), updated_at = now()
    where transect_id = p_transect_id returning * into v_new;
  end if;
  perform public.instructor_record_action(
    p_request_id, v_action, p_reviewer_name, p_transect_id, p_reason,
    jsonb_build_object('stateVersion', v_new.version)
  );
  return jsonb_build_object('state', to_jsonb(v_new), 'idempotent', false);
end;
$$;

create or replace function public.instructor_begin_purge(
  p_operation_id uuid,
  p_request_id uuid,
  p_transect_id text,
  p_expected_submission_count integer,
  p_expected_state_version integer,
  p_storage_paths jsonb,
  p_storage_path_digest text,
  p_photo_metadata_count integer,
  p_storage_object_count integer,
  p_record_snapshot jsonb,
  p_reviewer_name text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transect public.transects%rowtype;
  v_state public.instructor_record_state%rowtype;
  v_operation public.instructor_purge_operations%rowtype;
  v_path jsonb;
  v_db_path text;
begin
  if jsonb_typeof(p_storage_paths) is distinct from 'array'
     or p_storage_path_digest !~ '^[a-f0-9]{64}$'
     or p_photo_metadata_count < 0 or p_storage_object_count < 0
     or length(trim(p_reason)) not between 3 and 1000
     or length(trim(p_reviewer_name)) not between 2 and 80
     or jsonb_typeof(p_record_snapshot) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Purge operation input is invalid.';
  end if;
  -- Serialize the purge fence with student photo/storage authorization. Any
  -- write already holding this transaction lock finishes before inventory is
  -- checked; later writes observe purge_pending and are rejected.
  perform pg_advisory_xact_lock(hashtextextended('photo-purge:' || p_transect_id, 0));
  select * into v_operation from public.instructor_purge_operations
  where operation_id = p_operation_id for update;
  if found then
    if v_operation.status <> 'storage_pending'
       or v_operation.record_id <> p_transect_id
       or v_operation.source_submission_count <> p_expected_submission_count
       or v_operation.source_state_version <> p_expected_state_version
       or v_operation.storage_paths <> p_storage_paths
       or v_operation.storage_path_digest <> p_storage_path_digest
       or v_operation.photo_metadata_count <> p_photo_metadata_count
       or v_operation.storage_object_count <> p_storage_object_count
       or v_operation.record_snapshot <> p_record_snapshot then
      raise exception using errcode = '40001', message = 'Pending purge operation no longer matches its signed preview.';
    end if;
    update public.instructor_purge_operations
    set request_id = p_request_id,
        requested_by = trim(p_reviewer_name),
        reason = trim(p_reason),
        updated_at = now()
    where operation_id = p_operation_id
    returning * into v_operation;
    return jsonb_build_object('operation', to_jsonb(v_operation), 'idempotent', true);
  end if;
  if jsonb_array_length(p_storage_paths) < greatest(p_photo_metadata_count, p_storage_object_count)
     or jsonb_array_length(p_storage_paths) > p_photo_metadata_count + p_storage_object_count then
    raise exception using errcode = '22023', message = 'Purge photo counts do not match the exact path set.';
  end if;
  if (select count(*) <> count(distinct value #>> '{}') from jsonb_array_elements(p_storage_paths))
     or exists (
       select 1 from jsonb_array_elements(p_storage_paths) path
       where jsonb_typeof(path.value) is distinct from 'string'
          or split_part(path.value #>> '{}', '/', 1) = ''
          or split_part(path.value #>> '{}', '/', 2) is distinct from p_transect_id
          or split_part(path.value #>> '{}', '/', 3) = ''
          or split_part(path.value #>> '{}', '/', 4) <> ''
     ) then
    raise exception using errcode = '22023', message = 'Purge contains a non-canonical or duplicate Storage path.';
  end if;
  select * into v_transect from public.transects where id = p_transect_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Record was not found.'; end if;
  if v_transect.submission_count <> p_expected_submission_count then
    raise exception using errcode = '40001', message = 'Student submission changed after purge preview.';
  end if;
  if p_record_snapshot is distinct from jsonb_build_object(
    'recordId', v_transect.id,
    'classId', v_transect.class_id::text,
    'protocolVersion', v_transect.protocol_version,
    'speciesListVersion', v_transect.species_list_version,
    'submissionCount', v_transect.submission_count,
    'photoMetadataCount', p_photo_metadata_count,
    'storageObjectCount', p_storage_object_count
  ) then
    raise exception using errcode = '22023', message = 'Purge snapshot does not match the current record.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_storage_paths) path
    where split_part(path.value #>> '{}', '/', 1) is distinct from v_transect.owner_id::text
  ) then
    raise exception using errcode = '22023', message = 'Purge Storage owner does not match the record owner.';
  end if;
  select * into v_state from public.instructor_record_state
  where transect_id = p_transect_id for update;
  if not found or v_state.trashed_at is null then
    raise exception using errcode = '22023', message = 'Record is not in trash.';
  end if;
  if v_state.version <> p_expected_state_version or v_state.purge_pending then
    raise exception using errcode = '40001', message = 'Record state changed after purge preview.';
  end if;
  if (select count(*) from public.photos where transect_id = p_transect_id)
       <> p_photo_metadata_count then
    raise exception using errcode = '40001', message = 'Photo metadata count changed after purge preview.';
  end if;
  for v_db_path in select storage_path from public.photos where transect_id = p_transect_id loop
    if not (p_storage_paths ? v_db_path) then
      raise exception using errcode = '40001', message = 'Photo metadata changed after purge preview.';
    end if;
  end loop;
  update public.instructor_record_state
  set purge_pending = true, version = version + 1,
      updated_at = now(), updated_by = trim(p_reviewer_name)
  where transect_id = p_transect_id;
  insert into public.instructor_purge_operations (
    operation_id, request_id, record_id, class_id, status,
    requested_by, reason, source_submission_count, source_state_version,
    storage_paths, storage_path_digest, photo_metadata_count,
    storage_object_count, record_snapshot
  ) values (
    p_operation_id, p_request_id, p_transect_id, v_transect.class_id,
    'storage_pending', trim(p_reviewer_name), trim(p_reason),
    v_transect.submission_count, v_state.version, p_storage_paths,
    p_storage_path_digest, p_photo_metadata_count,
    p_storage_object_count, p_record_snapshot
  ) returning * into v_operation;
  perform public.instructor_record_action(
    p_request_id, 'purge_started', p_reviewer_name, p_transect_id, p_reason,
    jsonb_build_object(
      'operationId', p_operation_id,
      'photoMetadataCount', p_photo_metadata_count,
      'storageObjectCount', p_storage_object_count
    )
  );
  return jsonb_build_object('operation', to_jsonb(v_operation), 'idempotent', false);
end;
$$;

create or replace function public.instructor_claim_purge(
  p_operation_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id text;
  v_operation public.instructor_purge_operations%rowtype;
begin
  if p_lease_token is null then
    raise exception using errcode = '22023', message = 'Purge cleanup lease token is required.';
  end if;
  select record_id into v_record_id
  from public.instructor_purge_operations where operation_id = p_operation_id;
  if not found then raise exception using errcode = 'P0002', message = 'Purge operation was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('photo-purge:' || v_record_id, 0));
  select * into v_operation from public.instructor_purge_operations
  where operation_id = p_operation_id for update;
  if v_operation.status = 'completed' then return to_jsonb(v_operation); end if;
  if v_operation.status <> 'storage_pending' then
    raise exception using errcode = '55000', message = 'Purge operation is not ready for Storage cleanup.';
  end if;
  if v_operation.lease_token is not null
     and v_operation.lease_token <> p_lease_token
     and v_operation.lease_expires_at > clock_timestamp() then
    raise exception using errcode = '55P03', message = 'Purge Storage cleanup is already in progress.';
  end if;
  update public.instructor_purge_operations
  set lease_token = p_lease_token,
      lease_expires_at = clock_timestamp() + interval '5 minutes',
      updated_at = now()
  where operation_id = p_operation_id returning * into v_operation;
  return jsonb_build_object(
    'recordId', v_operation.record_id,
    'status', v_operation.status,
    'leaseExpiresAt', v_operation.lease_expires_at
  );
end;
$$;

create or replace function public.instructor_release_purge(
  p_operation_id uuid,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id text;
  v_operation public.instructor_purge_operations%rowtype;
begin
  if p_lease_token is null then
    raise exception using errcode = '22023', message = 'Purge cleanup lease token is required.';
  end if;
  select record_id into v_record_id
  from public.instructor_purge_operations where operation_id = p_operation_id;
  if not found then raise exception using errcode = 'P0002', message = 'Purge operation was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('photo-purge:' || v_record_id, 0));
  select * into v_operation from public.instructor_purge_operations
  where operation_id = p_operation_id for update;
  if v_operation.status = 'completed' then return to_jsonb(v_operation); end if;
  if v_operation.status <> 'storage_pending' or v_operation.lease_token is distinct from p_lease_token then
    raise exception using errcode = '40001', message = 'Purge cleanup lease changed before release.';
  end if;
  update public.instructor_purge_operations
  set lease_token = null, lease_expires_at = null, updated_at = now()
  where operation_id = p_operation_id returning * into v_operation;
  return to_jsonb(v_operation);
end;
$$;

create or replace function public.instructor_fail_purge(
  p_operation_id uuid,
  p_lease_token uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id text;
  v_operation public.instructor_purge_operations%rowtype;
begin
  if p_lease_token is null then
    raise exception using errcode = '22023', message = 'Purge cleanup lease token is required.';
  end if;
  select record_id into v_record_id
  from public.instructor_purge_operations where operation_id = p_operation_id;
  if not found then raise exception using errcode = 'P0002', message = 'Purge operation was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('photo-purge:' || v_record_id, 0));
  select * into v_operation from public.instructor_purge_operations
  where operation_id = p_operation_id for update;
  if v_operation.status = 'completed' then return to_jsonb(v_operation); end if;
  if v_operation.status = 'failed' then return to_jsonb(v_operation); end if;
  if v_operation.status <> 'storage_pending' or v_operation.lease_token is distinct from p_lease_token then
    raise exception using errcode = '40001', message = 'Purge cleanup lease changed before failure handling.';
  end if;
  update public.instructor_purge_operations
  set status = 'failed', last_error = left(coalesce(p_error, 'Unknown purge error.'), 500),
      lease_token = null, lease_expires_at = null, updated_at = now()
  where operation_id = p_operation_id returning * into v_operation;
  update public.instructor_record_state
  set purge_pending = false, version = version + 1,
      updated_at = now(), updated_by = v_operation.requested_by
  where transect_id = v_operation.record_id and purge_pending;
  perform public.instructor_record_action(
    v_operation.request_id, 'purge_partial', v_operation.requested_by,
    v_operation.record_id, v_operation.reason,
    jsonb_build_object('operationId', p_operation_id, 'stage', left(coalesce(p_error, ''), 160))
  );
  return to_jsonb(v_operation);
end;
$$;

create or replace function public.instructor_finalize_purge(p_operation_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id text;
  v_operation public.instructor_purge_operations%rowtype;
  v_transect public.transects%rowtype;
  v_state public.instructor_record_state%rowtype;
begin
  if p_lease_token is null then
    raise exception using errcode = '22023', message = 'Purge cleanup lease token is required.';
  end if;
  select record_id into v_record_id
  from public.instructor_purge_operations where operation_id = p_operation_id;
  if not found then raise exception using errcode = 'P0002', message = 'Purge operation was not found.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('photo-purge:' || v_record_id, 0));
  select * into v_operation from public.instructor_purge_operations
  where operation_id = p_operation_id for update;
  if v_operation.status = 'completed' then
    update public.instructor_purge_operations
    set status = case when status = 'storage_pending' then 'completed' else status end,
        completed_at = case when status = 'storage_pending'
          then coalesce(completed_at, now()) else completed_at end,
        redacted_at = coalesce(redacted_at, completed_at, updated_at, now()),
        updated_at = now(), last_error = '', storage_paths = '[]'::jsonb,
        record_snapshot = '{}'::jsonb, lease_token = null, lease_expires_at = null
    where record_id = v_operation.record_id
      and status in ('storage_pending', 'completed', 'failed');
    return jsonb_build_object('recordId', v_operation.record_id, 'alreadyCompleted', true);
  end if;
  if v_operation.status <> 'storage_pending' then
    raise exception using errcode = '55000', message = 'Purge operation is not ready to finalize.';
  end if;
  if v_operation.lease_token is distinct from p_lease_token then
    raise exception using errcode = '40001', message = 'Purge cleanup lease changed before finalization.';
  end if;
  select * into v_transect from public.transects
  where id = v_operation.record_id for update;
  if not found then
    if exists (
      select 1 from public.instructor_purge_tombstones
      where record_id = v_operation.record_id
    ) then
      update public.instructor_purge_operations
      set status = case when status = 'storage_pending' then 'completed' else status end,
          completed_at = case when status = 'storage_pending'
            then coalesce(completed_at, now()) else completed_at end,
          redacted_at = coalesce(redacted_at, now()), updated_at = now(),
          last_error = '', storage_paths = '[]'::jsonb,
          record_snapshot = '{}'::jsonb, lease_token = null, lease_expires_at = null
      where record_id = v_operation.record_id
        and status in ('storage_pending', 'completed', 'failed');
      return jsonb_build_object('recordId', v_operation.record_id, 'alreadyCompleted', true);
    end if;
    raise exception using errcode = '55000', message = 'Record is missing without a purge tombstone.';
  end if;
  select * into v_state from public.instructor_record_state
  where transect_id = v_operation.record_id for update;
  if not found or v_state.trashed_at is null or not v_state.purge_pending then
    raise exception using errcode = '40001', message = 'Record is no longer locked for purge.';
  end if;
  if v_transect.submission_count <> v_operation.source_submission_count
     or v_state.version <> v_operation.source_state_version + 1 then
    raise exception using errcode = '40001', message = 'Record changed during purge.';
  end if;
  if exists (
    select 1 from public.photos
    where transect_id = v_operation.record_id
      and not (v_operation.storage_paths ? storage_path)
  ) then
    raise exception using errcode = '40001', message = 'Photo metadata changed during purge.';
  end if;
  if (select count(*) from public.photos where transect_id = v_operation.record_id)
       <> v_operation.photo_metadata_count then
    raise exception using errcode = '40001', message = 'Photo metadata count changed during purge.';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = 'transect-photos'
      and split_part(name, '/', 1) = v_transect.owner_id::text
      and split_part(name, '/', 2) = v_operation.record_id
  ) then
    raise exception using errcode = '40001', message = 'Private Storage objects remain; database purge was not finalized.';
  end if;
  insert into public.instructor_purge_tombstones (
    record_id, operation_id, class_id, protocol_version,
    purged_by, reason, photo_count, purged_at
  ) values (
    v_operation.record_id, v_operation.operation_id, v_transect.class_id,
    v_transect.protocol_version, v_operation.requested_by,
    v_operation.reason, jsonb_array_length(v_operation.storage_paths), now()
  );
  delete from public.photos where transect_id = v_operation.record_id;
  delete from public.transect_revisions where transect_id = v_operation.record_id;
  delete from public.instructor_curation_revisions where transect_id = v_operation.record_id;
  delete from public.instructor_curations where transect_id = v_operation.record_id;
  delete from public.instructor_record_state where transect_id = v_operation.record_id;
  delete from public.transects where id = v_operation.record_id;
  -- After permanent deletion retain only the tombstone, purge ledger, and one
  -- non-sensitive completion event rather than the record's review history.
  delete from public.instructor_actions where record_id = v_operation.record_id;
  perform public.instructor_record_action(
    v_operation.request_id, 'purge_completed', v_operation.requested_by,
    v_operation.record_id, v_operation.reason,
    jsonb_build_object(
      'operationId', p_operation_id,
      'photoCount', v_operation.storage_object_count
    )
  );
  -- Keep request/reviewer/reason/status identifiers for audit and retry
  -- idempotency, but scrub every sensitive failed attempt once this record is
  -- permanently gone. The current pending operation becomes completed.
  update public.instructor_purge_operations
  set status = case when status = 'storage_pending' then 'completed' else status end,
      completed_at = case when status = 'storage_pending'
        then coalesce(completed_at, now()) else completed_at end,
      redacted_at = coalesce(redacted_at, now()), updated_at = now(),
      last_error = '', storage_paths = '[]'::jsonb,
      record_snapshot = '{}'::jsonb, lease_token = null, lease_expires_at = null
  where record_id = v_operation.record_id
    and status in ('storage_pending', 'completed', 'failed');
  return jsonb_build_object('recordId', v_operation.record_id, 'alreadyCompleted', false);
end;
$$;

-- Reject cached reinsertion after a permanent purge and block writes while the
-- Storage/database purge saga is in flight.
create or replace function public.protect_transect_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.instructor_purge_tombstones where record_id = new.id
  ) then
    raise exception 'This permanently purged record identifier cannot be reused.';
  end if;
  if exists (
    select 1 from public.instructor_record_state
    where transect_id = new.id and purge_pending
  ) then
    raise exception 'This record is being permanently purged.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_transect_lifecycle_trigger on public.transects;
create trigger protect_transect_lifecycle_trigger
before insert or update on public.transects
for each row execute function public.protect_transect_lifecycle();

create or replace function public.protect_photo_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.transect_id := old.transect_id;
    new.owner_id := old.owner_id;
    new.storage_path := old.storage_path;
    new.captured_at := old.captured_at;
  end if;
  if split_part(new.storage_path, '/', 1) is distinct from new.owner_id::text
     or split_part(new.storage_path, '/', 2) is distinct from new.transect_id
     or split_part(new.storage_path, '/', 3) = ''
     or split_part(new.storage_path, '/', 4) <> '' then
    raise exception 'Photo metadata does not use its canonical private path.';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('photo-purge:' || new.transect_id, 0));
  end if;
  if exists (
    select 1 from public.instructor_record_state
    where transect_id = new.transect_id and purge_pending
  ) then
    raise exception 'This record is being permanently purged.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_photo_lifecycle_trigger on public.photos;
create trigger protect_photo_lifecycle_trigger
before insert or update on public.photos
for each row execute function public.protect_photo_lifecycle();

-- Storage policies can call this without granting students visibility into the
-- instructor state table.
create or replace function public.student_photo_storage_write_allowed(
  p_name text,
  p_user_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_transect_id text := split_part(p_name, '/', 2);
begin
  if p_user_id is null
     or p_user_id is distinct from auth.uid()
     or split_part(p_name, '/', 1) is distinct from p_user_id::text
     or v_transect_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$'
     or split_part(p_name, '/', 3) = ''
     or split_part(p_name, '/', 4) <> '' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('photo-purge:' || v_transect_id, 0));
  return exists (
      select 1 from public.transects t
      where t.id = v_transect_id and t.owner_id = p_user_id
    )
    and not exists (
      select 1 from public.instructor_record_state state
      where state.transect_id = v_transect_id and state.purge_pending
    )
    and not exists (
      select 1 from public.instructor_purge_tombstones tombstone
      where tombstone.record_id = v_transect_id
    );
end;
$$;

drop policy if exists "Owners upload transect photos" on storage.objects;
create policy "Owners upload transect photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'transect-photos'
  and public.student_photo_storage_write_allowed(name, auth.uid())
);

drop policy if exists "Owners update transect photos" on storage.objects;
create policy "Owners update transect photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'transect-photos' and owner_id = auth.uid()::text
)
with check (
  bucket_id = 'transect-photos'
  and public.student_photo_storage_write_allowed(name, auth.uid())
);

-- Photo metadata must always remain attached to the owner's own transect and
-- to the canonical owner/record/file private path.
drop policy if exists "Owners insert their photo metadata" on public.photos;
create policy "Owners insert their photo metadata"
on public.photos for insert to authenticated
with check (
  owner_id = auth.uid()
  and split_part(storage_path, '/', 1) = auth.uid()::text
  and public.student_photo_storage_write_allowed(storage_path, auth.uid())
  and split_part(storage_path, '/', 2) = transect_id
);

drop policy if exists "Owners update their photo metadata" on public.photos;
create policy "Owners update their photo metadata"
on public.photos for update to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and split_part(storage_path, '/', 1) = auth.uid()::text
  and public.student_photo_storage_write_allowed(storage_path, auth.uid())
  and split_part(storage_path, '/', 2) = transect_id
);

alter table public.target_species_catalog enable row level security;
alter table public.instructor_record_state enable row level security;
alter table public.instructor_curations enable row level security;
alter table public.instructor_curation_revisions enable row level security;
alter table public.instructor_actions enable row level security;
alter table public.instructor_login_attempts enable row level security;
alter table public.instructor_purge_operations enable row level security;
alter table public.instructor_purge_tombstones enable row level security;

revoke all on table public.target_species_catalog from public, anon, authenticated;
revoke all on table public.instructor_record_state from public, anon, authenticated;
revoke all on table public.instructor_curations from public, anon, authenticated;
revoke all on table public.instructor_curation_revisions from public, anon, authenticated;
revoke all on table public.instructor_actions from public, anon, authenticated;
revoke all on table public.instructor_login_attempts from public, anon, authenticated;
revoke all on table public.instructor_purge_operations from public, anon, authenticated;
revoke all on table public.instructor_purge_tombstones from public, anon, authenticated;

-- Supabase projects may define permissive default privileges for service_role.
-- Reset them explicitly: the Edge Function reads tables and performs every
-- mutation through the audited SECURITY DEFINER RPCs below.
revoke all on table public.target_species_catalog from service_role;
revoke all on table public.instructor_record_state from service_role;
revoke all on table public.instructor_curations from service_role;
revoke all on table public.instructor_curation_revisions from service_role;
revoke all on table public.instructor_actions from service_role;
revoke all on table public.instructor_login_attempts from service_role;
revoke all on table public.instructor_purge_operations from service_role;
revoke all on table public.instructor_purge_tombstones from service_role;

-- The Edge Function may read these rows. Every mutation is routed through a
-- transactional SECURITY DEFINER RPC below; direct DML is intentionally absent.
grant select on table public.target_species_catalog,
  public.instructor_record_state, public.instructor_curations,
  public.instructor_curation_revisions, public.instructor_actions,
  public.instructor_purge_operations, public.instructor_purge_tombstones
to service_role;

revoke all on function public.instructor_curation_error(text, jsonb),
  public.instructor_record_action(uuid, text, text, text, text, jsonb),
  public.instructor_record_auth_attempt(text, text, text, boolean),
  public.instructor_record_auth_attempt(text, text, boolean),
  public.instructor_save_curation(text, jsonb, integer, integer, text, text, uuid),
  public.instructor_clear_curation(text, integer, integer, text, text, uuid),
  public.instructor_revert_curation(text, bigint, integer, integer, text, text, uuid),
  public.instructor_save_state(text, integer, text, boolean, text, text[], text, text, text, uuid),
  public.instructor_set_trash(text, integer, boolean, text, text, uuid),
  public.instructor_begin_purge(uuid, uuid, text, integer, integer, jsonb, text, integer, integer, jsonb, text, text),
  public.instructor_claim_purge(uuid, uuid),
  public.instructor_release_purge(uuid, uuid),
  public.instructor_fail_purge(uuid, uuid, text),
  public.instructor_finalize_purge(uuid, uuid),
  public.protect_transect_lifecycle(),
  public.protect_photo_lifecycle(),
  public.student_photo_storage_write_allowed(text, uuid)
from public, anon, authenticated;

grant execute on function public.instructor_curation_error(text, jsonb),
  public.instructor_record_action(uuid, text, text, text, text, jsonb),
  public.instructor_record_auth_attempt(text, text, text, boolean),
  public.instructor_record_auth_attempt(text, text, boolean),
  public.instructor_save_curation(text, jsonb, integer, integer, text, text, uuid),
  public.instructor_clear_curation(text, integer, integer, text, text, uuid),
  public.instructor_revert_curation(text, bigint, integer, integer, text, text, uuid),
  public.instructor_save_state(text, integer, text, boolean, text, text[], text, text, text, uuid),
  public.instructor_set_trash(text, integer, boolean, text, text, uuid),
  public.instructor_begin_purge(uuid, uuid, text, integer, integer, jsonb, text, integer, integer, jsonb, text, text),
  public.instructor_claim_purge(uuid, uuid),
  public.instructor_release_purge(uuid, uuid),
  public.instructor_fail_purge(uuid, uuid, text),
  public.instructor_finalize_purge(uuid, uuid)
to service_role;

-- This helper is safe for authenticated Storage-policy evaluation; it reveals
-- only whether the caller may write one path, never instructor state.
grant execute on function public.student_photo_storage_write_allowed(text, uuid)
to authenticated;

drop view if exists public.instructor_class_summaries;
drop view if exists public.instructor_record_summaries;
create view public.instructor_record_summaries
with (security_invoker = true)
as
with base as (
  select
    t.id as record_id,
    t.class_id,
    c.name as class_name,
    c.term as class_term,
    c.active as class_active,
    t.protocol_version,
    t.species_list_version,
    t.original_submitted_at,
    (t.original_submitted_at at time zone 'America/Los_Angeles')::date
      as submission_date_local,
    t.client_modified_at,
    t.server_created_at,
    t.server_updated_at,
    t.sync_state,
    t.submission_count,
    octet_length(t.payload::text)::bigint as original_payload_bytes,
    coalesce(octet_length(cur.curated_payload::text), 0)::bigint
      as curation_payload_bytes,
    t.payload as original_payload,
    case
      when cur.active and cur.source_submission_count = t.submission_count
        then cur.curated_payload
      else t.payload
    end as effective_payload,
    coalesce(cur.active, false) as has_curation,
    coalesce(cur.version, 0) as curation_version,
    coalesce(cur.active and cur.source_submission_count <> t.submission_count, false) as curation_stale,
    coalesce(state.review_status, 'unreviewed') as review_status,
    coalesce(state.excluded_from_analysis, false) as excluded_from_analysis,
    coalesce(state.test_data_status, 'auto') as test_data_status,
    coalesce(state.flags, array[]::text[]) as flags,
    coalesce(state.instructor_note, '') as instructor_note,
    coalesce(state.purge_pending, false) as purge_pending,
    coalesce(state.version, 0) as state_version,
    state.trashed_at,
    state.trashed_by,
    state.trash_reason,
    state.updated_at as state_updated_at
  from public.transects t
  join public.classes c on c.id = t.class_id
  left join public.instructor_curations cur on cur.transect_id = t.id
  left join public.instructor_record_state state on state.transect_id = t.id
), labeled as (
  select
    base.*,
    concat_ws(' ',
      effective_payload #>> '{metadata,site}',
      effective_payload #>> '{metadata,trail}',
      effective_payload #>> '{metadata,transectNumber}',
      effective_payload #>> '{metadata,observers}',
      effective_payload #>> '{metadata,generalNotes}',
      record_id
    ) as search_text,
    concat_ws(' ',
      effective_payload #>> '{metadata,site}',
      effective_payload #>> '{metadata,trail}',
      effective_payload #>> '{metadata,transectNumber}',
      effective_payload #>> '{metadata,observers}',
      effective_payload #>> '{metadata,generalNotes}',
      original_payload #>> '{metadata,site}',
      original_payload #>> '{metadata,trail}',
      original_payload #>> '{metadata,transectNumber}',
      original_payload #>> '{metadata,observers}',
      original_payload #>> '{metadata,generalNotes}',
      record_id
    ) ~* '(^|[^[:alnum:]])(TEST DATA|SYNTHETIC|TEST-)' as test_suggested
  from base
)
select
  labeled.record_id, labeled.class_id, labeled.class_name,
  labeled.class_term, labeled.class_active, labeled.protocol_version,
  labeled.species_list_version, labeled.original_submitted_at,
  labeled.submission_date_local,
  labeled.client_modified_at, labeled.server_created_at,
  labeled.server_updated_at, labeled.sync_state, labeled.submission_count,
  labeled.original_payload_bytes, labeled.curation_payload_bytes,
  labeled.effective_payload #>> '{metadata,site}' as site,
  labeled.effective_payload #>> '{metadata,trail}' as trail,
  labeled.effective_payload #>> '{metadata,transectNumber}' as transect_number,
  labeled.effective_payload #>> '{metadata,observers}' as observers,
  labeled.effective_payload #>> '{metadata,surveyDate}' as survey_date,
  labeled.effective_payload #> '{metadata,startGps}' as start_gps,
  labeled.effective_payload #> '{metadata,endGps}' as end_gps,
  public.is_valid_gps_point(labeled.effective_payload #> '{metadata,startGps}')
    or public.is_valid_gps_point(labeled.effective_payload #> '{metadata,endGps}')
    as has_gps,
  stats.completed_cells, stats.detected_cells,
  stats.surveyed_no_target_cells, stats.not_surveyed_cells,
  stats.incomplete_cells, stats.species_codes,
  cardinality(stats.species_codes) as species_count,
  stats.unknown_count,
  coalesce(photo_stats.photo_count, 0) as photo_count,
  coalesce(photo_stats.photo_bytes, 0) as photo_bytes,
  labeled.has_curation, labeled.curation_version, labeled.curation_stale,
  labeled.review_status, labeled.excluded_from_analysis,
  labeled.test_data_status, labeled.test_suggested,
  case labeled.test_data_status
    when 'test' then true
    when 'real' then false
    else labeled.test_suggested
  end as effective_is_test,
  labeled.flags, labeled.instructor_note, labeled.purge_pending,
  labeled.state_version, labeled.trashed_at, labeled.trashed_by,
  labeled.trash_reason, labeled.state_updated_at, labeled.search_text
from labeled
cross join lateral (
  select
    count(*) filter (where cell.value ->> 'status' <> 'incomplete')::integer as completed_cells,
    count(*) filter (where cell.value ->> 'status' = 'detected')::integer as detected_cells,
    count(*) filter (where cell.value ->> 'status' = 'surveyed_no_target')::integer as surveyed_no_target_cells,
    count(*) filter (where cell.value ->> 'status' = 'not_surveyed')::integer as not_surveyed_cells,
    count(*) filter (where cell.value ->> 'status' = 'incomplete')::integer as incomplete_cells,
    coalesce(array(
      select distinct species.value #>> '{}'
      from jsonb_array_elements(labeled.effective_payload -> 'segments') segment2
      cross join lateral jsonb_array_elements(segment2.value -> 'cells') cell2
      cross join lateral jsonb_array_elements(coalesce(cell2.value -> 'species', '[]'::jsonb)) species
      order by species.value #>> '{}'
    ), array[]::text[]) as species_codes,
    coalesce((
      select count(*)::integer
      from jsonb_array_elements(labeled.effective_payload -> 'segments') segment3
      cross join lateral jsonb_array_elements(segment3.value -> 'cells') cell3
      cross join lateral jsonb_array_elements(coalesce(cell3.value -> 'unknowns', '[]'::jsonb)) unknown_item
    ), 0) as unknown_count
  from jsonb_array_elements(labeled.effective_payload -> 'segments') segment
  cross join lateral jsonb_array_elements(segment.value -> 'cells') cell
) stats
left join lateral (
  select count(*)::integer as photo_count,
         coalesce(sum(size_bytes), 0)::bigint as photo_bytes
  from public.photos
  where photos.transect_id = labeled.record_id
) photo_stats on true;

revoke all on public.instructor_record_summaries from public, anon, authenticated;
grant select on public.instructor_record_summaries to service_role;

-- Class counts are calculated server-side so bootstrap never performs an N+1
-- query and a class with no records correctly reports three zero counts.
create view public.instructor_class_summaries
with (security_invoker = true)
as
select
  classes.id,
  classes.name,
  classes.term,
  classes.active,
  classes.created_at,
  classes.updated_at,
  count(records.record_id)::integer as record_count,
  count(records.record_id) filter (where records.trashed_at is null)::integer
    as active_record_count,
  count(records.record_id) filter (where records.trashed_at is not null)::integer
    as trashed_record_count,
  max(records.server_updated_at) as last_submission_at
from public.classes classes
left join public.instructor_record_summaries records
  on records.class_id = classes.id
group by classes.id, classes.name, classes.term, classes.active,
  classes.created_at, classes.updated_at;

revoke all on public.instructor_class_summaries from public, anon, authenticated;
grant select on public.instructor_class_summaries to service_role;

comment on table public.instructor_curations is
  'Non-destructive instructor overlay; original student payloads remain in public.transects.';
comment on table public.instructor_record_state is
  'Instructor review, analysis inclusion, test-data, and reversible trash state.';
comment on table public.instructor_actions is
  'Append-only audit events; never stores passwords, tokens, or full payloads.';
comment on table public.instructor_purge_operations is
  'Retryable ledger bridging private Storage deletion and transactional database deletion.';

commit;
