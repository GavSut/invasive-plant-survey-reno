import test from "node:test";
import assert from "node:assert/strict";
import {
  activeFilterLabels,
  buildChartSeries,
  computeSummary as computeDashboardSummary,
  escapeHtml,
  filtersForApi,
  freshFilters,
  payloadDifferences,
  metadataForRecord,
  recordMatchesFilters,
  reconcileUnknownNotes,
  recordIsExcluded,
  recordIsTest,
  recordIsTrashed,
  recordReviewStatus,
  recordState,
  sourcePayload,
  stateVersion,
  submissionDateKey,
  summaryForRecord,
  validGps,
  validateCuratedPayload,
} from "../instructor-data.js";
import {
  CELL_STATUSES,
  computeSummary,
  createTransect,
  findCell,
  setCellStatus,
} from "../protocol.js";

function completePayload({ id, site, trail = "Trail A", observers = "Observer A", surveyDate = "2026-09-01", gps = true } = {}) {
  const payload = createTransect();
  payload.id = id;
  payload.metadata.site = site;
  payload.metadata.trail = trail;
  payload.metadata.observers = observers;
  payload.metadata.transectNumber = id?.split("_").at(-1) || "1";
  payload.metadata.surveyDate = surveyDate;
  if (gps) payload.metadata.startGps = { latitude: 0, longitude: 0, accuracy: 5, timestamp: "2026-09-01T12:00:00Z" };
  payload.segments.forEach((segment) => segment.cells.forEach((cell) => setCellStatus(cell, CELL_STATUSES.NO_TARGET)));
  return payload;
}

function dashboardRecord(options = {}) {
  const payload = options.payload || completePayload({
    id: options.id || "transect_a",
    site: options.site || "Reno Test Site",
    trail: options.trail,
    observers: options.observers,
    surveyDate: options.surveyDate,
    gps: options.gps,
  });
  const summary = computeSummary(payload);
  return {
    recordId: payload.id,
    classId: options.classId || "class-active",
    originalMetadata: payload.metadata,
    effectiveMetadata: payload.metadata,
    originalSummary: { ...summary, statusCounts: summaryStatusCounts(payload), speciesCodes: summary.species },
    effectiveSummary: { ...summary, statusCounts: summaryStatusCounts(payload), speciesCodes: summary.species },
    originalSubmittedAt: options.submittedAt || "2026-09-02T01:02:03Z",
    syncState: options.syncState || "submitted",
    submissionCount: options.submissionCount || 1,
    photoCount: options.photoCount || 0,
    hasCuration: Boolean(options.hasCuration),
    curationStale: Boolean(options.curationStale),
    testSuggested: Boolean(options.testSuggested),
    state: {
      review_status: options.reviewStatus || "unreviewed",
      excluded_from_analysis: Boolean(options.excluded),
      test_data_status: options.testDataStatus || "real",
      trashed_at: options.trashed ? "2026-09-03T00:00:00Z" : null,
    },
  };
}

function summaryStatusCounts(payload) {
  const counts = { detected: 0, surveyed_no_target: 0, not_surveyed: 0, incomplete: 0 };
  payload.segments.flatMap((segment) => segment.cells).forEach((cell) => { counts[cell.status] += 1; });
  return counts;
}

