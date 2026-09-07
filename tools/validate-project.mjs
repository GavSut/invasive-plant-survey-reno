import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateSpeciesList } from "../species.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "index.html", "styles.css", "app.js", "protocol.js", "storage.js", "backend.js",
  "config.js", "species.js", "service-worker.js", "manifest.webmanifest", ".nojekyll",
  "README.md", "ARCHITECTURE.md", "INSTRUCTOR_WORKFLOW.md", "DATA_DICTIONARY.md", "TESTING.md",
  "data/sample_long_format.csv", "backend/supabase/schema.sql",
  "backend/supabase/functions/enroll-class/index.ts",
  "field-sheet/Invasive_Plant_Transect_Field_Sheet.docx",
];

for (const relative of required) {
  const stat = await fs.stat(path.join(root, relative)).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Missing required file: ${relative}`);
}

for (const file of ["app.js", "protocol.js", "storage.js", "backend.js", "species.js", "config.js", "service-worker.js"]) {
  execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
}

const html = await fs.readFile(path.join(root, "index.html"), "utf8");
for (const reference of ["./styles.css", "./app.js", "./manifest.webmanifest"]) {
  if (!html.includes(reference)) throw new Error(`index.html does not reference ${reference}`);
}

const worker = await fs.readFile(path.join(root, "service-worker.js"), "utf8");
for (const reference of ["./index.html", "./app.js", "./protocol.js", "./storage.js", "./species.js"]) {
  if (!worker.includes(`"${reference}"`)) throw new Error(`Service worker does not cache ${reference}`);
}
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.webmanifest"), "utf8"));
if (manifest.start_url !== "./" || manifest.scope !== "./") throw new Error("PWA manifest must retain relative GitHub Pages paths.");

const config = await fs.readFile(path.join(root, "config.js"), "utf8");
if (/serviceRoleKey\s*:|sb_secret_[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{50,}/.test(config)) {
  throw new Error("config.js appears to contain a privileged credential.");
}

const schema = await fs.readFile(path.join(root, "backend/supabase/schema.sql"), "utf8");
for (const requirement of ["enable row level security", "analysis_export_long", "archive_transect_revision", "Owners read their transects"]) {
  if (!schema.toLowerCase().includes(requirement.toLowerCase())) throw new Error(`Schema is missing ${requirement}.`);
}

const speciesErrors = validateSpeciesList();
if (speciesErrors.length) throw new Error(speciesErrors.join(" "));

const csv = await fs.readFile(path.join(root, "data/sample_long_format.csv"), "utf8");
const lines = csv.trim().split(/\r?\n/);
if (lines.length !== 9) throw new Error(`Sample CSV should contain a header and 8 rows; found ${lines.length} lines.`);
for (const token of ["surveyed_no_target", "not_surveyed", "incomplete", "paper_transcription", "edited_after_submission", "UNKNOWN"]) {
  if (!csv.includes(token)) throw new Error(`Sample CSV is missing ${token}.`);
}

const docx = await fs.readFile(path.join(root, "field-sheet/Invasive_Plant_Transect_Field_Sheet.docx"));
if (docx.subarray(0, 2).toString("binary") !== "PK") throw new Error("The Word field sheet is not a valid OOXML ZIP container.");

console.log(JSON.stringify({ requiredFiles: required.length, javascriptSyntax: "pass", species: "pass", sampleCsv: "pass", backendGuards: "pass", docxContainer: "pass" }));
