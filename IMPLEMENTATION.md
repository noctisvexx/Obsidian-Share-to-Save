# Mobile-first clipper implementation

## Stage 1

Markdown discovery and conversion are removed. Sharing uses the existing injected
Save Webpage action, the input modal, or `obsidian://share-to-save?url=...`.
Existing Markdown and its attachments are never migrated.

Tasks live in `_ShareToSave/queue` inside the Vault, allowing the user's existing
sync to transport them. This folder must be included in that sync. Tasks have a
type, schema version, ID, timestamps and pending/processing/failed/completed
states. Completion records remain as receipts; errors remain for manual retry.
Expired processing tasks can be retried explicitly. Legacy files are deleted only
after reading and verifying the migrated destination; unknown JSON is retained.

Attachments use Obsidian's public attachment-path API by default, or a custom
Vault folder. New embeds use full Vault paths. Binary names use SHA-256 digests;
existing references and attachments are left untouched. Shared files use the same
location policy. Existing notes keep their original filenames. New clips use
`Clip-{taskId}.md` to make saves idempotent across retries and devices.

File sync does not expose a distributed transaction or compare-and-swap. Exclusive
claim-file creation arbitrates consumers in the simulated shared-Vault test, but
Obsidian does not promise distributed atomic creation. Disconnected devices can
both parse a task. Deterministic note paths prevent different note
names for the same task, while sync-provider conflict copies remain possible.
New tasks also snapshot the note folder so device settings cannot send one task
to different folders. Article titles remain in title and aliases frontmatter.
This requires real multi-device testing and is not an exactly-once guarantee.

Automated tests use a fake Vault. Android sharing UI, relative default attachment
placement, device suspension, real network responses and sync conflict handling
require Obsidian/Android validation. No platform availability is claimed.

Stage 1 commit: `e4f1cd7`. Nine automated tests passed; TypeScript checking and
production build passed. Changed files: `.gitignore`, `vitest.config.ts`,
`src/{types,settings,main,queue-manager,file-watcher,downloader,image-handler,image-share-injector,attachment-storage,task-modal}.ts`,
`tests/{queue-manager,attachment-storage,file-watcher}.test.ts`,
`tests/mocks/obsidian.ts`, and this report.

## Stage 2

Mobile tasks target the originating device using a device-local ID stored through
Obsidian's App local-storage API. This local ID stores no queue data. Queue files
remain in the synced Vault. Desktop consumes explicitly desktop-targeted work or
failed mobile work with fallback permission. The global fallback switch is read
at each poll. A failed desktop fallback stops automatic retries. Explicit retry
can move a failed task to the current device. An interrupted task requires manual
retry after its ten-minute lease expires. A successful task remains completed.

`UrlNormalizer` removes tracking, preserves required parameters, handles safe
canonical URLs and known XHS short-link canonical expansion. `mobileRequest`
uses Obsidian requestUrl, bounds visible redirect hops and provides a thirty-second
timeout. Some requestUrl implementations follow redirects internally without
exposing their final URL; canonical metadata then provides the usable URL.
Timeouts stop the pipeline but cannot cancel requestUrl's underlying request.

`ResolverRegistry` tries matching resolvers, validates their results and uses the
generic resolver when required. `MobileClipper` adapts existing site converters
and Defuddle to this interface; dedicated social-platform resolvers are deferred.
`QualityValidator` rejects empty/title-only content, short incomplete article
bodies, login walls and app-only placeholders. Explicitly identified media posts
can succeed without long text. These are heuristics and require real examples.

Mobile parsing and media use requestUrl and Uint8Array. They do not call the Node
HTML fetcher or Electron renderer. Existing desktop acquisition handlers remain.
Both paths use the same Markdown/frontmatter and attachment saver. Media support
includes candidate URLs, Referer, image/video/audio/file kinds, SHA-256 naming,
content comparison and full Vault-path embeds. Failed attachments keep remote
links and attach visible warnings to a completed task. Separate attachment-only
retry is not implemented. Large media are buffered in memory and need Android
memory-pressure testing.

Stage 2 modified existing files:
`src/{types,settings,main,queue-manager,file-watcher,downloader,image-handler,content-converter,task-modal,attachment-storage}.ts`,
`src/i18n.ts`, `vitest.config.ts`, `tests/mocks/obsidian.ts`, `tests/{queue-manager,attachment-storage}.test.ts`, and
this report. New files: `src/{url-normalizer,quality-validator,mobile-http,resolver-registry,mobile-clipper}.ts`
and `tests/{resolvers,mobile-http,mobile-clipper}.test.ts`.

Automated validation includes mocked mobile HTML and attachments through the real
shared converter/saver, task failure retention, optional desktop consumption,
idempotent saves, timeout/redirect handling, media candidates and fixtures for
WeChat, Xiaohongshu, Zhihu, Obsidian Publish and a generic article. Fixtures are
synthetic and do not establish live-site compatibility or Android support.

Required acceptance on a real Android device: share-menu injection, mobile
networking, real page quality, relative/default attachment policy, app suspension
and restart, large media and Vault sync to a desktop with fallback enabled/disabled.
The queue folder must be included in the user's existing sync. Sync-provider
conflict copies and exactly-once behavior across disconnected devices remain
unverified. Changing queue settings during active work is not supported;
files remain safe but tasks in the old location need to be moved or the original
setting restored. Completed receipts and claim files are retained without automatic
cleanup. Stage 3 must wait for user confirmation.

Final stage 2 verification: 35 automated tests passed across six files;
`npm run build` includes TypeScript checking and the production bundle;
`npm run lint` and whitespace checks passed. The settings copy now describes
mobile-first clipping and the obsolete desktop-only workflow graphic is removed.
Android device tests and live-site tests have not been performed.
