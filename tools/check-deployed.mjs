const base = process.argv[2];
if (!base) {
  console.error("Usage: node tools/check-deployed.mjs https://USERNAME.github.io/REPOSITORY/");
  process.exit(2);
}
const url = new URL(base);
if (url.protocol !== "https:") throw new Error("Use the final HTTPS GitHub Pages URL.");
if (!url.pathname.endsWith("/")) url.pathname += "/";

const targets = ["", "index.html", "app.js", "protocol.js", "species.js", "service-worker.js", "manifest.webmanifest"];
for (const target of targets) {
  const address = new URL(target, url);
  const response = await fetch(address, { redirect: "follow", cache: "no-store" });
  if (!response.ok) throw new Error(`${address} returned ${response.status}.`);
  const type = response.headers.get("content-type") || "";
  if (target.endsWith(".js") && !/javascript|text\/plain|application\/octet-stream/.test(type)) {
    throw new Error(`${address} has unexpected Content-Type ${type}.`);
  }
}
console.log(JSON.stringify({ deployedUrl: url.href, https: true, requiredAssets: "pass" }));

