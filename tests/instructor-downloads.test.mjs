import test from "node:test";
import assert from "node:assert/strict";
import {
  PHOTO_ZIP_LIMITS,
  buildGeoJson,
  buildLongExport,
  buildMetadataExport,
  buildPhotoManifest,
  downloadPhotoZip,
  exportEntries,
  filterExportBundle,
  reconcilePhotoInventory,
  rowsToCsv,
} from "../instructor-downloads.js";
import {
  CELL_STATUSES,
  createTransect,
  findCell,
  setCellStatus,
} from "../protocol.js";

function payload(id, { site = "Original Site", gps = "line" } = {}) {
  const item = createTransect();
  item.id = id;
  item.metadata.site = site;
  item.metadata.trail = "Trail, One";
  item.metadata.observers = "Ada \"A\" & Lin";
  item.metadata.surveyDate = "2026-09-10";
  item.metadata.generalNotes = "line one\nline two";
  item.segments.forEach((segment) => segment.cells.forEach((cell) => setCellStatus(cell, CELL_STATUSES.NO_TARGET)));
  if (gps === "line" || gps === "start") {
    item.metadata.startGps = { latitude: 0, longitude: 0, accuracy: 5, timestamp: "2026-09-10T12:00:00Z" };
  }
  if (gps === "line" || gps === "end") {
    item.metadata.endGps = { latitude: 0.002, longitude: 0.004, accuracy: 8, timestamp: "2026-09-10T12:20:00Z" };
  }
  return item;
}

function row(id, item, overrides = {}) {
  return {
    id,
    class_id: "class_1",
    payload: item,
    protocol_version: "2.0.0",
    species_list_version: "reno-2026.1",
    original_submitted_at: "2026-09-10T12:30:00Z",
    client_modified_at: "2026-09-10T12:29:00Z",
    server_created_at: "2026-09-10T12:30:01Z",
    server_updated_at: "2026-09-10T12:30:01Z",
    sync_state: "submitted",
    submission_count: 1,
    ...overrides,
  };
}

const classes = [{ id: "class_1", name: "BIO 101", term: "Fall 2026", active: true }];

test("long and metadata exports reconstruct all 180 cells including multi-detection, 0, NS, and incomplete", () => {
  const original = payload("transect_export");
  const multi = findCell(original, 0, "left", 0);
  multi.status = CELL_STATUSES.DETECTED;
  multi.species = ["BRTE", "CIIN"];
  setCellStatus(findCell(original, 1, "right", 2), CELL_STATUSES.NOT_SURVEYED);
  setCellStatus(findCell(original, 2, "left", 1), CELL_STATUSES.INCOMPLETE);
  const bundle = { transects: [row(original.id, original)], curations: [], states: [], photos: [] };

  const rows = buildLongExport(bundle, { sourceMode: "original", classes });
  assert.equal(rows.length, 181);
  const cellKeys = new Set(rows.map((item) => [
    item.record_id, item.segment_start_m, item.side, item.distance_band_start_m,
  ].join("|")));
  assert.equal(cellKeys.size, 180);
  assert.equal(rows.filter((item) => item.species_code === "BRTE").length, 1);
  assert.equal(rows.filter((item) => item.species_code === "CIIN").length, 1);
  assert.equal(rows.filter((item) => item.survey_status === "not_surveyed").length, 1);
  assert.equal(rows.filter((item) => item.survey_status === "incomplete").length, 1);
  assert.equal(rows.filter((item) => item.survey_status === "surveyed_no_target").length, 177);

  const [metadata] = buildMetadataExport(bundle, { sourceMode: "original", classes });
  assert.equal(metadata.completed_cells, 179);
  assert.equal(metadata.detected_cells, 1);
  assert.equal(metadata.detected_species_count, 2);
  assert.equal(metadata.not_surveyed_cells, 1);
  assert.equal(metadata.incomplete_cells, 1);
  assert.equal(metadata.general_notes, "line one\nline two");
  assert.equal(metadata.entry_method, "digital_field");
  assert.equal(metadata.schema_version, 2);
  assert.equal(metadata.protocol_version, "2.0.0");
  assert.equal(metadata.species_list_version, "reno-2026.1");
  assert.equal(metadata.curation_status, "none");
  assert.equal(metadata.curation_present, false);
  assert.equal(metadata.original_payload_record_id, original.id);
  assert.equal(metadata.effective_payload_record_id, original.id);
  assert.equal(metadata.server_created_at, "2026-09-10T12:30:01Z");
  assert.equal(metadata.server_updated_at, "2026-09-10T12:30:01Z");
  assert.equal(metadata.photo_count, 0);
  assert.equal(metadata.expected_payload_photo_count, 0);
  assert.equal(metadata.uploaded_server_photo_count, 0);
  assert.equal(metadata.missing_expected_photo_count, 0);
  assert.equal(metadata.photo_upload_state, "no_photos_expected");
});

