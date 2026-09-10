# Catalog normalization and code log

## Source preservation

The instructor attachment is preserved byte-for-byte at `data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv`.

- SHA-256: `f1432e35ab48f58a700b5f6e5c275170dcbc02e5089054388ec11e33083d8e21`
- Source target rows: 23
- Normalized target records: 23
- Unknown/questionable is an administrative observation type and is not a 24th target.

The source `Nevada Noxious Weed?` Y/N values and notes were copied without substantive changes. The app labels them as instructor-supplied classifications, not an independently updated legal-status claim.

## Corrected source text

Only spelling, whitespace, capitalization, punctuation, and display formatting were normalized.

| Source value | Normalized value | Reason and verification source |
| --- | --- | --- |
| `Chorispora tenalla` | `Chorispora tenella` | Scientific epithet spelling verified against USDA NRCS PLANTS symbol `CHTE2` |
| `perennial pepperweeed` | `Perennial pepperweed` | Common-name spelling and display capitalization; USDA profile `LELA2` |
| `Taeniatherum ` | `Taeniatherum` | Removed trailing whitespace; USDA profile `TACA8` |
| `Verbascum thaspis` | `Verbascum thapsus` | Scientific epithet spelling verified against USDA profile `VETH` |
| `Ulmacaeae` | `Ulmaceae` | Family spelling verified on USDA profile `ULPU` |
| `tamarisk; saltcedar` / `Tamarix spp` | `Tamarisk / saltcedar` / `Tamarix spp.` | Display punctuation only; the genus-level category remains intact |
| Lowercase/mixed common-name starts | Initial-cap display names | Formatting only; target meaning unchanged |

`Lepidium draba` remains the instructor's target name. The supplied note “formerly, Cardaria draba” is retained, and `Cardaria draba` is searchable as an alias rather than silently revising the target.

## Species codes

All 23 display codes were verified as USDA NRCS PLANTS symbols on **2026-09-10**. No local fallback codes were needed. Official numeric suffixes are preserved, including `SATR12`, `COMA2`, `CANU4`, `CESO3`, `CEDI3`, `CIAR4`, `CHTE2`, `LELA2`, `TACA8`, `CETE5`, and genus-level `TAMAR2`.

`TAMAR2` is the verified USDA genus-level symbol for `Tamarix`; it is not a code borrowed from one saltcedar species. The complete mapping, source profile URL, authority, verification date, normalized names, supplied classifications, notes, and aliases are in `data/species_code_crosswalk.csv`.

Verification used the official [USDA NRCS PLANTS profiles](https://plants.usda.gov/home) and the USDA PLANTS search/profile records referenced by each catalog entry. `species.js` is authoritative at runtime; the crosswalk is a human-readable export generated with `npm run catalog:crosswalk`.

## Future changes

Treat a taxonomic change, split/merge, code replacement, or changed legal classification as a substantive instructor decision—not spelling cleanup. Record the original and replacement, reason, authority, date, aliases/synonyms, and catalog-version change here before release.
