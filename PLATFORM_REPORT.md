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
