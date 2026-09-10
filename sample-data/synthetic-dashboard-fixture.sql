-- SYNTHETIC/TEST DATA ONLY — Instructor dashboard fixture for app v2.1.2.
-- Prerequisite: apply schema.sql or the v2.1 instructor-dashboard migration.
-- This script never creates Auth users and never inserts a photo metadata row
-- unless the exact private Storage object already exists.

begin;

create or replace function pg_temp.synthetic_test_cells(
  p_segment integer,
  p_variant text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_side text;
  v_band integer;
  v_status text;
  v_species jsonb;
  v_unknowns jsonb;
  v_note text;
  v_cells jsonb := '[]'::jsonb;
begin
  foreach v_side in array array['left', 'right']::text[] loop
    for v_band in 0..2 loop
      v_status := 'surveyed_no_target';
      v_species := '[]'::jsonb;
      v_unknowns := '[]'::jsonb;
      v_note := '';

      if p_variant = 'complete_line' then
        if p_segment = 2 and v_side = 'left' and v_band = 0 then
          v_status := 'detected';
          v_species := '["SATR12"]'::jsonb;
          v_note := 'Synthetic single-species detection.';
        elsif p_segment = 2 and v_side = 'left' and v_band = 1 then
          v_status := 'detected';
          v_species := '["COMA2", "CANU4"]'::jsonb;
          v_note := 'Synthetic multiple-species cell.';
        elsif p_segment = 17 and v_side = 'right' and v_band = 2 then
          v_status := 'detected';
          v_unknowns := '[{"id":"unknown_test_sql_01","note":"Synthetic unknown observation."}]'::jsonb;
          v_note := 'Unknown included intentionally for dashboard testing.';
        end if;
      elsif p_variant = 'incomplete_point' then
        if p_segment < 8 then
          v_status := 'surveyed_no_target';
        elsif p_segment = 8 and v_side = 'left' and v_band = 0 then
          v_status := 'detected';
          v_species := '["BRTE"]'::jsonb;
          v_note := 'Synthetic detection before survey interruption.';
        elsif p_segment = 8 and v_side = 'right' and v_band = 2 then
          v_status := 'not_surveyed';
          v_note := 'Synthetic safety exclusion.';
        else
          v_status := 'incomplete';
        end if;
      elsif p_variant = 'edited_initial' then
        if p_segment = 5 and v_side = 'left' and v_band = 0 then
          v_status := 'detected';
          v_species := '["POBU"]'::jsonb;
        elsif p_segment = 12 and v_side = 'right' and v_band = 2 then
          v_status := 'detected';
          v_species := '["AIAL"]'::jsonb;
        end if;
      elsif p_variant in ('edited_current', 'curated_draft', 'curated_final') then
        if p_segment = 5 and v_side = 'left' and v_band = 0 then
          v_status := 'detected';
          v_species := '["POBU"]'::jsonb;
        elsif p_segment = 12 and v_side = 'right' and v_band = 2 then
          v_status := 'detected';
          v_species := '["AIAL"]'::jsonb;
        elsif p_segment = 21 and v_side = 'left' and v_band = 1 then
          v_status := 'detected';
          v_species := '["CHTE2"]'::jsonb;
          v_note := 'Synthetic detection added in student revision.';
        end if;
      elsif p_variant = 'trashed_end_point' then
        v_status := 'not_surveyed';
        if p_segment = 1 and v_side = 'left' and v_band = 0 then
          v_status := 'detected';
          v_species := '["CESO3"]'::jsonb;
          v_note := 'Synthetic detection retained in a trashed record.';
        end if;
      else
        raise exception 'Unknown synthetic fixture variant: %', p_variant;
      end if;

      v_cells := v_cells || jsonb_build_array(jsonb_build_object(
        'id', concat('s', p_segment, '_', v_side, '_', v_band),
        'side', v_side,
        'bandStart', v_band,
        'bandEnd', v_band + 1,
        'status', v_status,
        'species', v_species,
        'unknowns', v_unknowns,
        'note', v_note
      ));
    end loop;
  end loop;
  return v_cells;
end;
$$;

create or replace function pg_temp.synthetic_test_payload(
  p_record_id text,
  p_variant text,
  p_revision integer,
  p_photos jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_segment integer;
  v_segments jsonb := '[]'::jsonb;
  v_site text;
  v_trail text;
  v_number text;
  v_observers text;
  v_survey_date text;
  v_start_time text;
  v_end_time text;
  v_notes text;
  v_start_gps jsonb := 'null'::jsonb;
  v_end_gps jsonb := 'null'::jsonb;
  v_created_at text;
  v_modified_at text;
  v_original_submitted_at text;
begin
  for v_segment in 0..29 loop
    v_segments := v_segments || jsonb_build_array(jsonb_build_object(
      'index', v_segment,
      'startM', v_segment,
      'endM', v_segment + 1,
      'label', concat(v_segment, '-', v_segment + 1, ' m'),
      'note', case when v_segment = 10 then 'Synthetic segment note.' else '' end,
      'cells', pg_temp.synthetic_test_cells(v_segment, p_variant)
    ));
  end loop;

  if p_variant = 'complete_line' then
    v_site := 'TEST DATA — Complete Line';
    v_trail := 'Synthetic Null Island Trail A';
    v_number := 'TEST-001';
    v_observers := 'TEST OBSERVER ALPHA';
    v_survey_date := '2026-08-01';
    v_start_time := '14:00';
    v_end_time := '14:31';
    v_start_gps := '{"latitude":0.001,"longitude":0.001,"accuracy":8,"timestamp":"2026-08-01T14:00:00.000Z"}'::jsonb;
    v_end_gps := '{"latitude":0.0013,"longitude":0.0015,"accuracy":10,"timestamp":"2026-08-01T14:31:00.000Z"}'::jsonb;
    v_created_at := '2026-08-01T13:58:00.000Z';
    v_modified_at := '2026-08-01T14:32:00.000Z';
    v_original_submitted_at := '2026-08-01T14:32:00.000Z';
  elsif p_variant = 'incomplete_point' then
    v_site := 'TEST DATA — Incomplete Point';
    v_trail := 'Synthetic Null Island Trail B';
    v_number := 'TEST-002';
    v_observers := 'TEST OBSERVER BETA';
    v_survey_date := '2026-08-05';
    v_start_time := '15:10';
    v_end_time := '';
    v_start_gps := '{"latitude":0.0018,"longitude":0.002,"accuracy":18,"timestamp":"2026-08-05T15:10:00.000Z"}'::jsonb;
    v_created_at := '2026-08-05T15:08:00.000Z';
    v_modified_at := '2026-08-05T15:25:00.000Z';
    v_original_submitted_at := '2026-08-05T15:25:00.000Z';
  elsif p_variant = 'edited_initial' then
    v_site := 'TEST DATA — Edit Before';
    v_trail := 'Synthetic Revision Trail';
    v_number := 'TEST-003';
    v_observers := 'TEST OBSERVER GAMMA';
    v_survey_date := '2026-08-09';
    v_start_time := '16:00';
    v_end_time := '16:34';
    v_created_at := '2026-08-09T15:58:00.000Z';
    v_modified_at := '2026-08-09T16:35:00.000Z';
    v_original_submitted_at := '2026-08-09T16:35:00.000Z';
  elsif p_variant in ('edited_current', 'curated_draft', 'curated_final') then
    v_site := 'TEST DATA — Edited and Curated';
    v_trail := case
      when p_variant = 'curated_draft' then 'Synthetic Curated Trail Draft'
      when p_variant = 'curated_final' then 'Synthetic Curated Trail Final'
      else 'Synthetic Revision Trail'
    end;
    v_number := 'TEST-003';
    v_observers := 'TEST OBSERVER GAMMA';
    v_survey_date := '2026-08-09';
    v_start_time := '16:00';
    v_end_time := '16:39';
    v_created_at := '2026-08-09T15:58:00.000Z';
    v_modified_at := '2026-08-10T12:00:00.000Z';
    v_original_submitted_at := '2026-08-09T16:35:00.000Z';
  elsif p_variant = 'trashed_end_point' then
    v_site := 'TEST DATA — Trashed End Point';
    v_trail := 'Synthetic Retired Trail';
    v_number := 'TEST-004';
    v_observers := 'TEST OBSERVER DELTA';
    v_survey_date := '2026-08-12';
    v_start_time := '';
    v_end_time := '17:20';
    v_end_gps := '{"latitude":0.0025,"longitude":0.0028,"accuracy":22,"timestamp":"2026-08-12T17:20:00.000Z"}'::jsonb;
    v_created_at := '2026-08-12T16:45:00.000Z';
    v_modified_at := '2026-08-12T17:22:00.000Z';
    v_original_submitted_at := '2026-08-12T17:22:00.000Z';
  else
    raise exception 'Unknown synthetic fixture variant: %', p_variant;
  end if;

  v_notes := case
    when p_variant = 'curated_draft' then 'SYNTHETIC TEST DATA. Draft instructor correction; not a real survey.'
    when p_variant = 'curated_final' then 'SYNTHETIC TEST DATA. Final instructor correction; not a real survey.'
    else 'SYNTHETIC TEST DATA. Not a real survey, person, or location. Safe to delete.'
  end;

  return jsonb_build_object(
    'id', p_record_id,
    'schemaVersion', 2,
    'protocolVersion', '2.0.0',
    'speciesListVersion', 'reno-2026.1',
    'appVersion', '2.1.2',
    'entryMethod', 'digital_field',
    'metadata', jsonb_build_object(
      'observers', v_observers,
      'surveyDate', v_survey_date,
      'site', v_site,
      'trail', v_trail,
      'transectNumber', v_number,
      'startTime', v_start_time,
      'endTime', v_end_time,
      'generalNotes', v_notes,
      'startGps', v_start_gps,
      'endGps', v_end_gps
    ),
    'segments', v_segments,
    'photos', coalesce(p_photos, '[]'::jsonb),
    'createdAt', v_created_at,
    'modifiedAt', v_modified_at,
    'originalSubmittedAt', v_original_submitted_at,
    'lastSubmittedAt', v_modified_at,
    'revisionNumber', p_revision
  );
end;
$$;

do $$
declare
  v_owner_id uuid;
  v_active_class_id constant uuid := '11111111-1111-4111-8111-111111111101';
  v_inactive_class_id constant uuid := '11111111-1111-4111-8111-111111111102';
  v_record_ids constant text[] := array[
    'transect_test_complete_line',
    'transect_test_incomplete_point',
    'transect_test_edited_no_gps',
    'transect_test_trashed_end_point'
  ];
  v_photo_path text;
  v_photo_bytes bigint := 0;
  v_complete_photos jsonb := '[]'::jsonb;
  v_pending_photo jsonb;
  v_curated_payload jsonb;
begin
  if to_regclass('public.instructor_record_state') is null
     or to_regclass('public.instructor_curations') is null then
    raise exception 'Apply the v2.1 instructor-dashboard migration before loading this fixture.';
  end if;

  select id into v_owner_id
  from auth.users
  order by created_at desc
  limit 1;
  if v_owner_id is null then
    raise exception 'No Auth user exists. Open the student app and join a class once, then rerun this fixture.';
  end if;

  v_photo_path := concat(v_owner_id, '/transect_test_complete_line/photo_test_fixture_marker.png');
  select coalesce(nullif(metadata ->> 'size', '')::bigint, 0)
  into v_photo_bytes
  from storage.objects
  where bucket_id = 'transect-photos' and name = v_photo_path;

  if found then
    v_complete_photos := jsonb_build_array(jsonb_build_object(
      'id', 'photo_test_fixture_marker',
      'blobId', 'blob_test_fixture_marker',
      'scope', 'meter',
      'segmentIndex', 2,
      'side', null,
      'bandStart', null,
      'speciesCode', null,
      'unknownId', null,
      'note', 'SYNTHETIC TEST IMAGE — not a field photograph.',
      'capturedAt', '2026-08-01T14:04:00.000Z',
      'mimeType', 'image/png',
      'remotePath', v_photo_path,
      'syncStatus', 'submitted'
    ));
  else
    raise notice 'Optional test photo not found at %. Fixture will not create its photo metadata row.', v_photo_path;
  end if;

  v_pending_photo := jsonb_build_array(jsonb_build_object(
    'id', 'photo_test_pending_upload',
    'blobId', 'blob_test_pending_upload',
    'scope', 'cell',
    'segmentIndex', 8,
    'side', 'left',
    'bandStart', 0,
    'speciesCode', 'BRTE',
    'unknownId', null,
    'note', 'SYNTHETIC pending-photo state; no remote object is expected.',
    'capturedAt', '2026-08-05T15:20:00.000Z',
    'mimeType', 'image/png',
    'syncStatus', 'submission_failed',
    'lastError', 'SYNTHETIC interrupted upload'
  ));

  -- Make reruns deterministic. Only the four exact TEST IDs and two exact
  -- TEST classes are removed; no wildcard or production-row deletion occurs.
  delete from public.instructor_purge_tombstones where record_id = any(v_record_ids);
  delete from public.instructor_purge_operations where record_id = any(v_record_ids);
  delete from public.instructor_actions where record_id = any(v_record_ids);
  delete from public.instructor_curation_revisions where transect_id = any(v_record_ids);
  delete from public.instructor_curations where transect_id = any(v_record_ids);
  delete from public.instructor_record_state where transect_id = any(v_record_ids);
  delete from public.photos where transect_id = any(v_record_ids);
  delete from public.transect_revisions where transect_id = any(v_record_ids);
  delete from public.transects where id = any(v_record_ids);
  delete from public.class_members where class_id in (v_active_class_id, v_inactive_class_id);
  delete from public.classes where id in (v_active_class_id, v_inactive_class_id);

  insert into public.classes (id, name, term, access_code_hash, active, created_at, updated_at)
  values
    (
      v_active_class_id,
      'TEST DATA — Synthetic Dashboard Active',
      'Synthetic QA 2026',
      extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 11)),
      true,
      '2026-07-30T12:00:00Z',
      '2026-08-12T12:00:00Z'
    ),
    (
      v_inactive_class_id,
      'TEST DATA — Synthetic Dashboard Inactive',
      'Synthetic QA Archive',
      extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 11)),
      false,
      '2026-07-30T12:00:00Z',
      '2026-08-13T12:00:00Z'
    );

  insert into public.class_members (class_id, user_id, joined_at, last_seen_at)
  values
    (v_active_class_id, v_owner_id, '2026-07-30T12:05:00Z', '2026-08-12T12:00:00Z'),
    (v_inactive_class_id, v_owner_id, '2026-07-30T12:05:00Z', '2026-08-12T12:00:00Z');

  insert into public.transects (
    id, class_id, owner_id, payload, entry_method, protocol_version,
    species_list_version, original_submitted_at, client_modified_at,
    server_created_at, server_updated_at, sync_state, submission_count
  ) values
    (
      'transect_test_complete_line', v_active_class_id, v_owner_id,
      pg_temp.synthetic_test_payload('transect_test_complete_line', 'complete_line', 0, v_complete_photos),
      'digital_field', '2.0.0', 'reno-2026.1',
      '2026-08-01T14:32:00Z', '2026-08-01T14:32:00Z',
      '2026-08-01T14:32:05Z', '2026-08-01T14:32:05Z', 'submitted', 1
    ),
    (
      'transect_test_incomplete_point', v_active_class_id, v_owner_id,
      pg_temp.synthetic_test_payload('transect_test_incomplete_point', 'incomplete_point', 0, v_pending_photo),
      'digital_field', '2.0.0', 'reno-2026.1',
      '2026-08-05T15:25:00Z', '2026-08-05T15:25:00Z',
      '2026-08-05T15:25:05Z', '2026-08-05T15:25:05Z', 'upload_partially_complete', 1
    ),
    (
      'transect_test_edited_no_gps', v_active_class_id, v_owner_id,
      pg_temp.synthetic_test_payload('transect_test_edited_no_gps', 'edited_initial', 0, '[]'::jsonb),
      'digital_field', '2.0.0', 'reno-2026.1',
      '2026-08-09T16:35:00Z', '2026-08-09T16:35:00Z',
      '2026-08-09T16:35:05Z', '2026-08-09T16:35:05Z', 'submitted', 1
    ),
    (
      'transect_test_trashed_end_point', v_inactive_class_id, v_owner_id,
      pg_temp.synthetic_test_payload('transect_test_trashed_end_point', 'trashed_end_point', 0, '[]'::jsonb),
      'digital_field', '2.0.0', 'reno-2026.1',
      '2026-08-12T17:22:00Z', '2026-08-12T17:22:00Z',
      '2026-08-12T17:22:05Z', '2026-08-12T17:22:05Z', 'submitted', 1
    );

  -- A normal student edit: the production trigger archives revision 1 and
  -- increments submission_count to 2 without overwriting the original row.
  update public.transects
  set payload = pg_temp.synthetic_test_payload(
        'transect_test_edited_no_gps', 'edited_current', 1, '[]'::jsonb
      ),
      client_modified_at = '2026-08-10T12:00:00Z'
  where id = 'transect_test_edited_no_gps';

  if jsonb_array_length(v_complete_photos) = 1 then
    insert into public.photos (
      id, transect_id, owner_id, storage_path, scope, segment_index,
      side, band_start_m, species_code, unknown_id, note, captured_at,
      mime_type, size_bytes, uploaded_at
    ) values (
      'photo_test_fixture_marker', 'transect_test_complete_line', v_owner_id,
      v_photo_path, 'meter', 2, null, null, null, null,
      'SYNTHETIC TEST IMAGE — not a field photograph.',
      '2026-08-01T14:04:00Z', 'image/png', v_photo_bytes, '2026-08-01T14:32:04Z'
    );
  end if;

  -- Use the same transactional RPCs as the Edge Function. Each deterministic
  -- request UUID also exercises the dashboard's idempotent audit contract.
  perform public.instructor_save_state(
    'transect_test_complete_line', 0, 'accepted', false, 'test',
    array['synthetic', 'map-line'], 'TEST fixture: complete record.',
    'Synthetic Fixture', 'Synthetic fixture load.',
    '22222222-2222-4222-8222-222222222201'::uuid
  );
  perform public.instructor_save_state(
    'transect_test_incomplete_point', 0, 'needs_follow_up', true, 'auto',
    array['synthetic', 'incomplete', 'partial-upload'],
    'TEST fixture: intentionally incomplete and excluded.',
    'Synthetic Fixture', 'Synthetic fixture load.',
    '22222222-2222-4222-8222-222222222202'::uuid
  );
  perform public.instructor_save_state(
    'transect_test_edited_no_gps', 0, 'reviewed', false, 'test',
    array['synthetic', 'revision', 'curation', 'missing-gps'],
    'TEST fixture: student revision plus instructor curation.',
    'Synthetic Fixture', 'Synthetic fixture load.',
    '22222222-2222-4222-8222-222222222203'::uuid
  );
  perform public.instructor_save_state(
    'transect_test_trashed_end_point', 0, 'questionable', true, 'test',
    array['synthetic', 'trash', 'map-point'],
    'TEST fixture: reversible trash scenario.',
    'Synthetic Fixture', 'Synthetic fixture load.',
    '22222222-2222-4222-8222-222222222204'::uuid
  );
  perform public.instructor_set_trash(
    'transect_test_trashed_end_point', 1, true, 'Synthetic Fixture',
    'Synthetic trash workflow test.',
    '22222222-2222-4222-8222-222222222205'::uuid
  );

  -- Two saved overlay versions exercise curation history while retaining the
  -- untouched current and archived student submissions.
  perform public.instructor_save_curation(
    'transect_test_edited_no_gps',
    pg_temp.synthetic_test_payload('transect_test_edited_no_gps', 'curated_draft', 1, '[]'::jsonb),
    2, 0, 'Synthetic Fixture', 'Synthetic first curation version.',
    '22222222-2222-4222-8222-222222222206'::uuid
  );
  v_curated_payload := pg_temp.synthetic_test_payload(
    'transect_test_edited_no_gps', 'curated_final', 1, '[]'::jsonb
  );
  perform public.instructor_save_curation(
    'transect_test_edited_no_gps', v_curated_payload,
    2, 1, 'Synthetic Fixture', 'Synthetic corrected trail label.',
    '22222222-2222-4222-8222-222222222207'::uuid
  );

  raise notice 'Loaded 4 synthetic transects using Auth owner %.', v_owner_id;
  raise notice 'Optional Storage path: %', v_photo_path;
end;
$$;

commit;

-- The results below are a post-load verification, not additional mutations.
select
  class_name,
  class_term,
  class_active,
  count(*) as test_record_count,
  count(*) filter (where trashed_at is not null) as trashed_count,
  count(*) filter (where incomplete_cells > 0) as incomplete_count,
  count(*) filter (where photo_count > 0) as stored_photo_count
from public.instructor_record_summaries
where record_id = any(array[
  'transect_test_complete_line',
  'transect_test_incomplete_point',
  'transect_test_edited_no_gps',
  'transect_test_trashed_end_point'
])
group by class_name, class_term, class_active
order by class_active desc, class_name;

select
  record_id,
  submission_count,
  completed_cells,
  incomplete_cells,
  sync_state,
  has_curation,
  curation_version,
  test_data_status,
  effective_is_test,
  trashed_at is not null as is_trashed,
  photo_count
from public.instructor_record_summaries
where record_id = any(array[
  'transect_test_complete_line',
  'transect_test_incomplete_point',
  'transect_test_edited_no_gps',
  'transect_test_trashed_end_point'
])
order by record_id;
