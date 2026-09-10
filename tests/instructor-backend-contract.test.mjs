import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const paths = {
  schema: new URL("../backend/supabase/schema.sql", import.meta.url),
  migration: new URL("../backend/supabase/migrations/20260910_instructor_dashboard_v2_1.sql", import.meta.url),
  edge: new URL("../backend/supabase/functions/instructor-dashboard/index.ts", import.meta.url),
  enrollmentEdge: new URL("../backend/supabase/functions/enroll-class/index.ts", import.meta.url),
  config: new URL("../backend/supabase/config.toml", import.meta.url),
};

const [schema, migration, edge, enrollmentEdge, functionConfig] = await Promise.all(
  Object.values(paths).map((path) => fs.readFile(path, "utf8")),
);

const normalizedMigration = migration.replace(/\s+/g, " ").toLowerCase();
const normalizedSchema = schema.replace(/\s+/g, " ").toLowerCase();

const privateTables = [
  "instructor_record_state",
  "instructor_curations",
  "instructor_curation_revisions",
  "instructor_actions",
  "instructor_login_attempts",
  "instructor_purge_operations",
  "instructor_purge_tombstones",
  "target_species_catalog",
];

test("existing-project migration and fresh schema contain the same private dashboard model", () => {
  for (const table of privateTables) {
    for (const [label, sql] of [["migration", normalizedMigration], ["fresh schema", normalizedSchema]]) {
      assert.match(sql, new RegExp(`create table if not exists public\\.${table} \\(`), `${label} is missing ${table}`);
      assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `${label} does not enable RLS on ${table}`);
      assert.match(sql, new RegExp(`revoke all on table [^;]*public\\.${table}[^;]* from public, anon, authenticated`), `${label} does not revoke browser roles on ${table}`);
    }
  }
  assert.match(normalizedMigration, /grant select, insert, update on table public\.class_members to service_role/);
  assert.match(normalizedSchema, /grant select, insert, update on table public\.class_members to service_role/);
  assert.doesNotMatch(normalizedMigration, /grant [^;]* on table public\.instructor_[a-z_]+ to (anon|authenticated)/);
  assert.doesNotMatch(normalizedSchema, /grant [^;]* on table public\.instructor_[a-z_]+ to (anon|authenticated)/);
});

test("student identity and photo paths are hardened before instructor deletion is enabled", () => {
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /new\.id := old\.id/);
    assert.match(sql, /new\.class_id := old\.class_id/);
    assert.match(sql, /new\.owner_id := old\.owner_id/);
    assert.match(sql, /split_part\(new\.storage_path, '\/', 1\) is distinct from new\.owner_id::text/);
    assert.match(sql, /split_part\(new\.storage_path, '\/', 2\) is distinct from new\.transect_id/);
    assert.match(sql, /student_photo_storage_write_allowed\(storage_path, auth\.uid\(\)\)/);
    assert.match(sql, /create trigger protect_photo_lifecycle_trigger/);
    assert.match(sql, /create trigger protect_transect_lifecycle_trigger/);
    assert.match(sql, /instructor_purge_tombstones/);
  }
});

test("curation is versioned, catalog-checked, and cannot silently mask a newer submission", () => {
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /source_submission_count integer not null/);
    assert.match(sql, /student submission changed; reload before curating/);
    assert.match(sql, /archived curation is based on a different student revision/);
    assert.match(sql, /public\.target_species_catalog/);
    assert.match(sql, /curated payload contains a (?:species )?code outside (?:its|the) target catalog/);
    assert.match(sql, /curated payload contains a duplicate unknown identifier/);
    assert.match(sql, /p_payload - 'metadata' - 'segments'/);
    assert.match(sql, /when cur\.active and cur\.source_submission_count = t\.submission_count then cur\.curated_payload/);
    assert.match(sql, /curation_stale/);
  }

  const catalogRows = [...migration.matchAll(/\('reno-2026\.1',\s*'([A-Z0-9_-]+)'\)/g)].map((match) => match[1]);
  assert.equal(catalogRows.length, 23);
  assert.equal(new Set(catalogRows).size, 23);
  assert.ok(!catalogRows.includes("UNKNOWN"));
});