test("curated export is effective only when based on the current student submission", () => {
  const original = payload("transect_curated", { site: "Original" });
  const curated = structuredClone(original);
  curated.metadata.site = "Curated";
  const transect = row(original.id, original, { submission_count: 3 });

  const currentBundle = {
    transects: [transect],
    curations: [{ transect_id: original.id, active: true, curated_payload: curated, source_submission_count: 3, version: 1 }],
    states: [], photos: [],
  };
  assert.equal(exportEntries(currentBundle, { sourceMode: "curated" })[0].payload.metadata.site, "Curated");
  assert.deepEqual(exportEntries(currentBundle, { sourceMode: "both" }).map((entry) => entry.dataSource), ["original", "curated"]);

  const staleBundle = structuredClone(currentBundle);
  staleBundle.curations[0].source_submission_count = 2;
  const [effective] = exportEntries(staleBundle, { sourceMode: "curated" });
  assert.equal(effective.payload.metadata.site, "Original");
  assert.equal(effective.dataSource, "original");
  assert.equal(effective.curationStale, true);
});

test("metadata export identifies current, stale, and inactive curation state with provenance", () => {
  const original = payload("transect_metadata", { site: "Original" });
  original.createdAt = "2026-09-10T11:50:00Z";
  original.modifiedAt = "2026-09-10T12:29:00Z";
  original.originalSubmittedAt = "2026-09-10T12:30:00Z";
  const curated = structuredClone(original);
  curated.metadata.site = "Curated";
  curated.metadata.generalNotes = "Instructor-corrected notes";
  curated.modifiedAt = "2026-09-10T13:00:00Z";
  const transect = row(original.id, original, { submission_count: 3, entry_method: "paper_transcription" });
  const curation = {
    transect_id: original.id,
    active: true,
    curated_payload: curated,
    source_submission_count: 3,
    version: 4,
    created_at: "2026-09-10T12:45:00Z",
    updated_at: "2026-09-10T13:00:00Z",
  };
  const currentBundle = { transects: [transect], curations: [curation], states: [], photos: [] };

  const [current] = buildMetadataExport(currentBundle, { sourceMode: "curated", classes });
  assert.equal(current.site, "Curated");
  assert.equal(current.general_notes, "Instructor-corrected notes");
  // The indexed server column is authoritative and the payload remains a fallback.
  assert.equal(current.entry_method, "paper_transcription");
  assert.equal(current.curation_status, "current");
  assert.equal(current.curation_present, true);
  assert.equal(current.curation_active, true);
  assert.equal(current.curation_current, true);
  assert.equal(current.curation_stale, false);
  assert.equal(current.curation_source_submission_count, 3);
  assert.equal(current.curation_version, 4);
  assert.equal(current.curation_created_at, "2026-09-10T12:45:00Z");
  assert.equal(current.curation_updated_at, "2026-09-10T13:00:00Z");
  assert.equal(current.original_payload_created_at, "2026-09-10T11:50:00Z");
  assert.equal(current.original_payload_modified_at, "2026-09-10T12:29:00Z");
  assert.equal(current.effective_payload_modified_at, "2026-09-10T13:00:00Z");

  const staleBundle = structuredClone(currentBundle);
  staleBundle.curations[0].source_submission_count = 2;
  const [stale] = buildMetadataExport(staleBundle, { sourceMode: "curated", classes });
  assert.equal(stale.site, "Original");
  assert.equal(stale.curation_status, "stale");
  assert.equal(stale.curation_present, true);
  assert.equal(stale.curation_active, true);
  assert.equal(stale.curation_current, false);
  assert.equal(stale.curation_stale, true);
  assert.equal(stale.effective_payload_modified_at, "2026-09-10T12:29:00Z");

  const inactiveBundle = structuredClone(currentBundle);
  inactiveBundle.curations[0].active = false;
  inactiveBundle.curations[0].curated_payload = null;
  const [inactive] = buildMetadataExport(inactiveBundle, { sourceMode: "curated", classes });
  assert.equal(inactive.curation_status, "inactive");
  assert.equal(inactive.curation_present, true);
  assert.equal(inactive.curation_active, false);
  assert.equal(inactive.curation_current, false);
  assert.equal(inactive.curation_stale, false);
});

