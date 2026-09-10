import { createClient } from "npm:@supabase/supabase-js@2.57.4";

/*
POST /functions/v1/instructor-dashboard with { action, ... }.

Public action:
  login

Bearer-token actions:
  bootstrap, list-records, record-detail, export-records,
  save-curation, clear-curation, revert-curation, save-state,
  trash, restore, purge-preview, purge, photo-urls

The function is deployed with verify_jwt=false because its short-lived bearer
token is signed and verified here; no service credential is ever returned.
*/

const JSON_HEADERS = Object.freeze({
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
});
const SESSION_SECONDS = 30 * 60;
const PURGE_CHALLENGE_SECONDS = 5 * 60;
const MAX_BODY_BYTES = 2_000_000;
const MAX_RESPONSE_BYTES = 5_000_000;
const MAX_PAGE_SIZE = 200;
const MAX_CLASSES = 500;
const MAX_AGGREGATE_RECORDS = 10_000;
const MAX_MAP_RECORDS = 2_000;
const MAX_EXPORT_RECORDS = 200;
const MAX_EXPORT_PHOTO_ROWS = 1_000;
const MAX_EXPORT_AUDIT_ROWS = 1_000;
const MAX_EXPORT_REVISION_ROWS = 2_000;
const MAX_EXPORT_PAYLOAD_BYTES = 4_000_000;
const MAX_EXPORT_RESPONSE_BYTES = 5_000_000;
const MAX_BULK_MUTATIONS = 100;
const MAX_PURGE_RECORDS = 20;
const MAX_PHOTOS_PER_REQUEST = 100;
const PHOTO_METADATA_PAGE_SIZE = 500;
const STORAGE_PAGE_SIZE = 100;
const STORAGE_DELETE_BATCH_SIZE = 100;
const MAX_STORAGE_DELETE_BATCHES_PER_REQUEST = 100;
const DETAIL_COLLECTION_LIMIT = 500;
const PHOTO_URL_SECONDS = 300;
const PHOTO_BUCKET = "transect-photos";
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,159}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_CODES = new Set([
  "SATR12", "COMA2", "CANU4", "CESO3", "CEDI3", "CIIN", "CIVU", "CIAR4",
  "ONAC", "CHTE2", "LELA2", "LEDR", "ELAN", "AECY", "BRTE", "POBU",
  "TACA8", "CETE5", "VETH", "AIAL", "TAMAR2", "ULPU", "TRTE",
]);

type JsonRecord = Record<string, any>;
type AdminClient = ReturnType<typeof createClient>;

class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function response(status: number, body: JsonRecord, origin: string | null, allowed: boolean) {
  let serialized = JSON.stringify(body);
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    status = 413;
    serialized = JSON.stringify({
      error: "The instructor response exceeds the 5 MB limit. Narrow the selection and try again.",
      code: "response_too_large",
      details: { maximumBytes: MAX_RESPONSE_BYTES },
    });
  }
  return new Response(serialized, {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(allowed && origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Expose-Headers": "Retry-After",
        Vary: "Origin",
      } : {}),
    },
  });
}

function errorResponse(error: unknown, origin: string | null, allowed: boolean) {
  if (error instanceof ApiError) {
    const result = response(error.status, {
      error: error.message,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    }, origin, allowed);
    if (error.status === 429 && typeof (error.details as JsonRecord)?.retryAfterSeconds === "number") {
      result.headers.set("Retry-After", String((error.details as JsonRecord).retryAfterSeconds));
    }
    return result;
  }
  console.error("Instructor dashboard request failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return response(500, {
    error: "The instructor request could not be completed.",
    code: "internal_error",
  }, origin, allowed);
}

async function readJsonBody(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "request_too_large", "Request exceeds the 2 MB limit.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_json", "Request body must be JSON.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* the 413 result remains authoritative */ }
      throw new ApiError(413, "request_too_large", "Request exceeds the 2 MB limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed as JsonRecord;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be a JSON object.");
  }
}

function requiredString(value: unknown, name: string, minimum: number, maximum: number, trim = true) {
  if (typeof value !== "string") throw new ApiError(400, "invalid_input", `${name} is required.`);
  const result = trim ? value.trim() : value;
  if (result.length < minimum || result.length > maximum || /[\u0000]/.test(result)) {
    throw new ApiError(400, "invalid_input", `${name} must contain ${minimum}-${maximum} characters.`);
  }
  return result;
}

function optionalString(value: unknown, name: string, maximum: number) {
  if (value === undefined || value === null || value === "") return "";
  return requiredString(value, name, 0, maximum);
}

function requiredInteger(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ApiError(400, "invalid_input", `${name} is invalid.`);
  }
  return Number(value);
}

function requestId(value: unknown) {
  if (value === undefined || value === null || value === "") return crypto.randomUUID();
  const id = requiredString(value, "Request ID", 36, 36);
  if (!UUID_PATTERN.test(id)) throw new ApiError(400, "invalid_input", "Request ID must be a UUID.");
  return id;
}

function mutationRequestId(value: unknown) {
  if (value === undefined || value === null || value === "") {
    throw new ApiError(400, "missing_request_id", "A stable request ID is required for instructor mutations.");
  }
  return requestId(value);
}

function recordId(value: unknown) {
  const id = requiredString(value, "Record ID", 8, 160);
  if (!RECORD_ID_PATTERN.test(id)) throw new ApiError(400, "invalid_input", "Record ID is not canonical.");
  return id;
}

function exactIds(value: unknown, name: string, maximum: number, kind: "record" | "photo" = "record") {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "invalid_input", `Choose at least one ${name}.`);
  }
  if (value.length > maximum) {
    throw new ApiError(413, "too_many_items", `A single request supports at most ${maximum} ${name}.`);
  }
  const parsed = value.map((item, index) => {
    if (kind === "record") return recordId(item);
    return requiredString(item, `Photo ID ${index + 1}`, 1, 160);
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new ApiError(400, "duplicate_ids", `${name} must not contain duplicates.`);
  }
  return parsed;
}

function reviewerName(value: unknown) {
  const reviewer = requiredString(value, "Reviewer name", 2, 80);
  if (/[\u0001-\u001f\u007f]/.test(reviewer)) {
    throw new ApiError(400, "invalid_input", "Reviewer name contains unsupported control characters.");
  }
  return reviewer;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function hmacHex(value: string, secret: string) {
  return [...await hmac(value, secret)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalIp(value: string | null) {
  let candidate = String(value || "").split(",", 1)[0].trim().toLowerCase();
  if (!candidate || candidate.length > 128) return "";
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/);
  if (ipv4WithPort) {
    const octets = ipv4WithPort[1].split(".").map(Number);
    return octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
      ? octets.join(".") : "";
  }
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  }
  if (!candidate.includes(":") || !/^[0-9a-f:.]+$/.test(candidate)) return "";
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    const normalized = hostname.startsWith("[")
      ? hostname.slice(1, -1).toLowerCase() : hostname.toLowerCase();
    const mapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
    }
    return normalized;
  } catch {
    return "";
  }
}

function gatewayAddress(request: Request) {
  for (const header of ["CF-Connecting-IP", "X-Real-IP"]) {
    const address = canonicalIp(request.headers.get(header));
    if (address) return address;
  }
  return "gateway-address-unavailable";
}

async function credentialVersion(passwordMaterial: string, sessionSecret: string) {
  return bytesToBase64Url(await hmac(`credential-version:${passwordMaterial}`, sessionSecret));
}

async function passwordMatches(supplied: unknown, configured: { raw: string; hash: string }, compareSecret: string) {
  if (typeof supplied !== "string" || supplied.length > 256) return false;
  if (configured.raw) {
    const [left, right] = await Promise.all([
      hmac(`password:${supplied}`, compareSecret),
      hmac(`password:${configured.raw}`, compareSecret),
    ]);
    return constantTimeEqual(left, right);
  }
  const suppliedHash = new TextEncoder().encode(await sha256Hex(supplied));
  return constantTimeEqual(suppliedHash, new TextEncoder().encode(configured.hash));
}

async function issueSession(reviewer: string, passwordMaterial: string, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const payloadObject = {
    version: 2,
    issuer: "invasive-plant-survey-reno",
    audience: "instructor-dashboard",
    reviewer,
    issuedAt: now,
    expiresAt: now + SESSION_SECONDS,
    credentialVersion: await credentialVersion(passwordMaterial, secret),
    nonce: crypto.randomUUID(),
  };
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payloadObject)));
  const signature = bytesToBase64Url(await hmac(`session.${payload}`, secret));
  return {
    token: `${payload}.${signature}`,
    reviewerName: reviewer,
    expiresAt: (now + SESSION_SECONDS) * 1000,
  };
}

async function verifySession(request: Request, passwordMaterial: string, secret: string) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const [payloadPart, signaturePart] = parts;
    const expected = await hmac(`session.${payloadPart}`, secret);
    if (!constantTimeEqual(base64UrlToBytes(signaturePart), expected)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
    const now = Math.floor(Date.now() / 1000);
    const reviewer = reviewerName(payload?.reviewer);
    const currentCredentialVersion = await credentialVersion(passwordMaterial, secret);
    if (payload?.version !== 2
      || payload?.issuer !== "invasive-plant-survey-reno"
      || payload?.audience !== "instructor-dashboard"
      || !Number.isInteger(payload?.issuedAt)
      || !Number.isInteger(payload?.expiresAt)
      || payload.issuedAt > now + 30
      || payload.expiresAt <= now
      || payload.expiresAt - payload.issuedAt !== SESSION_SECONDS
      || payload?.credentialVersion !== currentCredentialVersion
      || !UUID_PATTERN.test(String(payload?.nonce || ""))) return null;
    return { reviewer, expiresAt: payload.expiresAt * 1000, nonce: payload.nonce };
  } catch {
    return null;
  }
}

