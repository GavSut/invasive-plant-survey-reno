export const PROTOCOL_VERSION = "2.0.0";
export const SCHEMA_VERSION = 2;
export const SEGMENT_COUNT = 30;
export const SIDES = ["left", "right"];
export const DISTANCE_BANDS = Object.freeze([
  Object.freeze({ start: 0, end: 1, label: "0-1 m" }),
  Object.freeze({ start: 1, end: 2, label: "1-2 m" }),
  Object.freeze({ start: 2, end: 3, label: "2-3 m" }),
]);

export const CELLS_PER_SEGMENT = SIDES.length * DISTANCE_BANDS.length;
export const TOTAL_CELLS = SEGMENT_COUNT * CELLS_PER_SEGMENT;

export const CELL_STATUSES = Object.freeze({
  INCOMPLETE: "incomplete",
  DETECTED: "detected",
  NO_TARGET: "surveyed_no_target",
  NOT_SURVEYED: "not_surveyed",
});

export function makeId(prefix = "rec") {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${value}`;
}

export function cellId(segmentIndex, side, bandStart) {
  return `s${segmentIndex}_${side}_${bandStart}`;
}

export function createCell(segmentIndex, side, band) {
  return {
    id: cellId(segmentIndex, side, band.start),
    side,
    bandStart: band.start,
    bandEnd: band.end,
    status: CELL_STATUSES.INCOMPLETE,
    species: [],
    unknowns: [],
    note: "",
  };
}

export function createSegments() {
  return Array.from({ length: SEGMENT_COUNT }, (_, index) => ({
    index,
    startM: index,
    endM: index + 1,
    label: `${index}-${index + 1} m`,
    note: "",
    cells: SIDES.flatMap((side) =>
      DISTANCE_BANDS.map((band) => createCell(index, side, band)),
    ),
  }));
}

export function createTransect({ speciesListVersion = "reno-2026.1" } = {}) {
  const now = new Date().toISOString();
  return {
    id: makeId("transect"),
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    speciesListVersion,
    appVersion: "2.3.2",
    entryMethod: "digital_field",
    metadata: {
      observers: "",
      surveyDate: "",
      site: "",
      trail: "",
      transectNumber: "",
      startTime: "",
      endTime: "",
      generalNotes: "",
      startGps: null,
      endGps: null,
    },
    segments: createSegments(),
    photos: [],
    createdAt: now,
    modifiedAt: now,
    originalSubmittedAt: null,
    lastSubmittedAt: null,
    syncStatus: "draft",
    revisionNumber: 0,
  };
}

export function findCell(transect, segmentIndex, side, bandStart) {
  const segment = transect.segments?.[segmentIndex];
  if (!segment) throw new Error(`Unknown segment ${segmentIndex}`);
  const cell = segment.cells.find((candidate) =>
    candidate.side === side && Number(candidate.bandStart) === Number(bandStart));
  if (!cell) throw new Error(`Unknown cell ${segmentIndex}/${side}/${bandStart}`);
  return cell;
}

export function addSpecies(cell, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return false;
  if (cell.species.some((existing) => existing.toUpperCase() === normalized)) return false;
  cell.species.push(normalized);
  cell.status = CELL_STATUSES.DETECTED;
  return true;
}

export function removeSpecies(cell, code) {
  const before = cell.species.length;
  cell.species = cell.species.filter((existing) => existing !== code);
  if (cell.species.length === 0 && cell.unknowns.length === 0) {
    cell.status = CELL_STATUSES.INCOMPLETE;
  }
  return cell.species.length !== before;
}

export function addUnknown(cell, note = "") {
  const unknown = { id: makeId("unknown"), note: String(note).trim() };
  cell.unknowns.push(unknown);
  cell.status = CELL_STATUSES.DETECTED;
  return unknown;
}

export function removeUnknown(cell, unknownId) {
  cell.unknowns = cell.unknowns.filter((item) => item.id !== unknownId);
  if (cell.species.length === 0 && cell.unknowns.length === 0) {
    cell.status = CELL_STATUSES.INCOMPLETE;
  }
}

export function setCellStatus(cell, status) {
  if (!Object.values(CELL_STATUSES).includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  if (status === CELL_STATUSES.DETECTED && cell.species.length === 0 && cell.unknowns.length === 0) {
    throw new Error("A detected cell must contain a species or unknown observation.");
  }
  if (status === CELL_STATUSES.NO_TARGET || status === CELL_STATUSES.NOT_SURVEYED || status === CELL_STATUSES.INCOMPLETE) {
    cell.species = [];
    cell.unknowns = [];
  }
  cell.status = status;
}

export function markCells(transect, segmentIndex, side, status, { incompleteOnly = true } = {}) {
  const segment = transect.segments[segmentIndex];
  const targets = segment.cells.filter((cell) => !side || cell.side === side);
  let changed = 0;
  for (const cell of targets) {
    if (incompleteOnly && cell.status !== CELL_STATUSES.INCOMPLETE) continue;
    setCellStatus(cell, status);
    changed += 1;
  }
  return changed;
}

export function allCells(transect) {
  return (transect.segments || []).flatMap((segment) => segment.cells || []);
}

export function computeSummary(transect) {
  const cells = allCells(transect);
  const statusCounts = cells.reduce((counts, cell) => {
    counts[cell.status] = (counts[cell.status] || 0) + 1;
    return counts;
  }, {});
  const species = [...new Set(cells.flatMap((cell) => cell.species))].sort();
  const unknownCount = cells.reduce((sum, cell) => sum + cell.unknowns.length, 0);
  const detectedCells = statusCounts[CELL_STATUSES.DETECTED] || 0;
  const completed = cells.length - (statusCounts[CELL_STATUSES.INCOMPLETE] || 0);
  return {
    totalCells: cells.length,
    completed,
    surveyedCells: detectedCells + (statusCounts[CELL_STATUSES.NO_TARGET] || 0),
    detectedCells,
    noTargetCells: statusCounts[CELL_STATUSES.NO_TARGET] || 0,
    notSurveyedCells: statusCounts[CELL_STATUSES.NOT_SURVEYED] || 0,
    incompleteCells: statusCounts[CELL_STATUSES.INCOMPLETE] || 0,
    species,
    unknownCount,
    photoCount: transect.photos?.length || 0,
  };
}

export function validateTransect(transect, { allowedSpeciesCodes = null } = {}) {
  const errors = [];
  if (!transect || typeof transect !== "object") return ["Transect is not an object."];
  if (transect.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`This record uses schema ${transect.schemaVersion ?? "unknown"}; schema ${SCHEMA_VERSION} is required.`);
  }
  if (transect.protocolVersion !== PROTOCOL_VERSION) {
    errors.push(`This record uses protocol ${transect.protocolVersion ?? "unknown"}; protocol ${PROTOCOL_VERSION} (3 m each side) is required.`);
  }
  if (transect.entryMethod !== "digital_field") {
    errors.push("Only digital field records are accepted by the current workflow.");
  }
  if (!Array.isArray(transect.segments)) {
    errors.push("Transect segments must be an array.");
    return errors;
  }
  if (transect.segments.length !== SEGMENT_COUNT) {
    errors.push(`Expected ${SEGMENT_COUNT} segments; found ${transect.segments.length}.`);
  }
  transect.segments.forEach((segment, index) => {
    if (!segment || typeof segment !== "object") {
      errors.push(`Segment ${index + 1} is not an object.`);
      return;
    }
    if (segment.index !== index || segment.startM !== index || segment.endM !== index + 1 || segment.label !== `${index}-${index + 1} m`) {
      errors.push(`Segment ${index + 1} must represent ${index}-${index + 1} m.`);
    }
    if (!Array.isArray(segment.cells)) {
      errors.push(`Segment ${index}-${index + 1} m cells must be an array.`);
      return;
    }
    if (segment.cells.length !== CELLS_PER_SEGMENT) {
      errors.push(`Segment ${index}-${index + 1} m must contain ${CELLS_PER_SEGMENT} cells.`);
    }
    for (const side of SIDES) {
      for (const band of DISTANCE_BANDS) {
        const matches = segment.cells.filter((cell) =>
          cell.side === side && cell.bandStart === band.start && cell.bandEnd === band.end);
        if (matches.length !== 1) errors.push(`Missing or duplicate cell: segment ${index}, ${side}, ${band.label}.`);
      }
    }
    segment.cells?.forEach((cell) => {
      if (cell.id !== cellId(index, cell.side, cell.bandStart)) {
        errors.push(`Invalid cell identifier in segment ${index}-${index + 1} m.`);
      }
      if (!Object.values(CELL_STATUSES).includes(cell.status)) {
        errors.push(`Invalid status in ${cell.id}.`);
      }
      if (!Array.isArray(cell.species) || !Array.isArray(cell.unknowns)) {
        errors.push(`Observations in ${cell.id} must be arrays.`);
        return;
      }
      if (new Set(cell.species).size !== cell.species.length) {
        errors.push(`Duplicate species in ${cell.id}.`);
      }
      for (const code of cell.species) {
        if (typeof code !== "string" || !/^[A-Z0-9_-]{2,10}$/.test(code) || code === "UNKNOWN") {
          errors.push(`Invalid target-species code in ${cell.id}.`);
        }
      }
      if (cell.unknowns.some((unknown) => !unknown || typeof unknown !== "object" || !String(unknown.id || "").trim())) {
        errors.push(`Invalid unknown observation in ${cell.id}.`);
      }
      if (new Set(cell.unknowns.map((unknown) => unknown?.id)).size !== cell.unknowns.length) {
        errors.push(`Duplicate unknown-observation identifier in ${cell.id}.`);
      }
      if (allowedSpeciesCodes) {
        for (const code of cell.species) {
          if (!allowedSpeciesCodes.has(code)) errors.push(`Unknown target-species code ${code} in ${cell.id}.`);
        }
      }
      if (cell.status === CELL_STATUSES.DETECTED && cell.species.length === 0 && cell.unknowns.length === 0) {
        errors.push(`Detected cell ${cell.id} has no observation.`);
      }
      if (cell.status !== CELL_STATUSES.DETECTED && (cell.species.length || cell.unknowns.length)) {
        errors.push(`Non-detected cell ${cell.id} contains an observation.`);
      }
    });
  });
  if (!Array.isArray(transect.photos)) {
    errors.push("Transect photos must be an array.");
  } else {
    const photoIds = new Set();
    transect.photos.forEach((photo) => {
      if (!photo?.id || !photo.blobId || photoIds.has(photo.id)) errors.push("Photo records need unique photo and blob identifiers.");
      photoIds.add(photo?.id);
      if (!Number.isInteger(photo?.segmentIndex) || photo.segmentIndex < 0 || photo.segmentIndex >= SEGMENT_COUNT) errors.push(`Photo ${photo?.id || "record"} has an invalid segment.`);
      if (!["meter", "cell", "observation"].includes(photo?.scope)) errors.push(`Photo ${photo?.id || "record"} has an invalid scope.`);
      if (photo?.scope !== "meter" && (!SIDES.includes(photo.side) || !DISTANCE_BANDS.some((band) => band.start === Number(photo.bandStart)))) {
        errors.push(`Photo ${photo?.id || "record"} has an invalid cell location.`);
      }
      if (photo?.scope === "observation" && Boolean(photo.speciesCode) === Boolean(photo.unknownId)) {
        errors.push(`Photo ${photo?.id || "record"} must identify one target or one unknown observation.`);
      }
      if (photo?.speciesCode && allowedSpeciesCodes && !allowedSpeciesCodes.has(photo.speciesCode)) errors.push(`Photo ${photo.id} uses unknown target-species code ${photo.speciesCode}.`);
    });
  }
  return errors;
}

const EXPORT_COLUMNS = Object.freeze([
  "record_id", "revision_number", "original_submission_timestamp", "last_modified_timestamp",
  "site", "trail", "transect_number", "observer_names", "survey_date", "start_time", "end_time",
  "start_latitude", "start_longitude", "start_accuracy_m", "start_gps_timestamp",
  "end_latitude", "end_longitude", "end_accuracy_m", "end_gps_timestamp",
  "segment_start_m", "segment_end_m", "segment_label", "side",
  "distance_band_start_m", "distance_band_end_m", "species_code", "survey_status",
  "observation_note", "entry_method", "schema_version", "protocol_version", "species_list_version", "sync_status",
]);

function baseExportRow(transect, segment, cell) {
  const metadata = transect.metadata || {};
  const startGps = metadata.startGps || {};
  const endGps = metadata.endGps || {};
  return {
    record_id: transect.id,
    revision_number: transect.revisionNumber ?? 0,
    original_submission_timestamp: transect.originalSubmittedAt || "",
    last_modified_timestamp: transect.modifiedAt || "",
    site: metadata.site || "",
    trail: metadata.trail || "",
    transect_number: metadata.transectNumber || "",
    observer_names: metadata.observers || "",
    survey_date: metadata.surveyDate || "",
    start_time: metadata.startTime || "",
    end_time: metadata.endTime || "",
    start_latitude: startGps.latitude ?? "",
    start_longitude: startGps.longitude ?? "",
    start_accuracy_m: startGps.accuracy ?? "",
    start_gps_timestamp: startGps.timestamp || "",
    end_latitude: endGps.latitude ?? "",
    end_longitude: endGps.longitude ?? "",
    end_accuracy_m: endGps.accuracy ?? "",
    end_gps_timestamp: endGps.timestamp || "",
    segment_start_m: segment.startM,
    segment_end_m: segment.endM,
    segment_label: segment.label,
    side: cell.side,
    distance_band_start_m: cell.bandStart,
    distance_band_end_m: cell.bandEnd,
    species_code: "",
    survey_status: cell.status,
    observation_note: cell.note || "",
    entry_method: transect.entryMethod,
    schema_version: transect.schemaVersion,
    protocol_version: transect.protocolVersion,
    species_list_version: transect.speciesListVersion,
    sync_status: transect.syncStatus,
  };
}

export function rowsForTransect(transect) {
  const rows = [];
  for (const segment of transect.segments) {
    for (const cell of segment.cells) {
      const base = baseExportRow(transect, segment, cell);
      if (cell.status === CELL_STATUSES.DETECTED) {
        for (const speciesCode of cell.species) {
          rows.push({ ...base, species_code: speciesCode, survey_status: CELL_STATUSES.DETECTED });
        }
        for (const unknown of cell.unknowns) {
          rows.push({
            ...base,
            species_code: "UNKNOWN",
            survey_status: CELL_STATUSES.DETECTED,
            observation_note: [base.observation_note, unknown.note].filter(Boolean).join(" | "),
          });
        }
      } else {
        rows.push(base);
      }
    }
  }
  return rows;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toLongCsv(transects) {
  const rows = transects.flatMap(rowsForTransect);
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const row of rows) lines.push(EXPORT_COLUMNS.map((key) => csvEscape(row[key])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export function exportColumns() {
  return [...EXPORT_COLUMNS];
}
