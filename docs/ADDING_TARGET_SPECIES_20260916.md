# Two additional field targets — September 16, 2026

| Common name | Scientific name | USDA PLANTS symbol |
|---|---|---|
| Redstem stork's bill | Erodium cicutarium | ERCI6 |
| Clasping pepperweed | Lepidium perfoliatum | LEPE2 |

The selectable catalog now has 25 species. New transects use catalog stamp
`reno-2026.2`. Existing `reno-2026.1` records and backups remain accepted, including
edits adding either new species. The earlier creation stamp is preserved because
submitted record identity is immutable. No existing survey is rewritten or
deleted, and the 30 m / 180-cell protocol stays at `2.0.0`.

The browser selector, guide, crosswalk, database validator/catalog, and instructor
function all accept both additions. The original 23-row instructor CSV is kept
unchanged. No Nevada noxious classification was supplied for the additions, so
that field remains explicitly unspecified. Identification cues have source links;
local photos have not been added. The uploaded homepage PDFs are separate files
and have not been edited by this catalog update.

## Publish in this order

1. Open the existing Supabase project `apjjzoaayttcovofwzmc`, then **SQL Editor**.
   Run `backend/supabase/migrations/20260916_target_catalog_v2.sql` in a new query.
   The result must show **25** accepted species for both `reno-2026.1` and
   `reno-2026.2`. This requires the earlier instructor-dashboard migration. The
   script is safe to rerun and rolls back if either catalog is incomplete.
   Do not run the full `schema.sql` against the existing project.
2. Open **Edge Functions → instructor-dashboard**, open its code editor, and
   replace `index.ts` with the complete included
   `backend/supabase/functions/instructor-dashboard/index.ts`. Choose
   **Deploy updates**. Preserve the existing secrets and the existing
   **Verify JWT off** setting; this function verifies its own instructor token.
   The enrollment function requires no change. Uploading a TypeScript file to
   GitHub alone does not redeploy a Supabase function.
3. Upload all files inside the package's `upload` folder to the root of
   `GavSut/invasive-plant-survey-reno`, preserving the nested directories, and
   commit to `main`. Wait for GitHub Pages to publish.
4. Sync or back up field work, then use the small **Refresh site** icon beside
   the title. Open a cell and search for `ERCI6`, `LEPE2`, or either plant name.

Apply the database and function changes before the frontend: the old database
rejects catalog `reno-2026.2` and the two new species codes.

## Validation completed locally

- Selector interaction: both taxa appear and are retained when the cell is saved.
- Student validation, student CSV, and instructor exports retain both codes for
  old and new catalog stamps.
- The migration compiled and ran twice in local PostgreSQL (PGlite), populated
  both 25-code catalogs, and preserved an existing survey unchanged.
- SQL and the actual instructor TypeScript validator accepted both new codes
  under both supported stamps and rejected unknown codes, unknown stamps, and
  malformed geometry.
- The project validator passes. The full Node suite has 109 passing tests and
  the same four pre-existing instructor-interface contract failures.
- Live Supabase deployment and a physical-phone check have not been performed.

## Sources

- [USDA profile for ERCI6](https://plants.usda.gov/home/plantProfile?symbol=ERCI6)
- [USDA profile for LEPE2](https://plants.usda.gov/home/plantProfile?symbol=LEPE2)
- [USDA API record for ERCI6](https://plantsservices.sc.egov.usda.gov/api/PlantProfile?symbol=ERCI6), retrieved 2026-09-16: plant ID 83665, Erodium cicutarium, redstem stork's bill.
- [USDA API record for LEPE2](https://plantsservices.sc.egov.usda.gov/api/PlantProfile?symbol=LEPE2), retrieved 2026-09-16: plant ID 63352, Lepidium perfoliatum, clasping pepperweed.
- [Utah State University identification reference](https://extension.usu.edu/rangeplants/forbs-herbaceous/storks-bill)
- [University of Washington Burke Herbarium identification reference](https://burkeherbarium.org/imagecollection/taxon.php?Taxon=Lepidium+perfoliatum)
- [Supabase dashboard deployment instructions](https://supabase.com/docs/guides/functions/quickstart-dashboard)
