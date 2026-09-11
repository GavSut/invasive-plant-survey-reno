# Invasive Plant Survey Reno

Created in part with large-language-model assistance for project owner **Gavin Sutter**. Requirements refinement: **ChatGPT — GPT-6 Astra Pro — September 9, 2026**. Protocol-v2 implementation, testing, and documentation: **Codex — GPT-5 — September 10, 2026**. The model and date of the earlier implementation were not recorded; these credits do not attribute that earlier work.

[Open the field survey](https://gavsut.github.io/invasive-plant-survey-reno/) · [Open the instructor dashboard](https://gavsut.github.io/invasive-plant-survey-reno/instructor.html)

This repository contains two interfaces backed by the existing Supabase project:

- A phone-first student survey that saves drafts and photos locally, works offline after one successful online load, and synchronizes only the signed-in device's records.
- An online-only instructor dashboard for class-wide exploration, review, non-destructive curation, downloads, private-photo review, reversible trash, and password-confirmed permanent purge.

The release version is **2.2.0**. The ecological protocol remains `2.0.0`, schema version remains `2`, and the species-list version remains `reno-2026.1`. Release 2.2.0 removes the instructor map and replaces it with a clean, interactive Quick summaries plot while preserving GPS fields and GeoJSON exports.

## Current protocol

- 30 along-trail segments: **0–1 m** through **29–30 m**. The endpoints are boundaries, not extra rows.
- Three perpendicular bands on each side: **0–1 m**, **1–2 m**, and **2–3 m**, measured from the trail centerline.
- 30 segments × 2 sides × 3 bands = **180 unique 1 m × 1 m cells**.
- LEFT and RIGHT are fixed while facing from transect start toward transect end.
- Assign a plant to the cell containing its rooted location.
- Record presence only. A target can occur once per cell; different targets may share a cell.
- `0` means surveyed with no target, `NS` means not surveyed, and blank means incomplete. `NS` counts as a completed status but not as surveyed area.
- Unknown/questionable plants remain distinct from the 23 target taxa.

## Student use

1. Open the field survey online once before fieldwork and join with the shared class code.
2. Create a field transect and enter observers, date, site, trail, transect number, and times. Endpoint GPS is optional.
3. Work from 0–1 m through 29–30 m. Opening or advancing past a cell never marks it complete.
4. Save each cell as detections, `0`, `NS`, or intentionally leave it incomplete. Use **Cancel** to discard an open cell draft.
5. Review the summary, resolve or acknowledge incomplete cells, and submit. Submission is not reported as successful until the server confirms it.
6. If sync fails, keep the record on the phone, export its JSON backup, reconnect, and use manual retry.

Do not clear site data, use private browsing, switch browser profiles, or discard the phone until the instructor confirms receipt. Those actions can remove the device-held anonymous identity and local-only records.

The identification-guide source and assets remain archived in this repository, and its direct URL continues to work. The normal student workflow no longer displays or advertises guide links.

## Instructor dashboard

The dashboard is not a direct database client. It sends authenticated requests to the `instructor-dashboard` Supabase Edge Function; only that server-side function holds class-wide privileges. Before login, the page exposes no class data.

The owner must install the dated migration, redeploy the updated `enroll-class` function, deploy the new `instructor-dashboard` function, keep gateway JWT verification disabled for both, and set the documented server-side secrets before publishing the frontend update. Start with [UPDATE.md](UPDATE.md). After setup, [Instructor dashboard guide](docs/INSTRUCTOR_DASHBOARD.md) explains filtering, selection, record review, curation, exports, trash, restore, purge, and photo handling.

Do not use permanent purge for ordinary cleanup. Curation preserves the student payload, and trash is reversible. Purge is reserved for confirmed records—normally clearly labeled synthetic test data—after a current backup.

## Deploy this release

This is an update to the existing repository and backend:

1. Back up the current database and private-photo inventory.
2. In Supabase SQL Editor, run `backend/supabase/migrations/20260910_instructor_dashboard_v2_1.sql`. Do **not** rerun the full schema on the existing project.
3. Immediately redeploy `backend/supabase/functions/enroll-class/index.ts` as `enroll-class`, then deploy `backend/supabase/functions/instructor-dashboard/index.ts` as `instructor-dashboard`. Turn **Verify JWT** off for both and set the documented server secrets. The migration keeps the former enrollment RPCs temporarily compatible, but the atomic enrollment limiter is active only after the updated `enroll-class` code is deployed.
4. For the existing repository, extract the supplied GitHub web-update ZIP and upload its contents to the root of `main`. The complete-repository ZIP is also supplied for Git/GitHub Desktop or a fresh checkout.
5. Wait for Pages, run the deployed checker, and perform the live synthetic-record checks in `docs/TESTING.md`.

There are **no paths to delete manually for v2.1**. In particular, keep `guide.html`, `guide.js`, `guide.css`, guide images, and guide-source documentation. They are retained but no longer linked from the survey interface.

See [UPDATE.md](UPDATE.md) for the exact Supabase Dashboard, optional CLI, GitHub web-upload, verification, and rollback sequence.

Clearly labeled fixtures for dashboard and phone-import testing are in [sample-data](sample-data/README.md). Their invented coordinates are near Null Island and must never be analyzed as field observations.

## Update the target catalog

`species.js` is the authoritative normalized catalog used by survey entry, protocol validation, exports, and the retained guide source. To change it:

1. Save the instructor's unchanged source list under `data/source/`.
2. Edit records in `species.js`. Keep codes unique and never put `UNKNOWN` in `SPECIES`.
3. Verify government symbols; record sources and normalization decisions rather than silently changing classification meaning.
4. Increment `SPECIES_LIST_VERSION` and create a reviewed database migration that updates the exact catalog/version allow-list in `is_protocol_v2_payload`, `target_species_catalog`, and the instructor Edge Function. Direct student submissions are intentionally rejected when their version or code is outside that server-side list.
5. Run `npm run catalog:crosswalk` to regenerate `data/species_code_crosswalk.csv`.
6. Run `npm test` and `npm run validate`, then apply the catalog migration before publishing the matching frontend.

The 2026 source attachment is preserved at `data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv`. Decisions are recorded in [Catalog corrections](docs/CATALOG_CORRECTIONS.md).

## Security boundaries

- `config.js` contains only the browser-safe Supabase project URL and publishable key.
- Student access remains anonymous Auth plus class enrollment and owner-only Row Level Security.
- Class enrollment accepts only a bounded JSON request with the correct media type and applies an atomic rolling limit to keyed client-address attempts plus a higher global backstop. Raw network addresses are not stored.
- The shared instructor password, session-signing secret, rate-limit secret, Supabase service-role key, database password, and class code must never be committed.
- Instructor-wide reads and writes go through the Edge Function. Browser roles receive no grants on instructor tables.
- Instructor sessions last 30 minutes and live only in `sessionStorage`; closing the tab ends the browser session. Rotating the instructor password invalidates existing tokens.
- Failed instructor login and purge-password attempts use separate atomic per-client limits plus database-wide backstops, with canonical addresses stored only as keyed digests.
- Survey photos remain in a private bucket and are viewed through short-lived signed URLs.
- Instructor mutations and audited exports use stable request IDs so an identical retry after an uncertain network response does not silently create a second logical action. Permanent purge additionally fences student photo writes, leases one cleanup worker at a time, deletes Storage in bounded batches, and finalizes database removal only after both API and transactional Storage checks confirm the private folder is empty.

The lightweight shared-password dashboard does not provide individual accounts, MFA, or cryptographic proof of reviewer identity. Reviewer names are required and audited, but are self-declared. See [Security and architecture](docs/ARCHITECTURE.md) for the complete model and limitations.

## Documentation

- [v2.1 owner deployment checklist](UPDATE.md)
- [Backend setup and semester operations](docs/BACKEND_AND_OPERATIONS.md)
- [Instructor dashboard guide](docs/INSTRUCTOR_DASHBOARD.md)
- [Security and architecture](docs/ARCHITECTURE.md)
- [Long-format data dictionary](docs/DATA_DICTIONARY.md)
- [Catalog corrections and USDA code verification](docs/CATALOG_CORRECTIONS.md)
- [Guide image provenance and reuse records](docs/IMAGE_SOURCES.md)
- [Concrete testing and remaining live checks](docs/TESTING.md)
- [Synthetic dashboard and phone-import fixtures](sample-data/README.md)
- [Sample long-format CSV](data/sample_long_format.csv)
- [Historical retired 5 m materials](archive/legacy-5m/README.md)

Local checks require Node.js but no package installation:

```bash
npm test
npm run validate
node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/
```

The final command checks the live Pages assets and sends a non-mutating invalid-media probe to both Edge Functions; it therefore requires network access. A green result proves the updated handlers are reachable with gateway JWT verification off, but it does not prove the database migration, secrets, enrollment, or destructive workflows are correct—complete the live checklist as well.
