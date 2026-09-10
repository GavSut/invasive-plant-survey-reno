import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SPECIES, SPECIES_LIST_VERSION, validateSpeciesList } from "../species.js";
import { CELLS_PER_SEGMENT, DISTANCE_BANDS, PROTOCOL_VERSION, SCHEMA_VERSION, SEGMENT_COUNT, TOTAL_CELLS } from "../protocol.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "index.html", "styles.css", "app.js", "protocol.js", "storage.js", "backend.js",
  "config.js", "species.js", "service-worker.js", "manifest.webmanifest", ".nojekyll",
  "guide.html", "guide.css", "guide.js", "README.md", "UPDATE.md",
  "docs/ARCHITECTURE.md", "docs/BACKEND_AND_OPERATIONS.md", "docs/CATALOG_CORRECTIONS.md",
  "docs/DATA_DICTIONARY.md", "docs/IMAGE_SOURCES.md", "docs/TESTING.md",
  "data/sample_long_format.csv", "data/species_code_crosswalk.csv",
  "data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv",
  "backend/supabase/schema.sql", "backend/supabase/migrations/20260910_protocol_v2.sql",
  "backend/supabase/admin/cleanup-protocol-v1.mjs", "backend/supabase/functions/enroll-class/index.ts",
  "tools/generate-crosswalk.mjs", "archive/legacy-5m/README.md",
];

