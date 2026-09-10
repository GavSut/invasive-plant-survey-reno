# One-time update to protocol v2

This release changes the active survey from five bands/300 cells to three bands/180 cells, installs the 23-target Reno catalog and online guide, rejects retired records/backups, and repairs the cell editor's scrolling and explicit Save/Cancel behavior.

## Owner actions in order

1. Pause class use during the transition.
2. Follow **One-time protocol-v2 transition** in [docs/BACKEND_AND_OPERATIONS.md](docs/BACKEND_AND_OPERATIONS.md): dry-run and execute the cutoff-scoped owner cleanup, then run `backend/supabase/migrations/20260910_protocol_v2.sql` in Supabase SQL Editor.
3. Upload/push every repository file to `main`, preserving folders. Do not upload an enclosing directory or ZIP.

   If you use **GitHub → Add file → Upload files**, it will not remove paths that are absent from the new package. After the upload, delete these retired root copies in GitHub (their appropriate replacements are under `docs/` or `archive/legacy-5m/`):

   - `ARCHITECTURE.md`
   - `DATA_DICTIONARY.md`
   - `INSTRUCTOR_WORKFLOW.md`
   - `TESTING.md`
   - `field-sheet/Invasive_Plant_Transect_Field_Sheet.docx`
   - `tools/build_field_sheet.py`
   - `tools/verify_field_sheet.py`

4. Wait for GitHub Pages, then run:

   ```bash
   node tools/check-deployed.mjs https://gavsut.github.io/invasive-plant-survey-reno/
   ```

5. Open the live site online in a fresh/private test profile. Verify app/protocol `2.0.0`, 180 cells, exactly three bands per side, 23 targets, and the separate guide.
6. Reopen existing class phones online before data collection. The release performs one version-scoped local transition that deletes incompatible five-band drafts/queued photos once while preserving membership settings. Do not clear browser data manually.
7. Complete the browser/device/backend checklist in [docs/TESTING.md](docs/TESTING.md).

The cleanup is intentionally absent from public client controls. It requires the owner-only server key and exact confirmation phrase. This repository does not contain that secret and cannot silently perform the backend deletion.

The existing `enroll-class` Edge Function does not change in v2. Do not rerun the full fresh-install schema on the existing project; use the dated migration.
