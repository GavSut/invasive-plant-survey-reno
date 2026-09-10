import { CONFIG, backendIsConfigured } from "./config.js";

export const INSTRUCTOR_ACTIONS = Object.freeze({
  LOGIN: "login",
  BOOTSTRAP: "bootstrap",
  LIST_RECORDS: "list-records",
  RECORD_DETAIL: "record-detail",
  EXPORT_RECORDS: "export-records",
  SAVE_CURATION: "save-curation",
  CLEAR_CURATION: "clear-curation",
  REVERT_CURATION: "revert-curation",
  SAVE_STATE: "save-state",
  TRASH: "trash",
  RESTORE: "restore",
  PURGE_PREVIEW: "purge-preview",
  PURGE: "purge",
  PHOTO_URLS: "photo-urls",
});

export const INSTRUCTOR_SESSION_KEY = "invasive-plant-instructor-session-v1";
const FUNCTION_NAME = CONFIG.instructorFunction || "instructor-dashboard";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InstructorApiError extends Error {
  constructor(message, { status = 0, code = "", details = null } = {}) {
    super(message);
    this.name = "InstructorApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function endpoint() {
  return `${CONFIG.supabaseUrl.replace(/\/$/, "")}/functions/v1/${FUNCTION_NAME}`;
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); }
    catch { body = { error: text }; }
  }
  if (!response.ok && response.status !== 207) {
    throw new InstructorApiError(
      String(body?.error || body?.message || `Dashboard request failed (${response.status}).`),
      { status: response.status, code: body?.code || "", details: body?.details ?? null },
    );
  }
  return { body: body || {}, partial: response.status === 207, status: response.status };
}

async function request(action, payload = {}, { token = "", signal } = {}) {
  if (!backendIsConfigured()) {
    throw new InstructorApiError("The Supabase project is not configured in config.js.");
  }
  if (!navigator.onLine) {
    throw new InstructorApiError("The instructor dashboard requires an internet connection.");
  }
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.supabasePublishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
    credentials: "omit",
    signal,
    body: JSON.stringify({ action, ...payload }),
  });
  return parseResponse(response);
}

function tokenExpiresAt(token) {
  try {
    const encoded = String(token || "");
    if (encoded.length > 4096) return 0;
    const [payloadPart, signaturePart, ...extra] = encoded.split(".");
    if (!payloadPart || !signaturePart || extra.length) return 0;
    if (!/^[A-Za-z0-9_-]+$/.test(payloadPart)) return 0;
    const padding = "=".repeat((4 - (payloadPart.length % 4)) % 4);
    const json = atob(payloadPart.replaceAll("-", "+").replaceAll("_", "/") + padding);
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (character) => character.charCodeAt(0))));
    return Number.isInteger(payload?.expiresAt) ? payload.expiresAt * 1000 : 0;
  } catch { return 0; }
}

function normalizedSession(value) {
  return {
    token: String(value?.token || ""),
    reviewerName: String(value?.reviewerName || "").trim(),
    expiresAt: tokenExpiresAt(value?.token),
  };
}

function validSession(value) {
  return Boolean(
    value && typeof value.token === "string" && value.token.includes(".")
    && typeof value.reviewerName === "string" && value.reviewerName.trim().length >= 2
    && Number(value.expiresAt) > Date.now() + 5_000,
  );
}

export function loadInstructorSession() {
  let persisted = null;
  try { persisted = JSON.parse(sessionStorage.getItem(INSTRUCTOR_SESSION_KEY) || "null"); }
  catch { sessionStorage.removeItem(INSTRUCTOR_SESSION_KEY); }
  const session = normalizedSession(persisted);
  if (!validSession(session)) {
    sessionStorage.removeItem(INSTRUCTOR_SESSION_KEY);
    return null;
  }
  return session;
}

export function saveInstructorSession(session) {
  const normalized = normalizedSession(session);
  if (!validSession(normalized)) throw new InstructorApiError("The server did not return a usable instructor session.");
  sessionStorage.setItem(INSTRUCTOR_SESSION_KEY, JSON.stringify({
    token: normalized.token,
    reviewerName: normalized.reviewerName,
  }));
  return normalized;
}

export function clearInstructorSession() {
  sessionStorage.removeItem(INSTRUCTOR_SESSION_KEY);
}

export function createInstructorRequestId() {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id || !UUID_PATTERN.test(id)) {
    throw new InstructorApiError("This browser cannot create a secure instructor operation ID.");
  }
  return id;
}

function requiredRequestId(value) {
  const id = String(value || "");
  if (!UUID_PATTERN.test(id)) {
    throw new InstructorApiError("A valid instructor operation request ID is required.");
  }
  return id;
}

