import fs from "node:fs/promises";
import { SPECIES } from "../species.js";

const columns = [
  "species_code", "code_authority", "code_source", "code_verified", "common_name", "scientific_name", "family",
  "instructor_nevada_noxious", "instructor_notes", "aliases",
];

function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const rows = SPECIES.map((species) => ({
  species_code: species.code,
  code_authority: species.codeAuthority,
  code_source: species.codeSource,
  code_verified: species.codeVerified,
  common_name: species.commonName,
  scientific_name: species.scientificName,
  family: species.family,
  instructor_nevada_noxious: species.instructorClassification.nevadaNoxious,
  instructor_notes: species.instructorClassification.notes,
  aliases: species.aliases.join("; "),
}));
const output = [columns.join(","), ...rows.map((row) => columns.map((column) => csv(row[column])).join(","))].join("\r\n") + "\r\n";
await fs.writeFile(new URL("../data/species_code_crosswalk.csv", import.meta.url), output);
console.log(`Wrote ${rows.length} targets to data/species_code_crosswalk.csv`);
