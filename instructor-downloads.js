import { rowsForTransect } from "./protocol.js";
import { recordIsExcluded, recordIsTest, validGps } from "./instructor-data.js";

export const PHOTO_ZIP_LIMITS = Object.freeze({ maxFiles: 50, maxBytes: 75 * 1024 * 1024 });

export function csvEscape(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows, preferredColumns = []) {
  const discovered = new Set(preferredColumns);
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => discovered.add(key)));
  const columns = [...discovered];
  if (!columns.length) return "";
  return `${columns.map(csvEscape).join(",")}\r\n${rows.map((row) => columns.map((key) => csvEscape(row?.[key])).join(",")).join("\r\n")}\r\n`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function indexed(items, key = "transect_id") {
  return new Map((items || []).map((item) => [item?.[key], item]));
}

function classLookup(classes) {
  return new Map((classes || []).map((item) => [item.id, item]));
}

function differs(original, curated) {
  return Boolean(curated) && JSON.stringify(original) !== JSON.stringify(curated);
}

export function exportEntries(bundle, { sourceMode = "curated", classes = [] } = {}) {
  const curations = indexed(bundle?.curations);
  const states = indexed(bundle?.states);
  const classMap = classLookup(classes);
  const entries = [];
  for (const transect of bundle?.transects || []) {
    const recordId = transect.id;
    const original = transect.payload;
    const curation = curations.get(recordId);
    const archivedCurated = curation?.active && curation.curated_payload ? curation.curated_payload : null;
    const curationIsCurrent = Boolean(archivedCurated)
      && Number(curation.source_submission_count) === Number(transect.submission_count);
    const curated = curationIsCurrent ? archivedCurated : null;
    const common = {
      transect,
      classRecord: classMap.get(transect.class_id) || null,
      state: states.get(recordId) || null,
      curation: curation || null,
      originalPayload: original,
      effectivePayload: curated || original,
      curationPresent: Boolean(curation),
      curationActive: Boolean(archivedCurated),
      curationCurrent: curationIsCurrent,
      differsFromOriginal: differs(original, archivedCurated),
      curationStale: Boolean(archivedCurated && !curationIsCurrent),
    };
    if (sourceMode === "original") {
      entries.push({ ...common, payload: original, dataSource: "original" });
    } else if (sourceMode === "both") {
      entries.push({ ...common, payload: original, dataSource: "original" });
      if (archivedCurated) entries.push({ ...common, payload: archivedCurated, dataSource: curationIsCurrent ? "curated" : "curated_stale" });
    } else {
      entries.push({ ...common, payload: curated || original, dataSource: curated ? "curated" : "original" });
    }
  }
  return entries;
}

function exportState(entry) {
  const state = entry.state || {};
  return {
    review_status: state.review_status || "unreviewed",
    excluded_from_analysis: Boolean(state.excluded_from_analysis),
    test_data_status: state.test_data_status || "auto",
    trashed: Boolean(state.trashed_at),
    instructor_flags: (state.flags || []).join(" | "),
    instructor_note: state.instructor_note || "",
  };
}

export function buildLongExport(bundle, options = {}) {
  const rows = [];
  for (const entry of exportEntries(bundle, options)) {
    const common = {
      class_id: entry.transect.class_id,
      class_name: entry.classRecord?.name || "",
      class_term: entry.classRecord?.term || "",
      data_source: entry.dataSource,
      differs_from_original: entry.differsFromOriginal,
      curation_stale: entry.curationStale,
      server_sync_state: entry.transect.sync_state || "",
      server_created_at: entry.transect.server_created_at || "",
      server_updated_at: entry.transect.server_updated_at || "",
      submission_count: entry.transect.submission_count ?? "",
      ...exportState(entry),
    };
    for (const row of rowsForTransect(entry.payload)) rows.push({ ...common, ...row });
  }
  return rows;
}

