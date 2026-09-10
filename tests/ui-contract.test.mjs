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

test("dialog has a bounded flex height and a dedicated shrinking scroll region", () => {
  assert.match(css, /\.dialog-shell\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s);
  assert.match(css, /\.dialog-body\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s);
  assert.match(css, /body\.modal-open\s*\{[^}]*position:\s*fixed[^}]*overflow:\s*hidden/s);
  assert.match(app, /restorePageAfterDialog/);
  assert.match(app, /focusSelector[^}]+focus\(\{ preventScroll: true \}\)/s);
  assert.match(app, /catch \(error\) \{\s*state\.cellDraft = null;\s*state\.editingCell = null;\s*restorePageAfterDialog\(\)/s);
  assert.match(app, /window\.scrollTo\(\{ top: context\.pageY, behavior: "auto" \}\)/);
});

test("guide is linked from the app but deliberately excluded from mandatory offline caching", () => {
  assert.match(app, /data-guide-link/);
  assert.match(guide, /23 targets/);
  assert.match(guide, /Quick field terms/);
  const coreBlock = worker.match(/const CORE_FILES = \[[\s\S]*?\];/)?.[0] || "";
  assert.doesNotMatch(coreBlock, /guide\.html|assets\/species/);
  assert.match(worker, /isOnlineGuideRequest/);
  assert.match(guideScript, /source and reuse record/);
  assert.match(guideScript, /addEventListener\("error"/);
  assert.match(guideScript, /window\.close\(\)/);
  assert.match(app, /guide\.html\?from=app#/);
  assert.match(app, /target="_blank"[^>]*data-guide-link/);
});

test("legacy transition is one-time and old uploads are rejected at both storage and sync boundaries", () => {
  assert.match(storage, /PROTOCOL_V2_RESET_KEY = "protocol-v2-local-reset-completed"/);
  assert.match(storage, /if \(prior\) return \{ removedTransects: 0, removedBlobs: 0, alreadyRun: true \}/);
  assert.match(storage, /isProtocolV2Transect/);
  assert.match(backend, /schemaVersion !== SCHEMA_VERSION \|\| transect\.protocolVersion !== PROTOCOL_VERSION/);
  assert.match(backend, /retired 5-meter protocol/);
});
