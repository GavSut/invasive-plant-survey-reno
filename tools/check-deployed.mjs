const base = process.argv[2];
if (!base) {
  console.error("Usage: node tools/check-deployed.mjs https://USERNAME.github.io/REPOSITORY/");
  process.exit(2);
}
const url = new URL(base);
if (url.protocol !== "https:") throw new Error("Use the final HTTPS GitHub Pages URL.");
if (!url.pathname.endsWith("/")) url.pathname += "/";

const targets = [
  "", "index.html", "styles.css", "app.js", "protocol.js", "storage.js", "backend.js", "config.js", "species.js",
  "service-worker.js", "manifest.webmanifest", "guide.html", "guide.css", "guide.js", "data/species_code_crosswalk.csv",
  "instructor.html", "instructor.css", "instructor.js", "instructor-api.js", "instructor-data.js",
  "instructor-downloads.js", "instructor-map.js",
];
const contents = new Map();
for (const target of targets) {
  const address = new URL(target, url);
  const response = await fetch(address, { redirect: "follow", cache: "no-store" });
  if (!response.ok) throw new Error(`${address} returned ${response.status}.`);
  const type = response.headers.get("content-type") || "";
  if (target.endsWith(".js") && !/javascript|text\/plain|application\/octet-stream/.test(type)) {
    throw new Error(`${address} has unexpected Content-Type ${type}.`);
  }
  if (target.endsWith(".css") && !/text\/css|text\/plain|application\/octet-stream/.test(type)) {
    throw new Error(`${address} has unexpected Content-Type ${type}.`);
  }
  if (!target.match(/\.(jpg|png|webp)$/)) contents.set(target, await response.text());
}

const instructorHtml = contents.get("instructor.html") || "";
const instructorEntry = contents.get("instructor.js") || "";
if (!instructorHtml.includes('href="./instructor.css"') || !instructorHtml.includes('src="./instructor.js"')) {
  throw new Error("Deployed instructor.html does not reference its local stylesheet and entry module.");
}
for (const module of ["instructor-api.js", "instructor-data.js", "instructor-downloads.js", "instructor-map.js"]) {
  if (!instructorEntry.includes(`./${module}`) || !(contents.get(module) || "").trim()) {
    throw new Error(`Deployed instructor module graph is incomplete at ${module}.`);
  }
}
if (!(contents.get("instructor.css") || "").trim()) {
  throw new Error("Deployed instructor.css is empty.");
}

const protocol = contents.get("protocol.js") || "";
if (!protocol.includes('PROTOCOL_VERSION = "2.0.0"') || !protocol.includes("TOTAL_CELLS") || /start:\s*[34],\s*end:\s*[45]/.test(protocol)) {
  throw new Error("Deployed protocol is not the three-band v2 release.");
}
const app = contents.get("app.js") || "";
const index = contents.get("index.html") || "";
const config = contents.get("config.js") || "";
if (/guide\.html|data-guide-link|ID guide|identification guide/i.test(`${app}\n${index}`)) {
  throw new Error("The deployed student interface still advertises the identification guide.");
}
if (!app.includes('href="./instructor.html"') || !config.includes('appVersion: "2.1.2"')) {
  throw new Error("The deployed student interface is not the 2.1.2 instructor-dashboard release.");
}
const supabaseUrl = config.match(/supabaseUrl:\s*"(https:\/\/[a-z0-9-]+\.supabase\.co)"/i)?.[1];
const publishableKey = config.match(/supabasePublishableKey:\s*"([^"]+)"/)?.[1];
if (!supabaseUrl || !publishableKey) {
  throw new Error("Deployed config.js does not contain its browser-safe Supabase connection values.");
}
// Exact media-type rejection is a safe, non-mutating fingerprint of the
// updated functions. It also proves both are deployed with gateway JWT
// verification disabled; otherwise the gateway rejects this probe first.
for (const functionName of ["enroll-class", "instructor-dashboard"]) {
  const probe = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Origin: url.origin,
      apikey: publishableKey,
      "Content-Type": "application/jsonp",
    },
    body: "{}",
  });
  if (probe.status !== 415) {
    throw new Error(`Deployed ${functionName} did not return 415 to the version probe (received ${probe.status}). Redeploy the updated function with Verify JWT off.`);
  }
}
const species = contents.get("species.js") || "";
// Count only catalog entries, not the `function record({ ... })` helper.
const recordCount = (species.match(/^\s{2}record\(\{/gm) || []).length;
if (recordCount !== 23 || !species.includes('SPECIES_LIST_VERSION = "reno-2026.1"')) {
  throw new Error(`Deployed catalog is incorrect (${recordCount} target records).`);
}
const imagePaths = [...species.matchAll(/image\("([^"\n]+)"/g)].map((match) => `assets/species/${match[1]}`);
if (imagePaths.length !== 38) throw new Error(`Deployed catalog references ${imagePaths.length} images, expected 38.`);
for (const target of imagePaths) {
  const address = new URL(target, url);
  const response = await fetch(address, { method: "HEAD", redirect: "follow", cache: "no-store" });
  if (!response.ok) throw new Error(`${address} returned ${response.status}.`);
  if (!/^image\//.test(response.headers.get("content-type") || "")) throw new Error(`${address} is not served as an image.`);
}
if (!(contents.get("guide.html") || "").includes("23 targets") || !(contents.get("guide.js") || "").includes("source and reuse record")) {
  throw new Error("Deployed identification guide is incomplete.");
}
const worker = contents.get("service-worker.js") || "";
const core = worker.match(/const CORE_FILES = \[[\s\S]*?\];/)?.[0] || "";
if (
  !worker.includes("invasive-transect-app-v2.1.2")
  || /guide\.html|assets\/species|instructor(?:[-.])/.test(core)
  || !worker.includes("offlineInstructorResponse")
  || !worker.includes("isInstructorRequest")
) {
  throw new Error("Deployed offline cache version/boundary is incorrect.");
}

console.log(JSON.stringify({
  deployedUrl: url.href,
  https: true,
  appVersion: "2.1.2",
  appProtocol: "2.0.0",
  speciesTargets: recordCount,
  guideImages: imagePaths.length,
  requiredAssets: "pass",
  edgeFunctions: "updated / verify-jwt-off",
}, null, 2));
