# Architecture and backend choice

## Selected design

The system keeps the existing static GitHub Pages frontend and Supabase backend:

- GitHub Pages serves plain HTML, CSS, ES modules, local guide images, and the service worker.
- IndexedDB stores multiple transects and photo blobs on the phone. The service-worker cache stores only the survey app shell required for offline entry.
- Supabase Anonymous Auth gives each browser profile a stable device-held user ID without student account registration.
- A server-side Edge Function checks the shared class code and enrolls that user ID. The readable class code is never stored in browser source.
- Postgres Row Level Security limits students to records owned by their Auth ID. The instructor uses the dashboard/SQL Editor for class-wide access.
- Private Supabase Storage holds survey photos. Public identification-guide images are separate repository assets.

The browser publishable key is intentionally public. The database password, class code, secret/service-role key, and privileged cleanup credentials must never appear in the repository.

## Options considered

| Option | Security and data | Offline/editing/photos | Maintenance and cost fit | Decision |
| --- | --- | --- | --- | --- |
| **Supabase** | Postgres, Anonymous Auth, RLS, revisions, private Storage | Local IndexedDB queue plus idempotent upsert; owned edits fit naturally | Existing project and instructor-friendly SQL/CSV workflow; verify current free-plan limits each term | **Selected** |
| Firebase | Mature anonymous Auth and client tooling | Strong mobile/offline ecosystem; document exports are less direct | Storage/server features and billing configuration add friction | Viable, but migration adds no value here |
| Cloudflare Workers + D1 + R2 | Good primitives with complete policy control | Would require custom enrollment, ownership, revision, and sync APIs | More code and owner maintenance | Strong custom alternative, not simpler |
| Self-hosted PocketBase | Simple record/file API with full control | Requires a continuously available host | Owner must patch, monitor, secure, and back up a server | Not appropriate for this class workflow |

Official platform references: [Supabase Anonymous Sign-Ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase Storage](https://supabase.com/docs/guides/storage), and [GitHub Pages publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Record and retry model

A transect is uploaded as one versioned JSON document rather than 180 separate requests. Its client-generated `record_id` is the database primary key, so a repeated tap, uncertain response, or later edit upserts the same record. The backend checks protocol `2.0.0`, schema `2`, 30 exact segments, six unique cells per segment, only bands 0–1, 1–2, and 2–3 m, valid cell statuses, and observation/status consistency.

`analysis_export_long` expands current JSON into analysis rows. Every non-detected cell yields one row; a detected cell yields one row per target and/or unknown observation. A complete export therefore represents all 180 unique cell geometries but may contain more than 180 rows.

Before a changed submission replaces the current payload, a trigger copies the former payload to `transect_revisions`. Identical retries do not create a new transect ID.

## Photo failure boundary

The survey document is saved locally first and uploaded before its photos. Every photo has a stable ID and contextual metadata. If an image upload fails, the survey remains stored, the blob remains in IndexedDB, and the record reports partial/failure state. Manual retry reuses the same IDs.

## Guide boundary

The identification guide and its images are public, read-only static files. They are linked before enrollment and from the cell editor, but are intentionally excluded from the mandatory app precache. An offline guide failure returns a clear explanation and never blocks local survey entry.

## Known limits

- A browser must load the app online once before it can reopen the survey shell offline.
- A record that never reaches Supabase is invisible to the instructor; local JSON export is the recovery path.
- Clearing browser storage or losing the phone can remove drafts, pending photos, and the anonymous ownership identity.
- A submission remains accessible from the same browser profile, not automatically from a different phone.
- Physical iPhone/Android acceptance and live RLS isolation remain semester-start checks; source inspection is not a substitute.
