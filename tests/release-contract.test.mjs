import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createTransect, PROTOCOL_VERSION, SCHEMA_VERSION, TOTAL_CELLS } from "../protocol.js";
import { CONFIG } from "../config.js";

const [packageJson, worker, storage, app, index, deploymentChecker] = await Promise.all([
  fs.readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  fs.readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../storage.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../app.js", import.meta.url), "utf8"),
  fs.readFile(new URL("../index.html", import.meta.url), "utf8"),
  fs.readFile(new URL("../tools/check-deployed.mjs", import.meta.url), "utf8"),
]);

test("release 2.1.1 changes the app/cache version without changing ecological protocol v2", () => {
  assert.equal(packageJson.version, "2.1.1");
  assert.equal(CONFIG.appVersion, "2.1.1");
  assert.match(worker, /CACHE_NAME\s*=\s*"invasive-transect-app-v2\.1\.1"/);
  assert.equal(PROTOCOL_VERSION, "2.0.0");
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(TOTAL_CELLS, 180);
  const record = createTransect();
  assert.equal(record.appVersion, "2.1.1");
  assert.equal(record.protocolVersion, "2.0.0");
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.segments.length, 30);
  assert.equal(record.segments.flatMap((segment) => segment.cells).length, 180);
});

test("minor app release preserves the existing IndexedDB and one-time protocol reset marker", () => {
  assert.match(storage, /DB_NAME\s*=\s*"invasive-plant-transect-v1"/);
  assert.match(storage, /DB_VERSION\s*=\s*1/);
  assert.match(storage, /PROTOCOL_V2_RESET_KEY\s*=\s*"protocol-v2-local-reset-completed"/);
  assert.doesNotMatch(storage, /v2\.1|2\.1\.0/);
});

test("service-worker activation removes only earlier caches owned by this app", () => {
  assert.match(worker, /CACHE_PREFIX\s*=\s*"invasive-transect-app-v"/);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)\s*&&\s*key !== CACHE_NAME/);
  assert.doesNotMatch(worker, /keys\.filter\(\(key\) => key !== CACHE_NAME\)/);
});

test("deployment checker verifies every local instructor frontend dependency", () => {
  for (const filename of [
    "instructor.html", "instructor.css", "instructor.js", "instructor-api.js", "instructor-data.js",
    "instructor-downloads.js", "instructor-map.js",
  ]) {
    assert.ok(deploymentChecker.includes(`"${filename}"`), `${filename} must be a deployed checker target`);
  }
  assert.match(deploymentChecker, /target\.endsWith\("\.css"\)/);
  assert.match(deploymentChecker, /instructor module graph is incomplete/);
  assert.match(deploymentChecker, /\["enroll-class", "instructor-dashboard"\]/);
  assert.match(deploymentChecker, /"Content-Type": "application\/jsonp"/);
  assert.match(deploymentChecker, /probe\.status !== 415/);
});

test("student runtime has exactly one secondary instructor entry point and no guide route", () => {
  const runtime = `${index}\n${app}`;
  assert.equal((runtime.match(/href="\.\/instructor\.html"/g) || []).length, 1);
  assert.doesNotMatch(runtime, /href=["'][^"']*guide\.html|data-guide-link|ID guide|identification guide/i);
});