export async function loginInstructor(reviewerName, password, { signal } = {}) {
  const reviewer = String(reviewerName || "").trim();
  if (reviewer.length < 2) throw new InstructorApiError("Enter an instructor or reviewer name.");
  if (!String(password || "")) throw new InstructorApiError("Enter the instructor password.");
  const { body } = await request(INSTRUCTOR_ACTIONS.LOGIN, { reviewerName: reviewer, password: String(password) }, { signal });
  return saveInstructorSession({
    token: body.token,
    reviewerName: body.reviewerName || reviewer,
    expiresAt: body.expiresAt,
  });
}

async function protectedRequest(action, payload = {}, options = {}) {
  const session = loadInstructorSession();
  if (!session) throw new InstructorApiError("Instructor session is invalid or expired. Sign in again.", { status: 401 });
  try {
    const result = await request(action, payload, { ...options, token: session.token });
    const current = loadInstructorSession();
    if (!current || current.token !== session.token) {
      throw new InstructorApiError("Instructor session ended while the request was running. Sign in again.", { status: 401 });
    }
    return result;
  } catch (error) {
    if (error?.status === 401) clearInstructorSession();
    throw error;
  }
}

async function protectedMutationRequest(action, payload, options = {}) {
  const { requestId, ...requestOptions } = options || {};
  return protectedRequest(action, { ...payload, requestId: requiredRequestId(requestId) }, requestOptions);
}

export async function fetchInstructorBootstrap(options) {
  return (await protectedRequest(INSTRUCTOR_ACTIONS.BOOTSTRAP, {}, options)).body;
}

export async function listInstructorRecords({ page = 1, pageSize = 50, filters = {}, sort = {} } = {}, options) {
  return (await protectedRequest(INSTRUCTOR_ACTIONS.LIST_RECORDS, { page, pageSize, filters, sort }, options)).body;
}

export async function fetchRecordDetail(recordId, options) {
  return (await protectedRequest(INSTRUCTOR_ACTIONS.RECORD_DETAIL, { recordId }, options)).body;
}

export async function fetchExportRecords(recordIds, { format = "raw", reason = "" } = {}, options) {
  return (await protectedMutationRequest(INSTRUCTOR_ACTIONS.EXPORT_RECORDS, { recordIds, format, reason }, options)).body;
}

export async function saveCuration(recordId, curatedPayload, reason, expectedSubmissionCount, expectedCurationVersion, options) {
  return (await protectedMutationRequest(INSTRUCTOR_ACTIONS.SAVE_CURATION, {
    recordId, curatedPayload, reason, expectedSubmissionCount, expectedCurationVersion,
  }, options)).body;
}

export async function clearCuration(recordId, reason, expectedSubmissionCount, expectedCurationVersion, options) {
  return (await protectedMutationRequest(INSTRUCTOR_ACTIONS.CLEAR_CURATION, {
    recordId, reason, expectedSubmissionCount, expectedCurationVersion,
  }, options)).body;
}

export async function revertCuration(recordId, revisionId, reason, expectedSubmissionCount, expectedCurationVersion, options) {
  return (await protectedMutationRequest(INSTRUCTOR_ACTIONS.REVERT_CURATION, {
    recordId, revisionId, reason, expectedSubmissionCount, expectedCurationVersion,
  }, options)).body;
}

export async function saveRecordState(recordId, values, expectedStateVersion, options) {
  return (await protectedMutationRequest(INSTRUCTOR_ACTIONS.SAVE_STATE, {
    recordId,
    expectedStateVersion,
    reviewStatus: values.reviewStatus,
    excludedFromAnalysis: Boolean(values.excludedFromAnalysis),
    testDataStatus: values.testDataStatus,
    flags: values.flags || [],
    instructorNote: values.instructorNote || "",
    reason: values.reason || "",
  }, options)).body;
}

export async function changeTrashState(action, recordIds, reason, expectedStateVersions = {}, options) {
  if (![INSTRUCTOR_ACTIONS.TRASH, INSTRUCTOR_ACTIONS.RESTORE].includes(action)) throw new Error("Invalid trash action.");
  const result = await protectedMutationRequest(action, { recordIds, reason, expectedStateVersions }, options);
  return { ...result.body, partial: result.partial };
}

export async function previewPurge(recordIds, options) {
  return (await protectedRequest(INSTRUCTOR_ACTIONS.PURGE_PREVIEW, { recordIds }, options)).body;
}

export async function permanentlyPurge({ recordIds, challenge, password, reason, confirmation }, options) {
  const result = await protectedMutationRequest(INSTRUCTOR_ACTIONS.PURGE, {
    recordIds, challenge, password, reason, confirmation,
  }, options);
  return { ...result.body, partial: result.partial };
}

export async function fetchPhotoUrls(photoIds, options) {
  return (await protectedRequest(INSTRUCTOR_ACTIONS.PHOTO_URLS, { photoIds }, options)).body;
}
