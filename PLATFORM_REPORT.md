# Stage 3 platform acceptance

Date: 2026-10-08. Branch: `codex/mobile-first-clipper`. Main is unchanged.
No APK, libapp.so or previous analysis artifacts were found in the workspace.
The user's summarized findings guide investigation; no proprietary code was copied.

## Bilibili

Implemented: BV/av video, b23 short links with visible redirect/canonical URL,
t.bilibili.com, dynamic and opus URLs. Public video/dynamic API first, matching
HTML SSR second, then guarded generic HTML. Title, UP/author, description/text,
cover/multiple post images, timestamp and source use the shared saver.
Video files are not downloaded. Public subtitles are not implemented in this
pass: they are optional and should not block normal saves.

Observed anonymously: view API returned code 0 for BV1xx411c7mD; dynamic API
returned -352; opus/1211500325209374726 returned a real HTML module-array SSR.
Reduced video fields and opus layout inform regression fixtures. The live
endpoint probes are not Android tests or full live end-to-end saves.

Acceptance: 104 automated tests passed (one opt-in XHS test skipped); TypeScript,
production build and lint passed. Bilibili has eight independent cases.
Limitations: restricted/deleted content fails; opus list/link-card/heading styles
and forwarded dynamics are not fully rendered. Hidden final short-link URLs need
canonical metadata. No arbitrary signing, cookies or CAPTCHA bypass.

Production files: `src/platforms/{shared,bilibili}.ts`, `src/{mobile-clipper,types,quality-validator}.ts`.
Tests: `tests/bilibili.test.ts`. Shared helpers parse bounded JSON trees and do
not execute scripts. Explicit structured post/video classification allows short
real captions while retaining article validation and access-wall checks.

## Douyin

Implemented: video/note/share URLs, modal_id, aweme_id and v.douyin short links
when redirects or SSR expose the item ID. Public RENDER_DATA and _ROUTER_DATA
are parsed without executing scripts; iesdouyin public share HTML is an alternate
source only when the first source did not explicitly deny access. Captions,
author, timestamp, gallery candidates and video-cover candidates use the shared
saver; no video stream download or watermark rewriting.

The user's v.douyin.com/8cyII4FOzNg redirected to video/7692403146391898021 but
returned a JavaScript verification shell; iesdouyin returned the same shell.
This sample is NOT successfully supported in the current anonymous environment.
The task fails clearly and remains available for retry/desktop fallback. No
verification script, signatures, session cookies or private API are used.

Acceptance: 113 tests passed (one skipped), TypeScript/build/lint passed.
Nine independent Douyin cases use documented public loader/RENDER_DATA shapes,
with illustrative values; these are NOT successful live page captures. The real
verification-shell marker was checked separately. Android has not been tested.
Changed: `src/platforms/douyin.ts`, platform access-wall helpers, registry entry,
`tests/douyin.test.ts` and this report.

## X / Twitter

Implemented: status/photo/video URLs on X and Twitter, public t.co redirects,
matching public page JSON or serialized SSR, unauthenticated syndication, guarded
HTML metadata and public oEmbed fallback. Acorn parses syntax; the literal-only
reader never evaluates calls, functions/getters or arbitrary operators. No
GraphQL authentication, guest bearer token or manufactured syndication token.
Public note_tweet long text, quoted post text/images and video posters are parsed
when exposed. Truncated known long posts fail rather than saving a preview.

Observed: the user's Allen0125/2107449641403039962 page exposed real caption and
one image and passed an opt-in anonymous live resolver test. The Randgai_artz
sample exposed explicit age-restriction metadata; it is deliberately rejected,
without attempting another endpoint. Syndication was empty in an initial probe
and later had TLS failure; it is not a guaranteed source. Public oEmbed responded
but cannot alone guarantee full media or long-post content.

Acceptance: 122 automated tests passed (two opt-in tests skipped); TypeScript,
build and lint passed. Ten X cases include one separately passing live resolver
test. Node live parsing is NOT Android requestUrl, Vault or media-download testing.
Metadata fallback may provide a public preview rather than full long/quoted
content when the page does not expose that distinction; retest long posts on a
device. X Articles content-state parsing is not implemented in this pass.
Changed: X/static-script-data modules, registry, package.json/lock (Acorn runtime
dependency), `tests/twitter.test.ts`, mobile entry and this report.