test("default analysis filtering excludes test, excluded, and trashed records independently", () => {
  const records = ["keep", "test", "excluded", "trash"].map((id) => row(id, payload(id)));
  const bundle = {
    transects: records,
    curations: [],
    states: [
      { transect_id: "test", test_data_status: "test" },
      { transect_id: "excluded", test_data_status: "real", excluded_from_analysis: true },
      { transect_id: "trash", test_data_status: "real", trashed_at: "2026-09-10T13:00:00Z" },
    ],
    photos: [],
  };
  assert.deepEqual(filterExportBundle(bundle).transects.map((item) => item.id), ["keep"]);
  assert.deepEqual(
    filterExportBundle(bundle, { includeTest: true, includeExcluded: true, includeTrash: true }).transects.map((item) => item.id),
    ["keep", "test", "excluded", "trash"],
  );
});

test("test-data filtering matches the server rule for original labels and record IDs", () => {
  const originalLabel = payload("ordinary_record", { site: "TEST DATA original" });
  const curatedLabel = structuredClone(originalLabel);
  curatedLabel.metadata.site = "Apparently real site";
  const idLabel = payload("transect_TEST-identifier", { site: "Apparently real site" });
  const bundle = {
    transects: [
      row(originalLabel.id, originalLabel, { submission_count: 2 }),
      row(idLabel.id, idLabel),
    ],
    curations: [{
      transect_id: originalLabel.id, active: true, curated_payload: curatedLabel,
      source_submission_count: 2, version: 1,
    }],
    // A persisted state row must not switch auto-classification to a narrower
    // client-only rule than instructor_record_summaries uses.
    states: [
      { transect_id: originalLabel.id, test_data_status: "auto" },
      { transect_id: idLabel.id, test_data_status: "auto" },
    ],
    photos: [],
  };
  const summaries = bundle.transects.map((transect) => ({ recordId: transect.id, effectiveIsTest: true }));
  assert.deepEqual(filterExportBundle(bundle, { summaries }).transects, []);
  assert.equal(filterExportBundle(bundle, { summaries, includeTest: true }).transects.length, 2);
});

test("CSV output is RFC-4180-safe for commas, quotes, and newlines", () => {
  const csv = rowsToCsv([{ site: "Trail, One", observers: 'Ada "A"', note: "first\nsecond" }], ["site", "observers", "note"]);
  assert.equal(csv, 'site,observers,note\r\n"Trail, One","Ada ""A""","first\nsecond"\r\n');
});

