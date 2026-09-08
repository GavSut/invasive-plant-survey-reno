# Invasive Plant Transect Field System

This repository contains a printable Word field sheet and an offline-first phone web app for a 30-meter invasive-plant transect. Paper and digital records use the same geometry, statuses, species codes, and long-format export.

**Updating the existing Reno site?** Version **1.0.1** fixes dialog buttons and segment-header navigation. Follow [UPDATE.md](UPDATE.md) to replace the files in your existing repository and refresh phones' cached app files. This release requires no Supabase SQL or function deployment.

## The segment convention (important)

A 30-meter transect contains **30 sampling segments**, not 31 point-labeled rows:

- Segment 1 is **0-1 m** along the trail.
- Segment 13 is **12-13 m** along the trail.
- Segment 30 is **29-30 m** along the trail.
- `0 m` and `30 m` are transect boundaries, not extra sampling cells.

Each segment contains ten 1 m × 1 m cells: five perpendicular bands on LEFT and five on RIGHT. Therefore, one complete transect contains **300 cells**. The app always shows both the actual range and ordinal position, such as `12-13 m · Segment 13 of 30`.

The Word sheet uses:

- Page 1: trail distance **0-15 m** (segments 0-1 through 14-15 m)
- Page 2: trail distance **15-30 m** (segments 15-16 through 29-30 m)

LEFT and RIGHT are defined while facing from transect start toward transect end. A plant is assigned using its rooted location.

## Data rules

- `detected`: one exported row per species in the cell; multiple species can share a cell.
- `surveyed_no_target`: the paper code is `0`.
- `not_surveyed`: the paper code is `NS`.
- `incomplete`: the cell remains blank and is never silently converted to zero.
- A species can be added only once per cell.
- An unidentified plant is exported as species code `UNKNOWN` with its note.

## Repository contents

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | Phone-first application |
| `protocol.js` | Survey geometry, status logic, validation, and CSV creation |
| `storage.js` | IndexedDB drafts, photo blobs, settings, backup/restore |
| `backend.js` | Supabase authentication, class enrollment, sync, and photo upload |
| `species.js` | The only file normally edited to change the species list |
| `config.js` | Safe-to-publish browser backend configuration |
| `service-worker.js`, `manifest.webmanifest` | Offline caching and installable-app behavior |
| `field-sheet/Invasive_Plant_Transect_Field_Sheet.docx` | Two-page landscape Word form |
| `backend/supabase/schema.sql` | Tables, revision trigger, access policies, storage policies, and export view |
| `backend/supabase/functions/enroll-class/index.ts` | Server-side class-code check and enrollment |
| `data/sample_long_format.csv` | Eight-row example of the analysis export |
| `ARCHITECTURE.md` | Backend comparison and security model |
| `INSTRUCTOR_WORKFLOW.md` | Semester operations checklist |
| `DATA_DICTIONARY.md` | Export field definitions |
| `TESTING.md` | Automated results and phone/deployment checklist |

## 1. Create the Supabase backend

The app remains fully usable for local entry and export without a backend, but class submissions and shared photo storage need these steps.

### Create the project

1. Create a free Supabase project at https://supabase.com/dashboard.
2. Save its database password in your password manager.
3. Open **SQL Editor**, create a new query, paste all of `backend/supabase/schema.sql`, and run it.
4. Confirm that the Tables view now includes `classes`, `class_members`, `transects`, `transect_revisions`, and `photos`.
5. Under **Authentication → Providers**, enable **Anonymous Sign-Ins**.

The schema turns on Row Level Security. Anonymous students receive a real, device-held Auth identity; the browser publishable key alone grants no class-record access.

### Create or rotate the class code

In SQL Editor, run this with your own values:

```sql
select public.create_or_rotate_class(
  'BIOL 101 Invasive Plants',
  'Fall 2026',
  'replace-with-at-least-12-random-characters'
);
```

Use a password-manager-generated code or four unrelated random words. Share it only with the class. Running the same command with the same class name and term replaces the old code. The database stores a bcrypt hash, not the readable code.

### Deploy the enrollment function

The Edge Function keeps class-code verification and enrollment out of browser code. Install the Supabase CLI using the current instructions at https://supabase.com/docs/guides/local-development/cli/getting-started.

From the repository root:

```bash
cd backend
supabase login
supabase link --project-ref apjjzoaayttcovofwzmc
supabase secrets set ALLOWED_ORIGINS="https://gavsut.github.io,http://localhost:8000" RATE_LIMIT_SECRET="A-LONG-RANDOM-SECRET"
supabase functions deploy enroll-class
```

Notes:

- This deployment's project ref is `apjjzoaayttcovofwzmc`.
- `ALLOWED_ORIGINS` contains origins only—no repository path and no trailing slash. Remove localhost after testing if desired.
- Generate `RATE_LIMIT_SECRET` with a password manager. It is used only to hash network identifiers for short-term failed-attempt throttling.
- Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the deployed function. Never copy the service-role key into this repository.
- `verify_jwt = false` in the function configuration means the platform proxy does not pre-validate tokens. The function itself still verifies every bearer token with Supabase Auth before doing anything.

## 2. Configure the browser app

This deployment copy is already configured with the project URL and browser-safe publishable key in `config.js`:

```js
supabaseUrl: "https://apjjzoaayttcovofwzmc.supabase.co",
supabasePublishableKey: "sb_publishable_...",
```

Find both under **Project Settings → API**. Use the browser-safe publishable key (or legacy `anon` key), never a secret key or `service_role` key. The class code does not belong in `config.js`.

