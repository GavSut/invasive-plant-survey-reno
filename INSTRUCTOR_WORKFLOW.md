# Instructor workflow

## Before the semester

1. Resume or create the Supabase project.
2. Run `backend/supabase/schema.sql` after reviewing it.
3. Enable anonymous Auth.
4. Deploy `enroll-class` and set the exact GitHub Pages origin.
5. Create a new class and a new random code with `create_or_rotate_class`.
6. Replace and version `species.js`; update the separate paper species legend.
7. Put the Supabase URL and publishable key in `config.js`.
8. Publish or update GitHub Pages.
9. Print the two-page Word form double-sided or as two separate landscape pages.
10. Test one full record on both iPhone Safari and Android Chrome.

## At the start of lab

1. Assign one designated phone per group per transect.
2. Have each phone open the site online once and join the class.
3. Confirm the offline-ready message appears.
4. Remind students that LEFT/RIGHT always face start → end.
5. Remind students that the 30 rows are ranges 0-1 through 29-30 m.
6. Have students test airplane-mode reopening before leaving service.

## In the field

1. Students capture optional Start GPS.
2. Students enter all 300 cell states; moving forward does not complete cells.
3. A questionable plant receives `UNKNOWN`, a note, and optionally a photo.
4. Students capture optional End GPS and review the summary.
5. If offline, students leave the record queued and export a JSON backup when practical.

## After fieldwork

1. Reconnect each phone.
2. Open **Class & backup** and retry sync.
3. Require the visible `Submitted` status or document `Upload partially complete` for follow-up.
4. Check Supabase `transects` for expected groups and `sync_state`.
5. Review `photos` and the private `transect-photos` bucket.
6. Contact groups whose expected record is missing; a completely local failure cannot appear server-side.

## Data export and review

1. Run the `analysis_export_long` query in `README.md`.
2. Download the result CSV.
3. Check for unexpected `incomplete` statuses and duplicated site/transect combinations.
4. Use `instructor_note` for review comments.
5. If a correction is required, preserve the rationale; the trigger archives the prior payload.
6. Re-export after corrections.

## End of semester

1. Export the long-format view and all backend tables.
2. Download required photos.
3. Save copies in an approved institutional location.
4. Mark the old class inactive.
5. Create a new class record and code for the next term.
6. Check current free-tier limits and resume the project before the next field session.

