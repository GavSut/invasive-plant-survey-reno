# Testing and validation report

## Automated checks

The repository includes dependency-free Node tests for protocol logic and a project validator. The final build process runs both and records the actual result here.

### Delivery run - 2026-09-07 UTC

- Protocol suite: **8 passed, 0 failed**.
- Project validator: **passed** all required-file, JavaScript syntax, species-list, sample-CSV, backend-safeguard, and DOCX-container checks.
- Sample CSV: **8 example rows × 33 fields**, imported and inspected successfully with the spreadsheet validation runtime.
- Word structural audit: **2 landscape sections, 2 survey tables, 30 segments, 300 cells, Times New Roman, fixed-width geometry - passed**.
- Word visual audit: rendered to **2 US Letter landscape pages** and both full-resolution page images were inspected; no clipping, overlap, broken borders, split rows, or missing segment labels remained.
- Live Supabase, final GitHub Pages subpath, iPhone Safari, and Android Chrome: **not run at delivery because those instructor-owned endpoints/devices do not yet exist**. The exact acceptance checklist and deployed-path command below cover that final environment-specific step.

Commands:

```bash
npm test
npm run validate
```

Covered assertions:

- Exactly 30 along-trail segments: 0-1 through 29-30 m.
- Exactly 300 cells: 30 segments × 2 sides × 5 bands.
- LEFT/RIGHT and all five band boundaries occur once per segment.
- Duplicate species in one cell are rejected; multiple different species remain valid.
- `surveyed_no_target`, `not_surveyed`, and `incomplete` remain distinct.
- Batch marking affects incomplete cells only and does not overwrite detections.
- Unknown plants export as `UNKNOWN` with their note.
- Long format emits one row for every non-detection cell and one row per detection.
- CSV quoting preserves commas in metadata.
- Geometry/status corruption is detected.
- All required project files and local page references exist.
- JavaScript files pass syntax checks.
- Species codes are present, unique, and valid.
- Backend SQL contains RLS, revision, owner-policy, and export-view safeguards.
- Sample CSV contains all required example states.
- The DOCX is a valid OOXML container.

## Concrete static/offline design checks

- All runtime application dependencies are local files; no font, script, or framework CDN is required.
- The service worker pre-caches the page, styles, JavaScript modules, species list, configuration, and manifest.
- Backend requests are deliberately excluded from caching.
- IndexedDB separately stores transect JSON, settings/Auth session, and photo blobs.
- Every data-changing interaction saves the active transect before navigation continues.
- Submission status changes to `Submitted` only after the server record, photo attempts, and final server sync-state update return successfully.
- A failed photo marks the record `Upload partially complete` without discarding the survey or local photo.
- Stable record/photo IDs and database upserts make repeated submission taps and retries idempotent.

## GPS cases to verify on devices

| Case | Expected result |
| --- | --- |
| Permission granted | Latitude, longitude, reported accuracy, and capture timestamp appear and persist |
| Permission denied | Plain-language warning; survey remains editable |
| GPS unavailable | Warning plus manual-coordinate option |
| Timeout/poor sky view | Retry guidance; no data loss |
| Poor reported accuracy | Accuracy remains visible rather than being silently treated as precise |
| Continue without GPS | Summary reports GPS not captured; submission remains allowed |

## iPhone Safari checklist

1. Open the final GitHub Pages HTTPS URL while online.
2. Join the test class and create two local transects.
3. Record two species in one cell; verify tapping one again removes it rather than duplicating it.
4. Record `0`, `NS`, an incomplete cell, and an unknown with a note/photo.
5. Capture Start GPS; deny End GPS.
6. Refresh during active entry and confirm the same segment/data return.
7. Close Safari, enable airplane mode, reopen the saved URL, and confirm the app loads.
8. Edit both transects offline, take another photo, and export CSV plus JSON backup.
9. Reconnect and retry sync. Tap submit repeatedly during upload; only one record ID should exist.
10. Edit a submitted cell and sync; verify a revision appears server-side.

## Android Chrome checklist

Repeat the Safari checklist, then use **Add to Home screen** and confirm the installed app opens at the correct repository subpath. Confirm camera capture, file selection, GPS denial, browser close/reopen, and storage persistence.

## Interrupted photo upload test

1. Complete a transect with two photos.
2. Begin submission and disable connectivity during photo upload.
3. Confirm the survey remains locally present and the status is `Upload partially complete` or `Submission failed`.
4. Reconnect and use manual retry.
5. Confirm the same record and photo IDs are used and no duplicate transect appears.

## Backup round-trip test

1. Export the restorable JSON backup for a transect containing photos.
2. Import it in a separate test browser profile.
3. Confirm metadata, cell statuses, observations, notes, GPS, entry method, stable record ID, and photo count.
4. If the same ID already exists, confirm the app requires an explicit replacement decision.

## Deployed-path check

After GitHub Pages publishes, run:

```bash
node tools/check-deployed.mjs https://USERNAME.github.io/REPOSITORY/
```

This validates HTTPS and the actual repository-subpath URLs for the page, modules, service worker, and manifest. It must be run against the real Pages URL; a local server cannot verify GitHub's deployment path or MIME headers.

## Testing limitation at delivery

The GitHub Pages URL and live Supabase project are instructor-owned and do not exist in the source package, so live enrollment, row-policy enforcement, iPhone Safari, Android Chrome, and final deployed-path tests cannot be honestly marked as executed until deployment. The checklists above are acceptance tests rather than claims of completion. Automated protocol, source, CSV, SQL-structure, and DOCX render checks are executed during packaging.
