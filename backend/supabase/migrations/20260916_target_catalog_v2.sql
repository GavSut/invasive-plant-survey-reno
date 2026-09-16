-- Add the two instructor-requested targets without changing stored surveys.
-- Run after 20260910_instructor_dashboard_v2_1.sql, before publishing the frontend.
-- Existing record catalog stamps are preserved. Both creation catalog versions
-- accept the additive codes, so older drafts/submissions can record these taxa.
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
  v_gps jsonb;
  v_target_codes constant text[] := array[
    'SATR12', 'COMA2', 'CANU4', 'CESO3', 'CEDI3', 'CIIN', 'CIVU', 'CIAR4',
    'ONAC', 'CHTE2', 'LELA2', 'LEDR', 'ELAN', 'AECY', 'BRTE', 'POBU',
    'TACA8', 'CETE5', 'VETH', 'AIAL', 'TAMAR2', 'ULPU', 'TRTE', 'ERCI6', 'LEPE2'
  ];
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 2000000
     or jsonb_typeof(p_payload -> 'metadata') is distinct from 'object'
     or (p_payload ->> 'protocolVersion') is distinct from '2.0.0'
     or (p_payload ->> 'schemaVersion')::integer is distinct from 2
     or (p_payload ->> 'entryMethod') is distinct from 'digital_field'
     or coalesce(p_payload ->> 'speciesListVersion', '') not in ('reno-2026.1', 'reno-2026.2')
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

-- Copy the existing canonical targets into the new creation catalog.
insert into public.target_species_catalog (species_list_version, code, common_name, scientific_name)
select 'reno-2026.2', code, common_name, scientific_name
from public.target_species_catalog
where species_list_version = 'reno-2026.1'
on conflict (species_list_version, code) do nothing;

insert into public.target_species_catalog (species_list_version, code, common_name, scientific_name)
select versions.version, additions.code, additions.common_name, additions.scientific_name
from (values ('reno-2026.1'), ('reno-2026.2')) as versions(version)
cross join (values
  ('ERCI6', 'Redstem stork''s bill', 'Erodium cicutarium'),
  ('LEPE2', 'Clasping pepperweed', 'Lepidium perfoliatum')
) as additions(code, common_name, scientific_name)
on conflict (species_list_version, code) do update
set common_name = excluded.common_name, scientific_name = excluded.scientific_name;

-- Abort the transaction if either catalog is incomplete. No survey rows change.
do $$
begin
  if (select count(*) from public.target_species_catalog where species_list_version = 'reno-2026.1') <> 25
     or (select count(*) from public.target_species_catalog where species_list_version = 'reno-2026.2') <> 25 then
    raise exception 'Catalog update expected 25 codes in each supported catalog. Check that the instructor-dashboard migration was applied first.';
  end if;
end;
$$;

commit;

select species_list_version, count(*) as accepted_species
from public.target_species_catalog
where species_list_version in ('reno-2026.1', 'reno-2026.2')
group by species_list_version
order by species_list_version;
