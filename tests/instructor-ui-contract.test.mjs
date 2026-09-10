import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fitInstructorMap, renderInstructorMap } from "../instructor-map.js";

const [html, css, app, api, data, downloads, map] = await Promise.all([
  fs.readFile(new URL("../instructor.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../instructor.css", import.meta.url), "utf8"),
  fs.readFile(new URL("../instructor.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../instructor-api.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../instructor-data.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../instructor-downloads.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../instructor-map.js", import.meta.url), "utf8"),
]);

test("pre-authentication surface contains only login controls/status and no class data", () => {
  const login = html.match(/<main id="login-view"[\s\S]*?<\/main>/)?.[0] || "";
  assert.match(login, /<h1 id="login-title">Instructor dashboard<\/h1>/);
  assert.match(login, /name="reviewerName"/);
  assert.match(login, /name="password" type="password"/);
  assert.match(login, /type="submit">Sign in<\/button>/);
  assert.match(login, /id="login-status"/);
  assert.match(login, /href="\.\/index\.html"/);
  assert.doesNotMatch(login, /summary-card|record-map|records-body|class-filter|observer|coordinates|photograph/i);
  assert.doesNotMatch(login, /login-intro|class="eyebrow"/, "The prompt limits pre-auth content to the named controls and status text.");
  assert.match(html, /id="dashboard-view" class="dashboard hidden" aria-hidden="true" hidden/);
  assert.match(app, /if \(!state\.session\) \{ showLogin\(\); return; \}/);
});

test("dashboard exposes the complete filter, selection, paging, detail, and destructive controls", () => {
  for (const name of [
    "classId", "term", "includeInactiveClasses", "surveyDateFrom", "surveyDateTo", "submissionDateFrom", "submissionDateTo",
    "site", "trail", "transectNumber", "observer", "recordId", "species", "surveyStatus", "syncState",
    "completionState", "gpsState", "photoState", "reviewStatus", "exclusionState", "testState", "trashState", "curationState",
  ]) assert.match(html, new RegExp(`name="${name}"`));
  for (const action of [
    "refresh", "clear-filters", "select-page", "select-all-filtered", "clear-selection",
    "trash-selected", "restore-selected", "purge-selected", "previous-page", "next-page", "open-downloads", "close-filters", "show-test-only",
  ]) assert.match(html, new RegExp(`data-action="${action}"`));
  assert.match(html, /id="record-dialog"/);
  assert.match(html, /id="curation-dialog"/);
  assert.match(html, /id="purge-dialog"/);
  assert.match(html, /id="photo-dialog"/);
  assert.match(app, /all\.length !== total \|\| new Set\(ids\)\.size !== total/);
  assert.match(app, /data\.summary \|\| data\.aggregates/);
  assert.match(data, /supplied\.totals \|\| supplied/);
  assert.match(data, /speciesDetectionFrequency/);
});

test("downloads default to curated analysis and opt in to test, excluded, or trashed data", () => {
  for (const scope of ["selected", "filtered", "class", "all"]) assert.match(html, new RegExp(`name="scope" value="${scope}"`));
  for (const format of ["long-csv", "metadata-csv", "geojson", "raw-json", "photo-manifest", "photo-zip"]) {
    assert.match(html, new RegExp(`value="${format}"`));
  }
  assert.match(html, /name="sourceMode" value="curated" checked/);
  for (const name of ["includeTest", "includeExcluded", "includeTrash"]) {
    const input = html.match(new RegExp(`<input name="${name}"[^>]*>`))?.[0] || "";
    assert.ok(input);
    assert.doesNotMatch(input, /\bchecked\b/);
  }
  assert.match(app, /Calculating exact eligible record count/);
  assert.match(downloads, /PHOTO_ZIP_LIMITS/);
  assert.match(downloads, /createStoreZip/);
  assert.match(downloads, /credentials: "omit"/);
  assert.match(app, /TRANSFORM_EXPORT_RECORD_LIMIT = 500/);
  assert.match(app, /\["metadata-csv", "geojson"\]\.includes\(format\)/);
  assert.match(app, /classes: bundle\.classes/);
  assert.doesNotMatch(html, /jszip/i);
});

test("instructor auth stays server-side, tab-scoped, cache-free, and secret-free", () => {
  const publicRuntime = [html, app, api, data, downloads, map].join("\n");
  assert.match(api, /sessionStorage/);
  assert.doesNotMatch(api, /localStorage/);
  assert.match(api, /Authorization: `Bearer \$\{token\}`/);
  assert.match(api, /cache: "no-store"/);
  assert.match(api, /credentials: "omit"/);
  assert.match(api, /if \(error\?\.status === 401\) clearInstructorSession\(\)/);
  assert.doesNotMatch(publicRuntime, /SUPABASE_SERVICE_ROLE_KEY|INSTRUCTOR_SESSION_SECRET|INSTRUCTOR_PASSWORD_HASH|sb_secret_/);
  assert.doesNotMatch(publicRuntime, /password\s*===|===\s*password/);
  assert.match(app, /form\.elements\.password\.value = ""/);
});

