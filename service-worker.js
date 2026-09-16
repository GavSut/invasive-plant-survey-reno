const CACHE_PREFIX = "invasive-transect-app-v";
const CACHE_NAME = "invasive-transect-app-v2.3.2-header-refresh";
const CORE_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./site-refresh.js",
  "./protocol.js",
  "./storage.js",
  "./backend.js",
  "./config.js",
  "./species.js",
  "./manifest.webmanifest",
];

async function downloadCoreFiles() {
  // Bypass the HTTP cache too. Fetch inside a worker does not re-enter its
  // fetch handler. Buffer every file before clearing any offline files.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    return await Promise.all(CORE_FILES.map(async (file) => {
      const response = await fetch(file, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Could not download ${file} (${response.status}).`);
      const type = response.headers.get("Content-Type") || "";
      if (file.endsWith(".js") && !/javascript|ecmascript|text\/plain|application\/octet-stream/i.test(type)) {
        throw new Error(`The server did not return a JavaScript file for ${file}.`);
      }
      if ((file === "./" || file.endsWith(".html")) && !/text\/html/i.test(type)) {
        throw new Error("The server did not return the survey homepage.");
      }
      return [file, new Response(await response.arrayBuffer(), {
        status: response.status, statusText: response.statusText, headers: response.headers,
      })];
    }));
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

async function cacheCoreFiles(files) {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(files.map(([file, response]) => cache.put(file, response)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(downloadCoreFiles().then(cacheCoreFiles).then(() => self.skipWaiting()));
});

let refreshingFiles = null;
self.addEventListener("message", (event) => {
  if (event.data?.type !== "REFRESH_SITE_FILES" || !event.ports[0]) return;
  // Only this app's windows may request a refresh.
  if (!event.source?.url || !event.source.url.startsWith(self.registration.scope)) return;
  if (!refreshingFiles) {
    refreshingFiles = (async () => {
      const files = await downloadCoreFiles();
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)));
      await cacheCoreFiles(files);
    })().finally(() => { refreshingFiles = null; });
  }
  event.waitUntil(refreshingFiles.then(
    () => event.ports[0].postMessage({ ok: true }),
    (error) => event.ports[0].postMessage({ ok: false, error: error.message }),
  ));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

function isBackendRequest(url) {
  return url.hostname.endsWith(".supabase.co");
}

function isOnlineGuideRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const file = url.pathname.split("/").pop();
  return ["guide.html", "guide.js", "guide.css", "species_code_crosswalk.csv"].includes(file)
    || url.pathname.includes("/assets/species/");
}

function isInstructorRequest(url) {
  if (url.origin !== self.location.origin) return false;
  const file = url.pathname.split("/").pop();
  return /^instructor(?:[-.][a-z0-9-]+)*\.(?:html|css|js)$/i.test(file);
}

function offlineInstructorResponse() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Instructor dashboard requires a connection</title><body style="font:18px system-ui;max-width:42rem;margin:3rem auto;padding:1rem"><h1>Instructor dashboard requires a connection</h1><p>The dashboard is online-only. Reconnect to review, curate, or download class data.</p><p>Student field-entry drafts remain available offline.</p><p><a href="./index.html">Return to the survey app</a></p></body></html>`, {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function offlineGuideResponse() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Guide unavailable offline</title><body style="font:18px system-ui;max-width:42rem;margin:3rem auto;padding:1rem"><h1>Species guide needs a connection</h1><p>The field survey, drafts, statuses, and photos still work offline. Reconnect to open the identification guide.</p><p><a href="./index.html">Return to the survey app</a></p></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function networkFirst(request) {
  if (refreshingFiles) await refreshingFiles;
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  if (refreshingFiles) await refreshingFiles;
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && request.method === "GET") {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isBackendRequest(url)) return;
  // Always revalidate repository PDFs; never serve a stale app-cache copy.
  if (url.origin === self.location.origin && url.pathname.endsWith(".pdf")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  if (isInstructorRequest(url)) {
    if (request.mode === "navigate") event.respondWith(fetch(request, { cache: "no-store" }).catch(offlineInstructorResponse));
    else event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  if (isOnlineGuideRequest(url)) {
    if (request.mode === "navigate") event.respondWith(fetch(request).catch(offlineGuideResponse));
    return;
  }
  if (request.mode === "navigate") {
    if (url.searchParams.has("site-refresh")) {
      // The confirmed refresh has already downloaded this page and all its
      // imports. Load that exact fresh copy even if service disappears now.
      event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match("./index.html"))
        .then((cached) => cached || fetch(request, { cache: "no-store" })));
      return;
    }
    event.respondWith(networkFirst(request).catch(() => caches.match("./index.html")));
    return;
  }
  if (url.origin === self.location.origin && ["config.js", "species.js"].includes(url.pathname.split("/").pop())) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.origin === self.location.origin) event.respondWith(cacheFirst(request));
});
