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
  if (!target.match(/\.(jpg|png|webp)$/)) contents.set(target, await response.text());
}

const protocol = contents.get("protocol.js") || "";
if (!protocol.includes('PROTOCOL_VERSION = "2.0.0"') || !protocol.includes("TOTAL_CELLS") || /start:\s*[34],\s*end:\s*[45]/.test(protocol)) {
  throw new Error("Deployed protocol is not the three-band v2 release.");
}
const species = contents.get("species.js") || "";
const recordCount = (species.match(/\brecord\(\{/g) || []).length;
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
if (!worker.includes("invasive-transect-app-v2.0.0") || /guide\.html|assets\/species/.test(core)) {
  throw new Error("Deployed offline cache version/boundary is incorrect.");
}

console.log(JSON.stringify({
  deployedUrl: url.href,
  https: true,
  appProtocol: "2.0.0",
  speciesTargets: recordCount,
  guideImages: imagePaths.length,
  requiredAssets: "pass",
}, null, 2));
