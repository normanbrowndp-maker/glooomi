# GLOOMI: media, branding and visual overhaul

## A. Media fix

The 503 came from the unconditional S3 provider and missing `S3_BUCKET`. Development now selects a separate private filesystem adapter by default. The existing S3 implementation remains available.

Local uploads use authenticated raw PUT, exact byte limits, MIME/signature checks, UUID filenames, exclusive creation, ownership/lifecycle checks and the existing finalize/attach flow. Authorized API responses issue expiring signed read capabilities; the filesystem is not a public static directory. Video supports HTTP Range. Partial/aborted uploads are removed, owned post deletion removes its file, and the existing cleanup timer retries expired/unbound/deleted work. Files and database records survived a real API restart in the integration test.

Actual tests uploaded an original PNG, a browser-generated WebM and a canvas-cropped JPEG through the real API. Browser tests uploaded photo/video/avatar/Story through the actual UI and reopened publications after reload. No mocked API was used for these media checks. The primary Neon database was not populated or mutated for testing.

## B. Design and branding

Main screens now share tokens and separated layout/feed/create/profile/page styles. Home has stories, follow/discovery tabs, public-content fallback, real author suggestions and a useful empty state. Explore has a responsive mosaic, media overlays, search, filters and author cards. Profile includes a larger avatar, real counters, tabs, edit/share/follow/message actions, private states and follower lists. Create is a selection/preview/details/success workflow with drag/drop, center crop/zoom, real progress, cancellation, retry, text drafts and publication navigation. Messages, Activity and Reels have consistent layouts and working API interactions.

Figma file: `PQ6moPWAuKox5sVu9IFrDZ`. High-fidelity context and screenshots were read for feed `4:19659`, Explore `4:19754`, Create details `4:19994`, own profile `4:20206` and Story `4:20717`. Starter-plan limits blocked further context reads for Direct/Activity/Reels; those pages follow the established style rather than claiming an exact Figma match.

Grand Hotel, Pacifico and Leckerli One were rendered and compared in a real browser. Grand Hotel was chosen for its connected, compact lowercase lettering. Product wordmarks are now actual text in a local WOFF2 font; the original SVG is retained as an export fallback. Montserrat is also local. Official OFL 1.1 license files are included with all fonts. Comparison: `/brand-comparison.html`. Optional interactive mobile frame: `/phone-preview`.

## C. Functionality

| Function | Status | Evidence |
|---|---|---|
| Registration | Preserved; account creation and email request remain separate | Unit + separate browser fixture regression |
| Email | Direct Gmail SMTP without Redis preserved | Real SMTP authentication + read-only API startup; email UI regression uses fixtures |
| Posts | Real create/read/idempotent retry/owner deletion | Real API and browser |
| Photo upload | PNG and cropped JPEG verified; other allowed formats retain signature checks | Real disk/HTTP/browser + unit tests |
| Video upload | Real WebM upload/preview/playback/Range/persistence verified; MP4/MOV checks supported | Real API/browser; codecs remain browser-dependent |
| Feed | Following, pagination, public discovery fallback and actual suggestions | Real API/browser |
| Profiles | Avatar, username, display name, bio, website, privacy and lists persisted; pronouns not implemented | Real API/browser/reload |
| Search | Username/display name/caption/hashtags, real visible posts only | Real API/browser |
| Stories | Real photo/video flow, 24-hour expiry, viewer, progress and local seen indicator | Real API/browser; reactions/highlights are deferred |
| Highlights | Not implemented | Needs a dedicated persistent model |
| Messages | Persistent REST sends, Socket.IO delivery, polling fallback, read markers and post sharing | Two-account real API/Socket.IO/browser |
| Notifications | Real likes/comments/follows/follow requests/approvals, grouping and read markers | Real API/browser |
| Reels | Existing videos, playback controls, in-view playback and offscreen pause | Real browser |
| Mobile | Bottom navigation, page/dialog layouts and opt-in Phone Preview | 320, 390, 430, 768, 1024 and 1440 px |

## D. Executed checks

- `corepack pnpm typecheck`.
- `corepack pnpm test`: 61 unit tests across 10 files, including real-filesystem persistence, abort cleanup, MIME spoofing, traversal, ownership and signed URL expiry/tampering.
- `corepack pnpm build`: API + web build passed. `corepack pnpm build:worker` also passed; local operation still needs no worker.
- `corepack pnpm exec prisma validate --schema prisma/schema.prisma --config prisma.config.ts`.
- `git diff --check`: passed; Git only reports its normal LF-to-CRLF normalization notice for `app.tsx`.
- `node apps/api/scripts/test-local-media.mjs --browser`: real standalone PostgreSQL, migration SQL applied only to its isolated database, real Nest API, real disk, two allowed test accounts and real headless Edge. Verified authentication/cookies/refresh, upload/publish/restart, privacy, follow-request approval/rejection, read markers, Socket.IO, post deletion/file cleanup, profile editing, idempotent seed, search, six viewport widths and all primary screens. No HTTP/blob failures or runtime exceptions were observed in the normal real browser scenario.
- That runner separately invokes the auth/email UI regression with API fixtures. It checks both email steps, OTP paste/focus/Backspace/arrows, wrong/expired codes, SMTP failure, resend, backend cooldown, reload persistence, existing-account continuation and password reset. This result is explicitly separate from real integration.
- `node apps/api/scripts/check-email-local.mjs`: required configuration present, existing Neon core schema columns present, Gmail SMTP authentication successful, API `direct` mode and Redis `not_required`. Cleanup was disabled for this diagnostic; no migrations, messages or data writes were performed.

## E. Screenshots

The real browser screenshots are copied to `.cache/gloomi-review-2026-11-10/`:

- `home-desktop.png`
- `profile-desktop.png`
- `explore-desktop.png`
- `create-details.png`
- `home-mobile.png`
- `phone-preview.png`

Full run artifacts: `.cache/local-e2e/67cd8049-8026-4b87-9427-db704bc7b8cd/`. These are explicitly labeled demo/test users and original procedural illustrations, not activity from real users. All artifacts and user uploads remain ignored by Git.

## F. Windows launch

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://localhost:5173`. Existing `.env` is preserved. The existing development configuration automatically selects local storage. The normal app uses the configured PostgreSQL database and Gmail SMTP; it needs no Docker, Redis, S3 bucket or new migration.

For isolated browser reproduction, first install the portable test binaries as documented in [local media](local-media.md), then run `corepack pnpm test:browser:real` with port 5173 free. No test targets the primary Neon database. `db:demo` is a separate, opt-in, idempotent seed; it refuses a remote database unless the operator explicitly authorizes that target. It was run only in the isolated test database here.

## G. Remaining limitations

Native Highlights/pronouns, per-post privacy/comment controls, persistent full media drafts, structured mention/repost/story-reaction events, moderation, push and video transcoding are not implemented. Text drafts are device-local; originals must be chosen again. Video codecs depend on the browser. The optional S3 adapter has not been verified against a live bucket. Changing providers requires a deliberate media-file migration. Signed read links are bearer capabilities until expiry. No cloud deployment was performed.

No existing account was deleted/reset, `.env` was not changed, no primary Neon migration or demo seed was run, and no Docker, Redis, Terraform or paid AWS resource was used.
