import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../service-worker.js", import.meta.url), "utf8");
const refreshSource = (await fs.readFile(new URL("../site-refresh.js", import.meta.url), "utf8"))
  .replace("export async function", "async function");

function fixture({ failFile = "", htmlScript = false } = {}) {
  const handlers = new Map();
  const cached = new Map([
    ["invasive-transect-app-v2.3.2-home-refresh", new Map([["./app.js", "old app"]])],
    ["invasive-transect-app-v2.3.2-pdf-resources", new Map([["./app.js", "older app"]])],
    ["another-site", new Map([["./app.js", "unrelated app"]])],
  ]);
  const requests = [];
  const scope = "https://example.test/invasive-plant-survey-reno/";
  const context = vm.createContext({
    self: { registration: { scope }, location: { origin: "https://example.test" },
      addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: {
      keys: async () => [...cached.keys()],
      delete: async (key) => cached.delete(key),
      open: async (key) => {
        if (!cached.has(key)) cached.set(key, new Map());
        return {
          put: async (file, response) => cached.get(key).set(file, await response.text()),
          match: async (file) => cached.get(key).get(file),
        };
      },
    },
    fetch: async (file, options) => {
      requests.push({ file, options });
      if (file === failFile) throw new Error("Connection lost");
      const type = file.endsWith(".js") && !htmlScript ? "application/javascript" : "text/html";
      return new Response(`fresh ${file}`, { headers: { "Content-Type": type } });
    },
    Response, AbortController, setTimeout, clearTimeout,
  });
  vm.runInContext(source, context);
  async function refresh() {
    let reply;
    let work;
    handlers.get("message")({ data: { type: "REFRESH_SITE_FILES" }, source: { url: `${scope}index.html` },
      ports: [{ postMessage: (message) => { reply = message; } }], waitUntil: (promise) => { work = promise; } });
    await work;
    return reply;
  }
  return { cached, requests, refresh };
}

test("refresh replaces stale app files from network and leaves other sites' caches alone", async () => {
  const { cached, requests, refresh } = fixture();
  assert.equal((await refresh()).ok, true);
  assert.equal(cached.get("invasive-transect-app-v2.3.2-home-refresh").get("./app.js"), "fresh ./app.js");
  assert.equal(cached.get("invasive-transect-app-v2.3.2-home-refresh").get("./site-refresh.js"), "fresh ./site-refresh.js");
  assert.equal(cached.has("invasive-transect-app-v2.3.2-pdf-resources"), false);
  assert.equal(cached.get("another-site").get("./app.js"), "unrelated app");
  assert.ok(requests.some(({ file }) => file === "./index.html"));
  assert.ok(requests.some(({ file }) => file === "./styles.css"));
  assert.ok(requests.every(({ options }) => options.cache === "no-store"));
});

for (const options of [{ failFile: "./app.js" }, { htmlScript: true }]) {
  test(`failed refresh preserves old cache: ${JSON.stringify(options)}`, async () => {
    const { cached, refresh } = fixture(options);
    assert.equal((await refresh()).ok, false);
    assert.equal(cached.get("invasive-transect-app-v2.3.2-home-refresh").get("./app.js"), "old app");
    assert.equal(cached.get("invasive-transect-app-v2.3.2-pdf-resources").get("./app.js"), "older app");
  });
}

for (const success of [true, false]) {
  test(`page navigates only after the worker confirms fresh files: ${success}`, async () => {
    const events = [];
    const worker = { state: "activated", addEventListener() {}, removeEventListener() {},
      postMessage(message, ports) {
        assert.equal(message.type, "REFRESH_SITE_FILES");
        events.push("worker refresh");
        ports[0].postMessage({ ok: success, error: success ? undefined : "Connection lost" });
      },
    };
    const context = vm.createContext({
      navigator: { onLine: true, serviceWorker: { register: async (script, options) => {
        assert.equal(script, "./service-worker.js");
        assert.equal(options.updateViaCache, "none");
        events.push("register");
        return { active: worker, update: async () => { events.push("check update"); } };
      } } },
      window: { location: { href: "https://example.test/invasive-plant-survey-reno/index.html", replace: (url) => {
        const target = new URL(url);
        assert.equal(target.pathname, "/invasive-plant-survey-reno/");
        assert.ok(target.searchParams.has("site-refresh"));
        events.push("navigate");
      } } },
      URL, MessageChannel, setTimeout, clearTimeout,
    });
    vm.runInContext(refreshSource, context);
    const work = vm.runInContext("refreshSiteFiles()", context);
    if (success) await work;
    else await assert.rejects(work, /Connection lost/);
    assert.deepEqual(events, success
      ? ["register", "check update", "worker refresh", "navigate"]
      : ["register", "check update", "worker refresh"]);
  });
}
