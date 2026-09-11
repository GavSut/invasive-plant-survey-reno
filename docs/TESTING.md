# Testing and validation report

This report separates repeatable local checks from owner-only tests against the deployed Supabase project and GitHub Pages site. A source-code assertion or mocked browser API does **not** prove that a migration, secret, Edge Function, RLS policy, Storage rule, or deployed page is active.

## Local automated result

Run from the repository root:

```bash
npm test
npm run validate
git diff --check
```

Final local verification on **2026-09-10 UTC**:

- `npm test`: 99 passed, 0 failed.
- `npm run validate`: passed the project-integrity validator.
- `git diff --check`: passed.

The Node tests use pure functions, mocked `fetch`/`sessionStorage`/DOM boundaries, and static source/SQL contract checks. They make no network calls to the production Supabase project and do not permanently delete anything.

## Requirement-to-test matrix

| Area | What local automation checks | What remains an owner/live check |
|---|---|---|
| Student release | App/cache `2.3.2`, protocol `2.0.0`, 30 segments, six cells per segment, 180 total cells, four distinct statuses, immediate side-level no-target shortcuts that affect incomplete cells only, confirmed segment-wide shortcut, cell-level NS entry, 23-species selector, two-page navigation, landing-page class/backup tools, scientific-name-first choices, backup compatibility, retained guide files, and no visible student guide route | Open the deployed Pages site online once, then verify draft entry/reopen offline on real phones |
| Student isolation | Owner predicates remain in transect, membership, photo-metadata, and private-Storage policies; public roles receive no instructor-table grants; privileged strings are absent from public files | Use two anonymous browser profiles and prove each can read/update only its own records and photos |
| Student enrollment | Migration/fresh-schema parity for the atomic client/global attempt helper and backward-compatible legacy RPCs; service-role-only execution; HMAC/canonical-address source contract; exact JSON media type; 4-KB streamed-request and 4-KB response bounds; 72-byte bcrypt boundary; `429`/`Retry-After`; unchanged anonymous-user and membership checks | Redeploy the updated `enroll-class`, verify a real correct enrollment, exercise malformed/oversized requests, and run controlled concurrent wrong-code tests against the migrated project |
| Instructor login | Reviewer/password request shape, no password persistence, `sessionStorage` token storage, local expiry, bearer requests, 401 cleanup, no-store requests, CORS/method source guards, HMAC/expiry/credential-version source contracts, and atomic per-client/global rate-limit SQL | Correct/incorrect password, 8-failure client and 200-failure global login lockouts, separate 5/50 purge limits, `Retry-After`, forged/expired tokens, disallowed origin, tab closure, and password-rotation invalidation against the deployed function |
| Record listing | Complete filter serialization, common/scientific-name-to-code mapping, sparse filters, deterministic server paging, stable-count selection checks, sorting controls, empty states, class counts, aggregate scope labels, and explicit server caps | Exercise every filter alone and in combinations with real project rows; verify counts against SQL spot checks |
| Quick summaries | Exact pure-function counts; filtered server aggregates; plot selector; top-category selector; line/bar SVG paths; exact-values table; label escaping; empty states; and absence of map/tile dependencies | Switch through all four plots with real data and verify values against table/database spot checks at desktop, tablet, and phone widths |
| Record detail | Static controls for original/effective/curated/difference views, 180-cell grid, cell-status filtering, metadata/provenance, photo associations, review state, and audit history | Visually inspect large/old records, signed thumbnails, missing files, revision history, and concurrent updates |
| Curation | Protocol/catalog validation, duplicate rejection, GPS bounds, staged cell edits, immutable original/source identity, reason requirement, revision archive, optimistic versions, stale-source refusal, safe clear/revert semantics, and effective-export fallback | Save, conflict, clear, and revert a synthetic record against the migrated database; confirm the original JSONB value/hash is unchanged |
| Review/trash | Review/test/exclusion flags, default export exclusions, reasons, optimistic state versions, audited RPC source contracts, exact partial-result display, reversible trash, and restore controls | Trash/restore synthetic rows and compare payload, photos, student revisions, curation revisions, and audit rows before/after |
| Permanent purge | Trash-only preview, exact unique IDs, short-lived signed challenge, password re-entry, canonical path/display digest, shared write fence, renewable single-worker lease, bounded Storage continuation, two API empty-folder checks, final transactional `storage.objects` emptiness check, persisted `storage_pending`/`failed`/`completed` saga, tombstone, redaction, and reinsertion guard | Purge only the supplied synthetic rows; interrupt one attempt; verify late-write rejection, concurrent-worker exclusion, linked Storage objects, continuation/retry behavior, database retention before empty confirmation, tombstone, and unchanged unselected rows |
| Downloads | Selected/filtered/class/all scopes; curated/original/both; default trash/test/exclusion safeguards; 180-cell long CSV; multiple targets; `0`, `NS`, incomplete; metadata CSV; GeoJSON longitude/latitude order; raw JSON; manifest; RFC 4180 quoting; spreadsheet-formula neutralization | Open every downloaded file in the intended tools and reconcile record/row counts to the dashboard and database |
| Photo ZIP | STORE-format ZIP structure, safe path names, manifest inclusion, missing-URL partial results, credential-free signed fetches, declared and actual byte caps | Browser download receipt, memory use, expiry during a batch, HEIC/JPEG/PNG previews, and real missing/interrupted Storage objects |
| Deployment | Required-file inventory, JS syntax, CSP/referrer/SRI source contracts, network-only instructor service-worker branch, relative GitHub Pages paths, and synthetic fixture integrity | Apply the migration, redeploy updated `enroll-class`, deploy `instructor-dashboard`, configure secrets, upload Pages files, run the deployment checker, and perform the live acceptance checklist below |

