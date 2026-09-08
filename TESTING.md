# Testing and validation report

## Automated checks

The repository includes dependency-free Node tests for protocol logic, application event handlers, and a project validator. Results below distinguish local automated checks from live-browser and physical-device checks.

### Bugfix release 1.0.1 - 2026-09-07 UTC

- Before the fix, the new interaction suite produced **3 failures and 2 passes**: both dialog-form submissions were incorrectly cancelled, and Next navigation left the header at 0-1 m.
- After the fix, `npm test` produced **13 passed, 0 failed**: the original eight protocol tests plus five interaction regression tests.
- `npm run validate` passed required-file, JavaScript syntax, species, sample CSV, backend source guards, and DOCX-container checks.
- The interaction tests execute the actual production event handlers in a Node VM with minimal DOM/storage test doubles. They verify that dialog submits remain uncancelled, details/class forms still use their application handlers, and Next/Previous/direct navigation synchronize the header and main heading without marking any cell complete. They are not native-browser or phone tests.
- The app/package/cache versions are **1.0.1**. The protocol remains **1.0.0**. The service-worker cache-name change causes replacement app assets to be downloaded after deployment; IndexedDB data is not migrated or cleared by this release.
- The corrected release has not yet been deployed to GitHub Pages. Native dialog interactions and the cache upgrade still need the short post-deployment smoke test in `UPDATE.md`.

### Live QA of version 1.0.0 - 2026-09-07 UTC

- GitHub Pages HTTPS and required assets passed at `https://gavsut.github.io/invasive-plant-survey-reno/`.
- Cloud Chrome walkthrough confirmed multiple species, duplicate prevention, an unknown with a note, distinct zero/NS/incomplete states, accurate 3/300 progress, summary counts, and saved observations after reload.
- Navigation reached 29-30 m without an extra segment. The header and dialog defects identified during that walkthrough are addressed in 1.0.1 above.
- Supabase allowed the GitHub origin with HTTP 204 preflight, rejected an unrelated origin with 403, and rejected enrollment without an Auth session with 401. The public Auth settings reported anonymous sign-ins enabled. Unauthenticated queries to transects, photos, revisions, class membership, and classes returned 401.
- No test survey was submitted to Supabase. Successful class enrollment, submission/retry/revisions, and isolation between two authenticated student sessions remain unverified.
- CSV and backup buttons showed export notifications, but actual download receipt was not independently confirmed. The cloud photo picker stalled; this is not a confirmed app-photo defect. Real camera/GPS permission flows and airplane-mode reopening remain physical-device checks.

### Delivery run - 2026-09-07 UTC

- Protocol suite: **8 passed, 0 failed**.
- Project validator: **passed** all required-file, JavaScript syntax, species-list, sample-CSV, backend-safeguard, and DOCX-container checks.
- Sample CSV: **8 example rows × 33 fields**, imported and inspected successfully with the spreadsheet validation runtime.
- Word structural audit: **2 landscape sections, 2 survey tables, 30 segments, 300 cells, Times New Roman, fixed-width geometry - passed**.
- Word visual audit: rendered to **2 US Letter landscape pages** and both full-resolution page images were inspected; no clipping, overlap, broken borders, split rows, or missing segment labels remained.
- At the original delivery, deployment and device checks were pending. The later live QA and 1.0.1 release results above supersede that status.

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
6. Refresh during active entry, reopen the saved transect, and confirm the observations remain at their original segments. Reopening currently starts navigation at 0-1 m.
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
node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/
```

This validates HTTPS and the actual repository-subpath URLs for the page, modules, service worker, and manifest. It must be run against the real Pages URL; a local server cannot verify GitHub's deployment path or MIME headers.

## Testing limitation at delivery

The live-site QA above covers version 1.0.0; corrected version 1.0.1 is prepared for upload. Successful enrollment/submission, two-session row-policy isolation, camera/GPS, real offline reopening, and iPhone Safari/Android Chrome remain acceptance checks rather than claims of completion. Automated source-policy checks do not prove that all deployed database policies match the source schema.