test("HTML escaping neutralizes every dashboard markup delimiter", () => {
  const hostile = `<img src=x onerror="alert('x')"> & text`;
  const escaped = escapeHtml(hostile);
  assert.equal(escaped, "&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp; text");
  assert.doesNotMatch(escaped, /<img|onerror="/);
});

test("GPS validation accepts zero coordinates but rejects blank, nonnumeric, and out-of-range values", () => {
  assert.equal(validGps({ latitude: 0, longitude: 0 }), true);
  assert.equal(validGps({ latitude: "39.5", longitude: "-119.8" }), true);
  assert.equal(validGps({ latitude: "", longitude: "" }), false);
  assert.equal(validGps({ latitude: " ", longitude: null }), false);
  assert.equal(validGps({ latitude: "north", longitude: -119 }), false);
  assert.equal(validGps({ latitude: 91, longitude: 0 }), false);
  assert.equal(validGps({ latitude: 0, longitude: -181 }), false);
});

test("combined filters preserve explicit zero, missing-data, and curation states", () => {
  const payload = completePayload({ id: "transect_combo", site: "Peavine Mountain", observers: "Ada & Lin", surveyDate: "2026-09-05" });
  const detected = findCell(payload, 2, "left", 0);
  detected.species = ["BRTE"];
  detected.status = CELL_STATUSES.DETECTED;
  setCellStatus(findCell(payload, 3, "right", 2), CELL_STATUSES.NOT_SURVEYED);
  setCellStatus(findCell(payload, 4, "left", 1), CELL_STATUSES.INCOMPLETE);
  const record = dashboardRecord({
    payload,
    classId: "class-active",
    submittedAt: "2026-09-06T01:00:00Z",
    syncState: "upload_partially_complete",
    submissionCount: 2,
    photoCount: 1,
    reviewStatus: "needs_follow_up",
    excluded: true,
    testDataStatus: "test",
    trashed: true,
    hasCuration: true,
  });
  const classes = [{ id: "class-active", active: true, name: "BIO", term: "Fall 2026" }];
  const filters = freshFilters({
    classId: "class-active",
    surveyDateFrom: "2026-09-05",
    surveyDateTo: "2026-09-05",
    submissionDateFrom: "2026-09-05",
    submissionDateTo: "2026-09-05",
    site: "peavine",
    observer: "lin",
    recordId: "combo",
    species: "cheatgrass",
    surveyStatus: "not_surveyed",
    syncState: "upload_partially_complete",
    completionState: "incomplete",
    gpsState: "present",
    photoState: "present",
    reviewStatus: "needs_follow_up",
    exclusionState: "excluded",
    testState: "test",
    trashState: "trashed",
    curationState: "curated",
  });
  assert.equal(recordMatchesFilters(record, filters, classes), true);
  assert.equal(recordMatchesFilters(record, { ...filters, species: "Canada thistle" }, classes), false);
  assert.equal(recordMatchesFilters(record, { ...filters, surveyStatus: "incomplete" }, classes), true);
  assert.equal(recordMatchesFilters(record, { ...filters, gpsState: "missing" }, classes), false);
});

test("inactive classes are excluded by default and filter serialization is sparse", () => {
  const record = dashboardRecord({ classId: "class-old" });
  const classes = [{ id: "class-old", active: false, name: "BIO", term: "Past" }];
  assert.equal(recordMatchesFilters(record, freshFilters(), classes), false);
  assert.equal(recordMatchesFilters(record, freshFilters({ includeInactiveClasses: true }), classes), true);
  assert.deepEqual(filtersForApi(freshFilters()), { classActive: true, trash: "active" });
  assert.deepEqual(filtersForApi(freshFilters({ includeInactiveClasses: true, site: "Reno" })), {
    site: "Reno",
    trash: "active",
  });
  assert.ok(activeFilterLabels(freshFilters({ includeInactiveClasses: true }), classes)
    .some((item) => item.label === "Including inactive classes"));
  assert.equal(activeFilterLabels(freshFilters(), classes).some((item) => item.key === "trashState"), false);
});

test("submission calendar dates use Reno day boundaries and term remains independent of class", () => {
  assert.equal(submissionDateKey("2026-09-06T01:00:00Z"), "2026-09-05");
  assert.equal(submissionDateKey("2026-09-06T08:00:00Z"), "2026-09-06");
  const record = dashboardRecord({ classId: "class-active", submittedAt: "2026-09-06T01:00:00Z" });
  const classes = [{ id: "class-active", active: true, name: "BIO", term: "Fall 2026" }];
  assert.equal(recordMatchesFilters(record, freshFilters({ term: "Fall 2026", submissionDateFrom: "2026-09-05", submissionDateTo: "2026-09-05" }), classes), true);
  assert.equal(recordMatchesFilters(record, freshFilters({ term: "Spring 2027" }), classes), false);
});

test("UI filters serialize to the Edge Function contract including names and exact day bounds", () => {
  assert.deepEqual(filtersForApi(freshFilters({
    classId: "11111111-1111-4111-8111-111111111101",
    term: "Fall 2026",
    surveyDateFrom: "2026-09-01", surveyDateTo: "2026-09-10",
    submissionDateFrom: "2026-09-02", submissionDateTo: "2026-09-09",
    observer: "Ada", species: "Cheatgrass", completionState: "incomplete",
    gpsState: "missing", photoState: "present", exclusionState: "included",
    testState: "test", trashState: "trashed", curationState: "original",
  })), {
    classId: "11111111-1111-4111-8111-111111111101",
    classTerm: "Fall 2026",
    classActive: true,
    surveyDateFrom: "2026-09-01", surveyDateTo: "2026-09-10",
    submittedDateFrom: "2026-09-02", submittedDateTo: "2026-09-09",
    observers: "Ada", speciesCode: "BRTE", completion: "incomplete",
    gps: false, photos: "present", excluded: false, test: "test", trash: "trashed", hasCuration: false,
  });
  assert.deepEqual(filtersForApi(freshFilters({ species: "thistle" })).speciesCodes, [
    "SATR12", "CANU4", "CESO3", "CIVU", "CIAR4", "ONAC",
  ]);
});

test("record helpers consume the actual flat list-records response shape", () => {
  const record = {
    recordId: "transect_flat",
    classId: "class-active",
    site: "Flat Site", trail: "Flat Trail", transectNumber: "17", observers: "Ada & Lin",
    surveyDate: "2026-09-07", startGps: { latitude: 0, longitude: 0 }, endGps: null,
    completedCells: 179, detectedCells: 2, surveyedNoTargetCells: 176,
    notSurveyedCells: 1, incompleteCells: 1, speciesCodes: ["BRTE", "CIIN"],
    reviewStatus: "questionable", excludedFromAnalysis: true, testDataStatus: "test",
    flags: ["needs_check"], instructorNote: "Review this", stateVersion: 4,
    trashedAt: "2026-09-10T12:00:00Z", trashReason: "Synthetic cleanup",
  };
  assert.deepEqual(metadataForRecord(record), {
    site: "Flat Site", trail: "Flat Trail", transectNumber: "17", observers: "Ada & Lin",
    surveyDate: "2026-09-07", startGps: { latitude: 0, longitude: 0 }, endGps: null,
  });
  const summary = summaryForRecord(record);
  assert.equal(summary.completedCells, 179);
  assert.equal(summary.detectedCells, 2);
  assert.deepEqual(summary.speciesCodes, ["BRTE", "CIIN"]);
  assert.deepEqual(summary.statusCounts, { detected: 2, surveyed_no_target: 176, not_surveyed: 1, incomplete: 1 });
  assert.deepEqual(recordState(record), {
    review_status: "questionable",
    excluded_from_analysis: true,
    test_data_status: "test",
    flags: ["needs_check"],
    instructor_note: "Review this",
    version: 4,
    trashed_at: "2026-09-10T12:00:00Z",
    trash_reason: "Synthetic cleanup",
  });
  assert.equal(recordReviewStatus(record), "questionable");
  assert.equal(recordIsExcluded(record), true);
  assert.equal(recordIsTest(record), true);
  assert.equal(recordIsTrashed(record), true);
  assert.equal(stateVersion(record), 4);
});

test("dashboard summaries and charts count cell states and species without losing absences", () => {
  const first = completePayload({ id: "transect_one", site: "Site One" });
  const second = completePayload({ id: "transect_two", site: "Site Two" });
  const detection = findCell(first, 0, "left", 0);
  detection.status = CELL_STATUSES.DETECTED;
  detection.species = ["BRTE", "CIIN"];
  setCellStatus(findCell(second, 1, "right", 2), CELL_STATUSES.INCOMPLETE);
  const records = [
    dashboardRecord({ payload: first, submissionCount: 2, photoCount: 1 }),
    dashboardRecord({ payload: second, syncState: "upload_partially_complete", excluded: true }),
  ];
  const summary = computeDashboardSummary(records);
  assert.equal(summary.totalTransects, 2);
  assert.equal(summary.editedSubmissions, 1);
  assert.equal(summary.partialUploads, 1);
  assert.equal(summary.incompleteTransects, 1);
  assert.equal(summary.detectedSpeciesCount, 2);
  assert.equal(summary.detectedCells, 1);
  assert.equal(summary.surveyedNoTargetCells, 358);
  assert.equal(summary.incompleteCells, 1);
  const charts = buildChartSeries(records);
  assert.deepEqual(charts.species.slice(0, 2), [{ label: "BRTE", value: 1 }, { label: "CIIN", value: 1 }]);
  assert.equal(charts.statuses.reduce((sum, item) => sum + item.value, 0), 360);
});

test("effective detail never silently applies a curation based on an older student submission", () => {
  const original = completePayload({ id: "transect_stale", site: "Original Site" });
  const curated = structuredClone(original);
  curated.metadata.site = "Old Curation";
  const staleDetail = {
    transect: { id: original.id, payload: original, submission_count: 3 },
    curation: { active: true, curated_payload: curated, source_submission_count: 2 },
  };
  assert.equal(sourcePayload(staleDetail, "effective").metadata.site, "Original Site");
  assert.equal(sourcePayload(staleDetail, "curated").metadata.site, "Old Curation");
  assert.ok(payloadDifferences(staleDetail).some((item) => item.path === "metadata.site"));
});

test("curated protocol validator rejects duplicate unknown IDs and out-of-catalog codes", () => {
  const valid = completePayload({ id: "transect_validate", site: "Valid" });
  assert.deepEqual(validateCuratedPayload(valid), []);

  const badCode = structuredClone(valid);
  const codeCell = findCell(badCode, 0, "left", 0);
  codeCell.status = CELL_STATUSES.DETECTED;
  codeCell.species = ["NOTREAL"];
  assert.ok(validateCuratedPayload(badCode).some((error) => error.includes("Unknown target-species code")));

  const duplicateUnknown = structuredClone(valid);
  const unknownCell = findCell(duplicateUnknown, 0, "left", 1);
  unknownCell.status = CELL_STATUSES.DETECTED;
  unknownCell.unknowns = [{ id: "unknown_1", note: "a" }, { id: "unknown_1", note: "b" }];
  assert.ok(validateCuratedPayload(duplicateUnknown).some((error) => error.includes("Duplicate unknown")));
});

test("unknown-note curation preserves identity by unchanged content rather than line position", () => {
  const existing = [
    { id: "unknown_first", note: "First plant" },
    { id: "unknown_second", note: "Second plant" },
  ];
  let generated = 0;
  const reconciled = reconcileUnknownNotes(
    existing,
    ["Second plant", "Edited first plant", "New plant"],
    () => `unknown_new_${++generated}`,
  );
  assert.deepEqual(reconciled, [
    { id: "unknown_second", note: "Second plant" },
    { id: "unknown_new_1", note: "Edited first plant" },
    { id: "unknown_new_2", note: "New plant" },
  ]);
  assert.equal(reconciled.some((item) => item.id === "unknown_first"), false);
});