export function buildMetadataExport(bundle, options = {}) {
  const photoInventory = reconcilePhotoInventory(bundle);
  const photoSummaryByRecord = new Map();
  for (const row of photoInventory) {
    if (!photoSummaryByRecord.has(row.record_id)) photoSummaryByRecord.set(row.record_id, row);
  }
  return exportEntries(bundle, options).map((entry) => {
    const metadata = entry.payload?.metadata || {};
    const original = entry.originalPayload || entry.transect.payload || {};
    const effective = entry.effectivePayload || original;
    const photoSummary = photoSummaryByRecord.get(entry.transect.id);
    const curationStatus = !entry.curationPresent
      ? "none"
      : !entry.curationActive
        ? "inactive"
        : entry.curationStale
          ? "stale"
          : "current";
    const statusCounts = { detected: 0, surveyed_no_target: 0, not_surveyed: 0, incomplete: 0 };
    const species = new Set();
    for (const segment of entry.payload?.segments || []) {
      for (const cell of segment.cells || []) {
        statusCounts[cell.status] = (statusCounts[cell.status] || 0) + 1;
        (cell.species || []).forEach((code) => species.add(code));
      }
    }
    return {
      class_id: entry.transect.class_id,
      class_name: entry.classRecord?.name || "",
      class_term: entry.classRecord?.term || "",
      record_id: entry.transect.id,
      data_source: entry.dataSource,
      original_payload_record_id: original.id || entry.transect.id,
      effective_payload_record_id: effective.id || entry.transect.id,
      exported_payload_record_id: entry.payload?.id || entry.transect.id,
      differs_from_original: entry.differsFromOriginal,
      curation_present: entry.curationPresent,
      curation_active: entry.curationActive,
      curation_current: entry.curationCurrent,
      curation_stale: entry.curationStale,
      curation_status: curationStatus,
      curation_source_submission_count: entry.curation?.source_submission_count ?? "",
      curation_version: entry.curation?.version || 0,
      curation_created_at: entry.curation?.created_at || "",
      curation_updated_at: entry.curation?.updated_at || "",
      entry_method: entry.transect.entry_method || entry.payload?.entryMethod || "",
      schema_version: entry.payload?.schemaVersion ?? "",
      protocol_version: entry.transect.protocol_version || entry.payload?.protocolVersion || "",
      species_list_version: entry.transect.species_list_version || entry.payload?.speciesListVersion || "",
      app_version: entry.payload?.appVersion || "",
      original_schema_version: original.schemaVersion ?? "",
      original_protocol_version: original.protocolVersion || entry.transect.protocol_version || "",
      original_species_list_version: original.speciesListVersion || entry.transect.species_list_version || "",
      original_payload_created_at: original.createdAt || "",
      original_payload_modified_at: original.modifiedAt || "",
      original_payload_original_submitted_at: original.originalSubmittedAt || entry.transect.original_submitted_at || "",
      original_payload_last_submitted_at: original.lastSubmittedAt || "",
      effective_payload_created_at: effective.createdAt || "",
      effective_payload_modified_at: effective.modifiedAt || "",
      effective_payload_original_submitted_at: effective.originalSubmittedAt || entry.transect.original_submitted_at || "",
      effective_payload_last_submitted_at: effective.lastSubmittedAt || "",
      site: metadata.site || "",
      trail: metadata.trail || "",
      transect_number: metadata.transectNumber || "",
      observer_names: metadata.observers || "",
      survey_date: metadata.surveyDate || "",
      start_time: metadata.startTime || "",
      end_time: metadata.endTime || "",
      start_latitude: metadata.startGps?.latitude ?? "",
      start_longitude: metadata.startGps?.longitude ?? "",
      start_accuracy_m: metadata.startGps?.accuracy ?? "",
      end_latitude: metadata.endGps?.latitude ?? "",
      end_longitude: metadata.endGps?.longitude ?? "",
      end_accuracy_m: metadata.endGps?.accuracy ?? "",
      general_notes: metadata.generalNotes || "",
      completed_cells: 180 - statusCounts.incomplete,
      detected_cells: statusCounts.detected,
      surveyed_no_target_cells: statusCounts.surveyed_no_target,
      not_surveyed_cells: statusCounts.not_surveyed,
      incomplete_cells: statusCounts.incomplete,
      detected_species_count: species.size,
      detected_species_codes: [...species].sort().join(" | "),
      photo_count: photoSummary?.record_uploaded_photo_count || 0,
      expected_payload_photo_count: photoSummary?.record_expected_photo_count || 0,
      uploaded_server_photo_count: photoSummary?.record_uploaded_photo_count || 0,
      missing_expected_photo_count: photoSummary?.record_missing_photo_count || 0,
      photo_upload_state: photoSummary?.record_photo_upload_state || "no_photos_expected",
      revision_count: Math.max(Number(entry.transect.submission_count || 1) - 1, 0),
      sync_state: entry.transect.sync_state || "",
      original_submitted_at: entry.transect.original_submitted_at || "",
      client_modified_at: entry.transect.client_modified_at || "",
      server_created_at: entry.transect.server_created_at || "",
      server_updated_at: entry.transect.server_updated_at || "",
      ...exportState(entry),
    };
  });
}