test("CSV neutralizes spreadsheet formulas without changing numeric measurements", () => {
  const csv = rowsToCsv([{
    observer: "=HYPERLINK(\"https://example.invalid\")",
    note: "+cmd",
    longitude: -119.81,
  }], ["observer", "note", "longitude"]);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
  assert.match(csv, /'\+cmd/);
  assert.match(csv, /,-119\.81\r\n$/);
});

test("GeoJSON uses longitude-latitude order, represents one endpoint as a point, and omits absent GPS", () => {
  const line = payload("line", { gps: "line" });
  const point = payload("point", { gps: "end" });
  const absent = payload("absent", { gps: "none" });
  const bundle = {
    transects: [row("line", line), row("point", point), row("absent", absent)],
    curations: [], states: [], photos: [],
  };
  const output = buildGeoJson(bundle, { sourceMode: "original", classes });
  assert.equal(output.type, "FeatureCollection");
  assert.equal(output.features.length, 2);
  assert.deepEqual(output.features.find((item) => item.id === "line:original").geometry, {
    type: "LineString", coordinates: [[0, 0], [0.004, 0.002]],
  });
  assert.deepEqual(output.features.find((item) => item.id === "point:original").geometry, {
    type: "Point", coordinates: [0.004, 0.002],
  });
});

test("photo manifest links metadata without embedding signed URLs or credentials", () => {
  const original = payload("transect_photo");
  original.photos.push({
    id: "photo_1", blobId: "blob_1", scope: "cell", segmentIndex: 1,
    side: "left", bandStart: 2, speciesCode: "BRTE", unknownId: null,
    note: "Payload note", capturedAt: "2026-09-10T12:10:00Z",
    originalName: "field-photo.jpg", mimeType: "image/jpeg", sizeBytes: 123,
  });
  const bundle = {
    transects: [row(original.id, original)], curations: [], states: [],
    photos: [{
      id: "photo_1", transect_id: original.id, storage_path: "owner/transect_photo/photo_1.jpg",
      scope: "cell", segment_index: 1, side: "left", band_start_m: 2, species_code: "BRTE",
      mime_type: "image/jpeg", size_bytes: 123, captured_at: "2026-09-10T12:10:00Z",
    }],
  };
  const [manifest] = buildPhotoManifest(bundle);
  assert.equal(manifest.photo_id, "photo_1");
  assert.equal(manifest.record_id, "transect_photo");
  assert.equal(manifest.distance_band_start_m, 2);
  assert.equal(manifest.expected_in_original_payload, true);
  assert.equal(manifest.expected_in_effective_payload, true);
  assert.equal(manifest.server_photo_metadata_present, true);
  assert.equal(manifest.upload_state, "uploaded");
  assert.equal(manifest.record_expected_photo_count, 1);
  assert.equal(manifest.record_uploaded_photo_count, 1);
  assert.equal(manifest.record_missing_photo_count, 0);
  assert.equal(manifest.record_photo_upload_state, "complete");
  assert.equal(manifest.download_status, "not_requested");
  assert.equal(Object.keys(manifest).some((key) => /signed|token|password|service/i.test(key)), false);
});

test("photo inventory exposes failed and incomplete payload attachments without inventing uploads", () => {
  const original = payload("transect_partial");
  original.photos = [
    {
      id: "photo_uploaded", blobId: "blob_uploaded", scope: "meter", segmentIndex: 2,
      note: "Confirmed image", capturedAt: "2026-09-10T12:05:00Z", mimeType: "image/jpeg",
      sizeBytes: 100,
    },
    {
      id: "photo_pending", blobId: "blob_pending", scope: "cell", segmentIndex: 8,
      side: "left", bandStart: 0, speciesCode: "BRTE", note: "Queued image",
      capturedAt: "2026-09-10T12:06:00Z", mimeType: "image/png", sizeBytes: 200,
      syncStatus: "pending_upload",
    },
    {
      id: "photo_failed", blobId: "blob_failed", scope: "cell", segmentIndex: 9,
      side: "right", bandStart: 1, unknownId: "unknown_1", note: "Failed image",
      capturedAt: "2026-09-10T12:07:00Z", mimeType: "image/heic", sizeBytes: 300,
      syncStatus: "submission_failed", lastError: "Network interrupted",
    },
  ];
  const transect = row(original.id, original, { sync_state: "upload_partially_complete" });
  const serverPhotos = [
    {
      id: "photo_uploaded", transect_id: original.id,
      storage_path: "owner/transect_partial/photo_uploaded.jpg", scope: "meter",
      segment_index: 2, mime_type: "image/jpeg", size_bytes: 100,
      uploaded_at: "2026-09-10T12:10:00Z",
    },
    {
      id: "photo_server_only", transect_id: original.id,
      storage_path: "owner/transect_partial/photo_server_only.jpg", scope: "transect",
      mime_type: "image/jpeg", size_bytes: 50, uploaded_at: "2026-09-10T12:11:00Z",
      signedUrl: "https://must-not-leak.invalid/photo",
    },
  ];
  const detail = {
    transect,
    curation: null,
    state: { transect_id: original.id, trashed_at: null },
    photos: serverPhotos,
    sessionToken: "must-not-leak",
  };

  const inventory = reconcilePhotoInventory(detail);
  assert.equal(inventory.length, 4);
  assert.deepEqual(inventory.map((item) => item.photo_id), [
    "photo_uploaded", "photo_server_only", "photo_pending", "photo_failed",
  ]);
  for (const item of inventory) {
    assert.equal(item.record_expected_photo_count, 3);
    assert.equal(item.record_uploaded_photo_count, 2);
    assert.equal(item.record_matched_uploaded_photo_count, 1);
    assert.equal(item.record_missing_photo_count, 2);
    assert.equal(item.record_photo_upload_state, "partial");
  }
  assert.equal(inventory.find((item) => item.photo_id === "photo_uploaded").upload_state, "uploaded");
  assert.equal(inventory.find((item) => item.photo_id === "photo_server_only").upload_state, "server_metadata_without_payload_descriptor");
  const pending = inventory.find((item) => item.photo_id === "photo_pending");
  assert.equal(pending.upload_state, "missing_from_storage_or_metadata");
  assert.equal(pending.payload_sync_status, "pending_upload");
  assert.equal(pending.server_photo_metadata_present, false);
  assert.equal(pending.storage_identifier, "");
  const failed = inventory.find((item) => item.photo_id === "photo_failed");
  assert.equal(failed.upload_state, "missing_from_storage_or_metadata");
  assert.equal(failed.payload_sync_status, "submission_failed");
  assert.equal(failed.payload_failure_reported, true);
  assert.equal(failed.mime_type, "image/heic");
  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /must-not-leak|signedUrl|sessionToken/);

  assert.deepEqual(buildPhotoManifest(detail), inventory);

  const [metadata] = buildMetadataExport({
    transects: [transect], curations: [], states: [], photos: serverPhotos,
  }, { sourceMode: "original", classes });
  assert.equal(metadata.photo_count, 2);
  assert.equal(metadata.expected_payload_photo_count, 3);
  assert.equal(metadata.uploaded_server_photo_count, 2);
  assert.equal(metadata.missing_expected_photo_count, 2);
  assert.equal(metadata.photo_upload_state, "partial");
});

