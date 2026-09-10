# Invasive Plant Survey Reno

Created in part with large-language-model assistance for project owner **Gavin Sutter**. Requirements refinement: **ChatGPT — GPT-6 Astra Pro — September 9, 2026**. Protocol-v2 implementation, testing, and documentation: **Codex — GPT-5 — September 10, 2026**. The model and date of the earlier implementation were not recorded; the credits above do not attribute that earlier work.

[Open the GitHub Pages site](https://gavsut.github.io/invasive-plant-survey-reno/) · [Open the species identification guide](https://gavsut.github.io/invasive-plant-survey-reno/guide.html)

This is a phone-first field app for a 30 m invasive-plant transect. It stores drafts and photos locally, works for survey entry without a connection after one successful online load, exports CSV/JSON backups, and synchronizes owned submissions to the existing Supabase project. The public identification guide is deliberately online-only.

## Current protocol

- 30 along-trail segments: **0–1 m** through **29–30 m**. The endpoints are boundaries, not extra rows.
- Three perpendicular bands on each side: **0–1 m**, **1–2 m**, and **2–3 m**, measured from the trail centerline.
- 30 segments × 2 sides × 3 bands = **180 unique 1 m × 1 m cells**.
- LEFT and RIGHT are fixed while facing from transect start toward transect end.
- Assign a plant to the cell containing its rooted location.
- Record presence only. A target can occur once per cell; different targets may share a cell.
- `0` means surveyed with no target, `NS` means not surveyed, and blank means incomplete. `NS` counts as a completed status but not as surveyed area.
- Unknown/questionable plants remain distinct from the 23 target taxa.

Protocol version is `2.0.0`; schema version is `2`; catalog version is `reno-2026.1`.

## Student use

1. Open the site online once before fieldwork and join with the shared class code.
2. Create a field transect and enter observers, date, site, trail, transect number, and times. Endpoint GPS is optional.
3. Work from 0–1 m through 29–30 m. Opening or advancing past a cell never marks it complete.
4. Save each cell as detections, `0`, `NS`, or intentionally leave it incomplete. Use **Cancel** to discard an open cell draft.
5. Use **ID guide** links when online. They open separately so the unsaved cell stays in the survey tab.
6. Review the summary, resolve or acknowledge incomplete cells, and submit. Submission is not reported as successful until the server confirms it.
7. If sync fails, keep the record on the phone, export its JSON backup, reconnect, and use manual retry.

Do not clear site data, use private browsing, switch browser profiles, or discard the phone until the instructor confirms receipt. Those actions can remove the device-held anonymous identity and local-only records.

## Update the target catalog and guide

`species.js` is the one authoritative normalized catalog used by entry, validation, exports, and the guide. To change it:

1. Make a copy of the instructor's new source list under `data/source/`.
2. Edit the corresponding records in `species.js`. Add/remove a whole `record({...})` block; edit the code, names, aliases, classification, guide cues, sources, and image records inside that block.
3. Keep codes unique. Verify government symbols rather than inventing them, retain the authority/source/date fields, and never put `UNKNOWN` in `SPECIES`.
4. Increment `SPECIES_LIST_VERSION` even for a correction.
5. Run `npm run catalog:crosswalk` to regenerate `data/species_code_crosswalk.csv` from the authoritative catalog.
6. Run `npm test` and `npm run validate`, then search the selector and guide by code, common name, scientific name, and alias.

The unchanged 2026 source attachment is preserved at `data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv`. Normalization and code decisions are recorded in [Catalog corrections](docs/CATALOG_CORRECTIONS.md).

## Deploy an update

The repository already contains the browser-safe Supabase project URL/key and uses only relative site paths.

1. Complete the one-time protocol-v2 backend transition in [UPDATE.md](UPDATE.md) before releasing this version.
2. Upload or push the complete repository contents to the root of `main`—do not add an enclosing folder or upload a ZIP.
3. In GitHub, keep **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
4. Wait for the Pages deployment, then run `node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/`.
5. Reopen the site online on each phone. Confirm **Class & backup → Current versions** shows app/protocol `2.0.0` and catalog `reno-2026.1` before entering data.

For later code releases, update `CONFIG.appVersion`, `package.json`, and the service-worker cache name together. A cache-name change updates app files; it must not become a recurring data reset.

## Security

`config.js` contains a publishable browser key by design. Row Level Security and device-held anonymous Auth provide the access boundary. Never commit a class code, database password, `service_role`/secret key, cleanup credential, or student data. The identification guide is public; submissions and survey photos are not.

## Documentation

- [One-time v2 update and instructor operations](docs/BACKEND_AND_OPERATIONS.md)
- [Architecture and backend choice](docs/ARCHITECTURE.md)
- [Long-format data dictionary](docs/DATA_DICTIONARY.md)
- [Catalog corrections and USDA code verification](docs/CATALOG_CORRECTIONS.md)
- [Guide image provenance and reuse records](docs/IMAGE_SOURCES.md)
- [Actual testing and remaining device checks](docs/TESTING.md)
- [Sample long-format CSV](data/sample_long_format.csv)
- [Historical retired 5 m materials](archive/legacy-5m/README.md)

Local checks require Node.js but no package install:

```bash
npm test
npm run validate
```