export function buildGeoJson(bundle, options = {}) {
  const features = [];
  for (const entry of exportEntries(bundle, options)) {
    const metadata = entry.payload?.metadata || {};
    const start = metadata.startGps;
    const end = metadata.endGps;
    let geometry = null;
    if (validGps(start) && validGps(end)) {
      geometry = { type: "LineString", coordinates: [[Number(start.longitude), Number(start.latitude)], [Number(end.longitude), Number(end.latitude)]] };
    } else if (validGps(start) || validGps(end)) {
      const point = validGps(start) ? start : end;
      geometry = { type: "Point", coordinates: [Number(point.longitude), Number(point.latitude)] };
    }
    if (!geometry) continue;
    features.push({
      type: "Feature",
      id: `${entry.transect.id}:${entry.dataSource}`,
      geometry,
      properties: {
        record_id: entry.transect.id,
        data_source: entry.dataSource,
        differs_from_original: entry.differsFromOriginal,
        class_id: entry.transect.class_id,
        class_name: entry.classRecord?.name || "",
        class_term: entry.classRecord?.term || "",
        site: metadata.site || "",
        trail: metadata.trail || "",
        transect_number: metadata.transectNumber || "",
        observers: metadata.observers || "",
        survey_date: metadata.surveyDate || "",
        ...exportState(entry),
      },
    });
  }
  return { type: "FeatureCollection", generated_at: new Date().toISOString(), features };
}

function photoDescriptors(payload) {
  return Array.isArray(payload?.photos) ? payload.photos : [];
}

function photoDescriptorMap(payload) {
  return new Map(photoDescriptors(payload)
    .filter((photo) => typeof photo?.id === "string" && photo.id)
    .map((photo) => [photo.id, photo]));
}

function photoValue(serverPhoto, descriptor, serverKey, descriptorKey, fallback = "") {
  const serverValue = serverPhoto?.[serverKey];
  if (serverValue !== undefined && serverValue !== null) return serverValue;
  const descriptorValue = descriptor?.[descriptorKey];
  return descriptorValue !== undefined && descriptorValue !== null ? descriptorValue : fallback;
}

function photoRecordState({ expectedCount, matchedCount, uploadedCount, syncState }) {
  if (!expectedCount && !uploadedCount) return "no_photos_expected";
  if (!expectedCount) return "server_metadata_without_payload_descriptor";
  if (matchedCount === expectedCount) {
    return syncState === "upload_partially_complete"
      ? "reported_partial_but_inventory_complete"
      : "complete";
  }
  return matchedCount ? "partial" : "missing_all";
}

/**
 * Reconcile payload attachment descriptors with successful server photo rows.
 * Accepts either an export bundle ({ transects, curations, states, photos }) or
 * one record-detail response ({ transect, curation, state, photos }). Returned
 * rows intentionally contain no signed URLs, session tokens, or credentials.
 */