test("mutation request IDs are bound to immutable payloads and abandoned operation contexts are cleared", () => {
  assert.match(app, /createInstructorRequestId/);
  const binding = app.match(/function boundRequestId[\s\S]*?\n}\n\nfunction invalidateBoundRequest/)?.[0] || "";
  assert.match(binding, /fingerprint = JSON\.stringify\(payload\)/);
  assert.match(binding, /existing\?\.fingerprint === fingerprint/);
  assert.match(binding, /operationRequests\.set\(holder, \{ fingerprint, requestId \}\)/);

  const pendingAction = app.match(/async function performPendingAction[\s\S]*?\n}\n\nasync function startPurge/)?.[0] || "";
  assert.equal((pendingAction.match(/boundRequestId\(pending,/g) || []).length, 3);
  assert.equal((pendingAction.match(/\{ requestId \}/g) || []).length, 3);
  assert.match(pendingAction, /state\.pendingAction = null/);

  const purge = app.match(/async function executePurge[\s\S]*?\n}\n\nasync function resolveDownloadRecords/)?.[0] || "";
  assert.match(purge, /boundRequestId\(preview, \{/);
  assert.match(purge, /\}, \{ requestId \}\)/);
  assert.match(purge, /state\.purgePreview = null/);
  assert.match(purge, /form\.reset\(\)/);

  assert.match(app, /boundRequestId\(form, \{[\s\S]*?action: INSTRUCTOR_ACTIONS\.SAVE_STATE/);
  assert.match(app, /boundRequestId\(form, \{[\s\S]*?action: INSTRUCTOR_ACTIONS\.SAVE_CURATION/);
  assert.match(app, /document\.addEventListener\("input", invalidateEditedOperation\)/);
  assert.match(app, /document\.addEventListener\("change", invalidateEditedOperation\)/);
  assert.match(app, /dialog === curationDialog[\s\S]*?invalidateBoundRequest/);
  assert.match(app, /dialog === actionDialog[\s\S]*?state\.pendingAction = null/);
  assert.match(app, /dialog === purgeDialog[\s\S]*?state\.purgePreview = null[\s\S]*?form\.reset\(\)/);
  assert.match(app, /state\.exportRequestIds\.clear\(\)/);
  assert.match(app, /fetchExportRecords\(recordIds, \{ format, reason \}, \{ requestId \}\)/);
  const selectedPhotos = app.match(/async function downloadSelectedDetailPhotos[\s\S]*?\n}\n\nfunction stateFormMarkup/)?.[0] || "";
  assert.match(selectedPhotos, /fetchAuditedExport\(\[detailId\], "photo-zip"\)/);
  assert.doesNotMatch(selectedPhotos, /fetchExportRecords/);
  assert.match(api, /protectedMutationRequest/);
  assert.match(api, /requestId: requiredRequestId\(requestId\)/);
});

test("sign-out removes previously authorized class data and private-photo URLs from the tab", () => {
  const showLogin = app.match(/function showLogin\([\s\S]*?\n}\n\nfunction showDashboard/)?.[0] || "";
  assert.match(showLogin, /closeAllDialogs\(\{ restoreFocus: false \}\)/);
  assert.match(showLogin, /destroyInstructorMap/);
  assert.match(showLogin, /state\.classes = \[\]/);
  assert.match(showLogin, /state\.records = \[\]/);
  assert.match(showLogin, /state\.selected\.clear\(\)/);
  assert.match(showLogin, /state\.selectedPhotos\.clear\(\)/);
  assert.match(showLogin, /state\.photoUrls\.clear\(\)/);
  assert.match(showLogin, /state\.photoPreviewRequests\.clear\(\)/);
  assert.match(showLogin, /state\.purgePreview = null/);
  assert.match(showLogin, /state\.downloadPreview = null/);
  assert.match(showLogin, /#photo-body/);
  assert.match(showLogin, /#class-filter/);
  assert.match(showLogin, /#term-filter/);
  assert.match(showLogin, /dashboardView\.hidden = true/);
});

test("record detail exposes provenance, cell filtering, and private-photo context", () => {
  for (const label of ["Original submission", "Latest submission update", "Revisions", "Sync state", "Curation", "Trash state"]) {
    assert.match(app, new RegExp(label));
  }
  assert.match(app, /data-action="detail-cell-filter"/);
  assert.match(app, /All 180/);
  assert.match(app, /data-photo-thumbnail/);
  assert.match(app, /photoAssociation/);
  assert.match(app, /state\.photoUrls/);
  assert.match(app, /safeSignedPhotoUrl/);
  assert.match(app, /reconcilePhotoInventory/);
  assert.match(app, /Expected attachment missing/);
  assert.match(app, /missing from server photo metadata or private Storage/);
  assert.match(app, /data-action="load-photo-preview"/);
  assert.match(app, /Request fresh preview/);
  const openRecord = app.match(/async function openRecord[\s\S]*?\n}\n\nfunction renderMap/)?.[0] || "";
  assert.doesNotMatch(openRecord, /fetchPhotoUrls|loadPhotoPreview/);
  assert.match(app, /async function loadPhotoPreview[\s\S]*?fetchPhotoUrls\(\[photoId\]\)/);
});

test("permanent purge is exact, reauthenticated, and keeps per-record partial failures visible", () => {
  const purge = html.match(/<dialog id="purge-dialog"[\s\S]*?<\/dialog>/)?.[0] || "";
  assert.match(purge, /name="reason"[^>]*required/);
  assert.match(purge, /name="password" type="password"[^>]*required/);
  assert.match(purge, /name="confirmation"[^>]*required/);
  assert.match(purge, /id="purge-record-list"/);
  assert.match(purge, /id="purge-result"/);
  assert.match(purge, />Permanently purge<\/button>/);
  assert.match(app, /sortedEligible\.length !== sortedRequested\.length/);
  assert.match(app, /photoMetadataCount/);
  assert.match(app, /storageObjectCount/);
  assert.match(app, /Partial purge/);
  assert.match(app, /Do not reuse this challenge/);
  assert.match(app, /state\.filters\.trashState !== "trashed"/);
  assert.match(app, /MAX_PURGE_RECORDS = 20/);
  assert.match(app, /form\.dataset\.locked = "true"/);
});

test("latest list and detail requests win without dropping a second load", () => {
  const load = app.match(/async function loadRecords[\s\S]*?\n}\n\nfunction renderDashboard/)?.[0] || "";
  const detail = app.match(/async function openRecord[\s\S]*?\n}\n\nfunction renderMap/)?.[0] || "";
  assert.doesNotMatch(load, /if \(state\.loading\) return/);
  assert.match(load, /requestNumber = \+\+state\.loadRequest/);
  assert.match(load, /filters: structuredClone\(state\.filters\)/);
  assert.match(load, /request\.page > returnedTotalPages/);
  assert.match(detail, /requestNumber = \+\+state\.detailRequest/);
  assert.match(detail, /requestNumber !== state\.detailRequest/);
  assert.match(app, /sessionIsCurrent\(epoch\)/);
});

test("curation preserves the active editor, exact charts expose overflow, and selection keeps focus", () => {
  assert.match(app, /!applyCurationCell\(\{ rerender: false, announce: false \}\)/);
  assert.match(app, /renderCuration\(\{ focus: "editor" \}\)/);
  assert.match(app, /segmentNotes/);
  assert.match(app, /Show all \$\{allItems\.length\.toLocaleString\(\)\} exact values/);
  const selectionChange = app.match(/const checkbox = event\.target\.closest[\s\S]*?renderSelection\(\);\n}\);/)?.[0] || "";
  assert.doesNotMatch(selectionChange, /renderTable\(\)/);
  assert.match(html, /Submission date \(Reno\)/);
  assert.match(html, /id="term-filter"/);
});

