-- Existing-project migration. Run only AFTER the cutoff-scoped cleanup script.
-- It does not alter classes, memberships, auth users, policies, or secrets.

begin;

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
begin
  if (p_payload ->> 'protocolVersion') is distinct from '2.0.0'
     or (p_payload ->> 'schemaVersion')::integer is distinct from 2
     or (p_payload ->> 'entryMethod') is distinct from 'digital_field'
     or jsonb_typeof(p_payload -> 'segments') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'segments') is distinct from 30 then
    return false;
  end if;

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
              or (value #>> '{}') !~ '^[A-Z0-9_-]{2,10}$'
              or (value #>> '{}') = 'UNKNOWN'
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

alter table public.transects drop constraint if exists transects_entry_method_check;
alter table public.transects add constraint transects_entry_method_check check (entry_method = 'digital_field') not valid;

alter table public.transects drop constraint if exists transects_protocol_version_check;
alter table public.transects add constraint transects_protocol_version_check check (protocol_version = '2.0.0') not valid;

alter table public.transects drop constraint if exists transects_current_payload_check;
alter table public.transects add constraint transects_current_payload_check check (public.is_protocol_v2_payload(payload)) not valid;

alter table public.photos drop constraint if exists photos_band_start_m_check;
alter table public.photos add constraint photos_band_start_m_check check (band_start_m between 0 and 2) not valid;

-- NOT VALID still enforces every future insert/update. It also lets this migration
-- protect the backend if an incompatible record created after the authorized
-- cleanup cutoff exists. Validate automatically when no incompatible rows remain.
do $$
begin
  if not exists (
    select 1 from public.transects
    where entry_method <> 'digital_field'
       or protocol_version <> '2.0.0'
       or not public.is_protocol_v2_payload(payload)
  ) then
    alter table public.transects validate constraint transects_entry_method_check;
    alter table public.transects validate constraint transects_protocol_version_check;
    alter table public.transects validate constraint transects_current_payload_check;
  end if;
  if not exists (select 1 from public.photos where band_start_m is not null and band_start_m not between 0 and 2) then
    alter table public.photos validate constraint photos_band_start_m_check;
  end if;
end;
$$;

drop view if exists public.analysis_export_long;

create view public.analysis_export_long
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

commit;