test("missing server-side payload descriptors remain explicit even when sync status was stripped", () => {
  const original = payload("transect_missing_photo");
  original.photos = [{
    id: "photo_without_client_state", blobId: "blob_local", scope: "transect",
    capturedAt: "2026-09-10T12:08:00Z", mimeType: "image/jpeg", sizeBytes: 321,
  }];
  const bundle = {
    transects: [row(original.id, original, { sync_state: "upload_partially_complete" })],
    curations: [], states: [], photos: [],
  };
  const [manifest] = buildPhotoManifest(bundle);
  assert.equal(manifest.photo_id, "photo_without_client_state");
  assert.equal(manifest.payload_sync_status, "");
  assert.equal(manifest.upload_state, "missing_from_storage_or_metadata");
  assert.equal(manifest.record_photo_upload_state, "missing_all");
  assert.equal(manifest.record_missing_photo_count, 1);
});

test("photo inventory distinguishes original and current effective attachment expectations", () => {
  const original = payload("transect_curated_photos");
  original.photos = [
    { id: "original_only", blobId: "blob_original", scope: "transect", mimeType: "image/jpeg" },
    { id: "shared", blobId: "blob_shared", scope: "meter", segmentIndex: 4, mimeType: "image/jpeg" },
  ];
  const curated = structuredClone(original);
  curated.photos = [
    curated.photos.find((photo) => photo.id === "shared"),
    { id: "effective_only", blobId: "blob_effective", scope: "cell", segmentIndex: 5, side: "right", bandStart: 2, mimeType: "image/png" },
  ];
  const transect = row(original.id, original, { submission_count: 2, sync_state: "submitted" });
  const bundle = {
    transects: [transect],
    curations: [{
      transect_id: original.id, active: true, curated_payload: curated,
      source_submission_count: 2, version: 1,
    }],
    states: [],
    photos: [{
      id: "shared", transect_id: original.id,
      storage_path: "owner/transect_curated_photos/shared.jpg",
      scope: "meter", segment_index: 4, mime_type: "image/jpeg",
    }],
  };
  const inventory = reconcilePhotoInventory(bundle);
  assert.deepEqual(inventory.map((item) => item.photo_id), ["shared", "original_only", "effective_only"]);
  assert.deepEqual(
    inventory.map((item) => [item.photo_id, item.expected_in_original_payload, item.expected_in_effective_payload]),
    [
      ["shared", true, true],
      ["original_only", true, false],
      ["effective_only", false, true],
    ],
  );
  assert.equal(inventory[0].record_original_expected_photo_count, 2);
  assert.equal(inventory[0].record_original_matched_uploaded_photo_count, 1);
  assert.equal(inventory[0].record_original_missing_photo_count, 1);
  assert.equal(inventory[0].record_original_photo_upload_state, "partial");
  assert.equal(inventory[0].record_effective_expected_photo_count, 2);
  assert.equal(inventory[0].record_effective_matched_uploaded_photo_count, 1);
  assert.equal(inventory[0].record_effective_missing_photo_count, 1);
  assert.equal(inventory[0].record_effective_photo_upload_state, "partial");
  assert.equal(inventory[0].record_expected_photo_count, 3);
  assert.equal(inventory[0].record_matched_uploaded_photo_count, 1);
  assert.equal(inventory[0].record_missing_photo_count, 2);
  assert.equal(inventory[0].record_photo_upload_state, "partial");
});