for (const relative of required) {
  const stat = await fs.stat(path.join(root, relative)).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Missing required file: ${relative}`);
}

for (const file of ["app.js", "protocol.js", "storage.js", "backend.js", "species.js", "config.js", "service-worker.js", "guide.js", "tools/generate-crosswalk.mjs", "backend/supabase/admin/cleanup-protocol-v1.mjs"]) {
  execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function recordsFromCsv(text) {
  const [rawHeaders, ...rawRows] = parseCsv(text);
  const headers = rawHeaders.map((header) => header.trim());
  return rawRows.filter((row) => row.some(Boolean)).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

const html = await fs.readFile(path.join(root, "index.html"), "utf8");
for (const reference of ["./styles.css", "./app.js", "./manifest.webmanifest"]) {
  if (!html.includes(reference)) throw new Error(`index.html does not reference ${reference}`);
}
for (const action of ['data-action="save-cell"', 'data-action="cancel-cell"']) {
  if (!html.includes(action)) throw new Error(`Cell editor is missing ${action}.`);
}

const guideHtml = await fs.readFile(path.join(root, "guide.html"), "utf8");
for (const reference of ["./guide.css", "./guide.js", "./data/species_code_crosswalk.csv"]) {
  if (!guideHtml.includes(reference)) throw new Error(`guide.html does not reference ${reference}`);
}
if (!guideHtml.includes("Quick field terms") || !guideHtml.includes("Awn") || !guideHtml.includes("Samara")) throw new Error("Guide is missing its brief field-term definitions.");

const worker = await fs.readFile(path.join(root, "service-worker.js"), "utf8");
for (const reference of ["./index.html", "./app.js", "./protocol.js", "./storage.js", "./species.js"]) {
  if (!worker.includes(`"${reference}"`)) throw new Error(`Service worker does not cache ${reference}`);
}
const coreBlock = worker.match(/const CORE_FILES = \[[\s\S]*?\];/)?.[0] || "";
if (/guide\.html|guide\.js|guide\.css|assets\/species/.test(coreBlock)) throw new Error("Online-only guide files must not be in the mandatory app precache.");
for (const token of ["isOnlineGuideRequest", "offlineGuideResponse", "invasive-transect-app-v2.0.0"]) {
  if (!worker.includes(token)) throw new Error(`Service worker is missing ${token}.`);
}

const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.webmanifest"), "utf8"));
if (manifest.start_url !== "./" || manifest.scope !== "./") throw new Error("PWA manifest must retain relative GitHub Pages paths.");

if (SEGMENT_COUNT !== 30 || CELLS_PER_SEGMENT !== 6 || TOTAL_CELLS !== 180 || DISTANCE_BANDS.length !== 3) {
  throw new Error("Protocol constants do not describe 30 segments and 180 cells.");
}
if (PROTOCOL_VERSION !== "2.0.0" || SCHEMA_VERSION !== 2) throw new Error("Current protocol/schema versions are incorrect.");
if (DISTANCE_BANDS.some((band, index) => band.start !== index || band.end !== index + 1)) throw new Error("Distance bands must be 0-1, 1-2, and 2-3 m.");

const config = await fs.readFile(path.join(root, "config.js"), "utf8");
if (/serviceRoleKey\s*:|SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+|sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{50,}/.test(config)) {
  throw new Error("config.js appears to contain a privileged credential.");
}

const speciesErrors = validateSpeciesList();
if (speciesErrors.length) throw new Error(speciesErrors.join(" "));
if (SPECIES.length !== 23 || SPECIES_LIST_VERSION !== "reno-2026.1") throw new Error("Catalog must contain 23 targets at version reno-2026.1.");
const codes = new Set();
const imagePaths = new Set();
for (const species of SPECIES) {
  if (species.code === "UNKNOWN") throw new Error("UNKNOWN cannot be a target taxon.");
  if (codes.has(species.code)) throw new Error(`Duplicate species code ${species.code}.`);
  codes.add(species.code);
  if (species.codeAuthority !== "USDA NRCS PLANTS" || !species.codeSource?.includes(`symbol=${species.code}`) || species.codeVerified !== "2026-09-10") {
    throw new Error(`${species.code} is missing USDA code provenance.`);
  }
  if (!/^[YN]$/.test(species.instructorClassification?.nevadaNoxious || "")) throw new Error(`${species.code} is missing the supplied Y/N classification.`);
  if (species.guide?.traits?.length < 3 || species.guide.traits.length > 5 || !species.guide.lookalikes || !species.guide.seasonal || !species.guide.safety || !species.guide.sources?.length) {
    throw new Error(`${species.code} guide content is incomplete.`);
  }
  for (const image of species.guide.images) {
    for (const field of ["src", "alt", "creator", "provider", "attribution", "sourceTaxon", "sourceRecord", "sourceImage", "rights", "accessed", "modifications"]) {
      if (!image[field]) throw new Error(`${species.code} image is missing ${field}.`);
    }
    if (!image.src.startsWith("./assets/species/") || !image.sourceRecord.startsWith("https://plantsservices.sc.egov.usda.gov/api/PlantImages?") || !image.rights.includes("Copyright=false")) {
      throw new Error(`${species.code} image provenance is incomplete.`);
    }
    if (imagePaths.has(image.src)) throw new Error(`Guide image reused unexpectedly: ${image.src}`);
    imagePaths.add(image.src);
    const imageStat = await fs.stat(path.join(root, image.src.slice(2))).catch(() => null);
    if (!imageStat?.isFile() || imageStat.size < 1000) throw new Error(`Missing or implausibly small guide image: ${image.src}`);
  }
}
if (imagePaths.size !== 38 || SPECIES.filter((species) => species.guide.images.length === 0).map((species) => species.code).join() !== "CEDI3") {
  throw new Error("Expected 38 vetted images and the documented CEDI3-only image gap.");
}

const sourceBytes = await fs.readFile(path.join(root, "data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv"));
const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
if (sourceHash !== "f1432e35ab48f58a700b5f6e5c275170dcbc02e5089054388ec11e33083d8e21") throw new Error("Preserved instructor source CSV has changed.");
const sourceRows = recordsFromCsv(sourceBytes.toString("utf8"));
if (sourceRows.length !== 23) throw new Error(`Instructor source should have 23 rows; found ${sourceRows.length}.`);
for (const [index, row] of sourceRows.entries()) {
  const target = SPECIES[index];
  if (target.instructorClassification.nevadaNoxious !== row["Nevada Noxious Weed?"] || target.instructorClassification.notes !== row.Notes) {
    throw new Error(`${target.code} changed an instructor-supplied classification or note.`);
  }
}

const crosswalkText = await fs.readFile(path.join(root, "data/species_code_crosswalk.csv"), "utf8");
const crosswalk = recordsFromCsv(crosswalkText);
if (crosswalk.length !== 23) throw new Error(`Code crosswalk should have 23 rows; found ${crosswalk.length}.`);
if (crosswalk.map((row) => row.species_code).join("|") !== SPECIES.map((species) => species.code).join("|")) throw new Error("Crosswalk order/codes differ from species.js.");

const sampleText = await fs.readFile(path.join(root, "data/sample_long_format.csv"), "utf8");
const sampleMatrix = parseCsv(sampleText);
if (sampleMatrix.length !== 9) throw new Error(`Sample CSV should contain a header and 8 rows; found ${sampleMatrix.length}.`);
const headerLength = sampleMatrix[0].length;
if (!sampleMatrix.every((row) => row.length === headerLength)) throw new Error("Sample CSV rows do not have a consistent field count.");
for (const token of ["detected", "surveyed_no_target", "not_surveyed", "incomplete", "UNKNOWN", "edited_after_submission", "digital_field", "2.0.0", "reno-2026.1"]) {
  if (!sampleText.includes(token)) throw new Error(`Sample CSV is missing ${token}.`);
}
if (/paper_transcription|,3,4,|,4,5,/.test(sampleText)) throw new Error("Sample CSV contains retired workflow/geometry values.");

const schema = await fs.readFile(path.join(root, "backend/supabase/schema.sql"), "utf8");
for (const requirement of ["enable row level security", "security_invoker = true", "analysis_export_long", "archive_transect_revision", "is_protocol_v2_payload", "protocol_version = '2.0.0'", "jsonb_array_length(v_segment -> 'cells') is distinct from 6", "count(distinct value #>> '{}')", "v_status <> 'detected'"]) {
  if (!schema.toLowerCase().includes(requirement.toLowerCase())) throw new Error(`Schema is missing ${requirement}.`);
}
const migration = await fs.readFile(path.join(root, "backend/supabase/migrations/20260910_protocol_v2.sql"), "utf8");
for (const requirement of ["not valid", "validate constraint", "is_protocol_v2_payload", "protocol_version = '2.0.0'", "band_start_m between 0 and 2"]) {
  if (!migration.toLowerCase().includes(requirement.toLowerCase())) throw new Error(`Migration is missing ${requirement}.`);
}
if (/delete\s+from/i.test(migration)) throw new Error("The migration must not perform a broad data cleanup.");
const cleanup = await fs.readFile(path.join(root, "backend/supabase/admin/cleanup-protocol-v1.mjs"), "utf8");
for (const requirement of ["2026-09-09T23:20:10Z", "CONFIRM_DELETE", "server_created_at=lte", "protocol_version=neq.2.0.0", "/rest/v1/transects", "/rest/v1/photos", "/rest/v1/transect_revisions", "/storage/v1/object/transect-photos", "prefixes"]) {
  if (!cleanup.includes(requirement)) throw new Error(`Cleanup script is missing ${requirement}.`);
}
if (/auth\/users|rest\/v1\/classes|rest\/v1\/class_members/.test(cleanup)) throw new Error("Cleanup script targets protected setup data.");

const app = await fs.readFile(path.join(root, "app.js"), "utf8");
const styles = await fs.readFile(path.join(root, "styles.css"), "utf8");
const activeRuntime = [html, app, styles, await fs.readFile(path.join(root, "protocol.js"), "utf8"), await fs.readFile(path.join(root, "backend.js"), "utf8")].join("\n");
for (const retired of ["paper_transcription", "Transcribe paper sheet", "3-4 m", "4-5 m", "300 cells"]) {
  if (activeRuntime.includes(retired)) throw new Error(`Active runtime still contains retired assumption: ${retired}`);
}
if (!/body\.modal-open\s*\{[^}]*position:\s*fixed[^}]*overflow:\s*hidden/s.test(styles)
    || !/\.dialog-body\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s.test(styles)
    || !app.includes("restorePageAfterDialog")) {
  throw new Error("Cell-dialog scroll/focus restoration contract is incomplete.");
}

const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
const firstLines = readme.split(/\r?\n/).slice(0, 6).join("\n");
for (const credit of ["Gavin Sutter", "GPT-6 Astra Pro", "Codex — GPT-5", "not recorded"]) {
  if (!firstLines.includes(credit)) throw new Error(`README opening attribution is missing ${credit}.`);
}

console.log(JSON.stringify({
  requiredFiles: required.length,
  javascriptSyntax: "pass",
  geometry: `${SEGMENT_COUNT} segments / ${TOTAL_CELLS} cells`,
  speciesTargets: SPECIES.length,
  guideImages: imagePaths.size,
  sourceChecksum: "pass",
  sampleCsv: "8 rows / pass",
  offlineBoundary: "pass",
  backendGuards: "pass",
  legacyTransitionScope: "pass",
  llmAttribution: "pass",
}, null, 2));
