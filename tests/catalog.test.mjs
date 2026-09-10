import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { SPECIES, SPECIES_LIST_VERSION, validateSpeciesList } from "../species.js";

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

test("catalog has the exact 23 unique attributed target codes", () => {
  assert.equal(SPECIES_LIST_VERSION, "reno-2026.1");
  assert.deepEqual(SPECIES.map((item) => item.code), [
    "SATR12", "COMA2", "CANU4", "CESO3", "CEDI3", "CIIN", "CIVU", "CIAR4", "ONAC", "CHTE2", "LELA2", "LEDR",
    "ELAN", "AECY", "BRTE", "POBU", "TACA8", "CETE5", "VETH", "AIAL", "TAMAR2", "ULPU", "TRTE",
  ]);
  assert.deepEqual(validateSpeciesList(), []);
  assert.equal(new Set(SPECIES.map((item) => item.code)).size, 23);
  assert.ok(SPECIES.every((item) => item.codeAuthority === "USDA NRCS PLANTS" && item.codeSource.endsWith(`symbol=${item.code}`)));
  assert.ok(!SPECIES.some((item) => item.code === "UNKNOWN"));
});

test("instructor classifications and notes match the unchanged source row-for-row", async () => {
  const bytes = await fs.readFile(new URL("../data/source/PlantList_InvasivePlants_ClassProject_2026-source.csv", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "f1432e35ab48f58a700b5f6e5c275170dcbc02e5089054388ec11e33083d8e21");
  const [headers, ...rows] = parseCsv(bytes.toString("utf8"));
  const yIndex = headers.findIndex((value) => value.trim() === "Nevada Noxious Weed?");
  const notesIndex = headers.findIndex((value) => value.trim() === "Notes");
  assert.equal(rows.length, 23);
  rows.forEach((row, index) => {
    assert.equal(SPECIES[index].instructorClassification.nevadaNoxious, row[yIndex]);
    assert.equal(SPECIES[index].instructorClassification.notes, row[notesIndex]);
  });
});

test("verified spelling fixes and genus-level Tamarix category are retained", () => {
  const byCode = Object.fromEntries(SPECIES.map((item) => [item.code, item]));
  assert.equal(byCode.CHTE2.scientificName, "Chorispora tenella");
  assert.equal(byCode.LELA2.commonName, "Perennial pepperweed");
  assert.equal(byCode.VETH.scientificName, "Verbascum thapsus");
  assert.equal(byCode.ULPU.family, "Ulmaceae");
  assert.equal(byCode.TAMAR2.scientificName, "Tamarix spp.");
  assert.ok(byCode.LEDR.aliases.includes("Cardaria draba"));
});

test("every guide card has compact identification content and complete image provenance", async () => {
  let imageCount = 0;
  for (const species of SPECIES) {
    assert.ok(species.guide.traits.length >= 3 && species.guide.traits.length <= 5);
    for (const field of ["lookalikes", "seasonal", "safety", "uncertainty"]) assert.ok(species.guide[field]);
    assert.ok(species.guide.sources.length >= 1);
    for (const image of species.guide.images) {
      imageCount += 1;
      for (const field of ["src", "alt", "creator", "provider", "attribution", "sourceTaxon", "sourceRecord", "sourceImage", "rights", "accessed", "modifications"]) assert.ok(image[field], `${species.code}/${field}`);
      assert.match(image.rights, /Copyright=false/);
      const stat = await fs.stat(new URL(`../${image.src.slice(2)}`, import.meta.url));
      assert.ok(stat.size > 1000);
    }
  }
  assert.equal(imageCount, 38);
  assert.deepEqual(SPECIES.filter((item) => item.guide.images.length === 0).map((item) => item.code), ["CEDI3"]);
});
