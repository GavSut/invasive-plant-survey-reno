import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MAX_BODY_BYTES = 4096;
const MAX_RESPONSE_BYTES = 4096;
const MAX_CLASS_CODE_BYTES = 72;
const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function response(status: number, body: Record<string, unknown>, origin: string | null, allowed: boolean,
  extraHeaders: Record<string, string> = {}) {
  let serialized = JSON.stringify(body);
  let responseStatus = status;
  if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    responseStatus = 500;
    serialized = JSON.stringify({ error: "Enrollment response exceeded its safe size limit." });
  }
  return new Response(serialized, {
    status: responseStatus,
    headers: {
      ...jsonHeaders,
      ...(allowed && origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Expose-Headers": "Retry-After",
        "Vary": "Origin",
      } : {}),
      ...extraHeaders,
    },
  });
}

async function hmacHex(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalIp(value: string | null) {
  let candidate = String(value || "").split(",", 1)[0].trim().toLowerCase();
  if (!candidate || candidate.length > 128) return "";
  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/);
  if (ipv4WithPort) {
    const octets = ipv4WithPort[1].split(".").map(Number);
    if (octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      return octets.join(".");
    }
    return "";
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

async function readJsonBody(request: Request) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new Error("request_too_large");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_json");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* the 413 result remains authoritative */ }
      throw new Error("request_too_large");
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("invalid_json");
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const originAllowed = Boolean(origin && allowedOrigins.includes(origin));

  if (request.method === "OPTIONS") {
    if (!originAllowed) return response(403, { error: "Origin is not allowed." }, origin, false);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      },
    });
  }
  if (!originAllowed) return response(403, { error: "Origin is not allowed." }, origin, false);
  if (request.method !== "POST") return response(405, { error: "Use POST." }, origin, true);
  const mediaType = (request.headers.get("Content-Type") || "")
    .split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return response(415, { error: "Content-Type must be application/json." }, origin, true);
  }

  let body: Record<string, unknown>;
  try { body = await readJsonBody(request); }
  catch (error) {
    const tooLarge = error instanceof Error && error.message === "request_too_large";
    return response(tooLarge ? 413 : 400, {
      error: tooLarge ? "Request exceeds the 4 KB limit." : "Request body must be a JSON object.",
    }, origin, true);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateSecret = Deno.env.get("RATE_LIMIT_SECRET");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !rateSecret || rateSecret.length < 32) {
    return response(500, { error: "Enrollment function is not fully configured." }, origin, true);
  }

  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return response(401, { error: "A valid anonymous session is required." }, origin, true);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return response(401, { error: "The anonymous session is invalid or expired." }, origin, true);

  const classCode = typeof body.classCode === "string" ? body.classCode.trim() : "";
  if (classCode.length < 12
    || new TextEncoder().encode(classCode).byteLength > MAX_CLASS_CODE_BYTES) {
    return response(400, { error: "The class code is not valid." }, origin, true);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const subjectHash = await hmacHex(`enrollment-client:${gatewayAddress(request)}`, rateSecret);
  const globalBucketHash = await hmacHex("enrollment-global-backstop", rateSecret);

  const { data: classes, error: verifyError } = await admin.rpc("verify_class_code", { p_access_code: classCode });
  if (verifyError) return response(500, { error: "Class-code verification failed." }, origin, true);
  const matched = Array.isArray(classes) ? classes[0] : null;
  const { data: rateStatus, error: rateError } = await admin.rpc("record_enrollment_auth_attempt", {
    p_subject_hash: subjectHash,
    p_global_bucket_hash: globalBucketHash,
    p_succeeded: Boolean(matched),
  });
  if (rateError) return response(500, { error: "Could not verify enrollment limits." }, origin, true);
  if (!rateStatus?.allowed) {
    const retryAfter = Number.isInteger(rateStatus?.retryAfterSeconds)
      ? Math.max(1, rateStatus.retryAfterSeconds) : 900;
    return response(429, { error: "Too many unsuccessful class-code attempts. Wait before retrying." }, origin, true, {
      "Retry-After": String(retryAfter),
    });
  }
  if (!matched) return response(403, { error: "The class code was not recognized." }, origin, true);

  const { error: membershipError } = await admin
    .from("class_members")
    .upsert({
      class_id: matched.class_id,
      user_id: userData.user.id,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "class_id,user_id" });
  if (membershipError) return response(500, { error: "Class membership could not be saved." }, origin, true);

  return response(200, {
    classId: matched.class_id,
    className: matched.class_name,
    term: matched.class_term,
    joinedAt: new Date().toISOString(),
  }, origin, true);
});
