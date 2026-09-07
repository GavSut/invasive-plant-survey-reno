import test from "node:test";
import assert from "node:assert/strict";
import {
  CELL_STATUSES,
  DISTANCE_BANDS,
  addSpecies,
  addUnknown,
  computeSummary,
  createTransect,
  findCell,
  markCells,
  rowsForTransect,
  setCellStatus,
  toLongCsv,
  validateTransect,
} from "../protocol.js";

test("30-meter geometry contains exactly 30 segments and 300 cells", () => {
  const transect = createTransect();
  assert.equal(transect.segments.length, 30);
  assert.equal(transect.segments[0].label, "0-1 m");
  assert.equal(transect.segments[14].label, "14-15 m");
  assert.equal(transect.segments[15].label, "15-16 m");
  assert.equal(transect.segments[29].label, "29-30 m");
  assert.equal(transect.segments.flatMap((segment) => segment.cells).length, 300);
  assert.deepEqual([...new Set(transect.segments.flatMap((segment) => segment.cells.map((cell) => cell.side)))].sort(), ["left", "right"]);
  assert.deepEqual([...new Set(transect.segments[0].cells.map((cell) => `${cell.bandStart}-${cell.bandEnd}`))], DISTANCE_BANDS.map((band) => `${band.start}-${band.end}`));
});

test("species duplicates are prevented within a cell but multiple species are allowed", () => {
  const transect = createTransect();
  const cell = findCell(transect, 12, "left", 2);
  assert.equal(addSpecies(cell, "brte"), true);
  assert.equal(addSpecies(cell, "BRTE"), false);
  assert.equal(addSpecies(cell, "CEMA"), true);
  assert.deepEqual(cell.species, ["BRTE", "CEMA"]);
  assert.equal(cell.status, CELL_STATUSES.DETECTED);
});

test("zero, not-surveyed, and incomplete remain distinct", () => {
  const transect = createTransect();
  const zero = findCell(transect, 0, "left", 0);
  const ns = findCell(transect, 0, "left", 1);
  const blank = findCell(transect, 0, "left", 2);
  setCellStatus(zero, CELL_STATUSES.NO_TARGET);
  setCellStatus(ns, CELL_STATUSES.NOT_SURVEYED);
  assert.equal(zero.status, "surveyed_no_target");
  assert.equal(ns.status, "not_surveyed");
  assert.equal(blank.status, "incomplete");
  const summary = computeSummary(transect);
  assert.equal(summary.noTargetCells, 1);
  assert.equal(summary.notSurveyedCells, 1);
  assert.equal(summary.incompleteCells, 298);
  assert.equal(summary.completed, 2);
});

test("intentional batch action changes incomplete cells only", () => {
  const transect = createTransect();
  const detected = findCell(transect, 4, "right", 0);
  addSpecies(detected, "BRTE");
  const changed = markCells(transect, 4, "right", CELL_STATUSES.NO_TARGET, { incompleteOnly: true });
  assert.equal(changed, 4);
  assert.equal(detected.status, CELL_STATUSES.DETECTED);
  assert.equal(detected.species[0], "BRTE");
});

test("unknown observation is retained without invented identity", () => {
  const transect = createTransect();
  const cell = findCell(transect, 7, "right", 4);
  addUnknown(cell, "Purple flower; photograph attached");
  const rows = rowsForTransect(transect).filter((row) => row.segment_start_m === 7 && row.side === "right" && row.distance_band_start_m === 4);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].species_code, "UNKNOWN");
  assert.match(rows[0].observation_note, /Purple flower/);
});

test("long export reconstructs all cells and expands multiple detections", () => {
  const transect = createTransect();
  transect.metadata.site = "Test, Site";
  const cell = findCell(transect, 0, "left", 0);
  addSpecies(cell, "BRTE");
  addSpecies(cell, "CEMA");
  const rows = rowsForTransect(transect);
  assert.equal(rows.length, 301);
  assert.equal(rows.filter((row) => row.segment_start_m === 0 && row.side === "left" && row.distance_band_start_m === 0).length, 2);
  const csv = toLongCsv([transect]);
  assert.match(csv, /"Test, Site"/);
  assert.match(csv, /BRTE,detected/);
  assert.match(csv, /CEMA,detected/);
});

test("validation detects geometry and duplicate corruption", () => {
  const valid = createTransect();
  assert.deepEqual(validateTransect(valid), []);
  valid.segments[0].endM = 2;
  valid.segments[1].cells[0].species = ["BRTE", "BRTE"];
  valid.segments[1].cells[0].status = CELL_STATUSES.DETECTED;
  const errors = validateTransect(valid);
  assert.ok(errors.some((error) => error.includes("must represent 0-1 m")));
  assert.ok(errors.some((error) => error.includes("Duplicate species")));
});

test("a 0 or NS assignment clears an existing detection explicitly", () => {
  const transect = createTransect();
  const cell = findCell(transect, 3, "left", 3);
  addSpecies(cell, "TAOF");
  setCellStatus(cell, CELL_STATUSES.NOT_SURVEYED);
  assert.equal(cell.status, CELL_STATUSES.NOT_SURVEYED);
  assert.deepEqual(cell.species, []);
  assert.deepEqual(cell.unknowns, []);
});

