# Backend transition and instructor operations

The GitHub Pages and Supabase projects already exist. The only privileged work needed for this release is the one-time v2 data cleanup/migration. Ordinary future frontend updates do not repeat it.

## One-time protocol-v2 transition

Use a maintenance window so an old cached client cannot submit while the backend is changing.

### 1. Download the repository and obtain the server-only key

In Supabase, open project `apjjzoaayttcovofwzmc`. Copy the **secret/service-role key** only for this local administrative session. Never paste it into `config.js`, GitHub, an issue, or a class handout.

From the repository root, set temporary shell environment variables:

```bash
export SUPABASE_URL="https://apjjzoaayttcovofwzmc.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="paste-the-server-only-key-here"
```

### 2. Dry-run the authorized cleanup

```bash
npm run cleanup:retired:dry-run
```

The script prints exact candidate IDs and photo counts. It selects only this app's transects created at or before **2026-09-09 23:20:10 UTC** whose protocol is not `2.0.0`. It does not target classes, memberships, Auth users, policies, secrets, or v2 records. Stop if any candidate is unexpected.

### 3. Execute only after reviewing the dry run

```bash
CONFIRM_DELETE='delete-retired-protocol-before-2026-09-09T23:20:10Z' node backend/supabase/admin/cleanup-protocol-v1.mjs
```

The operation removes only the listed legacy transects, their revision rows, their photo rows, and those photos' exact private Storage paths. It is rerunnable if interrupted. It does not delete later legacy records; those require a separate owner decision.

When finished, clear the shell value:

```bash
unset SUPABASE_SERVICE_ROLE_KEY
```

### 4. Apply the existing-project migration

Open Supabase **SQL Editor**, paste `backend/supabase/migrations/20260910_protocol_v2.sql`, and run it once. The transaction:

- accepts only `digital_field`, protocol `2.0.0`, schema `2` payloads;
- validates 30 exact segments, six unique 0–3 m cells per segment, cell IDs/statuses, observation presence, and duplicate-code prevention;
- limits new photo band values to 0, 1, or 2; and
- replaces the long-format view with the v2 columns and filter.

The new checks immediately reject future incompatible inserts/updates. They are marked validated automatically if no incompatible historical rows remain. A legacy record created after the authorized cutoff is preserved and reported by this diagnostic query:

```sql
select id, protocol_version, entry_method, server_created_at
from public.transects
where entry_method <> 'digital_field'
   or protocol_version <> '2.0.0'
   or not public.is_protocol_v2_payload(payload)
order by server_created_at;
```

Do not delete a later result without separately confirming what it is.

### 5. Publish and verify

Push/upload the repository root to `main`, wait for Pages, then run:

```bash
node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/
```

On an online phone, reopen the site and confirm app/protocol `2.0.0`, 180 cells, three bands, all 23 target codes, and the guide. The one-time browser transition removes only incompatible local transects/photo blobs and writes a durable v2 reset marker; it preserves class/session settings and never runs as a generic future-version reset.

## Existing backend configuration

- `config.js` contains the safe browser project URL and publishable key.
- Anonymous Sign-Ins must remain enabled under **Authentication**.
- `enroll-class` must remain deployed with an allowed origin of `https://gavsut.github.io` (origin only—no repository path/trailing slash).
- The class code is verified only in the Edge Function and stored server-side as a hash.
- RLS ownership policies and private Storage policies are defined in `backend/supabase/schema.sql`.

The v2 release does not change the enrollment function. A fresh backend can be created by running the complete `schema.sql`, enabling Anonymous Sign-Ins, and deploying `backend/supabase/functions/enroll-class`; an existing backend should use the dated migration instead of rerunning the full schema.

## Class-code rotation

Create or rotate a code in SQL Editor:

```sql
select public.create_or_rotate_class(
  'BIOL 101 Invasive Plants',
  'Fall 2026',
  'replace-with-a-long-random-class-code'
);
```

Share the readable code with students, but do not commit it. Observer names are metadata, not credentials.

## Before field day

1. Resume/check the Supabase project and current plan quotas.
2. Confirm the desired class row is active and rotate its class code.
3. Update/version `species.js` and its crosswalk if the target list changed.
4. Deploy GitHub Pages and run the deployed-path checker.
5. Open the guide and app on iPhone Safari and Android Chrome while online.
6. Join a test class, create two drafts, wait for the offline-ready message, then test airplane-mode close/reopen.
7. Exercise detection, multiple targets, unknown+note/photo, `0`, `NS`, incomplete, GPS granted/denied, submission, repeated submission, edit/resubmit, and manual retry.
8. Delete only clearly labeled contemporary test records through an owner-approved process.

## During and after fieldwork

1. Use one designated phone per group/transect and keep the same browser profile.
2. Require groups to reconnect and use **Class & backup → Retry/sync**.
3. Confirm a visible `Submitted` state. Follow up on `Upload partially complete` or `Submission failed`.
4. A fully local record cannot appear on the server; collect the JSON backup from that phone if needed.
5. Review `transects.sync_state`, `photos.sync_state`, and the private `transect-photos` bucket.

## Export the class dataset

Run in SQL Editor and download the result as CSV:

```sql
select *
from public.analysis_export_long
where class_name = 'BIOL 101 Invasive Plants'
  and class_term = 'Fall 2026'
order by survey_date, site, transect_number,
         segment_start_m, side, distance_band_start_m, species_code;
```

Check 180 unique cell keys per complete transect; row counts may be higher when cells have multiple observations. Review unexpected incomplete states and duplicate site/transect labels.

Use `instructor_note` and `instructor_reviewed_at` for annotations. If an instructor must correct a payload, document the reason; the revision trigger preserves the former payload. Re-export afterward.

## Backup and next semester

1. Export the long view plus `transects`, `transect_revisions`, `photos`, `classes`, and `class_members`.
2. Download required private photo folders and store all exports in the approved institutional location.
3. Mark the old class inactive, create a new class/term and code, and do not reuse the old code.
4. Review the provider's current plan/retention limits and institutional privacy requirements.
5. Update the catalog/version if needed, deploy, and repeat the phone acceptance checklist.
