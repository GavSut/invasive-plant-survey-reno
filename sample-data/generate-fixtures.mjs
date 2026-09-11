import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CELL_STATUSES,
  createTransect,
  findCell,
  setCellStatus,
  validateTransect,
} from "../protocol.js";
import { SPECIES } from "../species.js";

const OUTPUT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const TARGET_CODES = new Set(SPECIES.map((species) => species.code));

function setDetection(transect, segmentIndex, side, bandStart, species, unknowns = [], note = "") {
  const cell = findCell(transect, segmentIndex, side, bandStart);
  cell.species = [...species];
  cell.unknowns = structuredClone(unknowns);
  cell.note = note;
  cell.status = CELL_STATUSES.DETECTED;
}

function makePhoneImportBackup() {
  const transect = createTransect();
  const createdAt = "2026-08-15T15:00:00.000Z";
  transect.id = "transect_test_phone_import_v210";
  transect.appVersion = "2.3.2";
  transect.metadata = {
    observers: "TEST OBSERVER PHONE",
    surveyDate: "2026-08-15",
    site: "TEST DATA — Synthetic Phone Import",
    trail: "Synthetic Null Island Trail",
    transectNumber: "TEST-PHONE-01",
    startTime: "15:00",
    endTime: "15:22",
    generalNotes: "SYNTHETIC TEST DATA. Not a real survey, person, or location. Safe to delete.",
    startGps: {
      latitude: 0.001,
      longitude: 0.001,
      accuracy: 9,
      timestamp: "2026-08-15T15:00:00.000Z",
    },
    endGps: {
      latitude: 0.0012,
      longitude: 0.0014,
      accuracy: 11,
      timestamp: "2026-08-15T15:22:00.000Z",
    },
  };
  transect.segments.forEach((segment) => {
    segment.cells.forEach((cell) => setCellStatus(cell, CELL_STATUSES.NO_TARGET));
  });
  setDetection(transect, 2, "left", 0, ["SATR12"], [], "Synthetic single-species detection.");
  setDetection(transect, 4, "right", 1, ["BRTE", "POBU"], [], "Synthetic multiple-species cell.");
  setDetection(
    transect,
    9,
    "left",
    2,
    [],
    [{ id: "unknown_test_phone_01", note: "Synthetic unknown observation." }],
    "Unknown intentionally included for testing.",
  );
  setCellStatus(findCell(transect, 20, "right", 0), CELL_STATUSES.NOT_SURVEYED);
  for (let segmentIndex = 24; segmentIndex < 30; segmentIndex += 1) {
    transect.segments[segmentIndex].cells.forEach((cell) => setCellStatus(cell, CELL_STATUSES.INCOMPLETE));
  }
  transect.createdAt = createdAt;
  transect.modifiedAt = "2026-08-15T15:24:00.000Z";
  transect.originalSubmittedAt = null;
  transect.lastSubmittedAt = null;
  transect.syncStatus = "draft";
  transect.revisionNumber = 0;

  const validationErrors = validateTransect(transect, { allowedSpeciesCodes: TARGET_CODES });
  if (validationErrors.length) {
    throw new Error(`Generated phone backup is invalid:\n${validationErrors.join("\n")}`);
  }

  return {
    format: "invasive-plant-transect-backup",
    formatVersion: 1,
    exportedAt: "2026-08-15T15:25:00.000Z",
    transect,
    photos: [],
  };
}

function makeGeoJson() {
  return {
    type: "FeatureCollection",
    name: "SYNTHETIC dashboard map test locations",
    synthetic: true,
    warning: "TEST DATA only. Coordinates are invented near Null Island and do not represent Reno field sites.",
    features: [
      {
        type: "Feature",
        id: "transect_test_complete_line",
        geometry: {
          type: "LineString",
          coordinates: [[0.001, 0.001], [0.0015, 0.0013]],
        },
        properties: {
          record_id: "transect_test_complete_line",
          scenario: "complete_detection_gps_line",
          site: "TEST DATA — Complete Line",
          synthetic: true,
          schema_version: 2,
          protocol_version: "2.0.0",
          species_list_version: "reno-2026.1",
        },
      },
      {
        type: "Feature",
        id: "transect_test_incomplete_point",
        geometry: { type: "Point", coordinates: [0.002, 0.0018] },
        properties: {
          record_id: "transect_test_incomplete_point",
          scenario: "incomplete_partial_upload_start_point_only",
          site: "TEST DATA — Incomplete Point",
          synthetic: true,
          schema_version: 2,
          protocol_version: "2.0.0",
          species_list_version: "reno-2026.1",
        },
      },
      {
        type: "Feature",
        id: "transect_test_trashed_end_point",
        geometry: { type: "Point", coordinates: [0.0028, 0.0025] },
        properties: {
          record_id: "transect_test_trashed_end_point",
          scenario: "trashed_end_point_only",
          site: "TEST DATA — Trashed End Point",
          synthetic: true,
          schema_version: 2,
          protocol_version: "2.0.0",
          species_list_version: "reno-2026.1",
          trash_status: "trashed",
        },
      },
    ],
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function makeSyntheticPhoto() {
  const width = 240;
  const height = 120;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const stripe = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
      pixels[offset] = stripe ? 248 : 236;
      pixels[offset + 1] = stripe ? 190 : 82;
      pixels[offset + 2] = stripe ? 49 : 62;
    }
  }

  const glyphs = {
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    S: ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  };
  const drawPixel = (x, y, color) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 3;
    [pixels[offset], pixels[offset + 1], pixels[offset + 2]] = color;
  };
  const drawText = (text, startX, startY, scale, color) => {
    [...text].forEach((letter, letterIndex) => {
      const glyph = glyphs[letter];
      glyph.forEach((row, rowIndex) => {
        [...row].forEach((bit, columnIndex) => {
          if (bit !== "1") return;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              drawPixel(
                startX + letterIndex * 6 * scale + columnIndex * scale + dx,
                startY + rowIndex * scale + dy,
                color,
              );
            }
          }
        });
      });
    });
  };
  drawText("TEST", 28, 32, 8, [20, 20, 25]);

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.concat([Buffer.from([0]), pixels.subarray(y * width * 3, (y + 1) * width * 3)]));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const text = Buffer.from("Comment\0SYNTHETIC TEST IMAGE - NOT A FIELD PHOTOGRAPH", "latin1");
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("tEXt", text),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

await Promise.all([
  writeFile(
    path.join(OUTPUT_DIRECTORY, "synthetic-phone-import-backup.json"),
    `${JSON.stringify(makePhoneImportBackup(), null, 2)}\n`,
  ),
  writeFile(
    path.join(OUTPUT_DIRECTORY, "synthetic-dashboard-locations.geojson"),
    `${JSON.stringify(makeGeoJson(), null, 2)}\n`,
  ),
  writeFile(path.join(OUTPUT_DIRECTORY, "synthetic-photo.png"), makeSyntheticPhoto()),
]);

console.log("Generated and validated synthetic backup, GeoJSON, and test image.");