export function reconcilePhotoInventory(input) {
  const transects = Array.isArray(input?.transects)
    ? input.transects
    : input?.transect
      ? [input.transect]
      : [];
  const curations = Array.isArray(input?.curations)
    ? indexed(input.curations)
    : new Map(input?.curation?.transect_id
      ? [[input.curation.transect_id, input.curation]]
      : input?.curation && input?.transect?.id
        ? [[input.transect.id, input.curation]]
        : []);
  const states = Array.isArray(input?.states)
    ? indexed(input.states)
    : new Map(input?.state?.transect_id
      ? [[input.state.transect_id, input.state]]
      : input?.state && input?.transect?.id
        ? [[input.transect.id, input.state]]
        : []);
  const serverPhotos = Array.isArray(input?.photos) ? input.photos : [];
  const transectMap = indexed(transects, "id");
  const serverByRecord = new Map();
  for (const photo of serverPhotos) {
    const recordId = photo?.transect_id || "";
    if (!serverByRecord.has(recordId)) serverByRecord.set(recordId, []);
    serverByRecord.get(recordId).push(photo);
  }

  const recordIds = [...new Set([
    ...transects.map((transect) => transect?.id).filter(Boolean),
    ...serverPhotos.map((photo) => photo?.transect_id).filter(Boolean),
  ])];
  const rows = [];
  for (const recordId of recordIds) {
    const transect = transectMap.get(recordId) || null;
    const originalPayload = transect?.payload || {};
    const curation = curations.get(recordId) || null;
    const curationIsCurrent = Boolean(curation?.active && curation?.curated_payload)
      && Number(curation.source_submission_count) === Number(transect?.submission_count);
    const effectivePayload = curationIsCurrent ? curation.curated_payload : originalPayload;
    const originalById = photoDescriptorMap(originalPayload);
    const effectiveById = photoDescriptorMap(effectivePayload);
    const expectedIds = [...new Set([...originalById.keys(), ...effectiveById.keys()])];
    const uploaded = serverByRecord.get(recordId) || [];
    const uploadedIds = new Set(uploaded.map((photo) => photo?.id).filter(Boolean));
    const originalMatchedCount = [...originalById.keys()].filter((id) => uploadedIds.has(id)).length;
    const effectiveMatchedCount = [...effectiveById.keys()].filter((id) => uploadedIds.has(id)).length;
    const matchedCount = expectedIds.filter((id) => uploadedIds.has(id)).length;
    const expectedCount = expectedIds.length;
    const uploadedCount = uploaded.length;
    const missingCount = expectedCount - matchedCount;
    const recordUploadState = photoRecordState({
      expectedCount,
      matchedCount,
      uploadedCount,
      syncState: transect?.sync_state,
    });
    const common = {
      record_id: recordId,
      class_id: transect?.class_id || "",
      record_sync_state: transect?.sync_state || "",
      record_original_expected_photo_count: originalById.size,
      record_original_matched_uploaded_photo_count: originalMatchedCount,
      record_original_missing_photo_count: originalById.size - originalMatchedCount,
      record_original_photo_upload_state: photoRecordState({
        expectedCount: originalById.size,
        matchedCount: originalMatchedCount,
        uploadedCount,
        syncState: transect?.sync_state,
      }),
      record_effective_expected_photo_count: effectiveById.size,
      record_effective_matched_uploaded_photo_count: effectiveMatchedCount,
      record_effective_missing_photo_count: effectiveById.size - effectiveMatchedCount,
      record_effective_photo_upload_state: photoRecordState({
        expectedCount: effectiveById.size,
        matchedCount: effectiveMatchedCount,
        uploadedCount,
        syncState: transect?.sync_state,
      }),
      record_expected_photo_count: expectedCount,
      record_uploaded_photo_count: uploadedCount,
      record_matched_uploaded_photo_count: matchedCount,
      record_missing_photo_count: missingCount,
      record_photo_upload_state: recordUploadState,
      trashed_record: Boolean(states.get(recordId)?.trashed_at),
    };
    const append = (photoId, serverPhoto, descriptor) => {
      const expectedInOriginal = originalById.has(photoId);
      const expectedInEffective = effectiveById.has(photoId);
      const expected = expectedInOriginal || expectedInEffective;
      rows.push({
        photo_id: photoId,
        ...common,
        storage_identifier: serverPhoto?.storage_path || "",
        scope: photoValue(serverPhoto, descriptor, "scope", "scope"),
        segment_index: photoValue(serverPhoto, descriptor, "segment_index", "segmentIndex"),
        side: photoValue(serverPhoto, descriptor, "side", "side"),
        distance_band_start_m: photoValue(serverPhoto, descriptor, "band_start_m", "bandStart"),
        species_code: photoValue(serverPhoto, descriptor, "species_code", "speciesCode"),
        unknown_id: photoValue(serverPhoto, descriptor, "unknown_id", "unknownId"),
        note: photoValue(serverPhoto, descriptor, "note", "note"),
        captured_at: photoValue(serverPhoto, descriptor, "captured_at", "capturedAt"),
        original_filename: descriptor?.originalName || "",
        mime_type: photoValue(serverPhoto, descriptor, "mime_type", "mimeType"),
        size_bytes: photoValue(serverPhoto, descriptor, "size_bytes", "sizeBytes"),
        uploaded_at: serverPhoto?.uploaded_at || "",
        expected_in_original_payload: expectedInOriginal,
        expected_in_effective_payload: expectedInEffective,
        payload_sync_status: descriptor?.syncStatus || "",
        payload_failure_reported: Boolean(descriptor?.lastError || descriptor?.syncStatus === "submission_failed"),
        server_photo_metadata_present: Boolean(serverPhoto),
        upload_state: serverPhoto
          ? expected ? "uploaded" : "server_metadata_without_payload_descriptor"
          : "missing_from_storage_or_metadata",
        download_status: "not_requested",
      });
    };

    // Existing successful server-photo rows retain their original order.
    for (const serverPhoto of uploaded) {
      const descriptor = effectiveById.get(serverPhoto.id) || originalById.get(serverPhoto.id) || null;
      append(serverPhoto.id || "", serverPhoto, descriptor);
    }
    // Expected but missing attachments become explicit manifest rows.
    for (const photoId of expectedIds) {
      if (uploadedIds.has(photoId)) continue;
      append(photoId, null, effectiveById.get(photoId) || originalById.get(photoId));
    }
  }
  return rows;
}

