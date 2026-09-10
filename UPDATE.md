# Deploy release 2.1.2

This checklist upgrades the existing **Invasive Plant Survey Reno** installation from app `2.0.0` to `2.1.2`. It adds the instructor dashboard, removes visible guide routes from the normal student interface, and includes the stable, touch-friendly instructor map controls. It does **not** change protocol `2.0.0`, schema version `2`, the 180-cell geometry, the 23-species catalog, classes, memberships, student ownership, submitted payloads, or private photographs.

Nothing in this repository can deploy into your accounts automatically. Complete the account-owner steps below, then verify the live result before class use.

## Before you start

You need:

- owner access to Supabase project `apjjzoaayttcovofwzmc`;
- write access to `GavSut/invasive-plant-survey-reno`;
- the extracted v2.1 GitHub web-update release with `index.html` at its root;
- a long, unique instructor password stored in a password manager; and
- three different password-manager-generated random strings of at least 32 characters: one enrollment rate-limit secret and two instructor secrets. The existing `RATE_LIMIT_SECRET` may be retained if it already meets that requirement and remains private.

Use a brief maintenance window and ask students not to submit while the migration and function are being installed. First export the current `transects`, `transect_revisions`, `photos`, `classes`, and `class_members` tables and record the private Storage object inventory. See [Backup procedure](docs/BACKEND_AND_OPERATIONS.md#backup-procedure).

## 1. Run the existing-project migration

1. In Supabase, open project `apjjzoaayttcovofwzmc`.
2. Open **SQL Editor → New query**.
3. Open the repository file `backend/supabase/migrations/20260910_instructor_dashboard_v2_1.sql` locally or on GitHub.
4. Copy the **entire file**, paste it into SQL Editor, and select **Run**.
5. Require a successful transaction. If the editor reports an error, do not skip ahead; save the exact error and resolve it before deploying the function.

This migration is for the existing project. Do **not** run `backend/supabase/schema.sql` over the existing database. `schema.sql` is the complete end-state installer for a brand-new project only.

The migration adds instructor curation, record-state, audit, login-limit, purge-ledger, purge-tombstone, and catalog tables; service-role-only summaries and helper functions; explicit service-role grants; stronger record/photo lifecycle checks; atomic enrollment-limit RPCs; and owner-only student protections. It retains the legacy enrollment RPCs so the currently deployed `enroll-class` function continues working during this migration-first rollout. It does not rewrite existing student payloads.

Verify the required objects in a second query:

```sql
select
  to_regclass('public.instructor_record_state') is not null as record_state,
  to_regclass('public.instructor_curations') is not null as curations,
  to_regclass('public.instructor_actions') is not null as actions,
  to_regclass('public.instructor_purge_operations') is not null as purge_operations,
  to_regclass('public.instructor_purge_tombstones') is not null as purge_tombstones,
  to_regprocedure('public.record_enrollment_auth_attempt(text,text,boolean)') is not null as enrollment_limiter,
  to_regprocedure('public.instructor_record_auth_attempt(text,text,text,boolean)') is not null as instructor_limiter,
  to_regprocedure('public.instructor_claim_purge(uuid,uuid)') is not null as purge_claim,
  to_regprocedure('public.instructor_release_purge(uuid,uuid)') is not null as purge_release,
  to_regprocedure('public.instructor_finalize_purge(uuid,uuid)') is not null as purge_finalize,
  to_regprocedure('public.enrollment_rate_allowed(text)') is not null as legacy_enrollment_check,
  to_regprocedure('public.record_enrollment_attempt(text,boolean)') is not null as legacy_enrollment_record,
  has_function_privilege(
    'service_role',
    'public.record_enrollment_auth_attempt(text,text,boolean)',
    'execute'
  ) as enrollment_limiter_execute,
  has_table_privilege('service_role', 'public.class_members', 'select') as member_select,
  has_table_privilege('service_role', 'public.class_members', 'insert') as member_insert,
  has_table_privilege('service_role', 'public.class_members', 'update') as member_update;
```

Every returned value should be `true`.

## 2. Create the Edge Function secrets

Open **Edge Functions → Secrets** in Supabase. Add these exact names:

| Secret | Value |
| --- | --- |
| `INSTRUCTOR_PASSWORD` | A unique, high-entropy shared password. The function rejects values below 16 characters; use at least 20. Four or more unrelated password-manager words plus punctuation is practical. |
| `INSTRUCTOR_SESSION_SECRET` | A password-manager-generated random value of at least 32 characters. It must be different from every other secret. |
| `INSTRUCTOR_RATE_LIMIT_SECRET` | A second, different random value of at least 32 characters. |
| `RATE_LIMIT_SECRET` | Enrollment-only keyed-address secret of at least 32 characters. Confirm the existing value or create a third different random value. |
| `ALLOWED_ORIGINS` | `https://gavsut.github.io` |

For `ALLOWED_ORIGINS`, use lowercase, no trailing slash, and no `/invasive-plant-survey-reno` path. The Edge Function matches the browser `Origin`, which contains the scheme and host only.

Do not use the class code, database password, service-role key, or publishable browser key as the instructor password. Do not place any secret value in GitHub, `config.js`, an issue, a screenshot, chat, or browser source.

Supabase automatically supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. Do not copy the service-role value into frontend code.

## 3. Deploy both Edge Functions

Deploy the functions immediately after the migration. The migration deliberately retains the legacy service-role-only enrollment RPCs so the prior `enroll-class` deployment remains compatible during this short interval. The new atomic per-client and global enrollment limits are not active until the updated `enroll-class` source is deployed.

### 3a. Redeploy `enroll-class`

1. Open **Edge Functions → `enroll-class` → Deploy new version**. If the dashboard does not offer that control, use **Deploy a new function → Via Editor** and keep the name exactly `enroll-class`.
2. Replace the editor contents with the complete contents of `backend/supabase/functions/enroll-class/index.ts`.
3. Turn **Verify JWT** or **Enforce JWT verification** **off**.
4. Select **Deploy function** and wait for the deployed status.

The updated enrollment handler still validates the anonymous Supabase session itself. It also requires an exact JSON media type, reads at most 4 KB through a bounded stream, caps its JSON response at 4 KB, derives a keyed digest from the canonical gateway client address rather than storing the raw address, and uses transactional database limits of 10 recent failures for that client bucket plus a 200-failure global backstop during a 15-minute window. A `429` response includes `Retry-After`. `RATE_LIMIT_SECRET` is server-only and must differ from the instructor secrets.

### 3b. Deploy `instructor-dashboard`

#### Supabase Dashboard method

1. Open **Edge Functions → Deploy a new function → Via Editor**.
2. Name the function exactly `instructor-dashboard`.
3. Start from the blank/basic template.
4. Delete the template and paste the complete contents of `backend/supabase/functions/instructor-dashboard/index.ts`.
5. Turn **Verify JWT** or **Enforce JWT verification** **off**.
6. Select **Deploy function** and wait for the deployed status.

Gateway JWT verification must be off because this function issues and verifies its own short-lived instructor token. The function still enforces exact-origin CORS, POST-only requests, password checks, rate limiting, token signatures, expiry, and server-only authorization.

Do not treat a rejection in the Supabase Dashboard's generic function tester as a failed deployment: this production function intentionally accepts only requests whose browser `Origin` is `https://gavsut.github.io`. Perform the login smoke test from the deployed GitHub Pages dashboard.

#### Supabase CLI method (optional)

If the Supabase CLI is already configured, run from the repository root:

```bash
supabase login
supabase link --project-ref apjjzoaayttcovofwzmc
supabase functions deploy enroll-class --no-verify-jwt
supabase functions deploy instructor-dashboard --no-verify-jwt
```

Set the secrets through the Supabase Dashboard so the shared password does not land in shell history. The repository's `backend/supabase/config.toml` marks both functions `verify_jwt = false` for local/CLI consistency.

## 4. Upload the GitHub Pages release

You can do this entirely in GitHub's web interface:

1. Extract the supplied GitHub web-update ZIP. It contains every added or changed release file plus root `index.html` and `.nojekyll`; unchanged files already in the existing repository do not need to be uploaded again. A separate complete-repository ZIP is supplied for Git/GitHub Desktop or a fresh checkout.
2. Open the extracted folder and confirm `index.html`, `instructor.html`, `app.js`, and `service-worker.js` are immediately inside it—not inside another enclosing project folder.
3. Open [the repository](https://github.com/GavSut/invasive-plant-survey-reno).
4. Select **Add file → Upload files**.
5. Upload the extracted web-update contents, including the root `.nojekyll` file, preserving all folders, and commit to `main`. This update bundle stays below GitHub's 100-file browser-upload limit. If you instead use the complete-repository ZIP, upload it in two commits or use Git/GitHub Desktop; do not flatten the folders.
6. Keep **Settings → Pages → Deploy from a branch → `main` → `/(root)`**.
7. Wait for the Pages deployment to complete.

There are **no manual file removals for this release**. GitHub's web uploader does not delete absent files, but v2.1 intentionally retains the guide files and assets. Do not delete `guide.html`, `guide.js`, `guide.css`, `assets/species/`, or `docs/IMAGE_SOURCES.md`.

The service-worker cache name changes for v2.1. Reopen the student app online after Pages completes, wait for the update, then close and reopen the tab. This refreshes app files without deleting valid protocol-v2 drafts, sessions, class membership, queued photos, or submitted records.

## 5. Verify the live release

Run, if Node.js is available:

```bash
node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/
```

The checker also sends a non-mutating `application/jsonp` probe to both Edge Functions. Each updated handler must return `415`; another status identifies a stale/missing function, an origin mismatch, or Verify JWT still being on.

Then check the live pages manually:

1. Open the [student app](https://gavsut.github.io/invasive-plant-survey-reno/) online. Confirm app `2.1.2`, 30 segments, 180 cells, 23 selectable targets, and no visible field-guide link or prompt.
2. Confirm an unobtrusive **Instructor** link appears near the bottom and opens `/instructor.html`.
3. In a clean student browser profile, join the test class with the correct class code and confirm membership is saved. In a controlled test, confirm a non-JSON enrollment request is rejected, an oversized request is bounded, and repeated wrong codes eventually return `429` with `Retry-After`. Do not deliberately reach the 200-failure global backstop in the production class project.
4. Before login, confirm the dashboard exposes only its title, password, reviewer-name field, sign-in control, status text, and link back to the survey.
5. Enter a wrong password once and confirm the page shows a generic rejection without data.
6. Enter the correct password and a reviewer name. Confirm classes and records load and the session clears when the tab closes.
7. Load or submit only the clearly labeled fixtures described in `sample-data/README.md`, then test filter, detail, original/curated comparison, download, state changes, trash, restore, and audit history.
8. Retry one instructor mutation after simulating a lost response and confirm its stable request ID prevents a duplicate logical audit/change.
9. Test purge only on a backed-up synthetic record. Confirm preview lists exact IDs/photo counts, password re-entry and typed confirmation are required, the write fence rejects a late photo, bounded cleanup reports continuation instead of deleting database rows early, finalization occurs only after repeated empty Storage checks, and a repeated attempt is reported safely.
10. Use two student browser profiles to confirm each can still read and update only its own records and photos.
11. Complete the deployed-path and physical-device checks in `docs/TESTING.md`.

Do not call the release live-ready solely because local tests pass. A production acceptance requires the migration, secrets, function, Pages build, owner-only authorization, private-photo behavior, and destructive synthetic-record flow to be verified against the actual Supabase project.

## Rollback boundary

If the new frontend is faulty, revert the GitHub commit or upload the prior frontend release. Do not drop the instructor tables or reverse the hardening migration: the additive database objects preserve data, and dropping them could destroy curation/audit history. If `instructor-dashboard` is faulty, redeploy a corrected version or temporarily remove access to `/instructor.html`. If updated enrollment is faulty, redeploy a corrected `enroll-class`; the retained legacy RPCs provide a bounded rollback path for the earlier enrollment handler, but they do not activate the new atomic client/global limiter.

If any permanent purge reports a partial failure, stop broad cleanup. Keep the operation/result details, do not recreate the same record ID, and retry only that exact trashed record after correcting the reported storage or database problem.