## What local checks cannot prove

The following remain **pending** until the project owner performs them after deployment:

- that the dated migration committed successfully in Supabase;
- that the updated `enroll-class` version—not merely its backward-compatible database helpers—is deployed and enforcing the client/global enrollment limits;
- that `service_role` has exactly the deployed grants and student RLS remains owner-only;
- that the configured password, session-signing secret, rate-limit secret, and exact allowed origin are correct;
- that password rotation invalidates a token issued before the rotation;
- that private signed-photo URLs expire and are inaccessible without instructor authorization;
- that interrupted or bounded Storage deletion resumes safely, late writes are fenced, and the database is finalized only after the folder repeatedly verifies empty;
- that a generated browser download reaches the downloads folder on Safari, Chrome, iOS, and Android;
- that a large long-format/JSON export stays within the documented browser and Edge Function limits;
- that the deployed service worker replaces the previous cache without deleting valid protocol-v2 drafts or local photos.

No production migration, secret change, Edge deployment, GitHub push, live curation, or live purge is claimed by this report.

## Owner Supabase acceptance checklist

Use only the clearly labeled records from `sample-data/`. Back up the project first.

1. Run `20260910_instructor_dashboard_v2_1.sql` once in the SQL Editor and confirm the transaction completes without an error. Do not rerun the full fresh-install `schema.sql` on the existing project. Confirm the former enrollment RPCs remain service-role-only and callable until the updated function is deployed.
2. Immediately redeploy the updated `enroll-class` with Verify JWT off and confirm `RATE_LIMIT_SECRET` is private, unique, and at least 32 characters. The migration alone does not activate the new limiter.
3. Deploy `instructor-dashboard` with Verify JWT off, set all documented instructor secrets, and set `ALLOWED_ORIGINS` to the exact GitHub Pages origin.
4. From a disallowed origin or a request with no `Origin`, confirm preflight and POST are denied. From Pages, confirm only POST/OPTIONS work.
5. With a valid anonymous student session, confirm `enroll-class` accepts `application/json; charset=UTF-8`, rejects `application/jsonp`/missing media types with `415`, rejects a streamed body above 4 KB with `413`, and still saves membership for a correct class code.
6. In an isolated test window, send concurrent wrong-code requests from one client bucket. Confirm no more than 10 failures are admitted in 15 minutes and later responses are `429` with `Retry-After`. Test the 200-failure global backstop only in staging or an owner-controlled window, never immediately before class use. Confirm no raw client address is stored.
7. Attempt instructor login with no reviewer, a wrong password, and the correct password. Trigger the documented failed-attempt threshold in a controlled test and confirm a 429 response and `Retry-After`.
8. Copy and alter one character in a token; confirm rejection. Wait for expiry or use a short-lived staging configuration; confirm rejection and browser session cleanup.
9. Rotate the instructor password secret, confirm Supabase makes the new secret available, and verify that a token issued under the previous password no longer works. A Pages republish and function redeploy are not required for secret rotation. Rotate back only if intended.
10. In two clean browser profiles, anonymously enroll both students in one test class. Submit one synthetic transect from each. Confirm each profile sees/edits only its own row and photo; neither can select instructor tables or the class-wide export view with the publishable key.
11. Sign in to the dashboard. Compare each class count, filtered count, aggregate card, chart value, and GPS feature with a direct owner SQL count.
12. Save a synthetic curation. Capture `transects.payload` (or a canonical hash) before and after and confirm its JSONB value is unchanged, the current curation is separate, the audit row names the reviewer, and default exports use the current curation.
13. Simulate a lost response and retry the same curation/state/trash mutation with its original request ID. Confirm one logical change/audit result rather than a duplicate. Change the intended input and confirm the UI creates a different request ID.
14. Resubmit that student record, then confirm the prior curation is visibly stale and is not used as effective/default data. Confirm a stale save or revert returns a conflict rather than silently rebasing.
15. Mark a selected synthetic row as test and excluded. Confirm the same selected row disappears from default download eligibility and appears only when the corresponding opt-ins are checked.
16. Trash a synthetic row and confirm all payloads, revisions, curations, photos, and history remain. Restore it and confirm the complete record returns to active views.
17. Trash one synthetic record with photos. Start a purge, attempt a late student photo write after the fence, and confirm rejection. Interrupt or reach a bounded-deletion continuation where safely practical; verify database rows remain, reopen Trash, and resume only that record. Complete it and confirm two empty Storage reads occur before database finalization and the exact objects are gone before the transect is removed.
18. Repeat the completed purge request or preview the removed ID. Confirm it is idempotent/harmless, the tombstone remains, and a cached student client cannot recreate that record ID.
19. Select two synthetic records and make one stale before a bulk action. Confirm the 207 partial response identifies the exact success and failure and leaves retry decisions to the instructor.