export function buildPhotoManifest(bundle) {
  return reconcilePhotoInventory(bundle);
}

export function mergeExportBundles(bundles) {
  const output = { classes: [], transects: [], curations: [], states: [], photos: [], actions: [], revisions: [], curationRevisions: [] };
  for (const bundle of bundles || []) {
    for (const key of Object.keys(output)) {
      const source = key === "curationRevisions" ? (bundle?.curationRevisions || bundle?.curation_revisions) : bundle?.[key];
      output[key].push(...(source || []));
    }
  }
  output.classes = [...new Map(output.classes.map((item) => [item.id, item])).values()];
  return output;
}

export function filterExportBundle(bundle, { includeTest = false, includeExcluded = false, includeTrash = false, summaries = [] } = {}) {
  const byId = new Map((summaries || []).map((record) => [record.recordId || record.record_id, record]));
  const states = indexed(bundle?.states);
  const curations = indexed(bundle?.curations);
  const suggestsTest = (transect) => {
    const curation = curations.get(transect.id);
    const effectivePayload = curation?.active && Number(curation.source_submission_count) === Number(transect.submission_count)
      ? curation.curated_payload : transect.payload;
    const metadataValues = (payload) => {
      const metadata = payload?.metadata || {};
      return [metadata.site, metadata.trail, metadata.transectNumber, metadata.observers, metadata.generalNotes];
    };
    // Keep this equivalent to instructor_record_summaries.test_suggested: both
    // the effective and original labels plus the stable record ID are checked.
    const text = [...metadataValues(effectivePayload), ...metadataValues(transect.payload), transect.id].join(" ");
    return /(^|[^\p{L}\p{N}])(TEST DATA|SYNTHETIC|TEST-)/iu.test(text);
  };
  const keep = new Set((bundle?.transects || []).filter((transect) => {
    const summary = byId.get(transect.id);
    const authoritative = states.get(transect.id);
    const state = authoritative || {};
    const trashed = authoritative ? Boolean(state.trashed_at) : Boolean(summary && (summary.state?.trashed_at || summary.state?.trashedAt || summary.trashedAt));
    const excluded = authoritative ? Boolean(state.excluded_from_analysis) : Boolean(summary && recordIsExcluded(summary));
    const testStatus = state.test_data_status || "auto";
    const test = authoritative
      ? testStatus === "test" || (testStatus === "auto" && suggestsTest(transect))
      : (summary ? recordIsTest(summary) : suggestsTest(transect));
    return (includeTrash || !trashed) && (includeExcluded || !excluded) && (includeTest || !test);
  }).map((item) => item.id));
  return {
    classes: bundle?.classes || [],
    transects: (bundle?.transects || []).filter((item) => keep.has(item.id)),
    curations: (bundle?.curations || []).filter((item) => keep.has(item.transect_id)),
    states: (bundle?.states || []).filter((item) => keep.has(item.transect_id)),
    photos: (bundle?.photos || []).filter((item) => keep.has(item.transect_id)),
    actions: (bundle?.actions || []).filter((item) => keep.has(item.record_id)),
    revisions: (bundle?.revisions || []).filter((item) => keep.has(item.transect_id)),
    curationRevisions: (bundle?.curationRevisions || bundle?.curation_revisions || []).filter((item) => keep.has(item.transect_id)),
  };
}