async function issuePurgeChallenge(records: JsonRecord[], reviewer: string, passwordMaterial: string, secret: string) {
  const now = Math.floor(Date.now() / 1000);
  const payloadObject = {
    version: 1,
    purpose: "permanent-purge",
    reviewer,
    issuedAt: now,
    expiresAt: now + PURGE_CHALLENGE_SECONDS,
    credentialVersion: await credentialVersion(passwordMaterial, secret),
    nonce: crypto.randomUUID(),
    records: records.map((record) => ({
      recordId: record.recordId,
      operationId: record.operationId,
      submissionCount: record.submissionCount,
      stateVersion: record.stateVersion,
      storagePathHash: record.storagePathHash,
      displayHash: record.displayHash,
      photoMetadataCount: record.photoMetadataCount,
      storageObjectCount: record.storageObjectCount,
      recordSnapshot: record.recordSnapshot,
      resuming: Boolean(record.resuming),
    })).sort((a, b) => a.recordId.localeCompare(b.recordId)),
  };
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payloadObject)));
  const signature = bytesToBase64Url(await hmac(`purge.${payload}`, secret));
  return { challenge: `${payload}.${signature}`, expiresAt: payloadObject.expiresAt * 1000 };
}

async function verifyPurgeChallenge(value: unknown, reviewer: string, passwordMaterial: string, secret: string) {
  if (typeof value !== "string" || value.length > 100_000) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  try {
    const [payloadPart, signaturePart] = parts;
    const expected = await hmac(`purge.${payloadPart}`, secret);
    if (!constantTimeEqual(base64UrlToBytes(signaturePart), expected)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
    const now = Math.floor(Date.now() / 1000);
    if (payload?.version !== 1 || payload?.purpose !== "permanent-purge"
      || payload?.reviewer !== reviewer
      || !Number.isInteger(payload?.issuedAt) || !Number.isInteger(payload?.expiresAt)
      || payload.issuedAt > now + 30 || payload.expiresAt <= now
      || payload.expiresAt - payload.issuedAt !== PURGE_CHALLENGE_SECONDS
      || payload?.credentialVersion !== await credentialVersion(passwordMaterial, secret)
      || !UUID_PATTERN.test(String(payload?.nonce || ""))
      || !Array.isArray(payload?.records)
      || payload.records.length < 1 || payload.records.length > MAX_PURGE_RECORDS) return null;
    const recordIds = payload.records.map((item: JsonRecord) => item?.recordId);
    if (new Set(recordIds).size !== recordIds.length) return null;
    for (const item of payload.records) {
      if (!RECORD_ID_PATTERN.test(String(item?.recordId || ""))
        || !UUID_PATTERN.test(String(item?.operationId || ""))
        || !Number.isInteger(item?.submissionCount) || item.submissionCount < 1
        || !Number.isInteger(item?.stateVersion) || item.stateVersion < 1
        || !Number.isSafeInteger(item?.photoMetadataCount) || item.photoMetadataCount < 0
        || !Number.isSafeInteger(item?.storageObjectCount) || item.storageObjectCount < 0
        || typeof item?.resuming !== "boolean"
        || !validPurgeSnapshot(item?.recordSnapshot, item)
        || !/^[a-f0-9]{64}$/.test(String(item?.displayHash || ""))
        || !/^[a-f0-9]{64}$/.test(String(item?.storagePathHash || ""))) return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function validPurgeSnapshot(snapshot: unknown, item: JsonRecord) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const value = snapshot as JsonRecord;
  const allowed = new Set([
    "recordId", "classId", "protocolVersion", "speciesListVersion",
    "submissionCount", "photoMetadataCount", "storageObjectCount",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)) || Object.keys(value).length !== allowed.size) return false;
  return value.recordId === item.recordId
    && typeof value.classId === "string" && UUID_PATTERN.test(value.classId)
    && typeof value.protocolVersion === "string" && value.protocolVersion.length <= 80
    && typeof value.speciesListVersion === "string" && value.speciesListVersion.length <= 120
    && value.submissionCount === item.submissionCount
    && value.photoMetadataCount === item.photoMetadataCount
    && value.storageObjectCount === item.storageObjectCount;
}

function validGpsPoint(value: unknown) {
  if (value === undefined || value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as JsonRecord;
  if (typeof point.latitude !== "number" || !Number.isFinite(point.latitude)
    || point.latitude < -90 || point.latitude > 90
    || typeof point.longitude !== "number" || !Number.isFinite(point.longitude)
    || point.longitude < -180 || point.longitude > 180) return false;
  return point.accuracy === undefined || point.accuracy === null
    || (typeof point.accuracy === "number" && Number.isFinite(point.accuracy) && point.accuracy >= 0);
}

function purgeDisplay(payload: JsonRecord) {
  const metadata = payload?.metadata || {};
  return {
    site: String(metadata.site || ""),
    trail: String(metadata.trail || ""),
    transectNumber: String(metadata.transectNumber || ""),
    surveyDate: String(metadata.surveyDate || ""),
  };
}

async function purgeDisplayHash(payload: JsonRecord) {
  return sha256Hex(JSON.stringify(purgeDisplay(payload)));
}

function isProtocolV2Payload(payload: any) {
  if (!payload || payload.protocolVersion !== "2.0.0"
    || payload.schemaVersion !== 2 || payload.entryMethod !== "digital_field"
    || payload.speciesListVersion !== "reno-2026.1") return false;
  if (!payload.metadata || typeof payload.metadata !== "object" || Array.isArray(payload.metadata)
    || !validGpsPoint(payload.metadata.startGps)
    || !validGpsPoint(payload.metadata.endGps)) return false;
  if (!Array.isArray(payload.segments) || payload.segments.length !== 30) return false;
  return payload.segments.every((segment: any, segmentIndex: number) => {
    if (segment?.index !== segmentIndex || segment?.startM !== segmentIndex
      || segment?.endM !== segmentIndex + 1
      || segment?.label !== `${segmentIndex}-${segmentIndex + 1} m`
      || !Array.isArray(segment.cells) || segment.cells.length !== 6) return false;
    const keys = new Set<string>();
    for (const cell of segment.cells) {
      const side = cell?.side;
      const band = cell?.bandStart;
      if (!(["left", "right"] as unknown[]).includes(side)
        || !([0, 1, 2] as unknown[]).includes(band)
        || cell?.bandEnd !== band + 1
        || cell?.id !== `s${segmentIndex}_${side}_${band}`) return false;
      const key = `${side}:${band}`;
      if (keys.has(key)) return false;
      keys.add(key);
      if (!(["detected", "surveyed_no_target", "not_surveyed", "incomplete"] as unknown[]).includes(cell?.status)
        || !Array.isArray(cell?.species) || !Array.isArray(cell?.unknowns)
        || new Set(cell.species).size !== cell.species.length
        || cell.species.some((code: unknown) => typeof code !== "string" || !TARGET_CODES.has(code))) return false;
      const unknownIds = cell.unknowns.map((item: any) => item?.id);
      if (unknownIds.some((id: unknown) => typeof id !== "string" || !id.trim() || id.length > 160)
        || new Set(unknownIds).size !== unknownIds.length) return false;
      const observationCount = cell.species.length + cell.unknowns.length;
      if (cell.status === "detected" ? observationCount === 0 : observationCount !== 0) return false;
    }
    return keys.size === 6;
  });
}

function dbError(error: any, fallback: string): ApiError {
  const code = String(error?.code || "database_error");
  const message = typeof error?.message === "string" && error.message.length <= 500
    ? error.message
    : fallback;
  if (code === "40001" || code === "23505" || code === "55000" || code === "55P03") {
    return new ApiError(409, "conflict", message);
  }
  if (code === "P0002" || code === "PGRST116") return new ApiError(404, "not_found", message);
  if (code === "22023" || code === "23514" || code === "22P02") return new ApiError(400, "invalid_input", message);
  return new ApiError(500, "database_error", fallback, { code });
}

async function rpc(admin: AdminClient, name: string, args: JsonRecord, fallback: string) {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw dbError(error, fallback);
  return data;
}

// PostgREST installations commonly cap a single response at 1,000 rows. Count
// first, reject a documented over-limit result, then fetch deterministic pages
// and verify the row count so an export can never be silently truncated.
async function fetchSelectedRows(admin: AdminClient, options: {
  table: string;
  columns: string;
  filterColumn: string;
  ids: string[];
  orderColumn: string;
  maximum: number;
  label: string;
}) {
  const { count, error: countError } = await admin.from(options.table)
    .select(options.orderColumn, { count: "exact", head: true })
    .in(options.filterColumn, options.ids);
  if (countError) throw dbError(countError, `${options.label} could not be counted.`);
  const expected = Number(count || 0);
  if (expected > options.maximum) {
    throw new ApiError(413, "export_related_limit",
      `Selected records contain more than ${options.maximum} ${options.label}; export a smaller batch.`,
      { collection: options.table, maximum: options.maximum, count: expected });
  }
  const rows: JsonRecord[] = [];
  for (let offset = 0; offset < expected; offset += 500) {
    const { data, error } = await admin.from(options.table).select(options.columns)
      .in(options.filterColumn, options.ids)
      .order(options.orderColumn, { ascending: true })
      .range(offset, Math.min(offset + 499, expected - 1));
    if (error) throw dbError(error, `${options.label} could not be loaded.`);
    rows.push(...(data || []));
  }
  if (rows.length !== expected) {
    throw new ApiError(409, "records_changed",
      `${options.label} changed while the export was being assembled. Retry the export.`);
  }
  return rows;
}

async function audit(admin: AdminClient, action: string, reviewer: string, options: {
  recordId?: string;
  reason?: string;
  detail?: JsonRecord;
  requestId?: string;
} = {}) {
  return rpc(admin, "instructor_record_action", {
    p_request_id: options.requestId || crypto.randomUUID(),
    p_action: action,
    p_reviewer_name: reviewer,
    p_record_id: options.recordId || "",
    p_reason: options.reason || "",
    p_detail: options.detail || {},
  }, "Instructor action could not be audited.");
}

async function authorizePasswordAttempt(admin: AdminClient, supplied: unknown,
  configured: { raw: string; hash: string }, compareSecret: string,
  rateSecret: string, request: Request, purpose: "login" | "purge") {
  const subjectHash = await hmacHex(
    `instructor-client:${purpose}:${gatewayAddress(request)}`, rateSecret,
  );
  const globalBucketHash = await hmacHex(`instructor-global:${purpose}`, rateSecret);
  const succeeded = await passwordMatches(supplied, configured, compareSecret);
  const status = await rpc(admin, "instructor_record_auth_attempt", {
    p_subject_hash: subjectHash,
    p_global_bucket_hash: globalBucketHash,
    p_purpose: purpose,
    p_succeeded: succeeded,
  }, "Could not verify authentication limits.");
  if (!status?.allowed) {
    throw new ApiError(429, "rate_limited", "Too many unsuccessful attempts. Try again later.", {
      retryAfterSeconds: status?.retryAfterSeconds || 900,
    });
  }
  return succeeded;
}

function validateFilterObject(value: unknown) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_filters", "Filters must be an object.");
  }
  const filters = value as JsonRecord;
  const allowed = new Set([
    "classId", "classActive", "classTerm", "surveyDateFrom", "surveyDateTo",
    "submittedDateFrom", "submittedDateTo", "submittedFrom", "submittedTo",
    "site", "trail", "transectNumber",
    "observers", "recordId", "search", "speciesCode", "surveyStatus",
    "syncState", "completion", "gps", "photos", "reviewStatus", "speciesCodes",
    "excluded", "test", "trash", "hasCuration", "curationStale",
  ]);
  const unknown = Object.keys(filters).filter((key) => !allowed.has(key));
  if (unknown.length) throw new ApiError(400, "invalid_filters", "Unknown filter fields were supplied.", { fields: unknown });
  return filters;
}

function filterString(filters: JsonRecord, key: string, maximum = 300) {
  if (filters[key] === undefined || filters[key] === null || filters[key] === "") return "";
  return requiredString(filters[key], `${key} filter`, 1, maximum);
}

function filterCalendarDate(filters: JsonRecord, key: string) {
  const value = filterString(filters, key, 10);
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, "invalid_filters", `${key} must be a calendar date.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, "invalid_filters", `${key} must be a real calendar date.`);
  }
  return value;
}

function applyFilters(query: any, filters: JsonRecord) {
  const classId = filterString(filters, "classId", 36);
  if (classId) {
    if (!UUID_PATTERN.test(classId)) throw new ApiError(400, "invalid_filters", "Class ID is invalid.");
    query = query.eq("class_id", classId);
  }
  if (filters.classActive !== undefined) {
    if (typeof filters.classActive !== "boolean") throw new ApiError(400, "invalid_filters", "classActive must be true or false.");
    query = query.eq("class_active", filters.classActive);
  }
  const classTerm = filterString(filters, "classTerm", 160);
  if (classTerm) query = query.eq("class_term", classTerm);
  for (const [inputKey, column, operator] of [
    ["surveyDateFrom", "survey_date", "gte"],
    ["surveyDateTo", "survey_date", "lte"],
    ["submittedDateFrom", "submission_date_local", "gte"],
    ["submittedDateTo", "submission_date_local", "lte"],
  ] as Array<[string, string, "gte" | "lte"]>) {
    const value = filterCalendarDate(filters, inputKey);
    if (value) query = query[operator](column, value);
  }
  // Preserve compatibility with v2.1 prerelease clients. Date-only legacy
  // values use the Reno-local calendar column; full instants retain their
  // original UTC-timestamp behavior.
  for (const [inputKey, operator] of [
    ["submittedFrom", "gte"], ["submittedTo", "lte"],
  ] as Array<[string, "gte" | "lte"]>) {
    const value = filterString(filters, inputKey, 40);
    if (!value) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      query = query[operator]("submission_date_local", filterCalendarDate(filters, inputKey));
    } else {
      if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new ApiError(400, "invalid_filters", `${inputKey} is invalid.`);
      }
      query = query[operator]("original_submitted_at", value);
    }
  }
  for (const [inputKey, column, maximum] of [
    ["site", "site", 300], ["trail", "trail", 300],
    ["transectNumber", "transect_number", 120], ["observers", "observers", 500],
    ["recordId", "record_id", 160], ["search", "search_text", 500],
  ] as Array<[string, string, number]>) {
    const value = filterString(filters, inputKey, maximum);
    if (value) query = query.ilike(column,
      `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  }
  const speciesCode = filterString(filters, "speciesCode", 10).toUpperCase();
  if (speciesCode) {
    if (!TARGET_CODES.has(speciesCode)) throw new ApiError(400, "invalid_filters", "Species code is not in the target catalog.");
    query = query.contains("species_codes", [speciesCode]);
  }
  if (filters.speciesCodes !== undefined) {
    if (!Array.isArray(filters.speciesCodes) || filters.speciesCodes.length < 1 || filters.speciesCodes.length > 23) {
      throw new ApiError(400, "invalid_filters", "speciesCodes must contain 1-23 target codes.");
    }
    const codes = filters.speciesCodes.map((value: unknown) => requiredString(value, "Species code", 2, 10).toUpperCase());
    if (new Set(codes).size !== codes.length || codes.some((code: string) => !TARGET_CODES.has(code))) {
      throw new ApiError(400, "invalid_filters", "speciesCodes contains duplicates or an unknown target code.");
    }
    query = query.overlaps("species_codes", codes);
  }
  const surveyStatus = filterString(filters, "surveyStatus", 30);
  const statusColumns = new Map<string, string>([
    ["detected", "detected_cells"], ["surveyed_no_target", "surveyed_no_target_cells"],
    ["not_surveyed", "not_surveyed_cells"], ["incomplete", "incomplete_cells"],
  ]);
  if (surveyStatus) {
    const statusColumn = statusColumns.get(surveyStatus);
    if (!statusColumn) throw new ApiError(400, "invalid_filters", "Survey status is invalid.");
    query = query.gt(statusColumn, 0);
  }
  const enums: Array<[string, string, string[]]> = [
    ["syncState", "sync_state", ["submitted", "upload_partially_complete"]],
    ["reviewStatus", "review_status", ["unreviewed", "reviewed", "needs_follow_up", "questionable", "accepted"]],
  ];
  for (const [key, column, values] of enums) {
    const value = filterString(filters, key, 40);
    if (value) {
      if (!values.includes(value)) throw new ApiError(400, "invalid_filters", `${key} is invalid.`);
      query = query.eq(column, value);
    }
  }
  const completion = filterString(filters, "completion", 20);
  if (completion) {
    if (completion === "complete") query = query.eq("incomplete_cells", 0);
    else if (completion === "incomplete") query = query.gt("incomplete_cells", 0);
    else throw new ApiError(400, "invalid_filters", "Completion filter is invalid.");
  }
  const binaryFilters: Array<[string, string]> = [
    ["gps", "has_gps"], ["hasCuration", "has_curation"],
    ["curationStale", "curation_stale"], ["excluded", "excluded_from_analysis"],
  ];
  for (const [key, column] of binaryFilters) {
    if (filters[key] !== undefined) {
      if (typeof filters[key] !== "boolean") throw new ApiError(400, "invalid_filters", `${key} must be true or false.`);
      query = query.eq(column, filters[key]);
    }
  }
  const photos = filterString(filters, "photos", 20);
  if (photos) {
    if (photos === "present") query = query.gt("photo_count", 0);
    else if (photos === "missing") query = query.eq("photo_count", 0);
    else throw new ApiError(400, "invalid_filters", "Photo filter is invalid.");
  }
  const test = filterString(filters, "test", 20);
  if (test) {
    if (test === "test") query = query.eq("effective_is_test", true);
    else if (test === "real") query = query.eq("effective_is_test", false);
    else if (test !== "all") throw new ApiError(400, "invalid_filters", "Test-data filter is invalid.");
  }
  const trash = filterString(filters, "trash", 20) || "active";
  if (trash === "active") query = query.is("trashed_at", null);
  else if (trash === "trashed") query = query.not("trashed_at", "is", null);
  else if (trash !== "all") throw new ApiError(400, "invalid_filters", "Trash filter is invalid.");
  return query;
}

