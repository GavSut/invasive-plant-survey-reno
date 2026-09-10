-- Remove only the deterministic SYNTHETIC/TEST dashboard fixture rows.
-- This intentionally does not delete Auth users or any non-fixture record.
-- Private Storage objects must be deleted through Supabase Storage so their
-- physical object and metadata stay consistent.

begin;

do $$
declare
  v_active_class_id constant uuid := '11111111-1111-4111-8111-111111111101';
  v_inactive_class_id constant uuid := '11111111-1111-4111-8111-111111111102';
  v_record_ids constant text[] := array[
    'transect_test_complete_line',
    'transect_test_incomplete_point',
    'transect_test_edited_no_gps',
    'transect_test_trashed_end_point'
  ];
  v_storage_path text;
  v_photo_metadata_exists boolean;
begin
  select string_agg(name, E'\n' order by name) into v_storage_path
  from storage.objects
  where bucket_id = 'transect-photos'
    and split_part(name, '/', 2) = 'transect_test_complete_line'
    and split_part(name, '/', 3) = 'photo_test_fixture_marker.png'
    and split_part(name, '/', 4) = '';

  if v_storage_path is not null then
    raise exception 'Cleanup stopped safely. Delete the following exact object(s) through Storage > transect-photos, then rerun this script: %', v_storage_path;
  end if;

  select exists (
    select 1 from public.photos
    where id = 'photo_test_fixture_marker'
      and transect_id = 'transect_test_complete_line'
  ) into v_photo_metadata_exists;

  if v_photo_metadata_exists then
    raise notice 'The optional Storage object is absent; its fixture photo metadata can now be removed.';
  else
    raise notice 'No synthetic photo metadata row exists; no fixture Storage object was linked.';
  end if;

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

  raise notice 'Synthetic dashboard fixture rows removed. Auth users were not changed.';
end;
$$;

commit;

select
  (select count(*) from public.transects where id = any(array[
    'transect_test_complete_line',
    'transect_test_incomplete_point',
    'transect_test_edited_no_gps',
    'transect_test_trashed_end_point'
  ])) as remaining_fixed_fixture_transects,
  (select count(*) from public.classes where id in (
    '11111111-1111-4111-8111-111111111101'::uuid,
    '11111111-1111-4111-8111-111111111102'::uuid
  )) as remaining_test_classes;
