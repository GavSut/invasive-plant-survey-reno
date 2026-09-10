# Synthetic instructor-dashboard test data

Everything in this folder is **SYNTHETIC TEST DATA**. Observer labels are fictitious, the GPS values are invented near Null Island, and the records must not be used for ecological analysis.

## Files

| File | Purpose |
|---|---|
| `synthetic-dashboard-fixture.sql` | Loads four deterministic protocol-v2 records into Supabase, including dashboard review, curation, revision, trash, mapping, and incomplete-data states |
| `synthetic-dashboard-cleanup.sql` | Removes only those four records and the two fixed test classes |
| `synthetic-phone-import-backup.json` | Restorable app backup for testing **Class & backup → Import a restorable JSON backup** |
| `synthetic-dashboard-locations.geojson` | Export-reference GeoJSON containing the three records with GPS (one line and two points); the no-GPS fixture is intentionally absent |
| `synthetic-photo.png` | Optional visibly synthetic PNG for testing private photo display |
| `generate-fixtures.mjs` | Rebuilds and protocol-validates the JSON backup, GeoJSON, and PNG |

The current student app imports its own backup JSON format, not GeoJSON. Use `synthetic-phone-import-backup.json` for an app import. The GeoJSON is for validating exports or opening in GIS software; the instructor dashboard reads Supabase records directly. Its omission of `transect_test_edited_no_gps` is the expected export behavior—records without a recorded endpoint do not produce a feature.

## Load the dashboard fixture in Supabase

Prerequisites:

1. For a brand-new empty project only, apply `backend/supabase/schema.sql`. For the existing Reno project, apply only the dated v2.1 instructor-dashboard migration; never rerun the full schema over the working database.
2. Confirm at least one Supabase Auth user exists. Opening the student app and successfully joining a class once creates an anonymous Auth user. The fixture reuses the newest Auth user only as the required foreign-key owner; it does not change or delete that Auth user.

Then:

1. Open **Supabase → SQL Editor → New query**.
2. Paste the full contents of `synthetic-dashboard-fixture.sql`.
3. Click **Run**.
4. Confirm the final result contains four records and that every record has `effective_is_test = true`.
5. Sign in to `instructor.html`, include inactive classes, and choose either class whose name starts with `TEST DATA — Synthetic Dashboard`.

The two test class passwords are generated randomly and discarded by the script. They cannot be used for student enrollment. The test records are visible only through the protected instructor path or to the one existing Auth owner under the unchanged student RLS policies.

### Expected scenarios

| Record ID | Expected dashboard behavior |
|---|---|
| `transect_test_complete_line` | 180/180 complete, three detected cells, multiple species and an unknown, start/end GPS LineString, accepted, explicit test label |
| `transect_test_incomplete_point` | 50/180 complete, 130 incomplete, start-GPS point only, partial-upload state, needs follow-up, excluded, automatic test suggestion |
| `transect_test_edited_no_gps` | 180/180 complete, student submission count 2 with archived revision 1, two instructor-curation versions, no GPS |
| `transect_test_trashed_end_point` | Reversibly trashed, inactive class, end-GPS point only, excluded, explicit test label |

All sites, trails, observers, notes, and identifiers contain `TEST` or `SYNTHETIC` markers.

## Optional private-photo test

The SQL deliberately refuses to create a `public.photos` metadata row unless its exact Storage object already exists. This prevents a broken dashboard photo that points at a nonexistent object.

To exercise signed photo viewing:

1. Before running the fixture, find the Auth owner it will use:

   ```sql
   select id
   from auth.users
   order by created_at desc
   limit 1;
   ```

2. In **Storage → transect-photos**, upload `synthetic-photo.png` at this exact private path, renaming the file as shown:

   ```text
   OWNER_UUID/transect_test_complete_line/photo_test_fixture_marker.png
   ```

3. Run `synthetic-dashboard-fixture.sql` once. Its result should show `photo_count = 1` for `transect_test_complete_line`.

If the object is absent, the SQL prints a notice and safely omits the metadata row. The incomplete record still contains a deliberately failed local-photo descriptor in its original payload, but there is no server photo metadata and no remote object is claimed for that descriptor. This models an interrupted upload without creating a dangling Storage reference.

## Test app import and upload

1. Open the student site online.
2. Open **Class & backup**.
3. Choose **Import a restorable JSON backup** and select `synthetic-phone-import-backup.json`.
4. Open the imported draft. It has a line-shaped synthetic GPS pair, detections, a multiple-species cell, an unknown, an `NS` cell, and 36 deliberately incomplete cells.
5. Join the intended test class and submit only if you want a server record with ID `transect_test_phone_import_v210`.

The imported draft is not included in the SQL cleanup because it is uploaded through the ordinary student workflow and may belong to a different class. Delete it through the dashboard trash/purge workflow, or discard it locally if it was never submitted.

## Remove the SQL fixture

1. First discard any phone-local or queued `transect_test_*` records. If `transect_test_phone_import_v210` was submitted, remove it through the dashboard trash/purge workflow; the fixed SQL cleanup intentionally does not target it.
2. If the optional image was uploaded, delete only the exact `OWNER_UUID/transect_test_complete_line/photo_test_fixture_marker.png` object in **Storage → transect-photos**. Do not delete rows directly from `storage.objects`.
3. Run `synthetic-dashboard-cleanup.sql` in the SQL Editor. It deliberately aborts if that exact Storage object still exists, preserving the photo metadata until physical deletion succeeds.
4. Confirm the cleanup query reports zero remaining fixed test classes. It does not delete any Auth user.

The cleanup targets exact deterministic IDs—never a broad class, date range, owner, or production naming pattern. If a fixture record was permanently purged through the dashboard, the cleanup also removes only that fixture ID's purge ledger/tombstone so the test can be loaded again. Removing those tombstones is safe only after local/queued fixture copies have been discarded; otherwise a cached test client could recreate a fixed test ID.

## Rebuild and validate generated files

From the project root:

```bash
node sample-data/generate-fixtures.mjs
```

The generator stops with an error if the app-import record no longer passes the protocol-v2 validator and the current 23-code species catalog.
