import { CONFIG, backendIsConfigured } from "./config.js";
import { PROTOCOL_VERSION, SCHEMA_VERSION } from "./protocol.js";
import { getBlob, getSetting, setSetting } from "./storage.js";

const SESSION_KEY = "supabase_session";
const MEMBERSHIP_KEY = "class_membership";

function endpoint(path) {
  return `${CONFIG.supabaseUrl.replace(/\/$/, "")}${path}`;
}

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const message = body?.message || body?.msg || body?.error_description || body?.error || `Request failed (${response.status}).`;
    const error = new Error(String(message));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function expiresSoon(session) {
  const expiresAt = Number(session?.expires_at || 0);
  return !expiresAt || expiresAt * 1000 < Date.now() + 60_000;
}

async function saveSession(session) {
  await setSetting(SESSION_KEY, session);
  return session;
}

export async function refreshSession(session) {
  if (!session?.refresh_token) throw new Error("This phone's submission session has expired. Rejoin the class while online.");
  const response = await fetch(endpoint("/auth/v1/token?grant_type=refresh_token"), {
    method: "POST",
    headers: {
      apikey: CONFIG.supabasePublishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  return saveSession(await parseResponse(response));
}

export async function getSession({ refresh = true } = {}) {
  let session = await getSetting(SESSION_KEY);
  if (refresh && session && expiresSoon(session) && navigator.onLine) session = await refreshSession(session);
  return session;
}

export async function signInAnonymously() {
  if (!backendIsConfigured()) throw new Error("The instructor has not configured the class backend yet.");
  const existing = await getSession();
  if (existing?.access_token) return existing;
  if (!navigator.onLine) throw new Error("The first class enrollment requires an internet connection.");
  const response = await fetch(endpoint("/auth/v1/signup"), {
    method: "POST",
    headers: {
      apikey: CONFIG.supabasePublishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ data: { app: "invasive-plant-transect" } }),
  });
  const body = await parseResponse(response);
  const session = body?.access_token ? body : body?.session;
  if (!session?.access_token) throw new Error("Anonymous sign-in did not return a usable session. Confirm anonymous sign-ins are enabled.");
  return saveSession(session);
}

async function authenticatedFetch(url, options = {}, retry = true) {
  let session = await getSession();
  if (!session?.access_token) session = await signInAnonymously();
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: CONFIG.supabasePublishableKey,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && retry && session.refresh_token) {
    await refreshSession(session);
    return authenticatedFetch(url, options, false);
  }
  return response;
}

export async function enrollInClass(classCode) {
  if (!navigator.onLine) throw new Error("Class enrollment requires an internet connection.");
  const code = String(classCode || "").trim();
  if (!code) throw new Error("Enter the class code.");
  await signInAnonymously();
  const response = await authenticatedFetch(endpoint(`/functions/v1/${CONFIG.enrollmentFunction}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ classCode: code }),
  });
  const membership = await parseResponse(response);
  await setSetting(MEMBERSHIP_KEY, membership);
  return membership;
}

export async function getMembership() {
  return getSetting(MEMBERSHIP_KEY);
}

function photoExtension(photo) {
  const type = photo.mimeType || "image/jpeg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/heic" || type === "image/heif") return "heic";
  return "jpg";
}

async function uploadPhoto(transect, photo, session) {
  const stored = await getBlob(photo.blobId);
  if (!stored?.blob) throw new Error(`Photo ${photo.id} is not available on this phone.`);
  const userId = session.user?.id;
  if (!userId) throw new Error("The anonymous session is missing its user identifier.");
  const storagePath = `${userId}/${transect.id}/${photo.id}.${photoExtension(photo)}`;
  const objectResponse = await authenticatedFetch(
    endpoint(`/storage/v1/object/${CONFIG.photoBucket}/${encodeURI(storagePath)}`),
    {
      method: "POST",
      headers: {
        "Content-Type": stored.blob.type || photo.mimeType || "image/jpeg",
        "x-upsert": "true",
      },
      body: stored.blob,
    },
  );
  await parseResponse(objectResponse);

  const photoRow = {
    id: photo.id,
    transect_id: transect.id,
    owner_id: userId,
    storage_path: storagePath,
    scope: photo.scope,
    segment_index: photo.segmentIndex,
    side: photo.side || null,
    band_start_m: photo.bandStart ?? null,
    species_code: photo.speciesCode || null,
    unknown_id: photo.unknownId || null,
    note: photo.note || null,
    captured_at: photo.capturedAt,
    mime_type: stored.blob.type || photo.mimeType || "image/jpeg",
    size_bytes: stored.blob.size,
  };
  const metadataResponse = await authenticatedFetch(endpoint("/rest/v1/photos?on_conflict=id"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(photoRow),
  });
  await parseResponse(metadataResponse);
  return storagePath;
}

export async function syncTransect(transect, onProgress = () => {}) {
  if (!backendIsConfigured()) throw new Error("The instructor has not configured the class backend yet.");
  if (!navigator.onLine) throw new Error("No internet connection. The transect remains saved on this phone.");
  const membership = await getMembership();
  if (!membership?.classId) throw new Error("Join the class with its class code before uploading.");
  if (transect.schemaVersion !== SCHEMA_VERSION || transect.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error("This saved record uses the retired 5-meter protocol. Start a new 3-meter, 180-cell transect in app version 2.");
  }
  const session = await getSession();
  if (!session?.user?.id) throw new Error("The phone's anonymous session is unavailable.");

  onProgress({ phase: "record", completed: 0, total: (transect.photos?.length || 0) + 1 });
  const serverPayload = structuredClone(transect);
  delete serverPayload.syncStatus;
  delete serverPayload.lastSyncError;
  delete serverPayload.lastSubmittedAt;
  delete serverPayload.serverUpdatedAt;
  for (const photo of serverPayload.photos || []) {
    delete photo.syncStatus;
    delete photo.remotePath;
    delete photo.lastError;
  }
  const row = {
    id: transect.id,
    class_id: membership.classId,
    owner_id: session.user.id,
    payload: serverPayload,
    original_submitted_at: transect.originalSubmittedAt,
    client_modified_at: transect.modifiedAt,
    entry_method: transect.entryMethod,
    protocol_version: transect.protocolVersion,
    species_list_version: transect.speciesListVersion,
  };
  const recordResponse = await authenticatedFetch(endpoint("/rest/v1/transects?on_conflict=id"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(row),
  });
  const records = await parseResponse(recordResponse);
  onProgress({ phase: "record", completed: 1, total: (transect.photos?.length || 0) + 1 });

  const failures = [];
  let completed = 1;
  for (const photo of transect.photos || []) {
    try {
      const storagePath = await uploadPhoto(transect, photo, session);
      photo.remotePath = storagePath;
      photo.syncStatus = "submitted";
    } catch (error) {
      photo.syncStatus = "submission_failed";
      photo.lastError = error.message;
      failures.push({ photoId: photo.id, message: error.message });
    }
    completed += 1;
    onProgress({ phase: "photos", completed, total: (transect.photos?.length || 0) + 1 });
  }
  const finalSyncState = failures.length ? "upload_partially_complete" : "submitted";
  const stateResponse = await authenticatedFetch(endpoint(`/rest/v1/transects?id=eq.${encodeURIComponent(transect.id)}`), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ sync_state: finalSyncState }),
  });
  await parseResponse(stateResponse);
  return { record: records?.[0] || null, photoFailures: failures };
}

export async function fetchOwnTransects() {
  if (!backendIsConfigured()) return [];
  const membership = await getMembership();
  if (!membership?.classId) return [];
  const url = endpoint(`/rest/v1/transects?select=payload,sync_state,original_submitted_at,server_updated_at&class_id=eq.${encodeURIComponent(membership.classId)}&protocol_version=eq.${encodeURIComponent(PROTOCOL_VERSION)}&order=server_updated_at.desc&limit=100`);
  const response = await authenticatedFetch(url);
  const rows = await parseResponse(response);
  return (rows || []).map((row) => {
    const payload = {
      ...row.payload,
      syncStatus: row.sync_state || row.payload.syncStatus,
      originalSubmittedAt: row.original_submitted_at || row.payload.originalSubmittedAt,
      serverUpdatedAt: row.server_updated_at,
    };
    for (const photo of payload.photos || []) {
      photo.syncStatus = row.sync_state === "submitted" ? "submitted" : "pending_upload";
    }
    return payload;
  });
}