## 3. Replace the example species list

Open `species.js`. Change `SPECIES_LIST_VERSION` whenever the list changes, then edit the objects in `SPECIES`:

```js
export const SPECIES_LIST_VERSION = "fall-2026-v1";

export const SPECIES = Object.freeze([
  Object.freeze({
    code: "BRTE",
    scientificName: "Bromus tectorum",
    commonName: "Cheatgrass"
  }),
]);
```

To add a species, copy one object and edit its three values. To remove one, delete its object and adjacent comma as needed. To change a code or name, edit that value. Codes must be unique, 2-10 characters, and use letters, numbers, `_`, or `-`.

The paper field sheet intentionally has no full legend. Update the separate class species-code sheet at the same time and put the same version label on it.

## 4. Publish with GitHub Pages

1. Open the `GavSut/invasive-plant-survey-reno` repository. A private repository requires a GitHub plan that supports Pages for private repositories; a public repository works with standard GitHub Pages.
2. Upload all repository files, including `.nojekyll`, preserving the folders.
3. Commit to the `main` branch.
4. Open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select `main` and `/(root)`, then save.
7. Wait for GitHub to show the published HTTPS address: `https://gavsut.github.io/invasive-plant-survey-reno/`.
8. Confirm the Edge Function secret `ALLOWED_ORIGINS` contains exactly `https://gavsut.github.io` (plus `http://localhost:8000` only while local testing is needed). The origin must be lowercase, contain no repository path, and have no trailing slash.

Because every local URL is relative, the service worker and app work correctly inside a repository subpath.

### Update the site later

Edit the relevant file, commit it to `main`, and wait for Pages to redeploy. When application files change, increment `CACHE_NAME` in `service-worker.js` so phones replace the old offline cache. When the species list changes, also increment `SPECIES_LIST_VERSION`.

## 5. Test on a phone before class

1. Open the final GitHub Pages URL in iPhone Safari and Android Chrome while online.
2. Join a test class code.
3. Create a test transect and record several cells, including a detection, `0`, `NS`, and an unknown.
4. Capture GPS once and deny permission once; confirm entry remains possible in both cases.
5. Take a photo and confirm the app says it is saved locally.
6. Wait for the “offline app files are prepared” message.
7. Enable airplane mode, close the tab, reopen the same URL, and confirm the draft and photo count remain.
8. Add more observations offline and refresh the page.
9. Reconnect, open **Class & backup**, and use **Retry/sync current transect**.
10. Confirm the record appears in Supabase and its private photo appears in Storage.

Full test cases are in `TESTING.md`.

## 6. Instructor data access and export

### Export the full analysis table

In Supabase SQL Editor run:

```sql
select *
from public.analysis_export_long
where class_name = 'BIOL 101 Invasive Plants'
  and class_term = 'Fall 2026'
order by survey_date, site, transect_number,
         segment_start_m, side, distance_band_start_m, species_code;
```

Use the result panel's CSV download. The view emits at least one row per cell and one row per detected species, so zero-detection, NS, and incomplete effort are preserved.

### Review records and revisions

- `transects`: current submitted JSON, timestamps, sync state, and instructor note.
- `transect_revisions`: automatically archived previous payloads whenever a submitted transect changes.
- `photos`: searchable photo context and private storage path.
- **Storage → transect-photos**: private image objects organized as `anonymous-user/transect/photo`.

To annotate a record without changing student data, edit `instructor_note` and `instructor_reviewed_at` in the `transects` Table Editor. Students have no grant to modify those columns.

To correct a record, edit its `payload` only if necessary and document the reason in `instructor_note`. The revision trigger archives the prior payload. Export the dataset again afterward.

### Pending and failed uploads

The instructor can identify `upload_partially_complete` records in the `sync_state` column. A fully offline or failed-before-contact upload cannot be visible to the server; the student must show the device status or provide the local CSV/JSON backup. This is unavoidable for any genuinely offline system.

## 7. Semester backup and reset

1. Export `analysis_export_long` to CSV.
2. Export `transects`, `transect_revisions`, `photos`, `classes`, and `class_members` from the dashboard.
3. Download needed photo folders from Storage.
4. Store the exports in an approved university location.
5. Mark the old class inactive:

```sql
update public.classes
set active = false, updated_at = now()
where name = 'BIOL 101 Invasive Plants' and term = 'Fall 2026';
```

6. Create a new class row/code for the next term. Do not reuse the old class code.
7. Update and version the species list if needed.
8. Run the phone checklist again before field day.

Supabase Free projects currently pause after one week without activity and do not include managed backups. Resume the project before fieldwork and keep your own semester exports. Current plan information: https://supabase.com/pricing.

## Local development

Do not open `index.html` directly from the file system; service workers require HTTP or HTTPS. From the repository root, use any static server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Add that origin to `ALLOWED_ORIGINS` only during testing.

Run the dependency-free checks with:

```bash
npm test
npm run validate
```

## Privacy and device limitations

- Observer names are stored with the survey and are not authentication credentials.
- Student access is scoped to the anonymous Auth identity held in that browser. The same browser profile can view and edit its own submissions; another group cannot query them.
- Clearing site data, private browsing, switching browsers, or losing the phone can remove the local identity and local drafts. Export a JSON backup and do not clear browser data until the instructor confirms receipt.
- Photos are private. The public GitHub repository contains no photos or submissions.
- The browser publishable key is intentionally public; Row Level Security provides the access boundary. The service-role key must remain server-side.
