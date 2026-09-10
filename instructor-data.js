import { CELL_STATUSES, TOTAL_CELLS, validateTransect } from "./protocol.js";
import { SPECIES } from "./species.js";

export const SPECIES_BY_CODE = new Map(SPECIES.map((item) => [item.code, item]));
export const ALLOWED_SPECIES_CODES = new Set(SPECIES_BY_CODE.keys());

export const REVIEW_STATUSES = Object.freeze([
  ["", "Any review state"],
  ["unreviewed", "Unreviewed"],
  ["reviewed", "Reviewed"],
  ["needs_follow_up", "Needs follow-up"],
  ["questionable", "Questionable"],
  ["accepted", "Accepted"],
]);

export const DEFAULT_FILTERS = Object.freeze({
  classId: "",
  term: "",
  includeInactiveClasses: false,
  surveyDateFrom: "",
  surveyDateTo: "",
  submissionDateFrom: "",
  submissionDateTo: "",
  site: "",
  trail: "",
  transectNumber: "",
  observer: "",
  recordId: "",
  species: "",
  surveyStatus: "",
  syncState: "",
  completionState: "",
  gpsState: "",
  photoState: "",
  reviewStatus: "",
  exclusionState: "",
  testState: "",
  trashState: "active",
  curationState: "",
});