## Instagram

Implemented: p/reel/tv, username-prefixed URLs, instagr.am aliases and share URLs
that expose a public post identity. Ordinary public page JSON/Polaris structures
first, public embed/captioned page second, then verified token-free public oEmbed
identity diagnostics. The embed's literal JSON strings and nested contextJSON
are decoded statically. Shortcode/code, owner, caption, optional timestamp,
sidecar/carousel_media and image_versions2 candidates use the shared saver.
Videos save posters, not video_versions streams. Incomplete galleries fail.

The user's DdrPNX1jVEz main page had metadata but no complete carousel. Its public
embed exposed GraphSidecar children inside encoded contextJSON. An independent
opt-in live anonymous resolver test extracted caption, owner and multiple images.
Graph v25.0 token-free oEmbed responded during the probe, but its skeleton HTML
was not used as proof of complete clipping. Private media endpoints and signed
Polaris GraphQL requests are not called. Publicly embedded Polaris JSON is parsed
only when already included in a readable page. Availability can change.

Acceptance: 133 tests passed, three opt-in live tests skipped; TypeScript/build/
lint passed. Twelve Instagram cases include one separately passing live test.
Live probes are Node parsing only: no Android, Vault sync or real image download
validation. Missing timestamps remain empty, not guessed. Expiring CDN URLs can
fail downloads and leave remote links with existing attachment warnings.
Changed: `src/platforms/instagram.ts`, nested literal JSON helpers, mobile
registry, `tests/instagram.test.ts` and this report.

## Final Integration Acceptance

Final default suite: 142 passed, 4 skipped across 17 files. The build (including
TypeScript checks), lint and diff whitespace checks passed. Three opt-in anonymous
live resolver tests passed for the supplied B23, public X and Instagram links.
These are Node tests, NOT Android requestUrl, real media downloads or Vault sync.
The supplied Douyin link returned a JavaScript verification shell and is expected
to retain a failed task. The second X link is age-restricted and is rejected.

Eight integration tests exercise the actual mobile registry, shared Markdown and
attachment saver, queue completion and retained failures for all four platforms.
Desktop dispatch now uses the same public HTTP resolvers for these platforms;
existing desktop acquisition for other websites is unchanged. No new Electron
WebView fallback was added for these four platforms, so desktop retry cannot
guarantee access when the public source is blocked on both devices.
Bilibili canonical video links retain a valid part number. Startup tests retain
lazy initialization and no mobile idle polling. Android startup performance and
cross-device synchronization still require real-device checks.

Integration files: `src/main.ts`, `src/platforms/bilibili.ts`,
`tests/bilibili.test.ts`, `tests/startup.test.ts`, `tests/platform-flow.test.ts`
and this report. Existing regression tests cover queue safety, migration,
idempotent retries, deleted-note re-clipping, attachments and existing converters.
Dependency installation reports 24 audit findings (1 low, 5 moderate, 18 high);
unrelated dependency upgrades were not attempted in this platform adaptation.

## Android Manual Acceptance

1. Back up a test Vault, install the updated plugin package, restart Obsidian and
   keep the desktop off. Check that startup does not start unsolicited clipping.
2. Share the supplied B23 link: compare title, UP name, description, cover and
   source link. Also test a dynamic with multiple pictures; a real dynamic sample
   from the user is still needed. Subtitles are not implemented in this pass.
3. Share the supplied Douyin link: expect an explicit verification failure and a
   retained retryable task, not a blank successful note. Test an anonymously
   accessible video and image gallery separately; no live success is established.
4. Share the public X link and compare caption/image. The age-restricted link
   must fail clearly. Compare long and quoted posts against the browser;
   X Articles content-state parsing is not supported.
5. Share the supplied Instagram link: verify all carousel images are saved even
   with img_index=2. Compare caption/author, then test a single image and a reel
   poster. Check Obsidian-default and custom attachment folders and usable links.
6. Share twice, then delete only the saved note and share again. Check dedup and
   intentional re-clipping without modifying unrelated notes or attachments.
   Test offline failure, manual retry and desktop fallback on/off after syncing;
   retained tasks must not disappear and successful mobile notes must not repeat.

Development is paused pending Android acceptance. No claim of four-platform
Android compatibility or conflict-free real-device synchronization is made.
