import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SPECIES, SPECIES_LIST_VERSION, validateSpeciesList } from "../species.js";
import { CELLS_PER_SEGMENT, DISTANCE_BANDS, PROTOCOL_VERSION, SCHEMA_VERSION, SEGMENT_COUNT, TOTAL_CELLS, validateTransect } from "../protocol.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "index.html", "styles.css", "app.js", "protocol.js", "storage.js", "backend.js",
  "config.js", "species.js", "service-worker.js", "manifest.webmanifest", ".nojekyll",
  "guide.html", "guide.css", "guide.js", "README.md", "UPDATE.md",
  "instructor.html", "instructor.css", "instructor.js", "instructor-api.js",
  "instructor-data.js", "instructor-downloads.js",
  "docs/ARCHITECTURE.md", "docs/BACKEND_AND_OPERATIONS.md", "docs/CATALOG_CORRECTIONS.md",
  "docs/DATA_DICTIONARY.md", "docs/IMAGE_SOURCES.md", "docs/INSTRUCTOR_DASHBOARD.md", "docs/TESTING.md",
  "data/sample_long_format.csv", "data/species_code_crosswalk.csv",
  "data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv",
  "backend/supabase/schema.sql", "backend/supabase/config.toml",
  "backend/supabase/migrations/20260910_protocol_v2.sql",
  "backend/supabase/migrations/20260910_instructor_dashboard_v2_1.sql",
  "backend/supabase/admin/cleanup-protocol-v1.mjs", "backend/supabase/functions/enroll-class/index.ts",
  "backend/supabase/functions/instructor-dashboard/index.ts",
  "sample-data/README.md", "sample-data/generate-fixtures.mjs",
  "sample-data/synthetic-dashboard-fixture.sql", "sample-data/synthetic-dashboard-cleanup.sql",
  "sample-data/synthetic-dashboard-locations.geojson", "sample-data/synthetic-phone-import-backup.json",
  "sample-data/synthetic-photo.png",
  "tools/generate-crosswalk.mjs", "archive/legacy-5m/README.md",
];

