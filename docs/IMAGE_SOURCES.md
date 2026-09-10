# Identification-guide image sources

The guide currently references 38 locally stored USDA PLANTS image assets across 22 of the 23 target cards. Diffuse knapweed (`CEDI3`) intentionally shows an image gap because no suitable image with a sufficiently clear reusable USDA record was selected; its text card and authoritative profile remain available.

Every image's runtime record is stored beside its species in `species.js` and contains:

- local asset path and meaningful alt text;
- creator, provider/institution, and concise required-attribution text;
- taxon identified by the source;
- original USDA image-record URL and asset URL;
- reuse basis;
- access date; and
- modifications plus optional date/location metadata.

The guide shows creator, provider, and a source/reuse link next to each image. Opening an image shows the fuller rights statement. Broken assets collapse to an explicit unavailable state instead of leaving misleading blank content.

## Reuse basis

The selected USDA PLANTS API records reported `Copyright=false` when checked on **2026-09-10**. USDA PLANTS states that images without a copyright notice may be used for any purpose. That per-image result—not government-site ownership alone—is the recorded reuse basis. Assets with a visible copyright watermark or unclear permission were not selected. No watermark was removed, no generated plant image is used, and no related species is presented as an unlabeled substitute.

Some USDA profile records retain historical filenames/synonyms. Those cases are explicitly described in `sourceTaxon` rather than being treated as a different target. The genus-level `Tamarix` images are labeled as genus examples and do not claim to show every tamarisk species.

Original source records are generated from each record's `plantId` as:

```text
https://plantsservices.sc.egov.usda.gov/api/PlantImages?plantId=PLANT_ID
```

The current standard-size files live under `assets/species/`. Guide assets are public reference material and are separate from private student-uploaded photos. They are not in the survey app's mandatory offline precache.

Before adding or replacing an image, verify identity and permission on the individual source record; record every metadata field; optimize without destroying diagnostic detail; and run `npm run validate` to check file and credit completeness.
