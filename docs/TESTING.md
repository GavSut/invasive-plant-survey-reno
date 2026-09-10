# Testing and validation report

This report distinguishes automated/source checks, cloud-browser checks, emulation, and physical-device checks. It does not treat one as proof of another.

## Pre-change live reproduction — 2026-09-10 UTC

The then-deployed GitHub Pages release was opened in cloud-hosted Chrome at a 1363 × 936 CSS-pixel viewport before editing. A locally saved test transect was opened and its LEFT 0–1 m cell editor inspected.

- Deployed content still showed five bands, 300 cells, and the former placeholder catalog.
- The dialog was 832 px high; its scroll body was 693 px high with 847 px of content.
- A mouse wheel inside the body did scroll it to 153 px, so a total loss of wheel scrolling was **not** reproducible at that one viewport.
- The page behind the dialog was not intentionally locked, and the layout left the form/action geometry fragile as content and zoom increased. This matched the reported class of competing/clipped scrolling even though the strongest failure did not occur in that run.

The replacement uses one bounded flex dialog, one shrinking internal scroll region, a fixed internal footer, explicit Save/Cancel, `dvh` limits, background locking, and page-position/focus restoration on Save, Cancel, Escape, and opening errors.

## Automated checks

Run from the repository root:

```bash
npm test
npm run validate
```

Final local run on **2026-09-10 UTC**:

- `npm test`: **23 passed, 0 failed**.
- `npm run validate`: **passed** all 31 required-file, JavaScript syntax, geometry, 23-target catalog, 38-image, source-checksum, sample-CSV, offline-boundary, backend-guard, cleanup-scope, and attribution checks.
- `git diff --check`: **passed** with no whitespace errors.

Covered assertions include:

- 30 segments, 0–1 through 29–30 m, with no endpoint row;
- exactly 180 unique cells and only the 0–1, 1–2, and 2–3 m bands on both sides;
- unique target per cell, multiple different targets allowed, and unknown kept separate;
- `0`, `NS`, blank, and detected states plus surveyed-vs-completed counts;
- long export represents all cell geometries and expands multi-target cells;
- schema/protocol/code validation rejects legacy backups and unknown target codes;
- explicit cell drafts: Cancel discards and Save commits;
- dialog scroll/body-lock source contract and online-only guide cache boundary;
- exactly 23 catalog targets, unique attributed codes, unchanged instructor classifications, guide content, image metadata/files, and preserved source checksum;
- backend SQL guards, migration/cleanup scope, safe public configuration, sample CSV, and deployed-file expectations.

## Post-deployment browser checks

These must be run against the actual Pages URL after this commit is deployed:

At delivery, `node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/` correctly **failed** because the live site returned HTTP 404 for `guide.html`; the v2 files were not yet deployed. A Git push dry run also failed because this workspace has no GitHub credentials. Therefore, no post-deployment v2 browser result is claimed.

1. Open the homepage before enrollment; search the guide and open a direct `guide.html#BRTE` link.
2. Create a transect and confirm each side has 0–1, 1–2, 2–3 m only and progress starts at 0/180.
3. Scroll the open editor to the final target, note, photo, Cancel, and Save controls at normal size and 200% browser zoom.
4. Exercise wheel, trackpad-equivalent scrolling, Tab/Shift+Tab, Escape, touch emulation, and a viewport reduced for an on-screen keyboard.
5. Start an unsaved cell draft, open species help, return to the original app tab, and confirm the selected species/note and body scroll position remain. Cancel must discard; Save must persist and restore focus to the same grid cell.
6. Repeatedly open cells near the top and bottom of a long page; verify no stale body lock or page jump.
7. Break/disable one guide image request and verify its explicit unavailable state.
8. Go offline: the guide must explain that it needs connectivity while survey entry remains usable.
9. Refresh and close/reopen with a draft; create two local transects; export and re-import JSON; confirm old v1 backup rejection.
10. Reconnect and test initial submit, double tap, uncertain response retry, owned edit/revision, and interrupted photo upload.

## Backend/privacy acceptance

Use two separate browser profiles enrolled in the same test class. Each should read/update only its own transect. Verify signed-out requests cannot read class, membership, transect, revision, or photo rows; a student cannot set instructor-only columns; the export view is not granted to browser roles; and private photo paths are owner-scoped.

Source SQL contains these controls, but only testing against the migrated project proves its deployed state.

The cutoff-scoped cleanup was **not executed** and the migration was **not applied** from this workspace because no owner-only Supabase service-role/database credential was available. The repository contains the guarded dry-run/execute script and dated transactional migration; the remaining owner steps are in `docs/BACKEND_AND_OPERATIONS.md`.

## GPS and physical phones

On both iPhone Safari and Android Chrome, test permission granted, denied, unavailable/timeout, poor reported accuracy, manual coordinates, and continuing with no GPS. Also test camera capture, file selection, airplane-mode close/reopen, installed/add-to-home-screen behavior, and the on-screen keyboard.

No physical phone, physical trackpad, desktop Firefox, or Safari engine was available in the implementation environment. Those items must remain labeled pending until the instructor performs them; cloud Chrome or device emulation is not reported as physical testing.
