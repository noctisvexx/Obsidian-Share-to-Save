# Mobile-first acceptance report

Date: 2026-10-08. Branch: `codex/mobile-first-clipper`.
Stage 3 is paused. No new platform resolvers were developed.

## Result

71 automated tests pass across 11 files. `npm run build` passes, including
`tsc -noEmit -skipLibCheck` and the production bundle. `npm run lint` passes.
These are simulated tests, not Android device or live-site acceptance.
ADB is available but `adb devices -l` listed no connected devices.

## Verified automatically

| Area | Evidence and limits |
| --- | --- |
| Existing Markdown | Queue tests leave ordinary Markdown and Web Clipper notes unchanged. No Markdown discovery or conversion. Shared memo writes require exact YAML ownership, including inside the atomic update callback. |
| Existing attachments | Binary collision tests preserve different existing bytes, choose a nonconflicting filename and reuse that filename on another download. Local embeds are not fetched or rewritten. |
| Legacy queues | Strict recognition, destination verification before source deletion, idempotent migration, malformed JSON retention and source-change detection. Only confirmed legacy queue files can be removed. |
| Queue isolation | Tasks live in the configured Vault queue directory, outside the note folder. Malformed paths/settings are repaired without a Vault scan. A nonempty queue directory cannot be switched away from and hidden. |
| Failure and retry | HTTP failure retains task/error; retry preserves task identity. Processing and claim leases must both expire before manual recovery. Claim failure releases the owned lock. Failure of one task does not stop later work. |
| Duplicate tasks | Same normalized URL and note-folder snapshot produce a stable task ID, including on offline simulated devices. A completed receipt blocks stale pending/failed statuses from causing another save. Noncanonical sync conflict JSON is retained and reported, not consumed. |
| Completion confirmation | Success receipt is written before JSON status. Failure to write the final status does not downgrade a successful save. Existing task-owned output is idempotent. |
| Attachments | Root, custom and note-relative policy fixtures produce usable full-Vault-path embeds. Repeated URLs download once per batch; identical bytes share one asset. Missing MIME preserves the original URL extension. Hashing works without WebCrypto subtle. |
| Existing mobile converters | Synthetic WeChat, Xiaohongshu, Zhihu, Obsidian Publish and generic article fixtures run through the existing converter/saver. No live platform availability claim. XHS signed tokens and strings containing undefined/NaN are preserved. |
| Desktop fallback | Simulated mobile failure then permitted desktop consumption uses the real shared save pipeline but mocked desktop acquisition. The global fallback switch prevents consumption when disabled. |
| Mobile idle startup | Fake-clock ten-minute idle test: no queue scan/read/write, parser construction or processing timer. Load-time services are mocked; this is not an actual startup-duration measurement. |
| Lifecycle | Unload during settings load registers no services. Unload after queue read starts no tasks. Stop aborts the running pipeline; late network response cannot resume saving. Notification replacement/unload clears timers. |

## Necessary fixes

- Exact YAML ownership checks replace permissive substring matching and protect
  an existing foreign `Sts-memos.md` from text append.
- Stable URL/folder task IDs, immutable `.done` receipts, canonical task paths,
  claim cleanup, validated retry and conservative migration improve reliability.
- Explicit shares received during processing trigger another drain, without
  mobile background polling. Converter/downloader construction is lazy.
- Cancellation travels through HTTP, conversion, attachment and note saving;
  task-window errors are visible rather than unhandled promises.
- Attachment collision handling, root paths, extension detection and
  content-based deduplication are corrected. A pure SHA-256 implementation avoids
  an Android WebCrypto-subtle dependency.
- Generic fallback reuses the page response; blocked/error titles and non-HTML
  responses no longer count as successful article extraction.

## Changed files

Production: `package.json`, `package-lock.json`,
`src/{attachment-storage,content-converter,downloader,file-watcher,image-handler,main,mobile-clipper,mobile-http,notice-utils,quality-validator,queue-manager,settings,task-modal,text-saver}.ts`.
New helpers: `src/{cancellation,content-hash,note-ownership,random-id}.ts`.

Tests: `tests/{file-watcher,mobile-clipper,queue-manager}.test.ts`,
`tests/mocks/obsidian.ts`; new
`tests/{clipping-flow,image-handler,notice-utils,startup,text-saver}.test.ts`
and `tests/helpers/vault.ts`. Reports: this file and `IMPLEMENTATION.md`.

## Not verified and known risks

- **Real Android and real multi-device sync are NOT verified.** File sync has no
  distributed transaction guarantee. Offline devices may both parse; stable
  output names and receipts reduce duplicate outcomes but provider conflict
  copies remain possible. This is not an exactly-once guarantee.
- Different signed tokens or unresolved short URLs can identify the same article
  differently. Stable IDs deduplicate normalized URLs, not every semantic alias.
- Queue JSON, `.claim` and `.done` files must all participate in the user's
  existing Vault sync. No queue data is stored in the plugin-local directory.
- `requestUrl` has no underlying abort API: timeout/cancellation stops the
  pipeline, not the platform's network operation already in flight. A Vault
  write already submitted when unloading cannot be rolled back safely.
- Idle mobile startup deliberately does not auto-drain old tasks. Use the task
  window to retry; interrupted processing must wait for its lease to expire.
- Actual share-menu injection, Capacitor shared-image handling, app suspension,
  live server/login restrictions, default relative attachment API behavior and
  large-media memory pressure require real Obsidian validation.
- Failed media retain remote links and visible warnings; attachment-only retry
  is not implemented. Shared-image menu saving is a separate path from web-media
  deduplication and needs device testing.
- Receipts and conflict files are retained, not automatically cleaned up.
  Changing a nonempty queue directory is intentionally blocked.
- Dependency installation reports 24 audit findings (1 low, 5 moderate,
  18 high). Unrelated dependency upgrades were not applied in this acceptance
  pass; vulnerability remediation needs a separate scoped review.

## Android manual acceptance

Use a backed-up test Vault, not the only copy of important notes.

1. Install the rebuilt plugin. Include `_ShareToSave/queue` and its `.done`/
   `.claim` files in Vault sync. Enable mobile-first; turn the computer off.
2. Keep a Web Clipper note, an ordinary Markdown containing a URL, a foreign
   `Sts-memos.md` and its images. Record their content or hashes. Share one real
   WeChat article, XHS post, Zhihu article and ordinary webpage. Check task
   status, body and images. Compare the existing files: they must be unchanged.
3. Test Obsidian attachment settings at Vault root and relative to the note,
   then the plugin's custom folder. Open image embeds; re-share the same URL
   and check no second note or meaningless asset copy appears.
4. Disable networking and share a URL. Confirm failed task/error survives app
   restart; restore networking and retry from the task window. Interrupt an
   active clip by disabling the plugin and test retry after lease expiry.
5. Fail mobile clipping with desktop fallback disabled; sync to desktop and
   verify no automatic processing. Enable fallback and explicitly re-share or
   retry with permission: verify desktop processing, one result and retained
   failure on desktop error. A mobile-success task must not be clipped again.
6. In a test Vault, place one confirmed legacy `toBeSaved_*.json` in the old
   output folder. Open tasks and verify one migrated task; repeat opening.
   Unknown JSON and existing Markdown/media must remain unchanged. Test both
   devices online and offline; inspect sync conflict copies and final results.
7. Restart Obsidian without sharing. Check responsiveness and that no work
   starts on mobile while idle. Repeat with a large article/media item and
   app backgrounding. Record device, Obsidian version, sync provider, failing
   URLs, task messages and screenshots for any failures.

Await user confirmation before further development or stage 3.