test("photo ZIP enforces in-memory limits before requesting signed URLs", async () => {
  const tooMany = Array.from({ length: PHOTO_ZIP_LIMITS.maxFiles + 1 }, (_, index) => ({
    id: `photo_${index}`, transect_id: "transect_zip", size_bytes: 1,
  }));
  let requested = false;
  await assert.rejects(
    () => downloadPhotoZip({ photos: tooMany }, { fetchPhotoUrls: async () => { requested = true; return { items: [] }; } }),
    /limited to/i,
  );
  assert.equal(requested, false);

  await assert.rejects(
    () => downloadPhotoZip({ photos: [{ id: "huge", transect_id: "transect_zip", size_bytes: PHOTO_ZIP_LIMITS.maxBytes + 1 }] }, { fetchPhotoUrls: async () => ({ items: [] }) }),
    /limited to/i,
  );
});

test("photo ZIP reports partial failures, sanitizes archive paths, and includes a manifest", async () => {
  const photos = [
    { id: "photo/one", transect_id: "../record", size_bytes: 4, mime_type: "image/jpeg" },
    { id: "missing", transect_id: "record", size_bytes: 4, mime_type: "image/jpeg" },
  ];
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalSetTimeout = globalThis.setTimeout;
  let downloadedBlob;
  const requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return { ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/jpeg" }) };
    };
    globalThis.document = {
      body: { append() {} },
      createElement: () => ({ click() {}, remove() {} }),
    };
    URL.createObjectURL = (blob) => { downloadedBlob = blob; return "blob:test"; };
    URL.revokeObjectURL = () => {};
    globalThis.setTimeout = () => 0;
    const progress = [];
    const result = await downloadPhotoZip(
      { photos },
      {
        fetchPhotoUrls: async (ids) => {
          assert.deepEqual(ids, ["photo/one", "missing"]);
          return { items: [{ id: "photo/one", signedUrl: "https://signed.invalid/photo" }] };
        },
        onProgress: (value) => progress.push(value),
      },
    );
    assert.deepEqual(result, { requested: 2, included: 1, failures: 1 });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].options, { cache: "no-store", credentials: "omit" });
    assert.equal(progress.at(-1).zipPercent, 100);
    const bytes = new Uint8Array(await downloadedBlob.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const archiveText = new TextDecoder().decode(bytes);
    assert.match(archiveText, /_record\/photo_one\.jpg/);
    assert.doesNotMatch(archiveText, /\.\.\/record\/photo(?:\/|_)one\.jpg/);
    assert.match(archiveText, /photo-manifest\.csv/);
    assert.match(archiveText, /failed: No signed URL returned\./);
    assert.match(archiveText, /Requested: 2\nIncluded: 1\nFailed: 1/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("photo ZIP enforces the byte cap against fetched data, not only client metadata", async () => {
  const oversizedBlob = {
    size: PHOTO_ZIP_LIMITS.maxBytes + 1,
    arrayBuffer() { throw new Error("oversized photo must not be buffered"); },
  };
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  const originalSetTimeout = globalThis.setTimeout;
  try {
    globalThis.fetch = async () => ({ ok: true, blob: async () => oversizedBlob });
    globalThis.document = { body: { append() {} }, createElement: () => ({ click() {}, remove() {} }) };
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => {};
    globalThis.setTimeout = () => 0;
    await assert.rejects(
      () => downloadPhotoZip(
        { photos: [{ id: "misreported", transect_id: "transect_zip", size_bytes: 1 }] },
        { fetchPhotoUrls: async () => ({ items: [{ id: "misreported", signedUrl: "https://signed.invalid/photo" }] }) },
      ),
      /downloaded photo data exceeds|actual photo data exceeds|75 MB/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    globalThis.setTimeout = originalSetTimeout;
  }
});