test("student payload validation is bounded and tied to the exact Reno target catalog", () => {
  const expectedCodes = [
    "SATR12", "COMA2", "CANU4", "CESO3", "CEDI3", "CIIN", "CIVU", "CIAR4",
    "ONAC", "CHTE2", "LELA2", "LEDR", "ELAN", "AECY", "BRTE", "POBU",
    "TACA8", "CETE5", "VETH", "AIAL", "TAMAR2", "ULPU", "TRTE",
  ].sort();
  for (const sql of [migration, schema]) {
    const body = sql.match(/create or replace function public\.is_protocol_v2_payload[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)?.[1] || "";
    assert.match(body, /octet_length\(p_payload::text\) > 2000000/i);
    assert.match(body, /jsonb_typeof\(p_payload -> 'metadata'\) is distinct from 'object'/i);
    assert.match(body, /speciesListVersion'\) is distinct from 'reno-2026\.1'/i);
    assert.match(body, /not \(\(value #>> '\{\}'\) = any \(v_target_codes\)\)/i);
    assert.match(body, /public\.is_valid_gps_point\(v_gps\)/i);
    const declaration = body.match(/v_target_codes constant text\[\] := array\[([\s\S]*?)\];/i)?.[1] || "";
    const codes = [...declaration.matchAll(/'([A-Z0-9_-]+)'/g)].map((match) => match[1]).sort();
    assert.deepEqual(codes, expectedCodes);
  }
  assert.match(edge, /payload\.speciesListVersion !== "reno-2026\.1"/);
});

test("permanent purge uses a retryable storage/database boundary and retained tombstone", () => {
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /purge_pending boolean not null default false/);
    assert.match(sql, /status in \('storage_pending', 'completed', 'failed'\)/);
    assert.match(sql, /create or replace function public\.instructor_begin_purge/);
    assert.match(sql, /create or replace function public\.instructor_claim_purge/);
    assert.match(sql, /create or replace function public\.instructor_release_purge/);
    assert.match(sql, /create or replace function public\.instructor_fail_purge/);
    assert.match(sql, /create or replace function public\.instructor_finalize_purge\(p_operation_id uuid, p_lease_token uuid\)/);
    assert.match(sql, /where operation_id = p_operation_id for update/);
    assert.match(sql, /if v_operation\.status = 'completed'/);
    assert.match(sql, /insert into public\.instructor_purge_tombstones/);
    assert.match(sql, /this permanently purged record identifier cannot be reused/);
    assert.match(sql, /grant execute on function [^;]*public\.instructor_finalize_purge\(uuid, uuid\)[^;]*to service_role/);
    assert.match(sql, /from storage\.objects where bucket_id = 'transect-photos' and split_part\(name, '\/', 1\) = v_transect\.owner_id::text and split_part\(name, '\/', 2\) = v_operation\.record_id/);
    assert.doesNotMatch(sql, /delete from storage\.objects/, "Storage objects must be removed through the Storage API, not SQL.");
  }
});

test("successful purge redacts every retained operation for the record", () => {
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /redacted_at timestamptz/);
    assert.match(sql, /status = 'failed' and redacted_at is not null and last_error = '' and record_snapshot = '\{\}'::jsonb and storage_paths = '\[\]'::jsonb/);
    assert.match(sql, /where record_id = v_operation\.record_id and status in \('storage_pending', 'completed', 'failed'\)/);
    assert.match(sql, /redacted_at = coalesce\(redacted_at, completed_at, updated_at, now\(\)\)[^;]*where record_id = v_operation\.record_id and status in \('storage_pending', 'completed', 'failed'\)/);
    assert.match(sql, /from public\.instructor_purge_tombstones tombstone where tombstone\.record_id = operation\.record_id/);
  }
});

test("Edge Function is public only at the gateway and keeps all authority server-side", () => {
  assert.match(functionConfig, /\[functions\.instructor-dashboard\][\s\S]*?verify_jwt\s*=\s*false/);
  assert.match(edge, /Deno\.env\.get\("ALLOWED_ORIGINS"\)/);
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edge, /INSTRUCTOR_(?:PASSWORD|PASSWORD_HASH)/);
  assert.match(edge, /INSTRUCTOR_SESSION_SECRET/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/);
  assert.doesNotMatch(edge, /sb_secret_[A-Za-z0-9_-]{20,}|service_role\s*[:=]\s*["'][A-Za-z0-9._-]{20,}/i);
  assert.match(edge, /Cache-Control["']?\s*:\s*["']no-store["']/);
});

test("student browser roles remain owner-scoped and cannot read instructor-wide data", () => {
  const sql = normalizedSchema;
  assert.match(sql, /create policy "members read only their membership"[^;]*using \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /create policy "owners read their transects"[^;]*using \(owner_id = auth\.uid\(\)\)/);
  assert.match(sql, /create policy "owners update their transects"[^;]*using \(owner_id = auth\.uid\(\)\)[^;]*with check \([^;]*owner_id = auth\.uid\(\)/);
  assert.match(sql, /create policy "owners read their photo metadata"[^;]*using \(owner_id = auth\.uid\(\)\)/);
  assert.match(sql, /create policy "owners read transect photos"[^;]*bucket_id = 'transect-photos'[^;]*owner_id = auth\.uid\(\)::text/);
  assert.match(sql, /revoke all on public\.analysis_export_long from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant select on public\.analysis_export_long to (?:anon|authenticated)/);
});

test("authentication uses bounded HMAC sessions, credential rotation, and an atomic rolling rate limit", () => {
  assert.match(edge, /const SESSION_SECONDS = 30 \* 60/);
  assert.match(edge, /const PURGE_CHALLENGE_SECONDS = 5 \* 60/);
  assert.match(edge, /crypto\.subtle\.sign\("HMAC"/);
  assert.match(edge, /constantTimeEqual\(base64UrlToBytes\(signaturePart\), expected\)/);
  assert.match(edge, /payload\.expiresAt - payload\.issuedAt !== SESSION_SECONDS/);
  assert.match(edge, /payload\?\.credentialVersion !== currentCredentialVersion/);
  assert.match(edge, /configuredPassword\.raw \|\| configuredPassword\.hash/);
  assert.match(edge, /canonicalIp/);
  assert.match(edge, /`instructor-client:\$\{purpose\}:\$\{gatewayAddress\(request\)\}`/);
  assert.match(edge, /hmacHex\(`instructor-global:\$\{purpose\}`, rateSecret\)/);
  assert.match(edge, /p_global_bucket_hash: globalBucketHash/);
  assert.doesNotMatch(edge, /X-Forwarded-For|User-Agent/);
  assert.doesNotMatch(edge, /console\.(?:log|error)\([^)]*(?:password|authorization|token|serviceRoleKey)/i);
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /create or replace function public\.instructor_record_auth_attempt/);
    assert.match(sql, /p_global_bucket_hash text/);
    assert.match(sql, /pg_advisory_xact_lock\(least\(v_subject_lock, v_global_lock\)\)/);
    assert.match(sql, /pg_advisory_xact_lock\(greatest\(v_subject_lock, v_global_lock\)\)/);
    assert.match(sql, /attempted_at > v_now - interval '15 minutes'/);
    assert.match(sql, /case when p_purpose = 'purge' then 5 else 8 end/);
    assert.match(sql, /case when p_purpose = 'purge' then 50 else 200 end/);
    assert.match(sql, /insert into public\.instructor_login_attempts\(subject_hash, global_bucket_hash, purpose, succeeded\)/);
  }
});

test("class enrollment records outcomes atomically with client and global backstops", () => {
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /create or replace function public\.record_enrollment_auth_attempt/);
    assert.match(sql, /pg_advisory_xact_lock\(least\(v_subject_lock, v_global_lock\)\)/);
    assert.match(sql, /v_subject_failures >= 10 or v_global_failures >= 200/);
    assert.match(sql, /insert into public\.enrollment_attempts\(subject_hash, global_bucket_hash, succeeded\)[^;]*p_succeeded/);
    assert.match(sql, /retryafterseconds', greatest\(v_subject_retry, v_global_retry\)/);
    assert.match(sql, /grant execute on function public\.record_enrollment_auth_attempt\(text, text, boolean\) to service_role/);
    assert.match(sql, /revoke all on function public\.record_enrollment_auth_attempt\(text, text, boolean\) from public, anon, authenticated/);
    assert.match(sql, /octet_length\(coalesce\(p_access_code, ''\)\) > 72/);
  }
  assert.match(enrollmentEdge, /const MAX_BODY_BYTES = 4096/);
  assert.match(enrollmentEdge, /const MAX_RESPONSE_BYTES = 4096/);
  assert.match(enrollmentEdge, /readJsonBody\(request\)/);
  assert.match(enrollmentEdge, /Content-Type must be application\/json/);
  assert.match(enrollmentEdge, /mediaType !== "application\/json"/);
  assert.match(enrollmentEdge, /hmacHex\(`enrollment-client:/);
  assert.match(enrollmentEdge, /hmacHex\("enrollment-global-backstop"/);
  assert.match(enrollmentEdge, /canonicalIp/);
  assert.match(enrollmentEdge, /record_enrollment_auth_attempt/);
  assert.match(enrollmentEdge, /"Retry-After": String\(retryAfter\)/);
  assert.match(enrollmentEdge, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(enrollmentEdge, /MAX_CLASS_CODE_BYTES = 72/);
  assert.doesNotMatch(enrollmentEdge, /request\.json\(\)/);
  assert.doesNotMatch(enrollmentEdge, /begin_enrollment_attempt|finish_enrollment_attempt/);
  assert.doesNotMatch(enrollmentEdge, /enrollment_rate_allowed|record_enrollment_attempt/);
  assert.doesNotMatch(enrollmentEdge, /X-Forwarded-For|User-Agent/);
  assert.doesNotMatch(normalizedMigration, /drop function if exists public\.enrollment_rate_allowed|drop function if exists public\.record_enrollment_attempt/);
  assert.match(normalizedMigration, /grant execute on function public\.enrollment_rate_allowed\(text\) to service_role/);
  assert.match(normalizedMigration, /grant execute on function public\.record_enrollment_attempt\(text, boolean\) to service_role/);
});

test("Edge Function rejects silent truncation and implements bounded paging", () => {
  assert.doesNotMatch(edge, /\.limit\((?:5000|10000)\)/);
  assert.doesNotMatch(edge, /cleanIds\([^)]*\)\.slice\(/);
  assert.doesNotMatch(edge, /\.slice\(0,\s*MAX_(?:RECORD_IDS|SIGNED_PHOTOS)\)/);
  assert.match(edge, /list-records/);
  assert.match(edge, /pageSize/);
  assert.match(edge, /totalCount|total|hasMore/);
  assert.match(edge, /MAX_(?:PAGE_SIZE|RECORD_IDS|SIGNED_PHOTOS)/);
  assert.match(edge, /413|too (?:many|large)|maximum/i);
});

test("server filtering, class counts, summaries, and maps cover the complete filtered set", () => {
  assert.match(edge, /speciesCodes must contain 1-23 target codes/);
  assert.match(edge, /query = query\.overlaps\("species_codes", codes\)/);
  assert.match(edge, /\.select\("\*", \{ count: "exact" \}\)/);
  assert.match(edge, /\.order\("record_id", \{ ascending: true \}\)\.range/);
  assert.match(edge, /if \(facetRows\.length !== total\)/);
  assert.match(edge, /mapRecords[\s\S]*mapTotal[\s\S]*mapTruncated[\s\S]*mapLimit/);
  assert.match(edge, /original_submitted_at\.slice\(0, 10\)/);
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /create view public\.instructor_class_summaries/);
    assert.match(sql, /count\(records\.record_id\)::integer as record_count/);
    assert.match(sql, /as active_record_count/);
    assert.match(sql, /as trashed_record_count/);
    assert.match(sql, /grant select on public\.instructor_class_summaries to service_role/);
  }
});

test("class term and submission dates are filtered by exact Reno calendar values", () => {
  assert.match(edge, /"classTerm"/);
  assert.match(edge, /query = query\.eq\("class_term", classTerm\)/);
  assert.match(edge, /"submittedDateFrom", "submission_date_local", "gte"/);
  assert.match(edge, /"submittedDateTo", "submission_date_local", "lte"/);
  assert.match(edge, /parsed\.toISOString\(\)\.slice\(0, 10\) !== value/);
  assert.match(edge, /submission_date_local,.*survey_date/);
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /\(t\.original_submitted_at at time zone 'america\/los_angeles'\)::date as submission_date_local/);
    assert.match(sql, /labeled\.submission_date_local/);
    assert.match(sql, /public\.is_valid_gps_point\(labeled\.effective_payload #> '\{metadata,startgps\}'\) or public\.is_valid_gps_point\(labeled\.effective_payload #> '\{metadata,endgps\}'\) as has_gps/);
  }
});

test("untrusted labels and lookup names cannot reach object prototypes", () => {
  assert.match(edge, /function buildFacets[\s\S]*?const species = new Map<string, number>\(\)/);
  assert.match(edge, /const dates = new Map<string, number>\(\)/);
  assert.match(edge, /const sites = new Map<string, number>\(\)/);
  assert.match(edge, /const trails = new Map<string, number>\(\)/);
  assert.doesNotMatch(edge, /(?:species|dates|sites|trails)\[[^\]]+\]\s*=/);
  assert.match(edge, /const statusColumns = new Map<string, string>/);
  assert.match(edge, /const statusColumn = statusColumns\.get\(surveyStatus\)/);
  assert.match(edge, /const fields = new Map<string, string>/);
  assert.match(edge, /const column = typeof field === "string" \? fields\.get\(field\) : undefined/);
  assert.match(edge, /const versions: JsonRecord = Object\.create\(null\)/);
  assert.match(edge, /Object\.hasOwn\(object, id\)/);
});

test("record detail and exports reject collection truncation and oversized responses", () => {
  assert.match(edge, /fetchSelectedRows/);
  assert.match(edge, /select\(options\.orderColumn, \{ count: "exact", head: true \}\)/);
  assert.match(edge, /\.range\(offset, Math\.min\(offset \+ 499, expected - 1\)\)/);
  assert.match(edge, /if \(rows\.length !== expected\)/);
  assert.match(edge, /const MAX_EXPORT_RESPONSE_BYTES = 5_000_000/);
  assert.match(edge, /if \(exportBytes > MAX_EXPORT_RESPONSE_BYTES\)/);
  assert.match(edge, /new ApiError\(413, "export_size_limit"/);
  assert.match(edge, /if \(\(collection \|\| \[\]\)\.length > DETAIL_COLLECTION_LIMIT\)/);
  assert.match(edge, /const errors = queries\.map\(\(query: any\) => query\.error\)\.filter\(Boolean\)/);
  const detailHandler = edge.slice(
    edge.indexOf('if (action === "record-detail")'),
    edge.indexOf('if (action === "export-records")'),
  );
  assert.match(detailHandler, /admin\.from\("instructor_actions"\)[\s\S]*?\.eq\("record_id", id\)\.neq\("action", "photo_accessed"\)[\s\S]*?\.limit\(DETAIL_COLLECTION_LIMIT \+ 1\)/);
  assert.match(detailHandler, /actions: actionResult\.data \|\| \[\]/);
});

test("curated GPS is validated independently in the Edge Function and SQL", () => {
  assert.match(edge, /function validGpsPoint/);
  assert.match(edge, /point\.latitude < -90 \|\| point\.latitude > 90/);
  assert.match(edge, /point\.longitude < -180 \|\| point\.longitude > 180/);
  assert.match(edge, /point\.accuracy >= 0/);
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /curated gps must contain valid latitude, longitude, and nonnegative accuracy/);
    assert.match(sql, /\(v_gps ->> 'latitude'\)::numeric not between -90 and 90/);
    assert.match(sql, /\(v_gps ->> 'longitude'\)::numeric not between -180 and 180/);
  }
});

test("signed sessions, optimistic writes, and exact purge challenge are enforced", () => {
  assert.match(edge, /credentialVersion|credential[_-]?version/i);
  assert.match(edge, /expiresAt/);
  assert.match(edge, /expectedSubmissionCount/);
  assert.match(edge, /expectedCurationVersion/);
  assert.match(edge, /expectedStateVersion/);
  assert.match(edge, /new ApiError\(409/);
  assert.match(edge, /purge-preview/);
  assert.match(edge, /challenge/);
  assert.match(edge, /pathDigest|storagePathHash|storage[_-]?path[_-]?hash/i);
  assert.match(edge, /instructor_finalize_purge/);
  assert.match(edge, /canonical/i);
  assert.match(edge, /displayHash/);
  assert.match(edge, /purgeDisplayHash\(transect\.payload\) !== item\.displayHash/);
});

test("every audited export and mutation requires the caller's stable request ID", () => {
  const sections = [
    ['if (action === "export-records")', 'if (action === "save-curation")'],
    ['if (action === "save-curation")', 'if (action === "clear-curation")'],
    ['if (action === "clear-curation")', 'if (action === "revert-curation")'],
    ['if (action === "revert-curation")', 'if (action === "save-state")'],
    ['if (action === "save-state")', 'if (action === "trash" || action === "restore")'],
    ['if (action === "trash" || action === "restore")', 'if (action === "purge-preview")'],
    ['if (action === "purge")', 'if (action === "photo-urls")'],
  ];
  for (const [startMarker, endMarker] of sections) {
    const start = edge.indexOf(startMarker);
    const end = edge.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, `missing Edge action section ${startMarker}`);
    assert.match(edge.slice(start, end), /mutationRequestId\(body\.requestId\)/);
  }
});

test("purge photo digest uses one consistent field from preview through finalize", () => {
  const returnsPathDigest = /return\s*\{[\s\S]{0,500}\bpathDigest:\s*await sha256Hex/.test(edge);
  const returnsStoragePathHash = /return\s*\{[\s\S]{0,500}\bstoragePathHash:\s*await sha256Hex/.test(edge);
  assert.notEqual(returnsPathDigest, returnsStoragePathHash, "Photo collection must expose exactly one digest field.");
  const chosen = returnsPathDigest ? "pathDigest" : "storagePathHash";
  assert.match(edge, new RegExp(`(?:record|item)\\.${chosen}`), "The signed purge challenge must consume the collector digest.");
  assert.match(edge, new RegExp(`p_storage_path_digest:\\s*item\\.${chosen}`), "The purge RPC must consume the same digest.");
  const rejected = chosen === "pathDigest" ? "storagePathHash" : "pathDigest";
  assert.doesNotMatch(edge, new RegExp(`(?:record|item)\\.${rejected}`), "Mixed purge digest field names make every challenge unverifiable.");
});

test("permanent purge resumes a persisted operation, verifies Storage is empty, and redacts its ledger", () => {
  assert.match(edge, /\.eq\("status", "storage_pending"\)/);
  assert.match(edge, /existingOperation\?\.status === "storage_pending"/);
  assert.match(edge, /resumablePurgeDescriptor/);
  assert.match(edge, /admin\.storage\.from\(PHOTO_BUCKET\)\.remove/);
  assert.match(edge, /deleteAndVerifyStorage/);
  assert.match(edge, /consecutiveEmptyReads < 2/);
  assert.match(edge, /purge_storage_continuation/);
  assert.match(edge, /remaining\.filter\(\(path\) => !allowed\.has\(path\)\)/);
  assert.match(edge, /database rows were retained/i);
  assert.match(edge, /instructor_finalize_purge/);
  assert.match(edge, /instructor_fail_purge/);
  assert.match(edge, /instructor_claim_purge/);
  assert.match(edge, /instructor_release_purge/);
  assert.match(edge, /apiError\.code === "purge_storage_continuation"/);
  const purgeHandler = edge.slice(
    edge.indexOf('if (action === "purge")'),
    edge.indexOf('if (action === "photo-urls")'),
  );
  assert.match(purgeHandler, /if \(apiError\.code === "purge_storage_continuation"\) \{[\s\S]*?"instructor_release_purge"[\s\S]*?\} else \{[\s\S]*?"instructor_fail_purge"/);
  assert.equal((purgeHandler.match(/"instructor_fail_purge"/g) || []).length, 1);
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.match(sql, /set status = case when status = 'storage_pending' then 'completed' else status end[^;]*storage_paths = '\[\]'::jsonb[^;]*record_snapshot = '\{\}'::jsonb/);
    assert.match(sql, /delete from public\.photos where transect_id = v_operation\.record_id/);
    assert.match(sql, /delete from public\.transects where id = v_operation\.record_id/);
    assert.match(sql, /insert into public\.instructor_purge_tombstones/);
    assert.match(sql, /lease_token uuid/);
    assert.match(sql, /lease_expires_at timestamptz/);
    assert.match(sql, /private storage objects remain; database purge was not finalized/);
    for (const name of ["instructor_claim_purge", "instructor_release_purge", "instructor_fail_purge", "instructor_finalize_purge"]) {
      const start = sql.indexOf(`create or replace function public.${name}`);
      assert.ok(start >= 0, `${name} is missing`);
      const body = sql.slice(start, sql.indexOf("$$;", start) + 3);
      assert.ok(
        body.indexOf("pg_advisory_xact_lock") < body.indexOf("for update"),
        `${name} must acquire its record advisory lock before its row lock`,
      );
    }
  }
});

test("purge inventories and removes arbitrarily large photo sets in bounded pages", () => {
  assert.match(edge, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(edge, /offset \+= PHOTO_METADATA_PAGE_SIZE/);
  assert.match(edge, /\.range\(offset, Math\.min\(offset \+ PHOTO_METADATA_PAGE_SIZE - 1/);
  assert.match(edge, /offset \+= STORAGE_PAGE_SIZE/);
  assert.match(edge, /MAX_STORAGE_DELETE_BATCHES_PER_REQUEST/);
  assert.match(edge, /storagePathsToDelete = currentPhotos\.storagePaths/);
  assert.match(edge, /const fencedPhotos = await collectPhotoPaths/);
  assert.match(edge, /deleteAndVerifyStorage\(admin, purgeTransect, storagePathsToDelete, paths, renewLease\)/);
  assert.doesNotMatch(edge, /MAX_PHOTOS_PER_RECORD|more than 500 photos|jsonb_array_length\(p_storage_paths\) > 500/);
  for (const sql of [normalizedMigration, normalizedSchema]) {
    assert.doesNotMatch(sql, /jsonb_array_length\(p_storage_paths\) > 500/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('photo-purge:' \|\| p_transect_id, 0\)\)/);
    assert.match(sql, /language plpgsql volatile security definer[^$]*student_photo_storage_write_allowed|student_photo_storage_write_allowed[\s\S]*?language plpgsql volatile/s);
    assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('photo-purge:' \|\| v_transect_id, 0\)\)/);
  }
});
