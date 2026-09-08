# Update the Reno site to 1.0.1

This package is ready for the existing repository:
https://github.com/GavSut/invasive-plant-survey-reno

## What is fixed

- Cell editor Close buttons and confirmation-dialog Cancel/Continue buttons can perform their native actions again. This also repairs the confirmation step for batch 0/NS marking, replacing observations, submitting with acknowledged blanks, and replacing an existing local backup.
- Previous, Next, and direct segment selection update both the page heading and the small header label.
- The offline cache version is bumped so previously used phones can download the corrected JavaScript.

## Upload

1. Unzip `invasive-plant-survey-reno-v1.0.1.zip` on your computer.
2. Open your existing repository. Choose **Add file → Upload files**.
3. Upload the extracted files into the repository root, where `index.html` already lives. Do not upload the ZIP itself or add an extra enclosing folder.
4. For only this fix, replace `app.js`, `config.js`, `service-worker.js`, and `package.json`; also include `tests/app-interactions.test.mjs`, `README.md`, `TESTING.md`, and this `UPDATE.md` to retain the regression tests and documentation. You can upload the complete package if you have made no other custom changes since the original code delivery.
5. Preserve any custom species-list edits. If you changed backend settings in `config.js`, retain those values and change only its `appVersion` to `1.0.1`.
6. Commit with a message such as `Fix dialog controls and segment navigation (1.0.1)`.
7. Wait for the repository's Pages deployment to finish successfully, then open https://gavsut.github.io/invasive-plant-survey-reno/.

There is no database migration, class-code rotation, or Supabase function redeployment for this patch. The packaged config retains your existing project URL and publishable browser key.

## Refresh phones after deployment

1. While online, open or reload the app so the browser checks the updated service worker and downloads its app cache. Allow that first load to finish.
2. Close all tabs/windows for this app (including an installed copy), then reopen the site while still online. An already-open page may continue running the previous JavaScript until it is reopened.
3. In **Class & backup → Current versions**, confirm **App: 1.0.1**. Because configuration can update before the page's JavaScript does, also perform the button checks below.
4. If the controls still behave like the old version, reload online and reopen again after the download completes. Do not clear website data: that can erase locally saved drafts and the phone's anonymous submission session.

The app-file cache update does not clear saved transects, photo blobs, or class membership stored in IndexedDB. Keep a local backup before clearing any browser data.

## Post-deployment smoke test

Use a local draft clearly named TEST. No backend submission is needed for these checks.

1. Open a cell, add a species, tap the top ×, and verify the editor closes and the code remains. Reopen the cell and verify the bottom **Close** button also works.
2. Tap an **Incomplete cells = 0** shortcut. Tap **Cancel** and confirm nothing changed. Repeat and confirm the action: only incomplete cells in the chosen scope should become 0. Repeat with NS on another segment.
3. In a cell with a detection, choose 0. Confirm **Cancel** preserves the observation; repeating and accepting **Replace cell** changes it to 0.
4. Navigate Next, Previous, and directly to 29-30 m. The small header and large segment heading should match each time; navigating must not complete cells.
5. Open Summary on an incomplete draft and choose Submit. Confirm the acknowledgement checkbox enables **Submit with blanks**, and that **Cancel** closes the warning without submitting.
6. Reload and reopen the draft. Confirm its species and 0/NS/incomplete states remain. Reopening starts navigation at 0-1 m.

Camera/GPS, airplane mode, real class submission, failed-upload retry, and cross-group access checks are listed in `TESTING.md`; they have not been certified by this patch's Node tests.

## Automated checks

With Node.js installed, run `npm test` and `npm run validate` from the extracted folder. No dependency installation is required. Release result: **13 tests passed; project validation passed**. The new regression tests failed on the original bugs before the corrections were applied.
