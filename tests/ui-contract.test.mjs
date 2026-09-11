import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [html, css, app, guide, guideScript, worker, storage, backend] = await Promise.all([
  fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../styles.css", import.meta.url), "utf8"),
  fs.readFile(new URL("../app.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../guide.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../guide.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../storage.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../backend.js", import.meta.url), "utf8"),
]);

test("cell editor exposes explicit Save and Cancel controls", () => {
  assert.match(html, /data-action="save-cell"/);
  assert.ok((html.match(/data-action="cancel-cell"/g) || []).length >= 2);
  assert.doesNotMatch(html, /Transcribe paper sheet/);
});

test("student navigation has two pages and landing consolidates class and backup tools", () => {
  const navigation = html.match(/<nav id="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.equal((navigation.match(/data-nav=/g) || []).length, 2);
  assert.match(navigation, /data-nav="home"/);
  assert.match(navigation, /data-nav="summary"/);
  assert.doesNotMatch(navigation, /settings|Class &amp; backup/i);
  assert.match(app, /function classAndBackupMarkup/);
  assert.match(app, /id="class-and-backup"/);
  assert.match(app, /id="class-form"/);
  assert.match(app, /data-action="import-backup"/);
  assert.doesNotMatch(app, /function renderSettings|state\.view === "settings"|setView\("settings"\)/);
  assert.doesNotMatch(app, /Start where the trail begins|Thirty true 1-meter segments/);
});

test("species choices make scientific names primary and codes secondary", () => {
  assert.match(app, /<strong class="species-scientific"><i>\$\{escapeHtml\(species\.scientificName\)\}<\/i><\/strong>/);
  assert.match(app, /<span class="species-meta"><span class="species-code">\$\{escapeHtml\(species\.code\)\}<\/span> · \$\{escapeHtml\(species\.commonName\)\}<\/span>/);
  assert.match(css, /\.species-choice \.species-scientific[^}]*font-size:\s*1\.05rem/);
  assert.match(css, /\.species-choice \.species-code[^}]*font-size:\s*\.72rem/);
});

test("side-level no-target actions apply directly while NS remains cell-only", () => {
  const sidePanel = app.match(/function renderSidePanel[\s\S]*?\n}\n\nfunction renderEntry/)?.[0] || "";
  const cellDialog = app.match(/function renderCellDialog[\s\S]*?\n}\n\nfunction applySpeciesFilter/)?.[0] || "";
  const markBatch = app.match(/async function markBatch[\s\S]*?\n}\n\nfunction choosePhoto/)?.[0] || "";
  assert.match(sidePanel, />No Target Species<\/button>/);
  assert.match(sidePanel, /data-action="mark-side-zero"/);
  assert.doesNotMatch(sidePanel, /mark-side-ns|cells = NS|cells = 0/);
  assert.match(cellDialog, /data-status="\$\{CELL_STATUSES\.NOT_SURVEYED\}"[^>]*>NS · not surveyed<\/button>/);
  assert.match(app, /markBatch\(button\.dataset\.side, CELL_STATUSES\.NO_TARGET, \{ confirm: false \}\)/);
  assert.match(markBatch, /if \(confirm\) \{[\s\S]*?await askConfirm/);
  assert.match(app, /markBatch\(null, CELL_STATUSES\.NO_TARGET\)/);
});

test("dialog has a bounded flex height and a dedicated shrinking scroll region", () => {
  assert.match(css, /\.dialog-shell\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s);
  assert.match(css, /\.dialog-body\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  assert.match(css, /body\.modal-open\s*\{[^}]*position:\s*fixed[^}]*overflow:\s*hidden/s);
  assert.match(app, /restorePageAfterDialog/);
  assert.match(app, /focusSelector[^}]+focus\(\{ preventScroll: true \}\)/s);
  assert.match(app, /catch \(error\) \{\s*state\.cellDraft = null;\s*state\.editingCell = null;\s*restorePageAfterDialog\(\)/s);
  assert.match(app, /window\.scrollTo\(\{ top: context\.pageY, behavior: "auto" \}\)/);
});

test("guide files remain available but the student app no longer advertises them", () => {
  assert.doesNotMatch(app, /guide\.html|data-guide-link|ID guide|identification guide/i);
  assert.match(app, /href="\.\/instructor\.html"/);
  assert.match(guide, /23 targets/);
  assert.match(guide, /Quick field terms/);
  const coreBlock = worker.match(/const CORE_FILES = \[[\s\S]*?\];/)?.[0] || "";
  assert.doesNotMatch(coreBlock, /guide\.html|assets\/species/);
  assert.match(worker, /isOnlineGuideRequest/);
  assert.match(guideScript, /source and reuse record/);
  assert.match(guideScript, /addEventListener\("error"/);
  assert.match(guideScript, /window\.close\(\)/);
});

test("instructor files are online-only and never fall back to the student app", () => {
  const coreBlock = worker.match(/const CORE_FILES = \[[\s\S]*?\];/)?.[0] || "";
  assert.doesNotMatch(coreBlock, /instructor(?:[-.][a-z0-9-]+)*\.(?:html|css|js)/i);
  assert.match(worker, /function isInstructorRequest/);
  assert.match(worker, /function offlineInstructorResponse/);
  assert.match(worker, /fetch\(request, \{ cache: "no-store" \}\)\.catch\(offlineInstructorResponse\)/);
  const instructorBranch = worker.indexOf("if (isInstructorRequest(url))");
  const navigationFallback = worker.indexOf('if (request.mode === "navigate")', instructorBranch + 1);
  assert.ok(instructorBranch >= 0 && navigationFallback > instructorBranch,
    "Instructor routing must be handled before the generic navigation fallback.");
  assert.doesNotMatch(
    worker.slice(instructorBranch, navigationFallback),
    /caches\.match\("\.\/index\.html"\)/,
    "An offline instructor request must not render the student app.",
  );
});

test("legacy transition is one-time and old uploads are rejected at both storage and sync boundaries", () => {
  assert.match(storage, /PROTOCOL_V2_RESET_KEY = "protocol-v2-local-reset-completed"/);
  assert.match(storage, /if \(prior\) return \{ removedTransects: 0, removedBlobs: 0, alreadyRun: true \}/);
  assert.match(storage, /isProtocolV2Transect/);
  assert.match(backend, /schemaVersion !== SCHEMA_VERSION \|\| transect\.protocolVersion !== PROTOCOL_VERSION/);
  assert.match(backend, /retired 5-meter protocol/);
});
