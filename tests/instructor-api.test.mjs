import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  INSTRUCTOR_ACTIONS,
  INSTRUCTOR_SESSION_KEY,
  InstructorApiError,
  changeTrashState,
  clearCuration,
  clearInstructorSession,
  createInstructorRequestId,
  fetchExportRecords,
  fetchInstructorBootstrap,
  fetchRecordDetail,
  loadInstructorSession,
  loginInstructor,
  permanentlyPurge,
  revertCuration,
  saveCuration,
  saveInstructorSession,
  saveRecordState,
} from "../instructor-api.js";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

const originalDescriptors = Object.fromEntries(
  ["fetch", "navigator", "sessionStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeToken(expiresAt = Date.now() + 10 * 60_000) {
  const payload = Buffer.from(JSON.stringify({ expiresAt: Math.floor(expiresAt / 1000) })).toString("base64url");
  return `${payload}.c2lnbmF0dXJl`;
}

function validSession(overrides = {}) {
  return {
    token: makeToken(),
    reviewerName: "Gavin Sutter",
    ...overrides,
  };
}

beforeEach(() => {
  setGlobal("sessionStorage", new MemoryStorage());
  setGlobal("navigator", { onLine: true });
  setGlobal("fetch", async () => jsonResponse({}));
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test("instructor session is tab-scoped, expires locally, and can be explicitly cleared", () => {
  const saved = saveInstructorSession(validSession());
  assert.deepEqual(loadInstructorSession(), saved);
  const persisted = JSON.parse(sessionStorage.getItem(INSTRUCTOR_SESSION_KEY));
  assert.equal(persisted.token, saved.token);
  assert.deepEqual(Object.keys(persisted).sort(), ["reviewerName", "token"]);

  clearInstructorSession();
  assert.equal(loadInstructorSession(), null);

  sessionStorage.setItem(INSTRUCTOR_SESSION_KEY, JSON.stringify(validSession({ token: makeToken(Date.now() - 1) })));
  assert.equal(loadInstructorSession(), null);
  assert.equal(sessionStorage.getItem(INSTRUCTOR_SESSION_KEY), null);
});

test("login requires both reviewer and password and never persists the password", async () => {
  await assert.rejects(() => loginInstructor("", "secret"), /reviewer name/i);
  await assert.rejects(() => loginInstructor("Reviewer", ""), /password/i);

  const calls = [];
  setGlobal("fetch", async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return jsonResponse({ token: makeToken(Date.now() + 60_000), expiresAt: Date.now() + 60_000 });
  });
  const session = await loginInstructor("  Reviewer One  ", "temporary-password");
  assert.equal(session.reviewerName, "Reviewer One");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, INSTRUCTOR_ACTIONS.LOGIN);
  assert.equal(calls[0].body.password, "temporary-password");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.doesNotMatch(sessionStorage.getItem(INSTRUCTOR_SESSION_KEY), /temporary-password/);
});

test("protected requests use the bearer token and a 401 clears the tab session", async () => {
  saveInstructorSession(validSession());
  const calls = [];
  setGlobal("fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    if (body.action === INSTRUCTOR_ACTIONS.RECORD_DETAIL) return jsonResponse({ error: "expired" }, 401);
    return jsonResponse({ classes: [] });
  });

  assert.deepEqual(await fetchInstructorBootstrap(), { classes: [] });
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${loadInstructorSession().token}`);
  assert.match(calls[0].url, /\/functions\/v1\/instructor-dashboard$/);

  await assert.rejects(
    () => fetchRecordDetail("transect_test"),
    (error) => error instanceof InstructorApiError && error.status === 401,
  );
  assert.equal(loadInstructorSession(), null);
});

test("a protected response cannot repopulate the dashboard after sign-out", async () => {
  saveInstructorSession(validSession());
  let releaseResponse;
  setGlobal("fetch", () => new Promise((resolve) => { releaseResponse = resolve; }));

  const pending = fetchInstructorBootstrap();
  await Promise.resolve();
  clearInstructorSession();
  releaseResponse(jsonResponse({ classes: [{ id: "private-class" }] }));

  await assert.rejects(
    () => pending,
    (error) => error instanceof InstructorApiError && error.status === 401,
  );
  assert.equal(loadInstructorSession(), null);
});

test("dashboard API refuses network actions while offline", async () => {
  saveInstructorSession(validSession());
  setGlobal("navigator", { onLine: false });
  let called = false;
  setGlobal("fetch", async () => { called = true; return jsonResponse({}); });
  await assert.rejects(() => fetchInstructorBootstrap(), /requires an internet connection/i);
  assert.equal(called, false);
});

test("every instructor mutation and audited export requires a caller-owned UUID request ID", async () => {
  saveInstructorSession(validSession());
  let called = false;
  setGlobal("fetch", async () => { called = true; return jsonResponse({}); });

  const mutationsWithoutRequestIds = [
    () => fetchExportRecords(["transect_a"], { format: "raw" }),
    () => saveCuration("transect_a", {}, "Correction reason", 1, 0),
    () => clearCuration("transect_a", "Clear reason", 1, 1),
    () => revertCuration("transect_a", 1, "Revert reason", 1, 1),
    () => saveRecordState("transect_a", {
      reviewStatus: "reviewed", testDataStatus: "production", reason: "Review reason",
    }, 0),
    () => changeTrashState(INSTRUCTOR_ACTIONS.TRASH, ["transect_a"], "Trash reason", { transect_a: 0 }),
    () => permanentlyPurge({
      recordIds: ["transect_a"], challenge: "challenge", password: "password",
      reason: "Purge reason", confirmation: "PURGE 1 RECORDS",
    }),
  ];

  for (const mutation of mutationsWithoutRequestIds) {
    await assert.rejects(mutation, /operation request ID is required/i);
  }
  await assert.rejects(
    () => changeTrashState(INSTRUCTOR_ACTIONS.TRASH, ["transect_a"], "Trash reason", { transect_a: 0 }, { requestId: "not-a-uuid" }),
    /operation request ID is required/i,
  );
  assert.equal(called, false);
  assert.match(createInstructorRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("a caller can retry an uncertain mutation with the same request ID", async () => {
  saveInstructorSession(validSession());
  const calls = [];
  setGlobal("fetch", async (_url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) throw new TypeError("network response was lost");
    return jsonResponse({ results: [{ recordId: "transect_a", ok: true }] });
  });

  const invoke = () => changeTrashState(
    INSTRUCTOR_ACTIONS.TRASH,
    ["transect_a"],
    "Synthetic test",
    { transect_a: 3 },
    { requestId: REQUEST_ID },
  );
  await assert.rejects(invoke, /network response was lost/);
  await invoke();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestId, REQUEST_ID);
  assert.equal(calls[1].requestId, REQUEST_ID);
});

test("an audited export forwards one caller-owned ID across an uncertain retry", async () => {
  saveInstructorSession(validSession());
  const calls = [];
  setGlobal("fetch", async (_url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) throw new TypeError("export response was lost");
    return jsonResponse({ transects: [] });
  });

  const invoke = () => fetchExportRecords(
    ["transect_a"],
    { format: "photo-zip", reason: "" },
    { requestId: REQUEST_ID },
  );
  await assert.rejects(invoke, /export response was lost/);
  await invoke();

  assert.deepEqual(calls.map(({ action, recordIds, format, requestId }) => ({ action, recordIds, format, requestId })), [
    { action: INSTRUCTOR_ACTIONS.EXPORT_RECORDS, recordIds: ["transect_a"], format: "photo-zip", requestId: REQUEST_ID },
    { action: INSTRUCTOR_ACTIONS.EXPORT_RECORDS, recordIds: ["transect_a"], format: "photo-zip", requestId: REQUEST_ID },
  ]);
});

test("partial bulk responses are preserved and purge sends its exact challenge", async () => {
  saveInstructorSession(validSession());
  const calls = [];
  setGlobal("fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return jsonResponse({ results: [{ recordId: "transect_a", ok: false }] }, 207);
  });

  const trash = await changeTrashState(INSTRUCTOR_ACTIONS.TRASH, ["transect_a"], "Synthetic test", { transect_a: 3 }, { requestId: REQUEST_ID });
  assert.equal(trash.partial, true);
  assert.deepEqual(calls[0].recordIds, ["transect_a"]);
  assert.deepEqual(calls[0].expectedStateVersions, { transect_a: 3 });

  const purgeRequestId = "223e4567-e89b-42d3-a456-426614174000";
  const purge = await permanentlyPurge({
    recordIds: ["transect_a"],
    challenge: "signed-exact-record-set",
    password: "re-entered-password",
    reason: "Synthetic test cleanup",
    confirmation: "PURGE 1 RECORD: transect_a",
  }, { requestId: purgeRequestId });
  assert.equal(purge.partial, true);
  assert.equal(calls[1].challenge, "signed-exact-record-set");
  assert.deepEqual(calls[1].recordIds, ["transect_a"]);
  assert.equal(calls[1].password, "re-entered-password");
  assert.equal(calls[1].requestId, purgeRequestId);
});
