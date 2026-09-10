// Owner-only, cutoff-scoped cleanup for disposable pre-v2 survey data.
// Dry-run is the default. No class, membership, auth, policy, or secret rows are touched.
const CUTOFF = "2026-09-09T23:20:10Z";
const CONFIRMATION = `delete-retired-protocol-before-${CUTOFF}`;
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const execute = process.env.CONFIRM_DELETE === CONFIRMATION;

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  throw new Error("Set SUPABASE_URL to the project URL.");
}
if (serviceRoleKey.length < 40) {
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in the shell only. Never paste it into this repository.");
}

const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

const filter = `server_created_at=lte.${encodeURIComponent(CUTOFF)}&protocol_version=neq.2.0.0`;
const transects = await request(`/rest/v1/transects?select=id,protocol_version,server_created_at&${filter}&order=server_created_at.asc`);
const candidates = [];
for (const transect of transects) {
  const photos = await request(`/rest/v1/photos?select=id,storage_path&transect_id=eq.${encodeURIComponent(transect.id)}`);
  candidates.push({ ...transect, photos });
}

console.log(JSON.stringify({
  mode: execute ? "EXECUTE" : "DRY_RUN",
  cutoff: CUTOFF,
  retiredTransects: candidates.length,
  photos: candidates.reduce((sum, item) => sum + item.photos.length, 0),
  records: candidates.map(({ id, protocol_version, server_created_at, photos }) => ({ id, protocol_version, server_created_at, photos: photos.length })),
}, null, 2));

if (!execute) {
  console.log(`Dry run only. Re-run with CONFIRM_DELETE='${CONFIRMATION}' after reviewing the exact IDs above.`);
  process.exit(0);
}

for (const transect of candidates) {
  const objectPaths = transect.photos.map((photo) => photo.storage_path).filter(Boolean);
  if (objectPaths.length) {
    await request("/storage/v1/object/transect-photos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: objectPaths }),
    });
  }
  await request(`/rest/v1/photos?transect_id=eq.${encodeURIComponent(transect.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await request(`/rest/v1/transect_revisions?transect_id=eq.${encodeURIComponent(transect.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  await request(`/rest/v1/transects?id=eq.${encodeURIComponent(transect.id)}&server_created_at=lte.${encodeURIComponent(CUTOFF)}&protocol_version=neq.2.0.0`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  console.log(`Deleted retired survey record ${transect.id} and ${transect.photos.length} photo object(s).`);
}

console.log("Cleanup complete. Classes, class memberships, auth users, policies, secrets, and protocol-v2 records were not targeted.");