test("dashboard dependencies and responsive layout have browser security boundaries", () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /name="referrer" content="strict-origin-when-cross-origin"/);
  assert.match(html, /img-src[^;]*https:\/\/tile\.openstreetmap\.org/);
  assert.doesNotMatch(html, /https:\/\/\*\.tile\.openstreetmap\.org/);
  assert.match(map, /https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.doesNotMatch(map, /\{s\}\.tile\.openstreetmap\.org/);
  for (const resource of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="https:[^"]+"[^>]*>/g)) {
    assert.match(resource[0], /integrity="(?:sha256|sha384|sha512)-[^"]+"/);
    assert.match(resource[0], /crossorigin="anonymous"/);
  }
  assert.match(css, /grid-template-columns:\s*18rem minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 62rem\)/);
  assert.match(css, /@media \(max-width: 44rem\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /data-action="fit-map"/);
  assert.match(html, /data-action="focus-selected-map"/);
  assert.match(html, /data-action="toggle-map-size"/);
  assert.match(map, /scrollWheelZoom:\s*false/);
  assert.match(map, /ResizeObserver/);
  assert.match(css, /\.exploration-grid\.map-expanded/);
});

test("map fallback consumes flat API rows, omits absent GPS, and escapes labels", () => {
  const container = { innerHTML: "", querySelectorAll: () => [] };
  const originalLeaflet = globalThis.L;
  try {
    delete globalThis.L;
    renderInstructorMap(container, [
      {
        recordId: "transect_located", site: "<img onerror=alert(1)>", trail: "Test",
        startGps: { latitude: 0, longitude: 0 }, endGps: { latitude: 0.002, longitude: 0.004 },
        incompleteCells: 1, reviewStatus: "unreviewed",
      },
      { recordId: "transect_absent", site: "No GPS", startGps: null, endGps: null },
    ]);
    assert.match(container.innerHTML, /0\.00000, 0\.00000/);
    assert.match(container.innerHTML, /End 0\.00200, 0\.00400/);
    assert.match(container.innerHTML, /&lt;img onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(container.innerHTML, /<img|No GPS|transect_absent/);
  } finally {
    if (originalLeaflet === undefined) delete globalThis.L;
    else globalThis.L = originalLeaflet;
  }
});

test("interactive map endpoint markers select the same record as the transect line", () => {
  const handlers = [];
  const layers = [];
  const makeLayer = (kind) => ({
    kind,
    bindPopup() { return this; },
    on(event, callback) { if (event === "click") handlers.push({ kind, callback }); return this; },
    addTo(group) { group.items.push(this); return this; },
  });
  const group = { items: [], addTo() { return this; }, clearLayers() { this.items = []; } };
  const originalLeaflet = globalThis.L;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.L = {
    map: () => ({ fitBounds() {}, setView() {}, invalidateSize() {} }),
    tileLayer: () => ({ addTo() {} }),
    featureGroup: () => group,
    polyline: () => { const layer = makeLayer("line"); layers.push(layer); return layer; },
    circleMarker: () => { const layer = makeLayer("endpoint"); layers.push(layer); return layer; },
  };
  const selected = [];
  try {
    renderInstructorMap({ replaceChildren() {} }, [{
      recordId: "transect_line", site: "Site", startGps: { latitude: 1, longitude: 2 },
      endGps: { latitude: 3, longitude: 4 }, incompleteCells: 0, reviewStatus: "reviewed",
    }], { onSelect: (id) => selected.push(id) });
    assert.equal(handlers.filter((item) => item.kind === "endpoint").length, 2);
    handlers.forEach((item) => item.callback());
    assert.deepEqual(selected, ["transect_line", "transect_line", "transect_line"]);
  } finally {
    if (originalLeaflet === undefined) delete globalThis.L;
    else globalThis.L = originalLeaflet;
    if (originalAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test("map preserves a user's viewport when selection changes and offers an explicit reset", () => {
  let clearCount = 0;
  let fitCount = 0;
  let mapOptions;
  const makeLayer = () => ({
    bindPopup() { return this; }, bindTooltip() { return this; }, on() { return this; },
    addTo(group) { group.items.push(this); return this; }, setStyle() {}, setRadius() {}, bringToFront() {},
  });
  const group = { items: [], addTo() { return this; }, clearLayers() { clearCount += 1; this.items = []; } };
  const originalLeaflet = globalThis.L;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  globalThis.L = {
    map: (_container, options) => {
      mapOptions = options;
      return { fitBounds() { fitCount += 1; }, setView() {}, invalidateSize() {}, on() {}, remove() {} };
    },
    control: { zoom: () => ({ addTo() {} }) },
    tileLayer: () => ({ addTo() {} }), featureGroup: () => group,
    polyline: () => makeLayer(), circleMarker: () => makeLayer(),
  };
  const container = { replaceChildren() {} };
  const records = [{
    recordId: "transect_line", site: "Site", startGps: { latitude: 1, longitude: 2 },
    endGps: { latitude: 1.001, longitude: 2.001 }, incompleteCells: 0, reviewStatus: "reviewed",
  }];
  try {
    renderInstructorMap(container, records);
    assert.equal(clearCount, 1);
    assert.equal(fitCount, 1);
    assert.equal(mapOptions.scrollWheelZoom, false);
    assert.equal(mapOptions.touchZoom, true);

    renderInstructorMap(container, records, { selectedId: "transect_line" });
    assert.equal(clearCount, 1, "selection must not rebuild every map layer");
    assert.equal(fitCount, 1, "selection must not undo the user's pan or zoom");

    assert.equal(fitInstructorMap(container), true);
    assert.equal(fitCount, 2, "Fit records is the explicit viewport reset");
  } finally {
    if (originalLeaflet === undefined) delete globalThis.L;
    else globalThis.L = originalLeaflet;
    if (originalAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});