function parseSort(value: unknown) {
  const sort = value === undefined || value === null ? {} : value;
  if (typeof sort !== "object" || Array.isArray(sort)) throw new ApiError(400, "invalid_sort", "Sort must be an object.");
  const field = (sort as JsonRecord).field || "serverUpdatedAt";
  const direction = (sort as JsonRecord).direction || "desc";
  const fields = new Map<string, string>([
    ["serverUpdatedAt", "server_updated_at"], ["surveyDate", "survey_date"],
    ["originalSubmittedAt", "original_submitted_at"], ["site", "site"], ["trail", "trail"],
    ["transectNumber", "transect_number"], ["observers", "observers"],
    ["completion", "completed_cells"], ["detected", "detected_cells"],
    ["speciesCount", "species_count"], ["photoCount", "photo_count"],
    ["reviewStatus", "review_status"], ["recordId", "record_id"],
  ]);
  const column = typeof field === "string" ? fields.get(field) : undefined;
  if (!column || !["asc", "desc"].includes(direction)) {
    throw new ApiError(400, "invalid_sort", "Sort field or direction is invalid.");
  }
  return { column, ascending: direction === "asc", field, direction };
}

function summaryRow(row: JsonRecord) {
  const effectiveMetadata = {
    site: row.site || "", trail: row.trail || "",
    transectNumber: row.transect_number || "", observers: row.observers || "",
    surveyDate: row.survey_date || "", startGps: row.start_gps,
    endGps: row.end_gps,
  };
  const effectiveSummary = {
    statusCounts: {
      detected: row.detected_cells,
      surveyed_no_target: row.surveyed_no_target_cells,
      not_surveyed: row.not_surveyed_cells,
      incomplete: row.incomplete_cells,
    },
    completedCells: row.completed_cells, detectedCells: row.detected_cells,
    speciesCodes: row.species_codes || [], speciesCount: row.species_count,
    unknownCount: row.unknown_count,
  };
  const state = {
    transect_id: row.record_id, review_status: row.review_status,
    excluded_from_analysis: row.excluded_from_analysis,
    test_data_status: row.test_data_status, flags: row.flags || [],
    instructor_note: row.instructor_note || "", purge_pending: row.purge_pending,
    version: row.state_version, trashed_at: row.trashed_at,
    trashed_by: row.trashed_by, trash_reason: row.trash_reason,
    updated_at: row.state_updated_at,
  };
  return {
    recordId: row.record_id,
    classId: row.class_id,
    className: row.class_name,
    classTerm: row.class_term,
    classActive: row.class_active,
    protocolVersion: row.protocol_version,
    speciesListVersion: row.species_list_version,
    originalSubmittedAt: row.original_submitted_at,
    submissionDateLocal: row.submission_date_local,
    clientModifiedAt: row.client_modified_at,
    serverCreatedAt: row.server_created_at,
    serverUpdatedAt: row.server_updated_at,
    syncState: row.sync_state,
    submissionCount: row.submission_count,
    site: row.site || "",
    trail: row.trail || "",
    transectNumber: row.transect_number || "",
    observers: row.observers || "",
    surveyDate: row.survey_date || "",
    startGps: row.start_gps,
    endGps: row.end_gps,
    hasGps: row.has_gps,
    completedCells: row.completed_cells,
    detectedCells: row.detected_cells,
    surveyedNoTargetCells: row.surveyed_no_target_cells,
    notSurveyedCells: row.not_surveyed_cells,
    incompleteCells: row.incomplete_cells,
    speciesCodes: row.species_codes || [],
    speciesCount: row.species_count,
    unknownCount: row.unknown_count,
    photoCount: row.photo_count,
    photoBytes: Number(row.photo_bytes || 0),
    hasCuration: row.has_curation,
    curationVersion: row.curation_version,
    curationStale: row.curation_stale,
    reviewStatus: row.review_status,
    excludedFromAnalysis: row.excluded_from_analysis,
    testDataStatus: row.test_data_status,
    testSuggested: row.test_suggested,
    effectiveIsTest: row.effective_is_test,
    flags: row.flags || [],
    instructorNote: row.instructor_note || "",
    purgePending: row.purge_pending,
    stateVersion: row.state_version,
    trashedAt: row.trashed_at,
    trashedBy: row.trashed_by,
    trashReason: row.trash_reason,
    stateUpdatedAt: row.state_updated_at,
    effectiveMetadata,
    effectiveSummary,
    state,
  };
}