## Download acceptance checklist

For one synthetic set containing a multi-species detected cell, a `surveyed_no_target` cell, an `NS` cell, an incomplete cell, line GPS, point GPS, no GPS, a current curation, and a stale curation:

1. Export selected records, all filtered records, the current class, and all classes.
2. Repeat long CSV with curated, original, and both sources. Confirm each source reconstructs 180 unique cell geometries per transect before additional rows for multiple observations.
3. Confirm default analysis downloads omit trashed, test, and excluded records independently; opt in to each category and reconcile counts.
4. Open the metadata CSV and confirm timestamps, revision count, completion, review/test/exclusion/trash, GPS, and photo totals.
5. Validate GeoJSON as a `FeatureCollection`: both endpoints produce `[longitude, latitude]` LineString coordinates, one endpoint produces a Point, and no endpoint produces no feature.
6. Inspect raw JSON and the photo manifest. Confirm neither contains a session token, password, service-role key, or signed URL.
7. Create a small photo ZIP and confirm every successful file plus `photo-manifest.csv` is present. Make one test object unavailable and confirm the ZIP still completes with a per-file failure.
8. Exceed the photo count/byte guard and the long/raw browser guard. Confirm the UI refuses the request with a smaller-batch instruction rather than hanging.

Browser ZIP creation intentionally uses a memory-bounded, no-compression STORE writer because survey images are already compressed. It is not a substitute for a server-side bulk export. The release must keep conservative count/byte limits and treat reported metadata size only as preflight; the fetched blob size is checked again.

## Deployed GitHub Pages and device checks

After GitHub Pages reports a successful deployment, run:

```bash
node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/
```

Then verify in desktop Chrome/Firefox/Safari and on iPhone Safari plus Android Chrome:

1. The student homepage has one secondary Instructor link and no field-guide link, while a direct `guide.html` URL still loads online.
2. Reopen the student app online once, then use airplane mode to create/edit a draft, refresh, close/reopen, export/import a backup, and reconnect/sync. Existing protocol-v2 drafts and local photos must remain.
3. Open `instructor.html` offline. It must show the explicit online-required response and must never fall back to cached `index.html`.
4. Before login, inspect the page and accessibility tree: no class names, counts, record IDs, observers, coordinates, photos, or chart labels may be exposed.
5. Exercise filters, sort, pagination, select-page, select-all-filtered, clear selection, row click/keyboard activation, all summary plot choices, dialogs, empty/error/partial states, and session expiry.
6. Test the dashboard at 200% zoom, with keyboard only, at tablet width, and at a narrow phone width. Confirm focus, scrolling, dialogs, tables, plots, and download controls remain usable.

Record the date, device/browser versions, tester, Supabase function version, migration identifier, and pass/fail evidence for every live check. Cloud emulation is not a substitute for physical-phone camera, GPS, offline reopening, or download testing.