export function freshFilters(overrides = {}) {
  return { ...DEFAULT_FILTERS, ...overrides };
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safeJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

export function humanize(value) {
  return String(value || "Not set").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDate(value, { dateOnly = false } = {}) {
  if (!value) return "—";
  const parsed = dateOnly ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return dateOnly
    ? parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : parsed.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** exponent)).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

/** Calendar-day key for an instant as observed in Reno, independent of browser/UTC midnight. */
export function submissionDateKey(value, timeZone = "America/Los_Angeles") {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function recordState(record) {
  if (record?.state || record?.recordState) return record.state || record.recordState;
  if (!record) return {};
  return {
    review_status: record.reviewStatus ?? record.review_status ?? "unreviewed",
    excluded_from_analysis: Boolean(record.excludedFromAnalysis ?? record.excluded_from_analysis),
    test_data_status: record.testDataStatus ?? record.test_data_status ?? "auto",
    flags: record.flags || [],
    instructor_note: record.instructorNote ?? record.instructor_note ?? "",
    version: Number(record.stateVersion ?? record.state_version ?? record.version ?? 0),
    trashed_at: record.trashedAt ?? record.trashed_at ?? null,
    trash_reason: record.trashReason ?? record.trash_reason ?? null,
  };
}

export function stateVersion(recordOrState) {
  const value = recordOrState?.state ? recordOrState.state : recordOrState;
  return Number(value?.state_version ?? value?.stateVersion ?? value?.version ?? 0);
}

export function curationVersion(recordOrCuration) {
  if (recordOrCuration?.curationVersion !== undefined) return Number(recordOrCuration.curationVersion || 0);
  const value = recordOrCuration?.curation ? recordOrCuration.curation : recordOrCuration;
  return Number(value?.version || 0);
}

export function metadataForRecord(record, source = "effective") {
  if (source === "original") return record?.originalMetadata || record?.original_metadata || {};
  return record?.effectiveMetadata || record?.effective_metadata || record?.originalMetadata || (record ? {
    site: record.site || "", trail: record.trail || "", transectNumber: record.transectNumber || record.transect_number || "",
    observers: record.observers || "", surveyDate: record.surveyDate || record.survey_date || "",
    startGps: record.startGps || record.start_gps || null, endGps: record.endGps || record.end_gps || null,
  } : {});
}

export function summaryForRecord(record, source = "effective") {
  if (source === "original") return record?.originalSummary || record?.original_summary || {};
  return record?.effectiveSummary || record?.effective_summary || record?.originalSummary || (record ? {
    completedCells: record.completedCells ?? record.completed_cells,
    detectedCells: record.detectedCells ?? record.detected_cells,
    speciesCodes: record.speciesCodes || record.species_codes || [],
    statusCounts: {
      detected: record.detectedCells ?? record.detected_cells,
      surveyed_no_target: record.surveyedNoTargetCells ?? record.surveyed_no_target_cells,
      not_surveyed: record.notSurveyedCells ?? record.not_surveyed_cells,
      incomplete: record.incompleteCells ?? record.incomplete_cells,
    },
  } : {});
}

export function recordId(record) {
  return String(record?.recordId ?? record?.record_id ?? record?.id ?? "");
}

export function recordIsTrashed(record) {
  const state = recordState(record);
  return Boolean(state.trashed_at ?? state.trashedAt ?? record?.trashedAt);
}

export function recordIsExcluded(record) {
  const state = recordState(record);
  return Boolean(state.excluded_from_analysis ?? state.excludedFromAnalysis ?? record?.excludedFromAnalysis);
}

export function recordIsTest(record) {
  if (record?.effectiveIsTest !== undefined) return Boolean(record.effectiveIsTest);
  const state = recordState(record);
  const status = state.test_data_status ?? state.testDataStatus ?? "auto";
  return status === "test" || (status === "auto" && Boolean(record?.testSuggested));
}

export function recordHasGps(record) {
  if (record?.hasGps !== undefined || record?.has_gps !== undefined) return Boolean(record.hasGps ?? record.has_gps);
  const metadata = metadataForRecord(record);
  return validGps(metadata.startGps) || validGps(metadata.endGps);
}

export function validGps(gps) {
  if (gps?.latitude === null || gps?.latitude === undefined || String(gps.latitude).trim() === ""
      || gps?.longitude === null || gps?.longitude === undefined || String(gps.longitude).trim() === "") return false;
  const latitude = Number(gps?.latitude);
  const longitude = Number(gps?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function recordReviewStatus(record) {
  const state = recordState(record);
  return String(state.review_status ?? state.reviewStatus ?? record?.reviewStatus ?? "unreviewed");
}

export function recordHasCuration(record) {
  return Boolean(record?.hasCuration ?? record?.has_curation);
}

export function normalizedStatusCounts(summary) {
  const source = summary?.statusCounts || summary?.status_counts || {};
  return {
    detected: Number(source.detected || 0),
    surveyed_no_target: Number(source.surveyed_no_target || 0),
    not_surveyed: Number(source.not_surveyed || 0),
    incomplete: Number(source.incomplete || 0),
  };
}

export function completedCells(record) {
  const summary = summaryForRecord(record);
  if (Number.isFinite(Number(summary.completedCells ?? summary.completed_cells))) {
    return Number(summary.completedCells ?? summary.completed_cells);
  }
  return TOTAL_CELLS - normalizedStatusCounts(summary).incomplete;
}

function includesInsensitive(value, query) {
  return String(value ?? "").toLocaleLowerCase().includes(String(query || "").trim().toLocaleLowerCase());
}

function matchesSpecies(record, query) {
  const term = String(query || "").trim().toLocaleLowerCase();
  if (!term) return true;
  const codes = summaryForRecord(record).speciesCodes || summaryForRecord(record).species_codes || [];
  return codes.some((code) => {
    const species = SPECIES_BY_CODE.get(code);
    return [code, species?.commonName, species?.scientificName, ...(species?.aliases || [])]
      .some((value) => includesInsensitive(value, term));
  });
}

/** Client-side mirror used for tests, selection resolution, and defensive fallback. */
export function recordMatchesFilters(record, filters, classes = []) {
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
  const metadata = metadataForRecord(record);
  const summary = summaryForRecord(record);
  const counts = normalizedStatusCounts(summary);
  const state = recordState(record);
  const id = recordId(record);
  const classRecord = classes.find((item) => item.id === record.classId || item.id === record.class_id);
  if (f.classId && String(record.classId ?? record.class_id) !== f.classId) return false;
  if (f.term && String(record.classTerm ?? record.class_term ?? classRecord?.term ?? "") !== f.term) return false;
  if (!f.includeInactiveClasses && classRecord && !classRecord.active) return false;
  if (f.surveyDateFrom && String(metadata.surveyDate || "") < f.surveyDateFrom) return false;
  if (f.surveyDateTo && String(metadata.surveyDate || "") > f.surveyDateTo) return false;
  const submitted = submissionDateKey(record.originalSubmittedAt ?? record.original_submitted_at);
  if (f.submissionDateFrom && submitted < f.submissionDateFrom) return false;
  if (f.submissionDateTo && submitted > f.submissionDateTo) return false;
  if (!includesInsensitive(metadata.site, f.site)) return false;
  if (!includesInsensitive(metadata.trail, f.trail)) return false;
  if (!includesInsensitive(metadata.transectNumber, f.transectNumber)) return false;
  if (!includesInsensitive(metadata.observers, f.observer)) return false;
  if (!includesInsensitive(id, f.recordId)) return false;
  if (!matchesSpecies(record, f.species)) return false;
  if (f.surveyStatus && !counts[f.surveyStatus]) return false;
  if (f.syncState && String(record.syncState ?? record.sync_state) !== f.syncState) return false;
  if (f.completionState === "complete" && counts.incomplete !== 0) return false;
  if (f.completionState === "incomplete" && counts.incomplete === 0) return false;
  if (f.gpsState === "present" && !recordHasGps(record)) return false;
  if (f.gpsState === "missing" && recordHasGps(record)) return false;
  if (f.photoState === "present" && !Number(record.photoCount ?? record.photo_count)) return false;
  if (f.photoState === "missing" && Number(record.photoCount ?? record.photo_count)) return false;
  if (f.reviewStatus && recordReviewStatus(record) !== f.reviewStatus) return false;
  if (f.exclusionState === "excluded" && !recordIsExcluded(record)) return false;
  if (f.exclusionState === "included" && recordIsExcluded(record)) return false;
  if (f.testState === "test" && !recordIsTest(record)) return false;
  if (f.testState === "real" && recordIsTest(record)) return false;
  if (f.trashState === "active" && recordIsTrashed(record)) return false;
  if (f.trashState === "trashed" && !recordIsTrashed(record)) return false;
  if (f.curationState === "curated" && !recordHasCuration(record)) return false;
  if (f.curationState === "original" && recordHasCuration(record)) return false;
  return true;
}

export function filtersForApi(filters) {
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
  const output = { trash: f.trashState || "active" };
  if (f.classId) output.classId = f.classId;
  if (f.term) output.classTerm = f.term;
  if (!f.includeInactiveClasses) output.classActive = true;
  for (const key of ["surveyDateFrom", "surveyDateTo", "site", "trail", "transectNumber", "recordId", "surveyStatus", "syncState", "reviewStatus"]) {
    if (f[key]) output[key] = f[key];
  }
  // Date-only values let the server apply one documented Reno calendar boundary.
  // Constructing UTC-midnight instants here shifts late-afternoon submissions a day early.
  if (f.submissionDateFrom) output.submittedDateFrom = f.submissionDateFrom;
  if (f.submissionDateTo) output.submittedDateTo = f.submissionDateTo;
  if (f.observer) output.observers = f.observer;
  if (f.completionState) output.completion = f.completionState;
  if (f.gpsState) output.gps = f.gpsState === "present";
  if (f.photoState) output.photos = f.photoState;
  if (f.exclusionState) output.excluded = f.exclusionState === "excluded";
  if (f.testState) output.test = f.testState;
  if (f.curationState) output.hasCuration = f.curationState === "curated";
  if (f.species) {
    const term = f.species.toLocaleLowerCase();
    const codes = SPECIES.filter((item) => [item.code, item.commonName, item.scientificName, ...(item.aliases || [])]
      .some((value) => String(value || "").toLocaleLowerCase().includes(term))).map((item) => item.code);
    if (codes.length === 1) output.speciesCode = codes[0];
    else output.speciesCodes = codes;
  }
  return output;
}

export function activeFilterLabels(filters, classes = []) {
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) };
  const labels = [];
  const add = (key, label) => { if (f[key]) labels.push({ key, label }); };
  if (f.classId) {
    const item = classes.find((candidate) => candidate.id === f.classId);
    labels.push({ key: "classId", label: item ? `${item.name} · ${item.term || "No term"}` : `Class ${f.classId}` });
  }
  add("term", `Term: ${f.term}`);
  if (f.includeInactiveClasses) labels.push({ key: "includeInactiveClasses", label: "Including inactive classes" });
  if (f.surveyDateFrom || f.surveyDateTo) labels.push({ key: "surveyDates", label: `Survey ${f.surveyDateFrom || "…"} to ${f.surveyDateTo || "…"}` });
  if (f.submissionDateFrom || f.submissionDateTo) labels.push({ key: "submissionDates", label: `Submitted ${f.submissionDateFrom || "…"} to ${f.submissionDateTo || "…"}` });
  add("site", `Site: ${f.site}`); add("trail", `Trail: ${f.trail}`); add("transectNumber", `Transect: ${f.transectNumber}`);
  add("observer", `Observer: ${f.observer}`); add("recordId", `Record: ${f.recordId}`); add("species", `Species: ${f.species}`);
  add("surveyStatus", `Cell status: ${humanize(f.surveyStatus)}`); add("syncState", `Sync: ${humanize(f.syncState)}`);
  add("completionState", humanize(f.completionState)); add("gpsState", `GPS ${f.gpsState}`); add("photoState", `Photos ${f.photoState}`);
  add("reviewStatus", `Review: ${humanize(f.reviewStatus)}`); add("exclusionState", humanize(f.exclusionState));
  add("testState", `${humanize(f.testState)} data`);
  if (f.trashState && f.trashState !== DEFAULT_FILTERS.trashState) labels.push({ key: "trashState", label: humanize(f.trashState) });
  add("curationState", humanize(f.curationState));
  return labels;
}

export function computeSummary(records, supplied = null) {
  if (supplied && typeof supplied === "object") return supplied.totals || supplied;
  const result = {
    totalTransects: records.length,
    submittedTransects: 0,
    editedSubmissions: 0,
    partialUploads: 0,
    incompleteTransects: 0,
    trashedRecords: 0,
    recordsWithPhotos: 0,
    recordsWithGps: 0,
    detectedSpeciesCount: 0,
    detectedCells: 0,
    surveyedNoTargetCells: 0,
    notSurveyedCells: 0,
    incompleteCells: 0,
    testRecords: 0,
    excludedRecords: 0,
  };
  const species = new Set();
  for (const record of records) {
    const counts = normalizedStatusCounts(summaryForRecord(record));
    const codes = summaryForRecord(record).speciesCodes || summaryForRecord(record).species_codes || [];
    codes.forEach((code) => species.add(code));
    if ((record.syncState ?? record.sync_state) === "submitted") result.submittedTransects += 1;
    if (Number(record.submissionCount ?? record.submission_count) > 1) result.editedSubmissions += 1;
    if ((record.syncState ?? record.sync_state) === "upload_partially_complete") result.partialUploads += 1;
    if (counts.incomplete) result.incompleteTransects += 1;
    if (recordIsTrashed(record)) result.trashedRecords += 1;
    if (Number(record.photoCount ?? record.photo_count)) result.recordsWithPhotos += 1;
    if (recordHasGps(record)) result.recordsWithGps += 1;
    if (recordIsTest(record)) result.testRecords += 1;
    if (recordIsExcluded(record)) result.excludedRecords += 1;
    result.detectedCells += counts.detected;
    result.surveyedNoTargetCells += counts.surveyed_no_target;
    result.notSurveyedCells += counts.not_surveyed;
    result.incompleteCells += counts.incomplete;
  }
  result.detectedSpeciesCount = species.size;
  return result;
}

function countBy(records, keyFor) {
  const counts = new Map();
  records.forEach((record) => {
    const key = keyFor(record);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function buildChartSeries(records, supplied = null) {
  if (supplied && typeof supplied === "object") return {
    submissions: supplied.submissions || supplied.submissionsThroughTime || [],
    species: supplied.species || supplied.speciesDetectionFrequency || [],
    statuses: supplied.statuses || supplied.statusComposition || [],
    sites: supplied.sites || supplied.submissionsBySite || [],
  };
  const submissionDates = countBy(records, (record) => submissionDateKey(record.originalSubmittedAt ?? record.original_submitted_at));
  const species = new Map();
  records.forEach((record) => {
    const codes = summaryForRecord(record).speciesCodes || summaryForRecord(record).species_codes || [];
    codes.forEach((code) => species.set(code, (species.get(code) || 0) + 1));
  });
  const status = computeSummary(records);
  return {
    submissions: submissionDates.sort((a, b) => a.label.localeCompare(b.label)),
    species: [...species].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
    statuses: [
      { label: "Detected", value: status.detectedCells },
      { label: "Surveyed, none", value: status.surveyedNoTargetCells },
      { label: "Not surveyed", value: status.notSurveyedCells },
      { label: "Incomplete", value: status.incompleteCells },
    ],
    sites: countBy(records, (record) => {
      const metadata = metadataForRecord(record);
      return [metadata.site, metadata.trail].filter(Boolean).join(" · ") || "Unspecified";
    }),
  };
}

export function sourcePayload(detail, source = "effective") {
  const original = detail?.transect?.payload || detail?.originalPayload || null;
  const curation = detail?.curation;
  const curated = curation?.active && curation?.curated_payload ? curation.curated_payload : null;
  if (source === "original") return original;
  if (source === "curated") return curated || original;
  const current = curated && Number(curation.source_submission_count) === Number(detail?.transect?.submission_count);
  return current ? curated : original;
}

function walkDiff(original, curated, path, output) {
  if (Object.is(original, curated)) return;
  const originalObject = original && typeof original === "object";
  const curatedObject = curated && typeof curated === "object";
  if (!originalObject || !curatedObject || Array.isArray(original) !== Array.isArray(curated)) {
    output.push({ path: path || "record", original, curated });
    return;
  }
  if (Array.isArray(original)) {
    const max = Math.max(original.length, curated.length);
    for (let index = 0; index < max; index += 1) walkDiff(original[index], curated[index], `${path}[${index}]`, output);
    return;
  }
  const keys = new Set([...Object.keys(original), ...Object.keys(curated)]);
  keys.forEach((key) => walkDiff(original[key], curated[key], path ? `${path}.${key}` : key, output));
}

export function payloadDifferences(detail) {
  const original = sourcePayload(detail, "original");
  const curated = detail?.curation?.active ? detail.curation.curated_payload : null;
  if (!original || !curated) return [];
  const output = [];
  walkDiff(original, curated, "", output);
  return output;
}

export function validateCuratedPayload(payload) {
  const errors = validateTransect(payload, { allowedSpeciesCodes: ALLOWED_SPECIES_CODES });
  for (const [key, label] of [["startGps", "Start GPS"], ["endGps", "End GPS"]]) {
    const gps = payload?.metadata?.[key];
    if (gps === null || gps === undefined) continue;
    const latitude = gps.latitude;
    const longitude = gps.longitude;
    if (latitude === null || latitude === undefined || String(latitude).trim() === ""
      || longitude === null || longitude === undefined || String(longitude).trim() === "") {
      errors.push(`${label} requires both latitude and longitude, or both fields must be blank.`);
      continue;
    }
    if (!Number.isFinite(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90) errors.push(`${label} latitude must be between -90 and 90.`);
    if (!Number.isFinite(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180) errors.push(`${label} longitude must be between -180 and 180.`);
    if (gps.accuracy !== null && gps.accuracy !== undefined && String(gps.accuracy).trim() !== ""
      && (!Number.isFinite(Number(gps.accuracy)) || Number(gps.accuracy) < 0)) errors.push(`${label} accuracy must be zero or a positive number.`);
  }
  return errors;
}

export function reconcileUnknownNotes(existingUnknowns, notes, createId = () => `unknown_${crypto.randomUUID()}`) {
  const idsByNote = new Map();
  for (const unknown of Array.isArray(existingUnknowns) ? existingUnknowns : []) {
    const note = String(unknown?.note || "").trim();
    const id = String(unknown?.id || "").trim();
    if (!note || !id) continue;
    if (!idsByNote.has(note)) idsByNote.set(note, []);
    idsByNote.get(note).push(id);
  }
  return (Array.isArray(notes) ? notes : []).map((value) => {
    const note = String(value || "").trim();
    const matchingIds = idsByNote.get(note);
    return { id: matchingIds?.length ? matchingIds.shift() : createId(), note };
  });
}

export function cellFor(payload, segmentIndex, side, bandStart) {
  return payload?.segments?.[segmentIndex]?.cells?.find((cell) => cell.side === side && Number(cell.bandStart) === Number(bandStart)) || null;
}

export function recordTitle(record) {
  const metadata = metadataForRecord(record);
  return [metadata.site, metadata.transectNumber && `Transect ${metadata.transectNumber}`].filter(Boolean).join(" · ") || recordId(record) || "Untitled record";
}

export function effectiveReviewBadge(record) {
  if (recordIsTrashed(record)) return { text: "Trashed", tone: "danger" };
  if (recordIsTest(record)) return { text: "Test data", tone: "test" };
  if (recordIsExcluded(record)) return { text: "Excluded", tone: "warning" };
  const review = recordReviewStatus(record);
  return { text: humanize(review), tone: review === "accepted" || review === "reviewed" ? "success" : review === "unreviewed" ? "neutral" : "warning" };
}

export const CELL_STATUS_LABELS = Object.freeze({
  [CELL_STATUSES.DETECTED]: "Detected",
  [CELL_STATUSES.NO_TARGET]: "0 · surveyed, none",
  [CELL_STATUSES.NOT_SURVEYED]: "NS · not surveyed",
  [CELL_STATUSES.INCOMPLETE]: "Incomplete",
});