function buildFacets(rows: JsonRecord[]) {
  const species = new Map<string, number>();
  const dates = new Map<string, number>();
  const sites = new Map<string, number>();
  const trails = new Map<string, number>();
  const totals = {
    totalTransects: rows.length, submittedTransects: 0, editedSubmissions: 0,
    partialUploads: 0, incompleteTransects: 0, trashedRecords: 0,
    recordsWithPhotos: 0, recordsWithGps: 0, detectedSpeciesCount: 0,
    detectedCells: 0, surveyedNoTargetCells: 0, notSurveyedCells: 0,
    incompleteCells: 0, testRecords: 0, excludedRecords: 0,
  };
  for (const row of rows) {
    if (row.sync_state === "submitted") totals.submittedTransects += 1;
    if (Number(row.submission_count) > 1) totals.editedSubmissions += 1;
    if (row.sync_state === "upload_partially_complete") totals.partialUploads += 1;
    if (Number(row.incomplete_cells) > 0) totals.incompleteTransects += 1;
    if (row.trashed_at) totals.trashedRecords += 1;
    if (Number(row.photo_count) > 0) totals.recordsWithPhotos += 1;
    if (row.has_gps) totals.recordsWithGps += 1;
    if (row.effective_is_test) totals.testRecords += 1;
    if (row.excluded_from_analysis) totals.excludedRecords += 1;
    totals.detectedCells += Number(row.detected_cells || 0);
    totals.surveyedNoTargetCells += Number(row.surveyed_no_target_cells || 0);
    totals.notSurveyedCells += Number(row.not_surveyed_cells || 0);
    totals.incompleteCells += Number(row.incomplete_cells || 0);
    for (const code of row.species_codes || []) {
      const key = String(code);
      species.set(key, (species.get(key) || 0) + 1);
    }
    const date = typeof row.submission_date_local === "string"
      ? row.submission_date_local
      : typeof row.original_submitted_at === "string"
        ? row.original_submitted_at.slice(0, 10)
      : "Unknown";
    dates.set(date, (dates.get(date) || 0) + 1);
    const site = String(row.site || "Unknown");
    sites.set(site, (sites.get(site) || 0) + 1);
    const trail = String(row.trail || "Unknown");
    trails.set(trail, (trails.get(trail) || 0) + 1);
  }
  totals.detectedSpeciesCount = species.size;
  const series = (values: Map<string, number>) => [...values.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return {
    totals,
    submissionsThroughTime: series(dates),
    speciesDetectionFrequency: series(species).sort((a, b) => Number(b.count) - Number(a.count)),
    statusComposition: [
      { label: "detected", count: totals.detectedCells },
      { label: "surveyed_no_target", count: totals.surveyedNoTargetCells },
      { label: "not_surveyed", count: totals.notSurveyedCells },
      { label: "incomplete", count: totals.incompleteCells },
    ],
    submissionsBySite: series(sites).sort((a, b) => Number(b.count) - Number(a.count)),
    submissionsByTrail: series(trails).sort((a, b) => Number(b.count) - Number(a.count)),
  };
}

function mapRow(row: JsonRecord) {
  return {
    recordId: row.record_id,
    classId: row.class_id,
    site: row.site || "",
    trail: row.trail || "",
    transectNumber: row.transect_number || "",
    surveyDate: row.survey_date || "",
    startGps: row.start_gps,
    endGps: row.end_gps,
    reviewStatus: row.review_status,
    effectiveIsTest: Boolean(row.effective_is_test),
    excludedFromAnalysis: Boolean(row.excluded_from_analysis),
    trashedAt: row.trashed_at,
    incompleteCells: Number(row.incomplete_cells || 0),
    syncState: row.sync_state,
  };
}

function defaultState(record: string) {
  return {
    transect_id: record, review_status: "unreviewed", excluded_from_analysis: false,
    test_data_status: "auto", flags: [], instructor_note: "", purge_pending: false,
    version: 0, trashed_at: null, trashed_by: null, trash_reason: null,
    created_at: null, updated_at: null, updated_by: "",
  };
}

function canonicalPhotoPath(path: unknown, ownerId: unknown, transectId: string) {
  if (typeof path !== "string") return false;
  const pieces = path.split("/");
  return pieces.length === 3 && pieces[0] === ownerId && pieces[1] === transectId && Boolean(pieces[2]);
}

async function collectPhotoPaths(admin: AdminClient, transect: JsonRecord) {
  const metadata: JsonRecord[] = [];
  const { count, error: countError } = await admin.from("photos")
    .select("id", { count: "exact", head: true }).eq("transect_id", transect.id);
  if (countError) throw dbError(countError, "Photo metadata could not be counted.");
  const expectedMetadataCount = Number(count || 0);
  if (!Number.isSafeInteger(expectedMetadataCount) || expectedMetadataCount < 0) {
    throw new ApiError(409, "photo_inventory_invalid", "Photo metadata count is invalid.");
  }
  for (let offset = 0; offset < expectedMetadataCount; offset += PHOTO_METADATA_PAGE_SIZE) {
    const { data, error } = await admin.from("photos")
      .select("id,transect_id,owner_id,storage_path,size_bytes")
      .eq("transect_id", transect.id)
      .order("id", { ascending: true })
      .range(offset, Math.min(offset + PHOTO_METADATA_PAGE_SIZE - 1, expectedMetadataCount - 1));
    if (error) throw dbError(error, "Photo metadata could not be loaded.");
    metadata.push(...(data || []));
  }
  if (metadata.length !== expectedMetadataCount) {
    throw new ApiError(409, "photo_inventory_changed",
      "Photo metadata changed while its exact inventory was being assembled. Retry the purge preview.");
  }
  for (const photo of metadata) {
    if (photo.owner_id !== transect.owner_id
      || !canonicalPhotoPath(photo.storage_path, transect.owner_id, transect.id)) {
      throw new ApiError(409, "noncanonical_photo", "A linked photograph has a non-canonical private path.", { photoId: photo.id });
    }
  }
  const storagePaths = await listStoragePaths(admin, transect);
  const paths = [...new Set([
    ...metadata.map((photo: JsonRecord) => photo.storage_path),
    ...storagePaths,
  ])].sort();
  return {
    paths,
    storagePaths,
    storagePathHash: await sha256Hex(paths.join("\n")),
    photoMetadataCount: metadata.length,
    storageObjectCount: storagePaths.length,
  };
}

async function listStoragePaths(admin: AdminClient, transect: JsonRecord) {
  const prefix = `${transect.owner_id}/${transect.id}`;
  const storagePaths: string[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await admin.storage.from(PHOTO_BUCKET).list(prefix, {
      limit: STORAGE_PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new ApiError(502, "storage_error", "Private photo objects could not be listed.");
    const items = data || [];
    for (const item of items) {
      if (!item.id || item.name.includes("/")) {
        throw new ApiError(409, "noncanonical_photo", "The private photo folder contains a non-canonical object.");
      }
      storagePaths.push(`${prefix}/${item.name}`);
    }
    if (items.length < STORAGE_PAGE_SIZE) break;
  }
  const sorted = storagePaths.sort();
  if (new Set(sorted).size !== sorted.length) {
    throw new ApiError(409, "photo_inventory_changed",
      "Private photo objects changed while their exact inventory was being assembled. Retry the purge preview.");
  }
  return sorted;
}

async function deleteAndVerifyStorage(admin: AdminClient, transect: JsonRecord,
  initialStoragePaths: string[], allowedPaths: string[], renewLease: () => Promise<void>) {
  const allowed = new Set(allowedPaths);
  if (initialStoragePaths.some((path) => !allowed.has(path))) {
    throw new ApiError(409, "purge_changed",
      "Private photo objects no longer match the signed purge inventory. Database rows were retained.");
  }
  let batches = 0;
  for (let offset = 0; offset < initialStoragePaths.length; offset += STORAGE_DELETE_BATCH_SIZE) {
    if (batches >= MAX_STORAGE_DELETE_BATCHES_PER_REQUEST) {
      throw new ApiError(503, "purge_storage_continuation",
        "The bounded Storage cleanup made progress but needs another purge preview to continue; database rows were retained.",
        { deletedBatchCount: batches });
    }
    const { error } = await admin.storage.from(PHOTO_BUCKET)
      .remove(initialStoragePaths.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE));
    if (error) throw new ApiError(502, "storage_delete_failed", "One or more private photographs could not be deleted.");
    batches += 1;
    if (batches % 20 === 0) await renewLease();
  }

  // Two consecutive empty reads reduce the external Storage/SQL commit race.
  // Any late object is removed in a bounded first-page chunk, and an unfinished
  // cleanup remains retryable without deleting database rows.
  let consecutiveEmptyReads = 0;
  while (consecutiveEmptyReads < 2) {
    const remaining = await listStoragePage(admin, transect);
    if (!remaining.length) {
      consecutiveEmptyReads += 1;
      continue;
    }
    consecutiveEmptyReads = 0;
    const unexpected = remaining.filter((path) => !allowed.has(path));
    if (unexpected.length) {
      throw new ApiError(409, "purge_changed",
        "A private photo object appeared outside the signed purge inventory. Database rows were retained; create a new preview.",
        { unexpectedObjectCount: unexpected.length });
    }
    if (batches >= MAX_STORAGE_DELETE_BATCHES_PER_REQUEST) {
      throw new ApiError(503, "purge_storage_continuation",
        "The bounded Storage cleanup made progress but needs another purge preview to continue; database rows were retained.",
        { remainingObjectCountAtLeast: remaining.length, deletedBatchCount: batches });
    }
    const { error } = await admin.storage.from(PHOTO_BUCKET).remove(remaining);
    if (error) throw new ApiError(502, "storage_delete_failed", "A late private photograph could not be deleted.");
    batches += 1;
    if (batches % 20 === 0) await renewLease();
  }
  return { deletedBatchCount: batches };
}

async function listStoragePage(admin: AdminClient, transect: JsonRecord) {
  const prefix = `${transect.owner_id}/${transect.id}`;
  const { data, error } = await admin.storage.from(PHOTO_BUCKET).list(prefix, {
    limit: STORAGE_PAGE_SIZE, offset: 0, sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new ApiError(502, "storage_error", "Private photo objects could not be verified.");
  const paths = [];
  for (const item of data || []) {
    if (!item.id || item.name.includes("/")) {
      throw new ApiError(409, "noncanonical_photo", "The private photo folder contains a non-canonical object.");
    }
    paths.push(`${prefix}/${item.name}`);
  }
  return paths;
}

async function resumablePurgeDescriptor(operation: JsonRecord, transect: JsonRecord, state: JsonRecord) {
  const paths = operation?.storage_paths;
  const descriptor = {
    recordId: operation?.record_id,
    operationId: operation?.operation_id,
    submissionCount: operation?.source_submission_count,
    stateVersion: operation?.source_state_version,
    storagePathHash: operation?.storage_path_digest,
    photoMetadataCount: operation?.photo_metadata_count,
    storageObjectCount: operation?.storage_object_count,
    recordSnapshot: operation?.record_snapshot,
    resuming: true,
  };
  if (operation?.status !== "storage_pending"
    || operation.record_id !== transect.id
    || transect.submission_count !== operation.source_submission_count
    || state.version !== operation.source_state_version + 1
    || !state.purge_pending || !state.trashed_at
    || !UUID_PATTERN.test(String(operation.operation_id || ""))
    || !Number.isSafeInteger(operation.photo_metadata_count) || operation.photo_metadata_count < 0
    || !Number.isSafeInteger(operation.storage_object_count) || operation.storage_object_count < 0
    || !Array.isArray(paths)
    || paths.length < Math.max(operation.photo_metadata_count, operation.storage_object_count)
    || paths.length > operation.photo_metadata_count + operation.storage_object_count
    || new Set(paths).size !== paths.length
    || paths.some((path: unknown) => !canonicalPhotoPath(path, transect.owner_id, transect.id))
    || !validPurgeSnapshot(operation.record_snapshot, descriptor)
    || operation.record_snapshot.classId !== transect.class_id
    || operation.record_snapshot.protocolVersion !== transect.protocol_version
    || operation.record_snapshot.speciesListVersion !== transect.species_list_version
    || await sha256Hex([...paths].sort().join("\n")) !== operation.storage_path_digest) {
    throw new ApiError(409, "purge_resume_invalid",
      `Record ${transect.id} has an inconsistent pending purge. Review the purge ledger before continuing.`);
  }
  return { ...descriptor, paths: [...paths].sort() };
}

function rpcArgsForVersions(value: unknown, recordIds: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "missing_versions", "Current state versions are required for every selected record.");
  }
  const object = value as JsonRecord;
  const extras = Object.keys(object).filter((key) => !recordIds.includes(key));
  if (extras.length) throw new ApiError(400, "invalid_versions", "State versions contain unselected records.", { recordIds: extras });
  const versions: JsonRecord = Object.create(null);
  for (const id of recordIds) {
    if (!Object.hasOwn(object, id)) {
      throw new ApiError(400, "missing_versions", `State version is missing for ${id}.`);
    }
    versions[id] = requiredInteger(object[id], `State version for ${id}`, 0);
  }
  return versions;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const originAllowed = Boolean(origin && allowedOrigins.includes(origin));

  if (request.method === "OPTIONS") {
    if (!originAllowed) return response(403, { error: "Origin is not allowed.", code: "origin_denied" }, origin, false);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Expose-Headers": "Retry-After",
        "Cache-Control": "no-store",
        Vary: "Origin",
      },
    });
  }
  if (!originAllowed) return response(403, { error: "Origin is not allowed.", code: "origin_denied" }, origin, false);
  if (request.method !== "POST") return response(405, { error: "Use POST.", code: "method_not_allowed" }, origin, true);
  const mediaType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return response(415, { error: "Content-Type must be application/json.", code: "unsupported_media_type" }, origin, true);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const rawPassword = Deno.env.get("INSTRUCTOR_PASSWORD") || "";
    const legacyPasswordHash = (Deno.env.get("INSTRUCTOR_PASSWORD_HASH") || "").toLowerCase();
    const sessionSecret = Deno.env.get("INSTRUCTOR_SESSION_SECRET") || "";
    const rateSecret = Deno.env.get("INSTRUCTOR_RATE_LIMIT_SECRET") || "";
    const configuredPassword = {
      raw: rawPassword.length >= 16 && rawPassword.length <= 256 ? rawPassword : "",
      hash: /^[a-f0-9]{64}$/.test(legacyPasswordHash) ? legacyPasswordHash : "",
    };
    if (!supabaseUrl || !serviceRoleKey || (!configuredPassword.raw && !configuredPassword.hash)
      || sessionSecret.length < 32 || rateSecret.length < 32) {
      throw new ApiError(500, "not_configured", "Instructor dashboard is not fully configured.");
    }
    const passwordMaterial = configuredPassword.raw || configuredPassword.hash;
    const body = await readJsonBody(request);
    const action = requiredString(body.action, "Action", 1, 80);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "login") {
      const reviewer = reviewerName(body.reviewerName);
      const succeeded = await authorizePasswordAttempt(
        admin, body.password, configuredPassword, sessionSecret, rateSecret, request, "login",
      );
      await audit(admin, succeeded ? "login_success" : "login_failure", reviewer, {
        detail: { authentication: "shared_password" },
      });
      if (!succeeded) throw new ApiError(403, "password_rejected", "The instructor password was not recognized.");
      return response(200, await issueSession(reviewer, passwordMaterial, sessionSecret), origin, true);
    }

    const session = await verifySession(request, passwordMaterial, sessionSecret);
    if (!session) throw new ApiError(401, "session_expired", "Instructor session is invalid or expired. Sign in again.");
    const reviewer = session.reviewer;

    if (action === "bootstrap") {
      const { data: classes, error } = await admin.from("instructor_class_summaries")
        .select("*")
        .order("updated_at", { ascending: false }).limit(MAX_CLASSES + 1);
      if (error) throw dbError(error, "Classes could not be loaded.");
      if ((classes || []).length > MAX_CLASSES) {
        throw new ApiError(413, "too_many_classes", `Dashboard supports at most ${MAX_CLASSES} classes.`);
      }
      return response(200, {
        classes: (classes || []).map((item: JsonRecord) => ({
          ...item,
          recordCount: Number(item.record_count || 0),
          activeRecordCount: Number(item.active_record_count || 0),
          trashedRecordCount: Number(item.trashed_record_count || 0),
          lastSubmissionAt: item.last_submission_at,
        })),
        loadedAt: new Date().toISOString(),
        sessionExpiresAt: session.expiresAt,
      }, origin, true);
    }

    if (action === "list-records") {
      const page = requiredInteger(body.page ?? 1, "Page", 1, 100_000);
      const pageSize = requiredInteger(body.pageSize ?? 50, "Page size", 1, MAX_PAGE_SIZE);
      const filters = validateFilterObject(body.filters);
      const sort = parseSort(body.sort);
      let pageQuery: any = admin.from("instructor_record_summaries")
        .select("*", { count: "exact" });
      pageQuery = applyFilters(pageQuery, filters)
        .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
        .order("record_id", { ascending: true })
        .range((page - 1) * pageSize, page * pageSize - 1);
      const { data: pageRows, count, error } = await pageQuery;
      if (error) throw dbError(error, "Record summaries could not be loaded.");
      const total = Number(count || 0);
      if (total > MAX_AGGREGATE_RECORDS) {
        throw new ApiError(413, "aggregate_limit", `More than ${MAX_AGGREGATE_RECORDS} records match. Narrow the filters before loading dashboard summaries.`);
      }
      const facetColumns = "record_id,class_id,sync_state,submission_count,original_submitted_at,submission_date_local,survey_date,site,trail,transect_number,start_gps,end_gps,has_gps,detected_cells,surveyed_no_target_cells,not_surveyed_cells,incomplete_cells,species_codes,photo_count,effective_is_test,excluded_from_analysis,review_status,trashed_at";
      const facetRows: JsonRecord[] = [];
      for (let offset = 0; offset < total; offset += 1000) {
        let facetQuery: any = admin.from("instructor_record_summaries").select(facetColumns);
        facetQuery = applyFilters(facetQuery, filters)
          .order("record_id", { ascending: true }).range(offset, Math.min(offset + 999, total - 1));
        const { data, error: facetError } = await facetQuery;
        if (facetError) throw dbError(facetError, "Filtered summary totals could not be loaded.");
        facetRows.push(...(data || []));
      }
      if (facetRows.length !== total) {
        throw new ApiError(409, "records_changed", "Records changed while dashboard totals were being calculated. Refresh and try again.");
      }
      const allMapRows = facetRows.filter((row) => row.has_gps);
      const mapRecords = allMapRows.slice(0, MAX_MAP_RECORDS).map(mapRow);
      return response(200, {
        records: (pageRows || []).map(summaryRow),
        total, page, pageSize, totalPages: Math.ceil(total / pageSize),
        sort: { field: sort.field, direction: sort.direction },
        summary: buildFacets(facetRows),
        mapRecords,
        mapTotal: allMapRows.length,
        mapTruncated: allMapRows.length > mapRecords.length,
        mapLimit: MAX_MAP_RECORDS,
        loadedAt: new Date().toISOString(),
      }, origin, true);
    }

    if (action === "record-detail") {
      const id = recordId(body.recordId);
      const queries = await Promise.all([
        admin.from("transects").select("id,class_id,payload,entry_method,protocol_version,species_list_version,original_submitted_at,client_modified_at,server_created_at,server_updated_at,sync_state,submission_count")
          .eq("id", id).maybeSingle(),
        admin.from("instructor_curations").select("*").eq("transect_id", id).maybeSingle(),
        admin.from("instructor_record_state").select("*").eq("transect_id", id).maybeSingle(),
        admin.from("photos").select("id,transect_id,storage_path,scope,segment_index,side,band_start_m,species_code,unknown_id,note,captured_at,mime_type,size_bytes,uploaded_at")
          .eq("transect_id", id).order("captured_at").limit(DETAIL_COLLECTION_LIMIT + 1),
        admin.from("transect_revisions").select("revision_id,revision_number,client_modified_at,archived_at")
          .eq("transect_id", id).order("revision_number", { ascending: false }).limit(DETAIL_COLLECTION_LIMIT + 1),
        admin.from("instructor_curation_revisions")
          .select("revision_id,transect_id,active,source_submission_count,version,reason,reviewer_name,archived_at")
          .eq("transect_id", id).order("version", { ascending: false }).limit(DETAIL_COLLECTION_LIMIT + 1),
        admin.from("instructor_actions").select("action_id,request_id,record_id,action,reviewer_name,reason,detail,created_at")
          .eq("record_id", id).neq("action", "photo_accessed")
          .order("created_at", { ascending: false }).limit(DETAIL_COLLECTION_LIMIT + 1),
      ]);
      const errors = queries.map((query: any) => query.error).filter(Boolean);
      if (errors.length) throw dbError(errors[0], "Record detail could not be loaded.");
      const [transectResult, curationResult, stateResult, photoResult, revisionResult, curationRevisionResult, actionResult] = queries as any[];
      if (!transectResult.data) throw new ApiError(404, "not_found", "Record was not found.");
      for (const [label, collection] of [
        ["photos", photoResult.data], ["student revisions", revisionResult.data],
        ["curation revisions", curationRevisionResult.data], ["audit actions", actionResult.data],
      ] as Array<[string, any[]]>) {
        if ((collection || []).length > DETAIL_COLLECTION_LIMIT) {
          throw new ApiError(413, "detail_limit", `This record has more than ${DETAIL_COLLECTION_LIMIT} ${label}; use an export instead.`);
        }
      }
      return response(200, {
        transect: transectResult.data,
        curation: curationResult.data || null,
        curationStale: Boolean(curationResult.data?.active
          && curationResult.data.source_submission_count !== transectResult.data.submission_count),
        state: stateResult.data || defaultState(id),
        photos: photoResult.data || [], revisions: revisionResult.data || [],
        curationRevisions: curationRevisionResult.data || [], actions: actionResult.data || [],
      }, origin, true);
    }

    if (action === "export-records") {
      const ids = exactIds(body.recordIds, "records", MAX_EXPORT_RECORDS);
      const format = optionalString(body.format, "Export format", 40);
      const exportRequestId = mutationRequestId(body.requestId);
      const { data: payloadSizes, error: payloadSizeError } = await admin
        .from("instructor_record_summaries")
        .select("record_id,original_payload_bytes,curation_payload_bytes")
        .in("record_id", ids);
      if (payloadSizeError) throw dbError(payloadSizeError, "Selected payload sizes could not be checked.");
      const sizedIds = new Set((payloadSizes || []).map((item: JsonRecord) => item.record_id));
      const missingAtPreflight = ids.filter((id) => !sizedIds.has(id));
      if (missingAtPreflight.length) {
        throw new ApiError(404, "records_missing", "One or more selected records no longer exist.", { recordIds: missingAtPreflight });
      }
      const payloadByteCount = (payloadSizes || []).reduce((sum: number, item: JsonRecord) =>
        sum + Number(item.original_payload_bytes || 0) + Number(item.curation_payload_bytes || 0), 0);
      if (!Number.isSafeInteger(payloadByteCount) || payloadByteCount > MAX_EXPORT_PAYLOAD_BYTES) {
        throw new ApiError(413, "export_payload_limit",
          "The selected original and curated payloads exceed the 4 MB assembly limit; export a smaller batch.",
          { byteCount: payloadByteCount, maximumBytes: MAX_EXPORT_PAYLOAD_BYTES });
      }
      const results = await Promise.all([
        admin.from("transects").select("id,class_id,payload,entry_method,protocol_version,species_list_version,original_submitted_at,client_modified_at,server_created_at,server_updated_at,sync_state,submission_count").in("id", ids),
        admin.from("instructor_curations").select("*").in("transect_id", ids),
        admin.from("instructor_record_state").select("*").in("transect_id", ids),
      ]);
      const errors = results.map((result: any) => result.error).filter(Boolean);
      if (errors.length) throw dbError(errors[0], "Selected records could not be exported.");
      const [transects, curations, states] = results.map((result: any) => result.data || []);
      const found = new Set(transects.map((item: JsonRecord) => item.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) throw new ApiError(404, "records_missing", "One or more selected records no longer exist.", { recordIds: missing });
      const classIds = [...new Set(transects.map((item: JsonRecord) => item.class_id))];
      const [classResult, photos, actions, revisions, curationRevisions] = await Promise.all([
        admin.from("classes").select("id,name,term,active,created_at,updated_at").in("id", classIds),
        fetchSelectedRows(admin, {
          table: "photos",
          columns: "id,transect_id,storage_path,scope,segment_index,side,band_start_m,species_code,unknown_id,note,captured_at,mime_type,size_bytes,uploaded_at",
          filterColumn: "transect_id", ids, orderColumn: "id",
          maximum: MAX_EXPORT_PHOTO_ROWS, label: "photo metadata rows",
        }),
        fetchSelectedRows(admin, {
          table: "instructor_actions",
          columns: "action_id,request_id,record_id,action,reviewer_name,reason,detail,created_at",
          filterColumn: "record_id", ids, orderColumn: "action_id",
          maximum: MAX_EXPORT_AUDIT_ROWS, label: "instructor audit rows",
        }),
        fetchSelectedRows(admin, {
          table: "transect_revisions",
          columns: "revision_id,transect_id,revision_number,client_modified_at,archived_at",
          filterColumn: "transect_id", ids, orderColumn: "revision_id",
          maximum: MAX_EXPORT_REVISION_ROWS, label: "student revision metadata rows",
        }),
        fetchSelectedRows(admin, {
          table: "instructor_curation_revisions",
          columns: "revision_id,transect_id,active,source_submission_count,version,reason,reviewer_name,archived_at",
          filterColumn: "transect_id", ids, orderColumn: "revision_id",
          maximum: MAX_EXPORT_REVISION_ROWS, label: "curation revision metadata rows",
        }),
      ]);
      const { data: classes, error: classError } = classResult;
      if (classError) throw dbError(classError, "Class information could not be exported.");
      const exportBundle = {
        classes: classes || [], transects, curations, states, photos,
        actions, revisions, curationRevisions,
        relatedRowLimits: {
          photos: MAX_EXPORT_PHOTO_ROWS,
          actions: MAX_EXPORT_AUDIT_ROWS,
          revisions: MAX_EXPORT_REVISION_ROWS,
          curationRevisions: MAX_EXPORT_REVISION_ROWS,
        },
        exportedAt: new Date().toISOString(),
      };
      const exportBytes = new TextEncoder().encode(JSON.stringify(exportBundle)).byteLength;
      if (exportBytes > MAX_EXPORT_RESPONSE_BYTES) {
        throw new ApiError(413, "export_size_limit",
          "The selected raw data exceeds the 5 MB response limit; export a smaller record batch.",
          { byteCount: exportBytes, maximumBytes: MAX_EXPORT_RESPONSE_BYTES });
      }
      await audit(admin, "export_generated", reviewer, {
        reason: optionalString(body.reason, "Export reason", 1000),
        detail: { recordCount: ids.length, requestedFormat: format || "bundle", byteCount: exportBytes },
        requestId: exportRequestId,
      });
      return response(200, exportBundle, origin, true);
    }

    if (action === "save-curation") {
      const id = recordId(body.recordId);
      if (!isProtocolV2Payload(body.curatedPayload) || body.curatedPayload?.id !== id) {
        throw new ApiError(400, "invalid_curation", "Curated data failed protocol-v2 validation.");
      }
      const data = await rpc(admin, "instructor_save_curation", {
        p_transect_id: id,
        p_curated_payload: body.curatedPayload,
        p_expected_submission_count: requiredInteger(body.expectedSubmissionCount, "Expected submission count", 1),
        p_expected_curation_version: requiredInteger(body.expectedCurationVersion, "Expected curation version", 0),
        p_reviewer_name: reviewer,
        p_reason: requiredString(body.reason, "Correction reason", 3, 1000),
        p_request_id: mutationRequestId(body.requestId),
      }, "Curation could not be saved.");
      return response(200, data, origin, true);
    }

    if (action === "clear-curation") {
      const data = await rpc(admin, "instructor_clear_curation", {
        p_transect_id: recordId(body.recordId),
        p_expected_submission_count: requiredInteger(body.expectedSubmissionCount, "Expected submission count", 1),
        p_expected_curation_version: requiredInteger(body.expectedCurationVersion, "Expected curation version", 1),
        p_reviewer_name: reviewer,
        p_reason: requiredString(body.reason, "Reason", 3, 1000),
        p_request_id: mutationRequestId(body.requestId),
      }, "Curation could not be cleared.");
      return response(200, data, origin, true);
    }

    if (action === "revert-curation") {
      const data = await rpc(admin, "instructor_revert_curation", {
        p_transect_id: recordId(body.recordId),
        p_revision_id: requiredInteger(body.revisionId, "Curation revision", 1),
        p_expected_submission_count: requiredInteger(body.expectedSubmissionCount, "Expected submission count", 1),
        p_expected_curation_version: requiredInteger(body.expectedCurationVersion, "Expected curation version", 1),
        p_reviewer_name: reviewer,
        p_reason: requiredString(body.reason, "Reason", 3, 1000),
        p_request_id: mutationRequestId(body.requestId),
      }, "Curation revision could not be restored.");
      return response(200, data, origin, true);
    }

    if (action === "save-state") {
      if (!Array.isArray(body.flags) || body.flags.length > 20) {
        throw new ApiError(400, "invalid_input", "Flags must be an array containing at most 20 values.");
      }
      const flags = body.flags.map((flag: unknown) => requiredString(flag, "Flag", 1, 80));
      if (new Set(flags).size !== flags.length) throw new ApiError(400, "invalid_input", "Flags must not contain duplicates.");
      if (typeof body.excludedFromAnalysis !== "boolean") throw new ApiError(400, "invalid_input", "excludedFromAnalysis must be true or false.");
      const data = await rpc(admin, "instructor_save_state", {
        p_transect_id: recordId(body.recordId),
        p_expected_state_version: requiredInteger(body.expectedStateVersion, "Expected state version", 0),
        p_review_status: requiredString(body.reviewStatus, "Review status", 1, 40),
        p_excluded_from_analysis: body.excludedFromAnalysis,
        p_test_data_status: requiredString(body.testDataStatus, "Test-data status", 1, 20),
        p_flags: flags,
        p_instructor_note: optionalString(body.instructorNote, "Instructor note", 10000),
        p_reviewer_name: reviewer,
        p_reason: optionalString(body.reason, "Reason", 1000),
        p_request_id: mutationRequestId(body.requestId),
      }, "Review state could not be saved.");
      return response(200, data, origin, true);
    }

    if (action === "trash" || action === "restore") {
      const ids = exactIds(body.recordIds, "records", MAX_BULK_MUTATIONS);
      const versions = rpcArgsForVersions(body.expectedStateVersions, ids);
      const reason = requiredString(body.reason, "Reason", 3, 1000);
      const operationRequestId = mutationRequestId(body.requestId);
      const results = [];
      for (const id of ids) {
        try {
          const data = await rpc(admin, "instructor_set_trash", {
            p_transect_id: id,
            p_expected_state_version: versions[id],
            p_trash: action === "trash",
            p_reviewer_name: reviewer,
            p_reason: reason,
            p_request_id: operationRequestId,
          }, `Record could not be ${action === "trash" ? "trashed" : "restored"}.`);
          results.push({ recordId: id, ok: true, ...data });
        } catch (error) {
          const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "Record state failed.");
          results.push({ recordId: id, ok: false, status: apiError.status, code: apiError.code, error: apiError.message });
        }
      }
      return response(results.every((item) => item.ok) ? 200 : 207, { results }, origin, true);
    }

    if (action === "purge-preview") {
      const ids = exactIds(body.recordIds, "records", MAX_PURGE_RECORDS);
      const [transectResult, stateResult, operationResult] = await Promise.all([
        admin.from("transects").select("id,class_id,owner_id,protocol_version,species_list_version,submission_count,payload").in("id", ids),
        admin.from("instructor_record_state").select("transect_id,version,trashed_at,purge_pending").in("transect_id", ids),
        admin.from("instructor_purge_operations").select("*")
          .in("record_id", ids).eq("status", "storage_pending")
          .order("created_at", { ascending: false }).limit(MAX_PURGE_RECORDS + 1),
      ]);
      const sourceError = transectResult.error || stateResult.error || operationResult.error;
      if (sourceError) throw dbError(sourceError, "Purge eligibility could not be checked.");
      if ((operationResult.data || []).length > MAX_PURGE_RECORDS) {
        throw new ApiError(409, "purge_ledger_invalid", "Too many pending purge operations were found for the selected records.");
      }
      const transects = transectResult.data || [];
      const states = stateResult.data || [];
      const transectMap = new Map((transects || []).map((item: JsonRecord) => [item.id, item]));
      const stateMap = new Map((states || []).map((item: JsonRecord) => [item.transect_id, item]));
      const operationMap = new Map<string, JsonRecord>();
      for (const operation of operationResult.data || []) {
        if (operationMap.has(operation.record_id)) {
          throw new ApiError(409, "purge_ledger_invalid", "A record has more than one pending purge operation.", { recordId: operation.record_id });
        }
        operationMap.set(operation.record_id, operation);
      }
      const rejected = ids.filter((id) => {
        const state = stateMap.get(id);
        return !transectMap.has(id) || !state?.trashed_at
          || (Boolean(state?.purge_pending) !== operationMap.has(id));
      });
      if (rejected.length) {
        throw new ApiError(409, "purge_ineligible", "Every selected record must exist in Trash with a consistent purge state.", { recordIds: rejected });
      }
      const records = [];
      for (const id of ids) {
        const transect = transectMap.get(id)!;
        const state = stateMap.get(id)!;
        const display = purgeDisplay(transect.payload);
        const displayHash = await purgeDisplayHash(transect.payload);
        const existingOperation = operationMap.get(id);
        if (existingOperation) {
          records.push({
            ...await resumablePurgeDescriptor(existingOperation, transect, state),
            display, snapshot: display, displayHash,
          });
        } else {
          const photos = await collectPhotoPaths(admin, transect);
          records.push({
            recordId: id,
            operationId: crypto.randomUUID(),
            submissionCount: transect.submission_count,
            stateVersion: state.version,
            ...photos,
            recordSnapshot: {
              recordId: id,
              classId: transect.class_id,
              protocolVersion: transect.protocol_version,
              speciesListVersion: transect.species_list_version,
              submissionCount: transect.submission_count,
              photoMetadataCount: photos.photoMetadataCount,
              storageObjectCount: photos.storageObjectCount,
            },
            resuming: false,
            display, snapshot: display, displayHash,
          });
        }
      }
      records.sort((a, b) => a.recordId.localeCompare(b.recordId));
      const signed = await issuePurgeChallenge(records, reviewer, passwordMaterial, sessionSecret);
      return response(200, {
        records: records.map(({ paths: _paths, storagePaths: _storagePaths, ...item }) => item),
        recordIds: records.map((item) => item.recordId),
        recordCount: records.length,
        photoMetadataCount: records.reduce((sum, item) => sum + item.photoMetadataCount, 0),
        storageObjectCount: records.reduce((sum, item) => sum + item.storageObjectCount, 0),
        confirmation: `PURGE ${records.length} RECORDS`,
        ...signed,
      }, origin, true);
    }

    if (action === "purge") {
      const ids = exactIds(body.recordIds, "records", MAX_PURGE_RECORDS).sort();
      const challenge = await verifyPurgeChallenge(body.challenge, reviewer, passwordMaterial, sessionSecret);
      if (!challenge) throw new ApiError(400, "invalid_purge_challenge", "Purge preview expired or no longer matches. Create a new preview.");
      const challengeIds = challenge.records.map((item: JsonRecord) => item.recordId).sort();
      if (JSON.stringify(ids) !== JSON.stringify(challengeIds)) {
        throw new ApiError(400, "purge_ids_changed", "Selected record IDs do not exactly match the purge preview.");
      }
      const passwordAccepted = await authorizePasswordAttempt(
        admin, body.password, configuredPassword, sessionSecret, rateSecret, request, "purge",
      );
      if (!passwordAccepted) throw new ApiError(403, "password_rejected", "Password re-entry failed.");
      if (requiredString(body.confirmation, "Destructive confirmation", 1, 80, false) !== `PURGE ${ids.length} RECORDS`) {
        throw new ApiError(400, "confirmation_mismatch", "Destructive confirmation did not match.");
      }
      const reason = requiredString(body.reason, "Purge reason", 3, 1000);
      const purgeRequestId = mutationRequestId(body.requestId);
      const results = [];
      for (const item of challenge.records as JsonRecord[]) {
        const purgeLeaseToken = crypto.randomUUID();
        let purgeLeaseClaimed = false;
        try {
          const { data: existingOperation, error: operationError } = await admin
            .from("instructor_purge_operations").select("*")
            .eq("operation_id", item.operationId).maybeSingle();
          if (operationError) throw dbError(operationError, "Purge operation could not be read.");
          if (existingOperation?.status === "completed") {
            results.push({ recordId: item.recordId, ok: true, alreadyCompleted: true });
            continue;
          }
          if (existingOperation?.status === "failed") {
            throw new ApiError(409, "purge_retry_preview", "A prior purge attempt partially failed. Create a new preview before retrying.");
          }
          let paths: string[];
          let storagePathsToDelete: string[] = [];
          let purgeTransect: JsonRecord;
          if (existingOperation?.status === "storage_pending") {
            if (existingOperation.storage_path_digest !== item.storagePathHash
              || existingOperation.source_submission_count !== item.submissionCount
              || existingOperation.source_state_version !== item.stateVersion
              || existingOperation.photo_metadata_count !== item.photoMetadataCount
              || existingOperation.storage_object_count !== item.storageObjectCount) {
              throw new ApiError(409, "purge_changed", "Stored purge operation does not match this preview.");
            }
            const [{ data: transect, error: transectError }, { data: state, error: stateError }] = await Promise.all([
              admin.from("transects").select("id,class_id,owner_id,protocol_version,species_list_version,submission_count,payload").eq("id", item.recordId).maybeSingle(),
              admin.from("instructor_record_state").select("transect_id,version,trashed_at,purge_pending").eq("transect_id", item.recordId).maybeSingle(),
            ]);
            if (transectError || stateError) throw dbError(transectError || stateError, "Pending purge could not be rechecked.");
            if (!transect || !state) throw new ApiError(409, "purge_changed", "Pending purge record is no longer available.");
            if (await purgeDisplayHash(transect.payload) !== item.displayHash) {
              throw new ApiError(409, "purge_changed", "Record display metadata no longer matches the signed purge preview.");
            }
            purgeTransect = transect;
            const resumed = await resumablePurgeDescriptor(existingOperation, transect, state);
            if (resumed.storagePathHash !== item.storagePathHash) {
              throw new ApiError(409, "purge_changed", "Pending purge paths no longer match this preview.");
            }
            paths = resumed.paths;
            storagePathsToDelete = await listStoragePaths(admin, purgeTransect);
            const persistedPaths = new Set(paths);
            if (storagePathsToDelete.some((path) => !persistedPaths.has(path))) {
              throw new ApiError(409, "purge_changed",
                "Private photo objects no longer match the persisted purge inventory. Database rows were retained.");
            }
          } else {
            const [{ data: transect, error: transectError }, { data: state, error: stateError }] = await Promise.all([
              admin.from("transects").select("id,class_id,owner_id,protocol_version,species_list_version,submission_count,payload").eq("id", item.recordId).maybeSingle(),
              admin.from("instructor_record_state").select("transect_id,version,trashed_at,purge_pending").eq("transect_id", item.recordId).maybeSingle(),
            ]);
            if (transectError || stateError) throw dbError(transectError || stateError, "Purge record could not be rechecked.");
            if (!transect || !state?.trashed_at || state.purge_pending
              || transect.submission_count !== item.submissionCount
              || state.version !== item.stateVersion) {
              throw new ApiError(409, "purge_changed", "Record changed after purge preview. Create a new preview.");
            }
            if (await purgeDisplayHash(transect.payload) !== item.displayHash) {
              throw new ApiError(409, "purge_changed", "Record display metadata no longer matches the signed purge preview.");
            }
            purgeTransect = transect;
            const currentPhotos = await collectPhotoPaths(admin, transect);
            if (currentPhotos.storagePathHash !== item.storagePathHash
              || currentPhotos.photoMetadataCount !== item.photoMetadataCount
              || currentPhotos.storageObjectCount !== item.storageObjectCount) {
              throw new ApiError(409, "purge_changed", "Photos changed after purge preview. Create a new preview.");
            }
            paths = currentPhotos.paths;
            storagePathsToDelete = currentPhotos.storagePaths;
          }
          await rpc(admin, "instructor_begin_purge", {
            p_operation_id: item.operationId,
            p_request_id: purgeRequestId,
            p_transect_id: item.recordId,
            p_expected_submission_count: item.submissionCount,
            p_expected_state_version: item.stateVersion,
            p_storage_paths: paths,
            p_storage_path_digest: item.storagePathHash,
            p_photo_metadata_count: item.photoMetadataCount,
            p_storage_object_count: item.storageObjectCount,
            p_record_snapshot: item.recordSnapshot,
            p_reviewer_name: reviewer,
            p_reason: reason,
          }, "Purge operation could not be started or resumed.");
          const claim = await rpc(admin, "instructor_claim_purge", {
            p_operation_id: item.operationId,
            p_lease_token: purgeLeaseToken,
          }, "Purge Storage cleanup could not be claimed.");
          if (claim?.status === "completed") {
            results.push({ recordId: item.recordId, ok: true, alreadyCompleted: true });
            continue;
          }
          purgeLeaseClaimed = true;
          if (!existingOperation) {
            const fencedPhotos = await collectPhotoPaths(admin, purgeTransect);
            if (fencedPhotos.storagePathHash !== item.storagePathHash
              || fencedPhotos.photoMetadataCount !== item.photoMetadataCount
              || fencedPhotos.storageObjectCount !== item.storageObjectCount) {
              throw new ApiError(409, "purge_changed",
                "Photos changed while the purge fence was being established. Database rows were retained; create a new preview.");
            }
            paths = fencedPhotos.paths;
            storagePathsToDelete = fencedPhotos.storagePaths;
          }
          const renewLease = async () => {
            await rpc(admin, "instructor_claim_purge", {
              p_operation_id: item.operationId,
              p_lease_token: purgeLeaseToken,
            }, "Purge Storage cleanup lease could not be renewed.");
          };
          await renewLease();
          await deleteAndVerifyStorage(admin, purgeTransect, storagePathsToDelete, paths, renewLease);
          const finalized = await rpc(admin, "instructor_finalize_purge", {
            p_operation_id: item.operationId,
            p_lease_token: purgeLeaseToken,
          }, "Database purge could not be finalized.");
          results.push({ recordId: item.recordId, ok: true, ...finalized });
        } catch (error) {
          const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "Purge failed.");
          if (purgeLeaseClaimed) {
            try {
              if (apiError.code === "purge_storage_continuation") {
                await rpc(admin, "instructor_release_purge", {
                  p_operation_id: item.operationId,
                  p_lease_token: purgeLeaseToken,
                }, "Purge continuation lease could not be released.");
              } else {
                await rpc(admin, "instructor_fail_purge", {
                  p_operation_id: item.operationId,
                  p_lease_token: purgeLeaseToken,
                  p_error: `${apiError.code}: ${apiError.message}`,
                }, "Purge failure could not be recorded.");
              }
            } catch {
              // Another worker may have finalized or reclaimed an expired lease.
            }
          }
          results.push({ recordId: item.recordId, ok: false, status: apiError.status, code: apiError.code, error: apiError.message });
        }
      }
      return response(results.every((item) => item.ok) ? 200 : 207, { results }, origin, true);
    }

    if (action === "photo-urls") {
      const ids = exactIds(body.photoIds, "photographs", MAX_PHOTOS_PER_REQUEST, "photo");
      const { data: photos, error } = await admin.from("photos")
        .select("id,transect_id,owner_id,storage_path,scope,segment_index,side,band_start_m,species_code,unknown_id,note,captured_at,mime_type,size_bytes,uploaded_at")
        .in("id", ids);
      if (error) throw dbError(error, "Photo metadata could not be loaded.");
      const found = new Set((photos || []).map((photo: JsonRecord) => photo.id));
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length) throw new ApiError(404, "photos_missing", "One or more selected photographs no longer exist.", { photoIds: missing });
      for (const photo of photos || []) {
        if (!canonicalPhotoPath(photo.storage_path, photo.owner_id, photo.transect_id)) {
          throw new ApiError(409, "noncanonical_photo", "A photograph has a non-canonical private path.", { photoId: photo.id });
        }
      }
      const paths = (photos || []).map((photo: JsonRecord) => photo.storage_path);
      const { data: signed, error: signError } = await admin.storage
        .from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
      if (signError) throw new ApiError(502, "storage_error", "Photographs could not be authorized.");
      for (const linkedRecordId of new Set((photos || []).map((photo: JsonRecord) => photo.transect_id))) {
        await audit(admin, "photo_accessed", reviewer, {
          recordId: String(linkedRecordId),
          detail: { photoCount: (photos || []).filter((photo: JsonRecord) => photo.transect_id === linkedRecordId).length },
        });
      }
      const signedByPath = new Map((signed || []).map((item: JsonRecord, index: number) => [item.path || paths[index], item]));
      return response(200, {
        items: (photos || []).map((photo: JsonRecord) => ({
          ...photo,
          signedUrl: signedByPath.get(photo.storage_path)?.signedUrl || null,
          signedError: signedByPath.get(photo.storage_path)?.error || null,
        })),
        expiresInSeconds: PHOTO_URL_SECONDS,
      }, origin, true);
    }

    throw new ApiError(400, "unknown_action", "Unknown instructor-dashboard action.");
  } catch (error) {
    return errorResponse(error, origin, true);
  }
});
