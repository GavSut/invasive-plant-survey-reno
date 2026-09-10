# Instructor dashboard quick guide

Use the dashboard at:

`https://gavsut.github.io/invasive-plant-survey-reno/instructor.html`

It requires an internet connection. Student field entry remains offline-capable; the instructor dashboard deliberately does not cache class-wide data for offline use.

## Sign in

1. Enter your reviewer name as it should appear in the audit trail.
2. Enter the shared instructor password from the approved password manager.
3. Select **Sign in**.

The tab keeps a signed session for up to 30 minutes. The raw password is not retained. Closing the tab ends the browser session. Password rotation invalidates existing sessions.

If a session expires during a safe read, sign in and repeat it. If it expires during a write, refresh the record before repeating so you do not act on stale data.

## Start each review

1. Choose the class and term.
2. Leave inactive classes hidden unless you need a prior semester.
3. Select **Refresh** and inspect the refresh time.
4. Check the summary cards for incomplete, partial-upload, GPS/photo, review, test, excluded, and trash counts.
5. Apply filters and confirm the displayed result count before selecting records.

The map includes only actual coordinates: a line for two endpoints, a point for one endpoint, and no invented marker for no GPS. Marker/table selection represents the same record where synchronization is available. The public OpenStreetMap tile service can infer the approximate displayed GPS extent from tile requests; ask the site owner to deploy the documented no-tile coordinate-list fallback if institutional policy prohibits that third-party disclosure.

## Search, filter, and select

You can combine class, date, site/trail/transect, observer, record ID, species, status, sync/completion, GPS, photos, review, inclusion, test, trash, and curation filters.

- Read the active-filter chips before downloading or bulk-changing records.
- Sorting changes row order only.
- Row checkboxes select exact records.
- **Select all filtered** uses the current combined filters, not every database row. It resolves at most 5,000 exact IDs; narrow the filters above that limit.
- **Clear selection** before starting an unrelated operation.
- **Clear filters** returns to the default active analytical view.

Always verify the displayed selection count and IDs before trash or purge.

## Inspect a transect

Open its row. The detail panel provides:

- original and effective/curated metadata;
- original/latest submission timestamps and student revision count;
- sync state, GPS coordinates/accuracy, notes, and photos;
- the full 30-segment × six-cell grid, including `0`, `NS`, and incomplete states;
- target and unknown observations;
- review/test/exclusion/trash state; and
- curation revisions and instructor audit history.

Use the cell status filter/expand controls to investigate a subset without losing the complete 180-cell context. Compare **Original** with **Effective/curated** before accepting or correcting a record.

## Record review state

Set a review status, instructor note, and optional flags. You may also:

- explicitly mark test data;
- explicitly mark real data when an automatic text suggestion is wrong; or
- exclude a record from analysis without deleting it.

Save and verify the new audit entry. If a conflict appears, another tab or instructor changed the record after it loaded. Refresh and decide again; do not overwrite blindly.

## Curate a correction

Curation is the correction path. It leaves the original student submission unchanged.

1. Open **Compare** and identify the exact problem.
2. Start the curation editor from the current record.
3. Correct the necessary metadata or cell values.
4. Review every proposed difference.
5. Enter a concrete reason.
6. Save, then verify the curation version and audit entry.

The server rejects changes that break the 30-segment/180-cell protocol, cell IDs or bands, target catalog, status/observation meaning, or duplicate-prevention rules.

Unknown-plant notes retain their stable observation IDs when unchanged, even if their lines are reordered. Editing a note creates a new observation identity so a photo linked to the old observation is never silently reassigned by textarea position; review observation-photo associations after changing unknown notes.

If the student submits another edit, the existing curation becomes stale and is no longer treated as current. Compare the new original and reapply the correction deliberately. **Clear curation** returns the effective view to the original but preserves curation history. **Revert** restores only a compatible historical curation and never erases later history.

## Download data

1. Set the class and filters.
2. Choose a scope: selected, all filtered, current class, or all classes where enabled.
3. Confirm the displayed record count.
4. Choose the value source:
   - **Curated/effective** for normal analysis;
   - **Original** for the untouched student source; or
   - **Both** for comparison/provenance.
5. Keep the default exclusion of trash, test data, and instructor-excluded records for analysis. Include them only deliberately.
6. Choose a format and download.

| Format | Best use |
| --- | --- |
| Long CSV | Cell-level ecological analysis, including detections, multiple targets, `0`, `NS`, and incomplete |
| Metadata CSV | One-row-per-transect inventory and quality-control review |
| GeoJSON | GIS/map work; no feature is invented for missing GPS |
| Raw JSON | Selected record package with original, curated/state, photos, student/curation revision metadata, and audit context |
| Photo manifest | Reconcile expected private files and their survey associations |
| Photo ZIP | Bounded image batch plus manifest |

Large record selections are processed in chunks; do not close the tab until every chunk completes. Metadata CSV and GeoJSON downloads are limited to 500 records because the browser must assemble complete protocol payloads before converting them. One photo ZIP is limited to 50 images and 75 MiB. Use multiple batches plus the manifest for larger sets. Record any partial failure and retry the missing subset.

## Review photos

Open a record's photo section and select **Load preview** only for images you need to inspect. Opening record detail alone does not authorize or audit every image. Preview links are short lived; use **Request fresh preview** if one expires. Check segment, cell, species/unknown association, capture time, and upload status before using the image.

The bucket stays private. A photo manifest contains safe identifiers/paths but not a privileged key or permanent public URL.

## Trash and restore

For ordinary removal:

1. Select exact records.
2. Choose **Move to trash**, inspect the IDs/count, enter a reason, and confirm.
3. Verify them in the Trash view.

Trash is reversible and preserves submissions, revisions, curations, photos, state, and audit history.

To undo it, select exact records in the Trash view, choose **Restore**, enter a reason, and confirm. Verify them in the active view.

## Permanently purge synthetic data

Permanent purge is irreversible. Back up first and use only the exact confirmed trashed records.

1. Open the Trash view.
2. Select the record IDs; do not rely on the filter alone.
3. Request **Purge preview**.
4. Verify every ID and linked-photo count.
5. Enter a reason, re-enter the instructor password, and type the exact displayed confirmation.
6. Submit the still-valid preview and read the result for every record.

If the tab closes after a purge started, return to Trash and generate a new preview for that same record; the server can resume a consistent pending operation after another password confirmation. If any item says partial or failed, stop. Keep its operation detail and generate a new preview for only that record after resolving the issue. Do not manually delete broad Storage folders or only one half of the database/photo pair.

## End of session

1. Confirm writes and downloads completed.
2. Save required files in the approved location.
3. Close the dashboard tab to clear its session token.
4. Do not leave downloaded class data on a shared computer.

For deployment, password rotation, backups, semesters, and troubleshooting, use [Backend deployment and instructor operations](BACKEND_AND_OPERATIONS.md).
