# Android feedback fixes

Date: 2026-10-08. Branch: `codex/mobile-first-clipper`. No stage-3 resolvers.

## Xiaohongshu diagnosis

User example: `https://xhslink.cn/o/67FUe8cMQ4h`.
Anonymous HTTP inspection confirmed:

- `.cn` short links were not recognized by the mobile resolver selection or
  short-link canonical trust rules. They could fall directly to generic HTML
  extraction, which cannot read an SSR note stored in script data.
- The previous Chrome desktop user-agent produced an HTTP-200 login page in a
  live Node request. A public Android browser user-agent returned the article.
  This is a server-dependent observation, not a guarantee against restrictions.
- The actual Android-UA response stores the article in
  `window.__INITIAL_STATE__.noteData.data.noteData`, not `note.noteDetailMap`.
  It also uses `user.nickName`, `routeQuery.xsec_token` and H5 image variants.
- The desktop-style response contains the existing `noteDetailMap` structure,
  undefined values and WB image variants. Both response structures are covered
  by reduced fixtures with identities/tokens/expiring CDN links anonymized.

Fixes recognize `.cn`, use an Android UA for XHS HTML requests, support both
initialization layouts, preserve access parameters, derive canonical metadata
from mobile SSR when requestUrl hides redirects, and extract real title/body/
author/image data. HTTP redirects and bounded trusted short-link HTML redirects
are supported. State parsing reads a balanced object without executing scripts;
quoted undefined/NaN text survives. Only an empty `new Map([])` literal is handled,
not arbitrary JavaScript expressions. Exact requested note selection prevents
accidentally extracting the first recommendation.

Quality thresholds were not relaxed. No placeholder body is fabricated.
Explicit unavailable-page responses fail; missing usable SSR and an empty visible
page fail rather than letting generic extraction save script content. Errors
mention HTTP/extraction details and possible access restrictions. The existing
queue retains failed tasks for retry and permitted desktop fallback.

## Title filenames and compatibility

New saves prefer the extracted title through existing normalization/sanitization.
Windows reserved names are guarded and collision suffixes fit Android filename
byte limits. With a foreign or different-task same-title file, the new filename
adds the full stable task ID, e.g. `Article (task-id).md`; an additional counter is
used if that path is also occupied. Existing content is never overwritten.
No usable title falls back to `Clip-task-id.md`.

`sts_id` remains unchanged in YAML. Before any save or repeat network request,
the pipeline checks the old `Clip-task-id.md` path and then performs a read-only
ownership lookup in the task's snapshotted note folder. This is explicit task
lookup, not task discovery from Markdown and not a whole-Vault or startup scan.
Title changes and user renaming within that folder do not make a second note.
User moves to a different folder are outside this lookup's scope.

- Old completed tasks/receipts remain completed; their notes are not renamed.
- A retry recognizes an already saved old-format task note and leaves it intact.
- New pending/failed work uses title naming when it has no existing result.
- Shared attachment placement still receives the actual final note path.
- Queue leases, stable IDs and immutable completion receipts remain in use.
- Local concurrent saves of one task reuse the owned result. As previously
  documented, asynchronous multi-device file sync cannot guarantee a distributed
  exactly-once transaction. Offline devices may race or create provider conflict
  copies. A conflicting write fails safely and retains the task for retry.

## Verification

- Default suite: **90 passed, 1 skipped**, across 12 files. The opt-in live test is
  skipped normally so CI does not depend on an external post or network access.
- Opt-in live test: **1 passed**, fetching the user's current anonymous page
  with Android-UA headers and replaying its real HTML through mobile conversion
  and the shared saver. Vault and image-download bytes are mocked. This proves
  real HTML compatibility in Node, NOT Android requestUrl or live image fetching.
- `npm run build`: passes TypeScript checking and production bundle.
- `npm run lint`: passes. No Android device test was run by the agent.

Changed production files: `src/{content-converter,downloader,mobile-clipper,mobile-http,url-normalizer}.ts`.
Tests: `tests/{mobile-clipper,clipping-flow}.test.ts`, new
`tests/note-filenames.test.ts`, new `tests/fixtures/{xhs-share,xhs-mobile-share}.html`.
Reports: this file and the acceptance report follow-up.

## Phone retest

1. Install the updated package and reload the plugin. In the task window retry
   the failed XHS task for the provided link. Check the title, actual description,
   image and task result. Do not remove the queue manually.
2. With the computer off, share a WeChat article not previously clipped. Expect
   an article-title Markdown filename with `sts_id` in YAML. Re-share it and verify
   one note only. Old completed `Clip-...md` files intentionally keep their names.
3. Test an article whose title already names a user note. That note must remain
   unchanged and the clip must use a nonconflicting name. Retry/re-share to verify
   no further duplicate. Check relative attachments open correctly.
4. Try an unavailable/restricted XHS link or disable networking. Expect a failed
   retained task and understandable error, not a fake success. Verify optional
   desktop fallback after sync and verify successful mobile clips stay completed.

Await the user's next Android results. Stage 3 remains paused.
