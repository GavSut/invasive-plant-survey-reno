import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { SPECIES, SPECIES_LIST_VERSION } from "../species.js";
import { addSpecies, createTransect, findCell, validateTransect, toLongCsv } from "../protocol.js";
import { buildLongExport } from "../instructor-downloads.js";

for (const version of ["reno-2026.1", SPECIES_LIST_VERSION]) {
  test(`both new targets survive validation and student/instructor exports for ${version}`, () => {
    const transect = createTransect({ speciesListVersion: version });
    const cell = findCell(transect, 0, "left", 0);
    addSpecies(cell, "ERCI6");
    addSpecies(cell, "LEPE2");
    const allowedSpeciesCodes = new Set(SPECIES.map((species) => species.code));
    assert.deepEqual(validateTransect(transect, { allowedSpeciesCodes }), []);
    const csv = toLongCsv([transect]);
    assert.match(csv, /ERCI6,detected/);
    assert.match(csv, /LEPE2,detected/);
    const rows = buildLongExport({
      transects: [{ id: transect.id, payload: transect, species_list_version: version }],
      states: [], curations: [], photos: [],
    }, { sourceMode: "original" });
    assert.equal(rows.filter((row) => row.species_code === "ERCI6").length, 1);
    assert.equal(rows.filter((row) => row.species_code === "LEPE2").length, 1);
    assert.ok(rows.every((row) => row.species_list_version === version));
  });
}

test("database migration and instructor filters accept exactly the browser catalog", async () => {
  const migration = await fs.readFile(new URL("../backend/supabase/migrations/20260916_target_catalog_v2.sql", import.meta.url), "utf8");
  const edge = await fs.readFile(new URL("../backend/supabase/functions/instructor-dashboard/index.ts", import.meta.url), "utf8");
  const sqlCodes = migration.match(/v_target_codes constant text\[\] := array\[([\s\S]*?)\];/)[1];
  const edgeCodes = edge.match(/const TARGET_CODES = new Set\(\[([\s\S]*?)\]\);/)[1];
  const expected = SPECIES.map((species) => species.code).sort();
  assert.deepEqual([...sqlCodes.matchAll(/'([A-Z0-9]+)'/g)].map((match) => match[1]).sort(), expected);
  assert.deepEqual([...edgeCodes.matchAll(/"([A-Z0-9]+)"/g)].map((match) => match[1]).sort(), expected);
  assert.doesNotMatch(migration, /delete\s+from|truncate\s|update\s+public\.transects|drop\s+table/i);
  assert.match(migration, /not in \('reno-2026\.1', 'reno-2026\.2'\)/);
  assert.match(edge, /filters\.speciesCodes\.length > TARGET_CODES\.size/);
});