for (const relative of required) {
  const stat = await fs.stat(path.join(root, relative)).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Missing required file: ${relative}`);
}

for (const file of [
  "app.js", "protocol.js", "storage.js", "backend.js", "species.js", "config.js", "service-worker.js", "guide.js",
  "instructor.js", "instructor-api.js", "instructor-data.js", "instructor-downloads.js",
  "sample-data/generate-fixtures.mjs", "tools/generate-crosswalk.mjs", "backend/supabase/admin/cleanup-protocol-v1.mjs",
]) {
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
const studentNav = html.match(/<nav id="bottom-nav"[\s\S]*?<\/nav>/)?.[0] || "";
if ((studentNav.match(/data-nav=/g) || []).length !== 2 || !studentNav.includes('data-nav="home"')
    || !studentNav.includes('data-nav="summary"') || /settings|Class &amp; backup/i.test(studentNav)) {
  throw new Error("Student navigation must contain only Transects and Summary.");
}

const instructorHtml = await fs.readFile(path.join(root, "instructor.html"), "utf8");
for (const reference of ["./instructor.css", "./instructor.js", "./index.html"]) {
  if (!instructorHtml.includes(reference)) throw new Error(`instructor.html does not reference ${reference}`);
}
for (const field of ['name="reviewerName"', 'name="password"', 'id="login-status"']) {
  if (!instructorHtml.includes(field)) throw new Error(`Instructor login is missing ${field}.`);
}
if (!/id="dashboard-view"[^>]*class="[^"]*hidden[^"]*"[^>]*hidden/.test(instructorHtml)) {
  throw new Error("The instructor workspace must be hidden before authentication.");
}
for (const field of [
  "classId", "includeInactiveClasses", "surveyDateFrom", "surveyDateTo", "submissionDateFrom", "submissionDateTo",
  "site", "trail", "transectNumber", "observer", "recordId", "species", "surveyStatus", "syncState",
  "completionState", "gpsState", "photoState", "reviewStatus", "exclusionState", "testState", "trashState", "curationState",
]) {
  if (!instructorHtml.includes(`name="${field}"`)) throw new Error(`Instructor dashboard is missing the ${field} filter.`);
}
for (const action of [
  "refresh", "clear-filters", "select-page", "select-all-filtered", "clear-selection", "download-selected",
  "trash-selected", "restore-selected", "purge-selected", "previous-page", "next-page",
]) {
  if (!instructorHtml.includes(`data-action="${action}"`)) throw new Error(`Instructor dashboard is missing the ${action} action.`);
}
for (const format of ["long-csv", "metadata-csv", "geojson", "raw-json", "photo-manifest", "photo-zip"]) {
  if (!instructorHtml.includes(`value="${format}"`)) throw new Error(`Instructor dashboard is missing the ${format} export.`);
}
if (!/name="password"[\s\S]*name="confirmation"[\s\S]*Permanently purge/.test(instructorHtml)) {
  throw new Error("Permanent purge must require password re-entry, an exact confirmation, and an explicit destructive action.");
}
if (!/name="scope" value="selected"|name="scope"\s+value="selected"/.test(instructorHtml)
    || !/name="scope" value="filtered"|name="scope"\s+value="filtered"/.test(instructorHtml)) {
  throw new Error("Downloads must support selected and filtered record scopes.");
}
if (!/Content-Security-Policy/i.test(instructorHtml)
    || !/name="referrer" content="strict-origin-when-cross-origin"/.test(instructorHtml)) {
  throw new Error("Instructor page is missing its CSP or referrer policy.");
}
if (/unpkg\.com|tile\.openstreetmap\.org|leaflet/i.test(instructorHtml)) {
  throw new Error("The instructor dashboard must not load the retired map or third-party tile resources.");
}
for (const control of ['id="summary-plot"', 'id="summary-limit"', 'id="summary-chart"']) {
  if (!instructorHtml.includes(control)) throw new Error(`Instructor summaries are missing ${control}.`);
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
if (/instructor(?:[-.][a-z0-9-]+)*\.(?:html|css|js)/i.test(coreBlock)) throw new Error("Online-only instructor files must not be in the mandatory app precache.");
for (const token of ["isOnlineGuideRequest", "offlineGuideResponse", "isInstructorRequest", "offlineInstructorResponse", "invasive-transect-app-v2.3.2"]) {
  if (!worker.includes(token)) throw new Error(`Service worker is missing ${token}.`);
}
const instructorWorkerBranch = worker.slice(worker.indexOf("if (isInstructorRequest(url))"), worker.indexOf("if (isOnlineGuideRequest(url))"));
if (!/fetch\(request, \{ cache: "no-store" \}\)/.test(instructorWorkerBranch)
    || !/\.catch\(offlineInstructorResponse\)/.test(instructorWorkerBranch)
    || /caches\.match\("\.\/index\.html"\)/.test(instructorWorkerBranch)) {
  throw new Error("Instructor requests must be network-only and must never fall back to the cached student app.");
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
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.version !== "2.3.2" || !/appVersion:\s*"2\.3\.2"/.test(config)) {
  throw new Error("Package and browser configuration must use app version 2.3.2.");
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

const syntheticBackup = JSON.parse(await fs.readFile(path.join(root, "sample-data/synthetic-phone-import-backup.json"), "utf8"));
if (syntheticBackup.format !== "invasive-plant-transect-backup" || syntheticBackup.formatVersion !== 1) {
  throw new Error("Synthetic phone fixture is not a restorable app backup.");
}
const syntheticErrors = validateTransect(syntheticBackup.transect, { allowedSpeciesCodes: new Set(SPECIES.map((item) => item.code)) });
if (syntheticErrors.length) throw new Error(`Synthetic phone fixture is invalid: ${syntheticErrors.join(" ")}`);
if (syntheticBackup.transect.appVersion !== "2.3.2" || syntheticBackup.transect.protocolVersion !== "2.0.0") {
  throw new Error("Synthetic phone fixture has incorrect app/protocol versioning.");
}
const syntheticGeoJson = JSON.parse(await fs.readFile(path.join(root, "sample-data/synthetic-dashboard-locations.geojson"), "utf8"));
if (syntheticGeoJson.type !== "FeatureCollection"
    || syntheticGeoJson.features?.length !== 3
    || !syntheticGeoJson.features?.some((feature) => feature.geometry?.type === "LineString")
    || syntheticGeoJson.features?.filter((feature) => feature.geometry?.type === "Point").length !== 2
    || syntheticGeoJson.features?.some((feature) => !feature.geometry)
    || syntheticGeoJson.features?.some((feature) => feature.id === "transect_test_edited_no_gps")) {
  throw new Error("Synthetic GeoJSON must contain only the three located fixtures: one line and two points.");
}
const syntheticSql = await fs.readFile(path.join(root, "sample-data/synthetic-dashboard-fixture.sql"), "utf8");
const syntheticCleanup = await fs.readFile(path.join(root, "sample-data/synthetic-dashboard-cleanup.sql"), "utf8");
for (const id of [
  "transect_test_complete_line", "transect_test_incomplete_point", "transect_test_edited_no_gps", "transect_test_trashed_end_point",
]) {
  if (!syntheticSql.includes(id) || !syntheticCleanup.includes(id)) throw new Error(`Synthetic load/cleanup pair is missing ${id}.`);
}
if (/delete\s+from\s+auth\.|delete\s+from\s+storage\.objects/i.test(syntheticCleanup)) {
  throw new Error("Synthetic cleanup must not delete Auth users or Storage rows directly.");
}
if (!/from\s+storage\.objects/i.test(syntheticCleanup)
    || !/photo_test_fixture_marker\.png/.test(syntheticCleanup)
    || !/raise exception 'Cleanup stopped safely/i.test(syntheticCleanup)) {
  throw new Error("Synthetic cleanup must stop before deleting rows while its exact optional Storage object still exists.");
}

const schema = await fs.readFile(path.join(root, "backend/supabase/schema.sql"), "utf8");
for (const requirement of ["enable row level security", "security_invoker = true", "analysis_export_long", "archive_transect_revision", "is_protocol_v2_payload", "protocol_version = '2.0.0'", "jsonb_array_length(v_segment -> 'cells') is distinct from 6", "count(distinct value #>> '{}')", "v_status <> 'detected'"]) {
  if (!schema.toLowerCase().includes(requirement.toLowerCase())) throw new Error(`Schema is missing ${requirement}.`);
}
const migration = await fs.readFile(path.join(root, "backend/supabase/migrations/20260910_protocol_v2.sql"), "utf8");
for (const requirement of ["not valid", "validate constraint", "is_protocol_v2_payload", "protocol_version = '2.0.0'", "band_start_m between 0 and 2"]) {
  if (!migration.toLowerCase().includes(requirement.toLowerCase())) throw new Error(`Migration is missing ${requirement}.`);
}
if (/delete\s+from/i.test(migration)) throw new Error("The migration must not perform a broad data cleanup.");

const dashboardMigration = await fs.readFile(path.join(root, "backend/supabase/migrations/20260910_instructor_dashboard_v2_1.sql"), "utf8");
const normalizedDashboardMigration = dashboardMigration.replace(/\s+/g, " ").toLowerCase();
const normalizedSchema = schema.replace(/\s+/g, " ").toLowerCase();
const dashboardTables = [
  "target_species_catalog", "instructor_record_state", "instructor_curations", "instructor_curation_revisions",
  "instructor_actions", "instructor_login_attempts", "instructor_purge_operations", "instructor_purge_tombstones",
];
for (const table of dashboardTables) {
  for (const [label, sql] of [["dashboard migration", normalizedDashboardMigration], ["fresh schema", normalizedSchema]]) {
    if (!sql.includes(`create table if not exists public.${table}`)) throw new Error(`${label} is missing ${table}.`);
    if (!sql.includes(`alter table public.${table} enable row level security`)) throw new Error(`${label} does not enable RLS on ${table}.`);
  }
}
for (const [label, sql] of [["dashboard migration", normalizedDashboardMigration], ["fresh schema", normalizedSchema]]) {
  for (const requirement of [
    "grant select, insert, update on table public.class_members to service_role",
    "source_submission_count integer not null",
    "student submission changed; reload before curating",
    "new.id := old.id",
    "new.class_id := old.class_id",
    "new.owner_id := old.owner_id",
    "split_part(storage_path, '/', 1) = auth.uid()::text",
    "split_part(storage_path, '/', 2) = transect_id",
    "purge_pending boolean not null default false",
    "status in ('storage_pending', 'completed', 'failed')",
    "instructor_begin_purge",
    "instructor_claim_purge",
    "instructor_release_purge",
    "instructor_fail_purge",
    "instructor_finalize_purge",
    "insert into public.instructor_purge_tombstones",
    "this permanently purged record identifier cannot be reused",
  ]) {
    if (!sql.includes(requirement)) throw new Error(`${label} is missing dashboard guard: ${requirement}.`);
  }
  if (/grant [^;]* on table public\.instructor_[a-z_]+ to (anon|authenticated)/.test(sql)) {
    throw new Error(`${label} grants private instructor tables to a browser role.`);
  }
  if (/delete from storage\.objects/.test(sql)) throw new Error(`${label} deletes Storage rows directly instead of using the Storage API.`);
}
if ((dashboardMigration.match(/\('reno-2026\.1',\s*'[A-Z0-9_-]+'\)/g) || []).length !== 23) {
  throw new Error("Dashboard migration target catalog must contain exactly 23 codes.");
}

const functionConfig = await fs.readFile(path.join(root, "backend/supabase/config.toml"), "utf8");
if (!/\[functions\.enroll-class\][\s\S]*?verify_jwt\s*=\s*false/.test(functionConfig)) {
  throw new Error("Supabase config must explicitly disable gateway JWT verification for the internally authenticated enrollment function.");
}
if (!/\[functions\.instructor-dashboard\][\s\S]*?verify_jwt\s*=\s*false/.test(functionConfig)) {
  throw new Error("Supabase config must explicitly disable gateway JWT verification for the internally authenticated instructor function.");
}
const instructorEdge = await fs.readFile(path.join(root, "backend/supabase/functions/instructor-dashboard/index.ts"), "utf8");
for (const requirement of [
  "ALLOWED_ORIGINS", "SUPABASE_SERVICE_ROLE_KEY", "INSTRUCTOR_SESSION_SECRET", "Cache-Control", "no-store",
  "list-records", "record-detail", "export-records", "save-curation", "save-state", "trash", "restore",
  "purge-preview", "photo-urls", "credentialVersion", "expectedSubmissionCount", "expectedStateVersion",
  "storagePathHash", "instructor_claim_purge", "instructor_release_purge", "instructor_finalize_purge",
]) {
  if (!instructorEdge.includes(requirement)) throw new Error(`Instructor Edge Function is missing ${requirement}.`);
}
const enrollmentEdge = await fs.readFile(path.join(root, "backend/supabase/functions/enroll-class/index.ts"), "utf8");
for (const requirement of [
  "MAX_BODY_BYTES = 4096", "MAX_RESPONSE_BYTES = 4096", "record_enrollment_auth_attempt",
  "enrollment-global-backstop", "Retry-After", "mediaType !== \"application/json\"",
]) {
  if (!enrollmentEdge.includes(requirement)) throw new Error(`Enrollment Edge Function is missing ${requirement}.`);
}
if (/begin_enrollment_attempt|finish_enrollment_attempt|X-Forwarded-For|User-Agent/.test(enrollmentEdge)) {
  throw new Error("Enrollment Edge Function uses a retired limiter or an attacker-controlled address fallback.");
}
if (!normalizedDashboardMigration.includes("grant execute on function public.enrollment_rate_allowed(text) to service_role")
    || !normalizedDashboardMigration.includes("grant execute on function public.record_enrollment_attempt(text, boolean) to service_role")
    || /drop function if exists public\.(?:enrollment_rate_allowed|record_enrollment_attempt)/.test(normalizedDashboardMigration)) {
  throw new Error("Migration must retain service-role-only legacy enrollment RPCs until enroll-class is redeployed.");
}
if (/Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/.test(instructorEdge)
    || /sb_secret_[A-Za-z0-9_-]{20,}|service_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i.test(instructorEdge)) {
  throw new Error("Instructor Edge Function contains wildcard CORS or an embedded privileged secret.");
}
if (/\.limit\((?:5000|10000)\)|\.slice\(0,\s*MAX_(?:RECORD_IDS|SIGNED_PHOTOS)\)/.test(instructorEdge)
    || !/MAX_PAGE_SIZE|MAX_RECORD_IDS|MAX_SIGNED_PHOTOS/.test(instructorEdge)
    || !/413/.test(instructorEdge)) {
  throw new Error("Instructor Edge Function must use explicit paging/caps instead of silently truncating results.");
}
const cleanup = await fs.readFile(path.join(root, "backend/supabase/admin/cleanup-protocol-v1.mjs"), "utf8");
for (const requirement of ["2026-09-09T23:20:10Z", "CONFIRM_DELETE", "server_created_at=lte", "protocol_version=neq.2.0.0", "/rest/v1/transects", "/rest/v1/photos", "/rest/v1/transect_revisions", "/storage/v1/object/transect-photos", "prefixes"]) {
  if (!cleanup.includes(requirement)) throw new Error(`Cleanup script is missing ${requirement}.`);
}
if (/auth\/users|rest\/v1\/classes|rest\/v1\/class_members/.test(cleanup)) throw new Error("Cleanup script targets protected setup data.");

const app = await fs.readFile(path.join(root, "app.js"), "utf8");
const styles = await fs.readFile(path.join(root, "styles.css"), "utf8");
const activeRuntime = [html, app, styles, await fs.readFile(path.join(root, "protocol.js"), "utf8"), await fs.readFile(path.join(root, "backend.js"), "utf8")].join("\n");
if (/guide\.html|data-guide-link|ID guide|identification guide/i.test(`${html}\n${app}`)) {
  throw new Error("The visible student runtime still advertises the retained field guide.");
}
if ((`${html}\n${app}`.match(/href="\.\/instructor\.html"/g) || []).length !== 1) {
  throw new Error("The student runtime must contain exactly one secondary Instructor link.");
}
for (const retired of ["paper_transcription", "Transcribe paper sheet", "3-4 m", "4-5 m", "300 cells"]) {
  if (activeRuntime.includes(retired)) throw new Error(`Active runtime still contains retired assumption: ${retired}`);
}
if (!/body\.modal-open\s*\{[^}]*position:\s*fixed[^}]*overflow:\s*hidden/s.test(styles)
    || !/\.dialog-body\s*\{[^}]*min-height:\s*0[^}]*flex:\s*1 1 auto[^}]*overflow-y:\s*auto/s.test(styles)
    || !app.includes("restorePageAfterDialog")) {
  throw new Error("Cell-dialog scroll/focus restoration contract is incomplete.");
}
if (!app.includes("function classAndBackupMarkup") || !app.includes('id="class-and-backup"')
    || !app.includes('id="class-form"') || !app.includes('data-action="import-backup"')
    || /function renderSettings|state\.view === "settings"|setView\("settings"\)/.test(app)
    || /Start where the trail begins|Thirty true 1-meter segments/.test(app)) {
  throw new Error("Student landing-page consolidation is incomplete.");
}
if (!app.includes('class="species-scientific"') || !app.includes('class="species-meta"')
    || !app.includes('class="species-code"')) {
  throw new Error("Species choices must make scientific names primary and codes/common names secondary.");
}
const sidePanelSource = app.match(/function renderSidePanel[\s\S]*?\n}\n\nfunction renderEntry/)?.[0] || "";
if (!sidePanelSource.includes(">No Target Species</button>") || !sidePanelSource.includes('data-action="mark-side-zero"')
    || /mark-side-ns|cells = NS|cells = 0/.test(sidePanelSource)
    || !app.includes('data-status="${CELL_STATUSES.NOT_SURVEYED}">NS · not surveyed</button>')
    || !app.includes('markBatch(button.dataset.side, CELL_STATUSES.NO_TARGET, { confirm: false })')
    || !/if \(confirm\) \{[\s\S]*?await askConfirm/.test(app)) {
  throw new Error("Side quick actions must apply no-target directly while retaining NS in the individual-cell editor.");
}

const instructorApi = await fs.readFile(path.join(root, "instructor-api.js"), "utf8");
const instructorData = await fs.readFile(path.join(root, "instructor-data.js"), "utf8");
const instructorDownloads = await fs.readFile(path.join(root, "instructor-downloads.js"), "utf8");
const instructorApp = await fs.readFile(path.join(root, "instructor.js"), "utf8");
const dashboardRuntime = [instructorHtml, instructorApi, instructorData, instructorDownloads, instructorApp].join("\n");
if (/service[_-]?role|sb_secret_|database password/i.test(dashboardRuntime)
    || /password\s*[:=]\s*["'][^"']+["']/.test(dashboardRuntime)) {
  throw new Error("The public instructor runtime appears to contain privileged credentials.");
}
if (!instructorApi.includes("sessionStorage") || instructorApi.includes("localStorage")
    || !instructorApi.includes('cache: "no-store"') || !instructorApi.includes('credentials: "omit"')) {
  throw new Error("Instructor sessions must be tab-scoped and dashboard requests must bypass caches/cookies.");
}
if (!/body:\s*JSON\.stringify\(\{ action, \.\.\.payload \}\)/.test(instructorApi)
    || !/if \(error\?\.status === 401\) clearInstructorSession\(\)/.test(instructorApi)) {
  throw new Error("Instructor API request/session-expiry handling is incomplete.");
}
for (const action of ["list-records", "record-detail", "export-records", "save-curation", "save-state", "trash", "restore", "purge-preview", "purge", "photo-urls"]) {
  if (!instructorApi.includes(`"${action}"`)) throw new Error(`Instructor API is missing ${action}.`);
}
if (!instructorDownloads.includes("PHOTO_ZIP_LIMITS") || !instructorDownloads.includes("createStoreZip")
    || !instructorDownloads.includes("blob.size") || !instructorDownloads.includes("credentials: \"omit\"")
    || !/\^\[=\+\\-@\\t\\r\]/.test(instructorDownloads)) {
  throw new Error("Dashboard exports are missing browser ZIP limits, credential-free photo reads, or spreadsheet-formula protection.");
}
if (!/\[Number\(start\.longitude\), Number\(start\.latitude\)\]/.test(instructorDownloads)
    || !/\[Number\(point\.longitude\), Number\(point\.latitude\)\]/.test(instructorDownloads)) {
  throw new Error("GeoJSON coordinates must use longitude-latitude order without invented locations.");
}
if (!instructorData.includes("validateTransect") || !instructorData.includes("ALLOWED_SPECIES_CODES")
    || !instructorData.includes("source_submission_count")) {
  throw new Error("Curated dashboard data is missing protocol/catalog validation or stale-curation protection.");
}
if (!instructorApp.includes("function linePlotMarkup") || !instructorApp.includes("function barPlotMarkup")
    || !instructorApp.includes("View exact values") || /instructor-map\.js|renderInstructorMap|record-map/.test(instructorApp)) {
  throw new Error("Instructor summaries must provide interactive line/bar plots without the retired map runtime.");
}

const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
const firstLines = readme.split(/\r?\n/).slice(0, 6).join("\n");
for (const credit of ["Gavin Sutter", "GPT-6 Astra Pro", "Codex — GPT-5", "not recorded"]) {
  if (!firstLines.includes(credit)) throw new Error(`README opening attribution is missing ${credit}.`);
}

console.log(JSON.stringify({
  requiredFiles: required.length,
  javascriptSyntax: "pass",
  appVersion: packageJson.version,
  protocolVersion: PROTOCOL_VERSION,
  geometry: `${SEGMENT_COUNT} segments / ${TOTAL_CELLS} cells`,
  speciesTargets: SPECIES.length,
  guideImages: imagePaths.size,
  sourceChecksum: "pass",
  sampleCsv: "8 rows / pass",
  offlineBoundary: "pass",
  instructorOnlineBoundary: "pass",
  instructorFrontendContracts: "pass",
  instructorBackendGuards: "pass",
  syntheticFixtures: "pass",
  legacyTransitionScope: "pass",
  llmAttribution: "pass",
}, null, 2));
