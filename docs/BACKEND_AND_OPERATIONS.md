# Backend deployment and instructor operations

This guide covers the existing GitHub Pages site, Supabase project `apjjzoaayttcovofwzmc`, and the v2.1 instructor dashboard. It is written for the project owner. Students should receive only the survey URL and current class code—not this setup material or any instructor secret.

## Choose the correct database path

| Situation | Run |
| --- | --- |
| Existing project already running app/protocol v2 | Only `backend/supabase/migrations/20260910_instructor_dashboard_v2_1.sql` |
| Existing project that has not completed the protocol-v2 transition | First complete the reviewed protocol-v2 cleanup/migration, then run the v2.1 migration |
| Brand-new empty Supabase project | Complete `backend/supabase/schema.sql` once; do not then repeat historical migrations |

Never rerun the complete fresh-install `schema.sql` over the working project. The v2.1 migration is additive where possible, transactional, and designed to preserve existing classes, memberships, original student submissions, student revision history, and photo records.

Before any backend change, export current tables and inventory the private bucket. Schedule the operation when students are not submitting.

## Existing-project installation in Supabase Dashboard

### 1. Apply the migration

1. Open the existing Supabase project.
2. Select **SQL Editor → New query**.
3. Copy all of `backend/supabase/migrations/20260910_instructor_dashboard_v2_1.sql` into the editor.
4. Select **Run** and require a successful transaction.
5. Run the verification query in [UPDATE.md](../UPDATE.md#1-run-the-existing-project-migration).

If the migration fails, do not deploy either updated function and hope it works. Record the exact first error. The transaction should prevent a partially applied schema; confirm in SQL Editor before retrying.

The migration explicitly grants `service_role` the required membership privileges:

```sql
grant select, insert, update
on table public.class_members
to service_role;
```

It also installs the atomic enrollment-limit helpers while retaining the former service-role-only enrollment RPCs for rollout compatibility. The prior `enroll-class` deployment therefore continues working after the migration, but the new per-client/global limiter is active only after the updated function is redeployed. Instructor access is limited to the required records, revisions, photos, new instructor tables, summary views, sequences, and purge helpers. The migration revokes instructor-table access from `public`, `anon`, and `authenticated`; Row Level Security remains enabled.

### 2. Configure secrets

Open **Edge Functions → Secrets** and set:

| Name | Requirement |
| --- | --- |
| `INSTRUCTOR_PASSWORD` | Unique shared dashboard password; the function requires at least 16 characters, and 20+ high-entropy characters is the operational recommendation; store it in a password manager |
| `INSTRUCTOR_SESSION_SECRET` | Unique random string of at least 32 characters |
| `INSTRUCTOR_RATE_LIMIT_SECRET` | A different unique random string of at least 32 characters |
| `RATE_LIMIT_SECRET` | A third unique random string of at least 32 characters, used only to key enrollment client/global buckets; retain the existing private value if it already meets this requirement |
| `ALLOWED_ORIGINS` | Exactly `https://gavsut.github.io` |

Do not reuse the class code or any Supabase key. Do not add these values to `config.js` or GitHub. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied automatically to deployed Edge Functions; the service-role value must never cross into a browser response.

The function retains `INSTRUCTOR_PASSWORD_HASH` only as a legacy fallback for an exact lowercase SHA-256 hex value. New installations should set the raw `INSTRUCTOR_PASSWORD` secret instead; do not set both.

### 3. Deploy both functions online

Redeploy `enroll-class` immediately after the migration:

1. Select **Edge Functions → `enroll-class` → Deploy new version** (or create it through **Via Editor** with that exact existing name).
2. Replace the editor with the complete contents of `backend/supabase/functions/enroll-class/index.ts`.
3. Turn **Verify JWT** off.
4. Deploy and wait for the deployed state.

Then deploy the instructor function:

1. Select **Edge Functions → Deploy a new function → Via Editor**.
2. Name it `instructor-dashboard`.
3. Replace the template with the complete contents of `backend/supabase/functions/instructor-dashboard/index.ts`.
4. Turn **Verify JWT** off.
5. Deploy and wait for the deployed state.

The function uses its own signed, tab-scoped instructor session rather than a Supabase user JWT. Disabling the gateway's JWT check is therefore required; it does not bypass the function's own password, token, origin, expiry, input, and authorization checks.

The generic Supabase Dashboard function tester may be rejected because its request origin is not the production GitHub Pages origin. That is expected. Test sign-in from the deployed `https://gavsut.github.io/invasive-plant-survey-reno/instructor.html` page.

Optional CLI deployment:

```bash
supabase login
supabase link --project-ref apjjzoaayttcovofwzmc
supabase functions deploy enroll-class --no-verify-jwt
supabase functions deploy instructor-dashboard --no-verify-jwt
```

Prefer setting secrets through the Supabase Dashboard rather than placing them in a shell command or `.env` file. Both functions must retain `verify_jwt = false`: `enroll-class` validates the anonymous Auth session inside the handler, while `instructor-dashboard` validates its own signed instructor session. The migration-first order is backward compatible because it retains the older enrollment RPCs; atomic enrollment limiting begins only when the new `enroll-class` deployment is live.

### 4. Publish the static files

Upload/push the repository root to `main`, keep Pages on `main` / `(root)`, and wait for deployment. Include the root `.nojekyll` file. If GitHub's browser uploader rejects the release because it contains more than 100 files, upload it in two commits while preserving the folder structure, or use Git. No file needs manual deletion in v2.1. The guide code and assets intentionally remain in the repository even though student pages no longer link to them.

Open each student device online once after deployment so the v2.1 service worker replaces the earlier app shell. This is an application-file refresh, not a local-data reset.

## Fresh installation

For a genuinely empty Supabase project only:

1. Run the complete `backend/supabase/schema.sql` in SQL Editor.
2. Enable **Authentication → Providers → Anonymous Sign-Ins**.
3. Deploy `enroll-class` with Verify JWT off and set `ALLOWED_ORIGINS=https://gavsut.github.io` plus a unique password-manager-generated `RATE_LIMIT_SECRET` of at least 32 characters.
4. Deploy `instructor-dashboard` with Verify JWT off and its password, session-secret, instructor-rate-secret, and allowed-origin settings from the table above.
5. Create a class with `create_or_rotate_class`.
6. Put only the new project's URL and publishable key in `config.js`.

The working Reno installation already exists; these fresh-install steps are not the update procedure for it.

## Student class-enrollment safeguards

The student app sends `application/json` and a small `{ classCode }` body to `enroll-class`. The function rejects another media type, reads the JSON stream only up to 4 KB, caps its JSON response at 4 KB, validates the anonymous Supabase user, and never returns or logs a class code. The shipped browser client already uses the required content type; a hand-written request or integration must do the same.

Failed-code limiting is enforced transactionally in Postgres so concurrent requests cannot all pass a separate count-before-insert check. The normal bucket permits 10 recent failures for the keyed canonical gateway client address in 15 minutes. A separate 200-failure global bucket over the same window limits distributed address rotation. Only keyed digests are stored in `enrollment_attempts`, not raw network addresses. A blocked response is `429` and includes `Retry-After`.

`RATE_LIMIT_SECRET` is distinct from `INSTRUCTOR_RATE_LIMIT_SECRET`. Rotating it intentionally changes the keyed bucket values and effectively starts a new enrollment window; do not rotate it merely to work around student typos. The global backstop protects this small class service but is not a substitute for upstream abuse controls. Because many students can share a campus or carrier address, investigate a lockout rather than repeatedly retrying, and schedule controlled limit tests away from class use.

## Dashboard sign-in and session behavior

Open:

`https://gavsut.github.io/invasive-plant-survey-reno/instructor.html`

Enter the shared instructor password and a reviewer name. The reviewer value appears in curation, state, trash/restore, and purge audit entries; use a consistent real name or institutional identifier.

Before entering the shared password, verify that the address bar shows `https://gavsut.github.io/invasive-plant-survey-reno/instructor.html` and that the page is not embedded in another site. Login and purge re-entry use separate atomic 15-minute limits: 8/5 failures per keyed canonical gateway address plus 200/50 global failures respectively. The global bucket remains effective if a caller varies forwarding headers; raw addresses are not stored. GitHub Pages cannot supply this project with a custom `frame-ancestors`/`X-Frame-Options` response header, so the release does not claim clickjacking protection.

The raw password is sent only over HTTPS for the login request and is not retained after authentication. The page stores only the signed token and reviewer name in `sessionStorage`; it derives the display expiry from the signed token. The token expires after 30 minutes; closing the tab removes it. A `401` or expired-session message requires signing in again.

The login limiter rejects additional attempts after eight recent failures for the same protected network subject during a 15-minute window. Permanent-purge password re-entry has a separate five-failure limit over the same window. Do not repeatedly guess. Confirm the secret value or rotate it as an owner.

## Dashboard operating workflow

### Select and refresh a class

1. Choose a class/term. The dashboard defaults to an active or recently updated class rather than hard-coding a semester.
2. Enable inactive classes only when reviewing a prior term.
3. Select **Refresh** after student submissions or another instructor's changes. Check the last-refresh time.
4. Review the total/result count and summary cards before applying filters.

The instructor function pages summary records from the server; it does not silently cap the class at one fixed browser response. A page contains at most 200 records, and more than 10,000 matches requires narrower filters. Map data is explicitly marked partial above 2,000 located records. Export requests accept 200 record IDs, bulk trash/restore accepts 100, and an exact permanent-purge preview accepts 20. Per export request, related collections are capped at 1,000 photo metadata rows, 1,000 audit rows, and 2,000 rows for each revision-metadata collection; combined original-plus-curation payload data has a 4 MB preflight cap, and the complete response is capped at 5 MB. The page chunks larger supported selections; the server rejects an oversized request rather than truncating it. Browser-side safeguards additionally cap select-all resolution at 5,000 record IDs, long-format assembly at 90,000 base cell rows, raw JSON at 200 records, metadata CSV and GeoJSON at 500 records each, photo manifests at 1,000 records, and a photo ZIP at 50 files/75 MiB. Narrow the selection further if one chunk or browser operation exceeds a limit.

### Filter, sort, and select

Filters may be combined across class/term/activity, survey/submission date, site, trail, transect number, observer, record ID, target species, names, cell/sync/completion state, GPS, photos, review, inclusion, test status, trash, and curation. Active filter chips summarize the current restriction.

- **Clear filters** returns to the default active, non-trash view.
- A row checkbox selects that exact record.
- **Select all filtered** resolves exact IDs beyond the current page, up to 5,000 matches; narrow the filters above that browser safeguard and always inspect the displayed count.
- **Clear selection** removes the current selection.
- Sorting changes presentation, not record identity or selection.

The normal active dashboard view includes and visibly labels test and excluded records so they can be reviewed; trashed records use the separate Trash filter. Default downloads independently exclude test, excluded, and trashed records. Include any of those categories in a download only with its explicit opt-in.

Instructor mutations carry a stable UUID created once for the intended action and reused if the same request must be retried after an uncertain network result. The audited database helpers use that ID to return the already-committed logical result instead of applying a duplicate state, curation, trash, restore, or purge action. A request ID is an idempotency key, not authorization: the function still validates the instructor session, exact record IDs, versions, reason, and other action inputs. If the intended records or values change, refresh and start a new action rather than reusing the old request ID.

### Review a record

Open a row to see original and effective/curated metadata, timestamps, revisions, GPS/accuracy, notes, all 30 segments and six cells per segment, target and unknown observations, photo metadata/previews, instructor state, trash state, and audit history.

Use the 180-cell grid/status filters to inspect the full effort rather than detections only. A correct record preserves `surveyed_no_target`, `not_surveyed`, and `incomplete` cells as distinct states.

Where the dashboard offers **Effective/curated**, **Original**, or **Compare**, use:

- **Effective/curated** for the instructor-reviewed analytical representation.
- **Original** to see exactly what the student last submitted.
- **Compare** before saving or trusting a curation, especially after a student resubmission.

### Set review, test, and exclusion state

Use the state controls to set:

- review status: `unreviewed`, `reviewed`, `needs follow-up`, `questionable`, or `accepted`;
- an instructor note and optional flags;
- test status: automatic suggestion, explicitly test, or explicitly real; and
- inclusion/exclusion from analysis.

Automatic test suggestions look for obvious labels such as `TEST DATA`, `SYNTHETIC`, or `TEST-`; they are suggestions, not the sole authority. Mark a real record explicitly real if text produces a false suggestion. Exclusion is reversible metadata and never deletes a record.

Refresh if the page reports a version conflict. That means another tab or instructor changed the state after your copy loaded; the server refused to silently overwrite the newer action.

### Curate without overwriting the original

1. Open the record and compare original/current effective data.
2. Start an edit from the current original/effective payload shown by the dashboard.
3. Correct only the intended metadata or cells.
4. Review the full change summary.
5. Enter a specific reason of at least three characters; prefer a useful note such as `Corrected transposed trail and site from field notebook`.
6. Save and verify the curation version/audit entry.

The server rejects invalid geometry, IDs, sides/bands, statuses, target codes, duplicate species/unknown IDs, or inconsistent observation/status combinations. It also binds the overlay to the current student `submission_count`.

If a student resubmits after curation, the overlay becomes **stale** and is not silently applied as the effective analytical payload. Compare the new original, then create a new valid curation. Clearing a curation returns the effective view to the original without deleting curation history. Reverting restores a compatible earlier overlay while archiving the current overlay; a revision tied to an older student submission must be reviewed/rebased rather than silently relabeled current.

### View and download photographs

The record detail lists photo metadata and missing/partial upload states. Requesting a preview creates a private signed URL for a short period; the bucket never becomes public. Open or download the preview before it expires, or request it again.

The server signs no more than 100 photos per request, and each signed URL lasts five minutes. The optional browser ZIP is more conservative: 50 files and 75 MiB. For more data, download smaller groups and keep the photo manifest. A bundle reports missing or failed objects instead of representing a partial bundle as complete.

### Trash and restore

Trash is the normal deletion workflow:

1. Select exact records.
2. Choose **Move to trash**.
3. Inspect the count/IDs, enter a reason, and confirm.
4. Use the Trash view to verify them.

Trashed records retain originals, student revisions, curations/history, state, photos, and audit records. They disappear from default active views and analysis downloads.

To reverse the action, open the Trash view, select exact records, choose **Restore**, enter a reason, and confirm. Verify the records return to the expected class/filter.

### Permanently purge

Purge is irreversible and is available only for exact selected records already in Trash. Use it only after a backup and normally only for clearly marked synthetic/test records.

1. Switch to the Trash view and select the exact record(s). Never rely on a broad filter alone.
2. Request the purge preview and compare every displayed record ID and linked-photo count with your intended set.
3. Enter a reason, re-enter the current shared instructor password, and type the exact displayed destructive confirmation.
4. Submit the five-minute signed preview. If it expires or the set changes, generate a new preview.
5. Read the result for every record. “Partial” or “failed” is not success.

The server first establishes a database write fence shared with student photo authorization. A write that already holds that fence finishes before the inventory is accepted; later photo/record writes see `purge_pending` and are rejected. A renewable database lease prevents two dashboard workers from cleaning the same pending operation concurrently. The function then rechecks the exact canonical inventory, removes Storage objects in bounded pages/batches, and requires two consecutive empty-folder reads before asking the database to finalize. Finalization acquires the same advisory fence and performs a final read-only exact `storage.objects` emptiness check before deleting any application row. Database rows remain intact if Storage reports an unexpected object, an error, or a continuation boundary. Finalization transactionally removes the linked rows and writes a minimal purge tombstone/operation outcome only after the fenced Storage checks have succeeded. The tombstone prevents a cached phone from recreating that record ID. Repeating a completed request with its stable request identity is handled idempotently.

The purge tombstone durably retains the reviewer and purge reason. Use a short operational reason only; do not copy observer names, coordinates, field notes, photo content, or any payload data into that field.

If a large photo set reaches the per-request deletion-batch boundary, the response explicitly reports that bounded Storage cleanup made progress but needs continuation; it does not finalize the database. Return to the Trash view and generate a new preview for that exact record, re-enter the password, and continue only that item. The same rule applies if the tab closes after the server starts a purge: a valid pending ledger can be safely resumed after another password confirmation. If an operation is marked failed, do not select more records. Save the exact result, correct the reported storage/database issue, and generate a new preview for only that failed record. Never manually delete only a database row and leave unknown Storage objects, or vice versa.

## Downloads and analytical meaning

Choose a scope—selected records, all filtered records, current class, or all classes where offered—then choose a format/source.

| Download | Contents and use |
| --- | --- |
| Long-format CSV | Analysis-ready effort rows. Detected cells may produce multiple rows; `surveyed_no_target`, `not_surveyed`, and `incomplete` remain explicit. |
| Transect metadata CSV | One row per transect with metadata, completion, revision/sync/GPS/photo, review, curation, test, exclusion, and trash summaries. |
| GeoJSON | `LineString` for two endpoints, `Point` for one endpoint, and no invented geometry for records without GPS. |
| Raw JSON | Original payload, current curation/effective data, state, photos, student/curation revision metadata, and relevant audit data for the chosen records. |
| Photo manifest CSV | Safe identifiers and capture/cell/observation/upload/download metadata; no privileged URL/key. |
| Photo ZIP | Bounded selected private photos plus a manifest; use batches above the browser limit. |

For analysis, leave **effective/curated** selected and retain the default exclusion of trashed, test, and excluded records. Choose **original** for a preserved source export. Choose **both** to audit differences and retain source markers. Record the chosen filters, source mode, class, date, and download timestamp alongside analytical work.

Spreadsheet applications can interpret values beginning with `=`, `+`, `-`, or `@` as formulas. The dashboard escapes risky CSV cells, but keep spreadsheet safe-import settings and never treat observer/site/note text as formulas.

The SQL view `analysis_export_long` remains available for owner-side original-source fallback. The dashboard should be preferred when curated state and analysis exclusions matter.

## Password and secret rotation

Rotation requires no GitHub edit or Pages redeploy:

1. Generate a new unique high-entropy password and store it in the approved password manager.
2. In **Supabase → Edge Functions → Secrets**, replace `INSTRUCTOR_PASSWORD`.
3. Supabase makes the changed function secret available without a function redeploy.
4. Close any dashboard tabs, open a new tab, and verify login with the new password.
5. Remove the old value from the password manager's active entry and notify authorized instructors through an approved channel.

Changing the password also changes the token credential version, so previously issued sessions fail on their next request. If immediate full-session invalidation is needed independently of the password, rotate `INSTRUCTOR_SESSION_SECRET`. Rotate `INSTRUCTOR_RATE_LIMIT_SECRET` only deliberately; doing so changes the keyed network subject values used for the short failed-login window.

Rotate after staff changes, suspected disclosure, accidental screenshots/chat/issue posting, or according to institutional policy. A class-code rotation is separate and uses the SQL function below.

## Class and semester management

Create or rotate a student class code in SQL Editor:

```sql
select public.create_or_rotate_class(
  'BIOL 101 Invasive Plants',
  'Fall 2026',
  'replace-with-a-long-random-class-code'
);
```

The code must be at least 12 characters and no more than 72 UTF-8 bytes, matching the database's bcrypt input boundary. Ordinary password-manager-generated words fit comfortably. Share it with students but do not commit it. To end a term, back it up first, then mark its class row inactive in SQL Editor/Table Editor. Create a new class/term row and new code rather than renaming or reusing the old semester.

Before the new term:

1. Verify or resume the Supabase project and review current quota/retention status.
2. Back up the prior class, including curations, state, audit, and photos.
3. Mark the prior class inactive and create/rotate the new class code.
4. Review the 23-target catalog; version and test any authorized changes.
5. Rotate the instructor password if the authorized teaching team changed.
6. Deploy/check GitHub Pages.
7. Perform two-profile RLS, iPhone Safari, Android Chrome, offline student-entry, GPS, photo, submission/edit/retry, dashboard, export, trash/restore, and synthetic purge tests.

Changing the target catalog is a coordinated release, not a frontend-only edit. Update the species source/configuration and version, the hard-coded submission allow-list in `is_protocol_v2_payload`, `target_species_catalog`, and the Edge Function's target codes in one reviewed migration/release. Apply the backend migration before publishing a client that emits the new species-list version.

## Backup procedure

Keep backups in an institutionally approved location because they may contain names, precise coordinates, notes, and photographs.

### Dashboard data package

1. Include inactive classes and set the required class/term filters.
2. Export effective long CSV for analysis.
3. Export original long CSV or “both” for provenance.
4. Export metadata CSV, GeoJSON, raw JSON, and the photo manifest.
5. Download private photos in batches within the 50-file/75-MiB ZIP limit. Reconcile bundle results with the manifest.
6. Record the export date, dashboard/app version, source mode, filters, and any partial-photo failures.

### Owner-side database archive

Use Supabase's current project-backup/export facilities or SQL Editor CSV downloads to preserve at minimum:

- `classes`
- `class_members`
- `transects`
- `transect_revisions`
- `photos`
- `instructor_record_state`
- `instructor_curations`
- `instructor_curation_revisions`
- `instructor_actions`
- `instructor_purge_operations`
- `instructor_purge_tombstones`
- `target_species_catalog`

For a query-based table export, substitute a real table name in a query such as `select * from public.classes;`, run it in SQL Editor, and select the result download. Add an `order by` only when you name a real column from that table. Do not paste results into issues or public repositories. Login-attempt rows are operational/rate-limit data and normally do not need semester archival unless institutional policy says otherwise.

The private Storage bucket requires a separate file backup/inventory; database photo rows alone do not contain image bytes. Use dashboard photo bundles in reconciled batches or an owner-approved Supabase Storage export method, then compare exact expected object identifiers/counts against `photos` and the manifest.

A complete backup preserves both originals and curation/audit context. A detections-only CSV is not a complete survey archive because it loses zero-detection and missing-effort states.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| “Instructor dashboard is not fully configured” | All four secret names/lengths; function deployment; automatic `SUPABASE_URL` and service role availability |
| Origin/CORS rejection | `ALLOWED_ORIGINS` is exactly `https://gavsut.github.io`, without path or slash; test from the deployed Pages URL rather than a file/local preview |
| Login rejected | Exact current password and reviewer name; Caps Lock; whether the password was just rotated |
| Too many instructor password attempts | Stop and honor `Retry-After`; confirm the intended password rather than continuing to guess. Rotate an instructor secret only for an intentional credential change or recovery |
| Session invalid/expired | Sign in again; sessions last 30 minutes and close with the tab; a password/session-secret rotation intentionally invalidates tokens |
| No classes or records | Migration/function grants, class filter and inactive-class toggle; confirm students actually synchronized—local-only drafts cannot appear |
| Partial results | Refresh, narrow filters, and inspect the reported failed page/chunk; never assume missing chunks contain zero records |
| Student enrollment returns `415` or `413` | Use `Content-Type: application/json` and a `{ "classCode": "..." }` request below the 4-KB bound; the shipped student app already does this |
| Student enrollment returns `429` | Stop retrying and honor `Retry-After`; inspect whether the keyed client bucket or global backstop was reached, and do not rotate `RATE_LIMIT_SECRET` merely to bypass a live safety limit |
| Student “Class membership could not be saved” | Confirm the updated `enroll-class` is deployed with Verify JWT off, Anonymous Sign-Ins are enabled, and `service_role` has `SELECT`, `INSERT`, `UPDATE` on `class_members` |
| Photo preview expired/missing | Request a fresh signed URL; check photo metadata sync state and exact private Storage object |
| Curation marked stale/conflict | Student resubmitted or another instructor wrote a newer version; refresh, compare with the latest original, and deliberately reapply/rebase |
| Purge continuation/partial/failed | Stop bulk work; preserve operation details; retry only the named trashed record. A continuation means bounded Storage deletion made progress while database rows were deliberately retained; finalization requires the fenced folder to verify empty |

## Live acceptance and continuing checks

After deployment, follow [the concrete test report and remaining checklist](TESTING.md). At minimum, prove with two separate anonymous student sessions that owner-only records/photos remain isolated, prove browser roles cannot query instructor tables, and exercise the dashboard using clearly labeled synthetic records.

Use the deterministic fixtures and exact cleanup instructions in [`sample-data/README.md`](../sample-data/README.md). The fixture sites, people, and near-Null-Island coordinates are invented and must not enter ecological analysis.

Do not describe migrations, secret configuration, function deployment, GitHub upload, or live testing as complete until it has actually succeeded in the owner accounts. Local source inspection and unit tests cannot verify production CORS, credentials, RLS, Storage, or network behavior.
