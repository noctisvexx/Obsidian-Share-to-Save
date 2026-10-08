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
