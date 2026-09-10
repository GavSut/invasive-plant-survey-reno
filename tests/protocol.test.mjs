import test from "node:test";
import assert from "node:assert/strict";
import {
  CELL_STATUSES,
  CELLS_PER_SEGMENT,
  DISTANCE_BANDS,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  TOTAL_CELLS,
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

test("30-meter geometry contains 30 segments, three bands per side, and exactly 180 cells", () => {
  const transect = createTransect();
  assert.equal(transect.segments.length, 30);
  assert.equal(transect.segments[0].label, "0-1 m");
  assert.equal(transect.segments[14].label, "14-15 m");
  assert.equal(transect.segments[15].label, "15-16 m");
  assert.equal(transect.segments[29].label, "29-30 m");
  assert.equal(transect.schemaVersion, SCHEMA_VERSION);
  assert.equal(transect.protocolVersion, PROTOCOL_VERSION);
  assert.equal(CELLS_PER_SEGMENT, 6);
  assert.equal(TOTAL_CELLS, 180);
  assert.equal(transect.segments.flatMap((segment) => segment.cells).length, 180);
  assert.deepEqual([...new Set(transect.segments.flatMap((segment) => segment.cells.map((cell) => cell.side)))].sort(), ["left", "right"]);
  assert.deepEqual([...new Set(transect.segments[0].cells.map((cell) => `${cell.bandStart}-${cell.bandEnd}`))], DISTANCE_BANDS.map((band) => `${band.start}-${band.end}`));
});

test("species duplicates are prevented within a cell but multiple species are allowed", () => {
  const transect = createTransect();
  const cell = findCell(transect, 12, "left", 2);
  assert.equal(addSpecies(cell, "brte"), true);
  assert.equal(addSpecies(cell, "BRTE"), false);
  assert.equal(addSpecies(cell, "CIIN"), true);
  assert.deepEqual(cell.species, ["BRTE", "CIIN"]);
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
  assert.equal(summary.incompleteCells, 178);
  assert.equal(summary.completed, 2);
  assert.equal(summary.surveyedCells, 1);
});

test("intentional batch action changes incomplete cells only", () => {
  const transect = createTransect();
  const detected = findCell(transect, 4, "right", 0);
  addSpecies(detected, "BRTE");
  const changed = markCells(transect, 4, "right", CELL_STATUSES.NO_TARGET, { incompleteOnly: true });
  assert.equal(changed, 2);
  assert.equal(detected.status, CELL_STATUSES.DETECTED);
  assert.equal(detected.species[0], "BRTE");
});

test("unknown observation is retained without invented identity", () => {
  const transect = createTransect();
  const cell = findCell(transect, 7, "right", 2);
  addUnknown(cell, "Purple flower; photograph attached");
  const rows = rowsForTransect(transect).filter((row) => row.segment_start_m === 7 && row.side === "right" && row.distance_band_start_m === 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].species_code, "UNKNOWN");
  assert.match(rows[0].observation_note, /Purple flower/);
});

test("long export reconstructs all cells and expands multiple detections", () => {
  const transect = createTransect();
  transect.metadata.site = "Test, Site";
  const cell = findCell(transect, 0, "left", 0);
  addSpecies(cell, "BRTE");
  addSpecies(cell, "CIIN");
  const rows = rowsForTransect(transect);
  assert.equal(rows.length, 181);
  assert.equal(rows.filter((row) => row.segment_start_m === 0 && row.side === "left" && row.distance_band_start_m === 0).length, 2);
  const csv = toLongCsv([transect]);
  assert.match(csv, /"Test, Site"/);
  assert.match(csv, /BRTE,detected/);
  assert.match(csv, /CIIN,detected/);
  assert.match(csv, /digital_field,2,2\.0\.0,reno-2026\.1/);
});

test("validation detects geometry and duplicate corruption", () => {
  const valid = createTransect();
  assert.deepEqual(validateTransect(valid), []);
  valid.segments[0].endM = 2;
  valid.segments[0].label = "wrong";
  valid.segments[1].cells[0].id = "wrong-cell";
  valid.segments[1].cells[0].species = ["BRTE", "BRTE"];
  valid.segments[1].cells[0].status = CELL_STATUSES.DETECTED;
  const errors = validateTransect(valid);
  assert.ok(errors.some((error) => error.includes("must represent 0-1 m")));
  assert.ok(errors.some((error) => error.includes("Invalid cell identifier")));
  assert.ok(errors.some((error) => error.includes("Duplicate species")));
});

test("validation rejects retired protocol records and target codes outside the catalog", () => {
  const transect = createTransect();
  transect.protocolVersion = "1.0.0";
  transect.schemaVersion = 1;
  const cell = findCell(transect, 0, "left", 0);
  addSpecies(cell, "NOTREAL");
  const errors = validateTransect(transect, { allowedSpeciesCodes: new Set(["BRTE"]) });
  assert.ok(errors.some((error) => error.includes("protocol 1.0.0")));
  assert.ok(errors.some((error) => error.includes("schema 1")));
  assert.ok(errors.some((error) => error.includes("Unknown target-species code")));
});

test("validation rejects malformed arrays, cell IDs, and administrative UNKNOWN in the target list", () => {
  const malformed = createTransect();
  const cell = findCell(malformed, 0, "right", 1);
  cell.id = "not-the-geometry-id";
  cell.species = ["UNKNOWN"];
  cell.status = CELL_STATUSES.DETECTED;
  const errors = validateTransect(malformed);
  assert.ok(errors.some((error) => error.includes("Invalid cell identifier")));
  assert.ok(errors.some((error) => error.includes("Invalid target-species code")));

  const noSegments = createTransect();
  noSegments.segments = null;
  assert.ok(validateTransect(noSegments).some((error) => error.includes("segments must be an array")));

  const badPhoto = createTransect();
  badPhoto.photos.push({ id: "photo_1", blobId: "blob_1", scope: "cell", segmentIndex: 30, side: "left", bandStart: 4 });
  const photoErrors = validateTransect(badPhoto);
  assert.ok(photoErrors.some((error) => error.includes("invalid segment")));
  assert.ok(photoErrors.some((error) => error.includes("invalid cell location")));
});

test("a 0 or NS assignment clears an existing detection explicitly", () => {
  const transect = createTransect();
  const cell = findCell(transect, 3, "left", 2);
  addSpecies(cell, "TAMAR2");
  setCellStatus(cell, CELL_STATUSES.NOT_SURVEYED);
  assert.equal(cell.status, CELL_STATUSES.NOT_SURVEYED);
  assert.deepEqual(cell.species, []);
  assert.deepEqual(cell.unknowns, []);
});