export function suggestedFilename(prefix, extension) {
  const date = new Date().toISOString().slice(0, 10);
  const clean = String(prefix || "invasive-plant-export").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${clean || "invasive-plant-export"}-${date}.${extension}`;
}

export function downloadExport(format, bundle, { sourceMode = "curated", classes = [], prefix = "invasive-plant" } = {}) {
  if (format === "long-csv") {
    const csv = rowsToCsv(buildLongExport(bundle, { sourceMode, classes }));
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), suggestedFilename(`${prefix}-long`, "csv"));
    return;
  }
  if (format === "metadata-csv") {
    const csv = rowsToCsv(buildMetadataExport(bundle, { sourceMode, classes }));
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), suggestedFilename(`${prefix}-metadata`, "csv"));
    return;
  }
  if (format === "geojson") {
    const json = JSON.stringify(buildGeoJson(bundle, { sourceMode, classes }), null, 2);
    downloadBlob(new Blob([json], { type: "application/geo+json" }), suggestedFilename(prefix, "geojson"));
    return;
  }
  if (format === "photo-manifest") {
    const csv = rowsToCsv(buildPhotoManifest(bundle));
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), suggestedFilename(`${prefix}-photos`, "csv"));
    return;
  }
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), sourceMode, ...bundle }, null, 2);
  downloadBlob(new Blob([json], { type: "application/json" }), suggestedFilename(`${prefix}-raw`, "json"));
}

function extensionFor(photo) {
  const mime = String(photo.mime_type || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  return "jpg";
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safePathSegment(value) {
  const text = String(value || "item").normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 100);
  return text && text !== "." && text !== ".." ? text : "item";
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function write16(view, offset, value) { view.setUint16(offset, value, true); }
function write32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

/** Small STORE-only ZIP writer. Images are already compressed, so DEFLATE adds memory without useful savings. */
export function createStoreZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(String(entry.name));
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);
    const stamp = dosDateTime(entry.date || new Date());
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800);
    write16(localView, 8, 0); write16(localView, 10, stamp.time); write16(localView, 12, stamp.date);
    write32(localView, 14, crc); write32(localView, 18, data.length); write32(localView, 22, data.length);
    write16(localView, 26, name.length); write16(localView, 28, 0); local.set(name, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800); write16(centralView, 10, 0); write16(centralView, 12, stamp.time); write16(centralView, 14, stamp.date);
    write32(centralView, 16, crc); write32(centralView, 20, data.length); write32(centralView, 24, data.length);
    write16(centralView, 28, name.length); write16(centralView, 30, 0); write16(centralView, 32, 0);
    write16(centralView, 34, 0); write16(centralView, 36, 0); write32(centralView, 38, 0); write32(centralView, 42, localOffset);
    central.set(name, 46); centralParts.push(central);
    localOffset += local.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 4, 0); write16(endView, 6, 0);
  write16(endView, 8, entries.length); write16(endView, 10, entries.length);
  write32(endView, 12, centralSize); write32(endView, 16, localOffset); write16(endView, 20, 0);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

export async function downloadPhotoZip(bundle, { fetchPhotoUrls, onProgress = () => {}, prefix = "invasive-plant-photos" } = {}) {
  const photos = bundle?.photos || [];
  const totalBytes = photos.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
  if (!photos.length) throw new Error("The selected records contain no photographs.");
  if (photos.length > PHOTO_ZIP_LIMITS.maxFiles || totalBytes > PHOTO_ZIP_LIMITS.maxBytes) {
    throw new Error(`Photo bundles are limited to ${PHOTO_ZIP_LIMITS.maxFiles} files and ${Math.round(PHOTO_ZIP_LIMITS.maxBytes / 1048576)} MB. Download a manifest or choose a smaller batch.`);
  }
  const authorization = await fetchPhotoUrls(photos.map((item) => item.id));
  const signed = new Map((authorization.items || []).map((item) => [item.id, item]));
  const manifest = buildPhotoManifest(bundle);
  const zipEntries = [];
  let completed = 0;
  let failures = 0;
  let actualBytes = 0;
  for (const photo of photos) {
    const item = signed.get(photo.id);
    const row = manifest.find((candidate) => candidate.photo_id === photo.id);
    try {
      if (!item?.signedUrl) throw new Error(item?.signedError || "No signed URL returned.");
      const response = await fetch(item.signedUrl, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const declaredLength = Number(response.headers?.get?.("Content-Length") || 0);
      if (declaredLength && actualBytes + declaredLength > PHOTO_ZIP_LIMITS.maxBytes) {
        const limitError = new Error(`The downloaded photographs exceed the ${Math.round(PHOTO_ZIP_LIMITS.maxBytes / 1048576)} MB browser ZIP limit. Choose a smaller batch.`);
        limitError.code = "actual_zip_limit";
        throw limitError;
      }
      const blob = await response.blob();
      if (actualBytes + blob.size > PHOTO_ZIP_LIMITS.maxBytes) {
        const limitError = new Error(`The downloaded photographs exceed the ${Math.round(PHOTO_ZIP_LIMITS.maxBytes / 1048576)} MB browser ZIP limit. Choose a smaller batch.`);
        limitError.code = "actual_zip_limit";
        throw limitError;
      }
      actualBytes += blob.size;
      zipEntries.push({
        name: `${safePathSegment(photo.transect_id)}/${safePathSegment(photo.id)}.${extensionFor(photo)}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      row.download_status = "included";
    } catch (error) {
      if (error?.code === "actual_zip_limit") throw error;
      failures += 1;
      row.download_status = `failed: ${String(error?.message || error).slice(0, 120)}`;
    }
    completed += 1;
    onProgress({ completed, total: photos.length, failures });
  }
  const encoder = new TextEncoder();
  zipEntries.push({ name: "photo-manifest.csv", data: encoder.encode(rowsToCsv(manifest)) });
  zipEntries.push({ name: "README.txt", data: encoder.encode(`Generated ${new Date().toISOString()}.\nRequested: ${photos.length}\nIncluded: ${photos.length - failures}\nFailed: ${failures}\nSee photo-manifest.csv for per-file status.\n`) });
  onProgress({ completed, total: photos.length, failures, zipPercent: 50 });
  const blob = createStoreZip(zipEntries);
  onProgress({ completed, total: photos.length, failures, zipPercent: 100 });
  downloadBlob(blob, suggestedFilename(prefix, "zip"));
  return { requested: photos.length, included: photos.length - failures, failures };
}
