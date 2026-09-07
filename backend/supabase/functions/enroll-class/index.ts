import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function response(status: number, body: Record<string, unknown>, origin: string | null, allowed: boolean) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...(allowed && origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
      } : {}),
    },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rateSecret = Deno.env.get("RATE_LIMIT_SECRET");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !rateSecret) {
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

  let body: { classCode?: unknown };
  try { body = await request.json(); }
  catch { return response(400, { error: "Request body must be JSON." }, origin, true); }
  const classCode = typeof body.classCode === "string" ? body.classCode.trim() : "";
  if (classCode.length < 8 || classCode.length > 128) {
    return response(400, { error: "The class code is not valid." }, origin, true);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const networkSubject = request.headers.get("CF-Connecting-IP")
    || request.headers.get("X-Forwarded-For")?.split(",")[0]
    || "unknown";
  const subjectHash = await sha256(`${networkSubject}|${rateSecret}`);

  const { data: allowed, error: rateError } = await admin.rpc("enrollment_rate_allowed", { p_subject_hash: subjectHash });
  if (rateError) return response(500, { error: "Could not verify enrollment limits." }, origin, true);
  if (!allowed) return response(429, { error: "Too many unsuccessful class-code attempts. Wait 15 minutes before retrying." }, origin, true);

  const { data: classes, error: verifyError } = await admin.rpc("verify_class_code", { p_access_code: classCode });
  const matched = Array.isArray(classes) ? classes[0] : null;
  await admin.rpc("record_enrollment_attempt", { p_subject_hash: subjectHash, p_succeeded: Boolean(matched) });
  if (verifyError) return response(500, { error: "Class-code verification failed." }, origin, true);
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
