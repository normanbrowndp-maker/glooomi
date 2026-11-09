# Local media and demonstration testing

## Why uploads returned 503

The old `MediaModule` always selected `S3MediaStorage`. Its `bucket()` method throws `Media storage is not configured` when `S3_BUCKET` is absent. The current development configuration has no bucket. It is not necessary to provision one for a local presentation.

`MEDIA_STORAGE_PROVIDER` now accepts `local` or `s3`. The development default is `local`; production retains `s3` as its default. The existing S3 adapter is preserved. No environment file needs to change for the existing development configuration.

## Private filesystem storage

By default local files are stored in `<repository>/uploads/private-media/<server-generated UUID>`. `uploads/` is ignored by Git and is not served as a static directory. `LOCAL_MEDIA_DIR` can point at another private, persistent directory outside source/public/build folders. Never point it at the frontend public directory. The application process must have write access; Windows ACLs control local disk access.

The browser uses this real flow:

1. Authenticated `POST /api/media/uploads` records the owner, MIME, exact byte count and purpose in PostgreSQL. It returns `provider: local`, `method: PUT`, a media ID and a relative content URL.
2. Authenticated `PUT /api/media/uploads/:id/content` streams the original file bytes. It checks the pending asset, owner, declared content type, exact byte count and signature. It does not use S3 presigned POST or base64. Exclusive file creation prevents replacement of an existing file. Aborted, incomplete and rejected writes are removed.
3. `POST /api/media/uploads/:id/finalize` rechecks the real disk bytes and marks the asset `READY`.
4. `POST /api/posts` or `/api/stories` atomically attaches the owner's ready asset. Retrying post creation with the same media ID returns the existing owned post instead of duplicating it.
5. Feed/profile/explore responses issue five-minute signed media capabilities only after applying their visibility rules. `GET /api/media/files/:uuid` validates the signature, expiry and database lifecycle state. Arbitrary filenames, traversal paths and directory listings are not available. The response uses the database content type, `nosniff`, private caching and HTTP Range support for video.

Signed read links are bearer capabilities, like the existing S3 links: anyone who receives a still-valid link can use it until expiry. Do not treat such URLs as public permanent URLs. Deleted assets and expired stories are refused even if a previously issued link has time remaining.

The existing limits remain 10 MiB for images and 50 MiB for video. JPEG, PNG, WebP, GIF, MP4, WebM and QuickTime have MIME/signature checks. Browser codec support still determines playback; the app does not transcode or scan media. Images can be center-cropped to square/portrait before upload; animated GIF cropping creates a still JPEG, while the Original setting keeps the original GIF.

Files and PostgreSQL records survive a backend restart. Pending/ready assets older than 24 hours, failed uploads and deletion work are retried by the existing cleanup timer. Removing an owned post unbinds and removes its file; a failed disk cleanup remains eligible for retry. `MEDIA_CLEANUP_ENABLED=false` is reserved for read-only diagnostics. Existing attached posts are never garbage-collected as unused uploads.

`API_PUBLIC_ORIGIN` optionally sets the browser-reachable API origin for signed local read URLs; the default is `http://localhost:<PORT or 3000>`. For remote demonstrations use the reachable API origin, persistent storage and HTTPS. Credentials stay server-side.

The provider is selected for the environment as a whole. Switching an existing local database to S3 does not copy its files automatically; plan a separate file migration before changing providers. Back up the private media directory together with PostgreSQL data.

## Windows development

The existing `.env` must already contain the PostgreSQL and auth/SMTP configuration. Preserve it.

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://localhost:5173`. Choose Create, select a photo/video, inspect the preview, add a caption and publish. No Docker, Redis, AWS resource or migration is needed for the current schema. Restart the API to verify that the published media remains available.

The development client keeps its API cookie host consistent with either `localhost` or `127.0.0.1`. Development Origin checks allow the corresponding loopback alias on the same configured port; production never expands its allowlist. An absent CSRF cookie skips the futile initial refresh POST rather than producing an expected anonymous-session 401. Real invalid login/expired-session errors still surface normally.

## Isolated real integration and browser checks

The real media tests never load the root `.env`. They create a fresh PostgreSQL cluster bound to loopback, apply the existing migration SQL only to its `gloomi_e2e` database, create two authorized test users, start the real API and stop the cluster afterward. The primary Neon database is never a test target.

Install portable test-only Windows PostgreSQL binaries into ignored cache (not the system):

```powershell
npm install --prefix .cache/e2e-tools --no-audit --no-fund --ignore-scripts @embedded-postgres/windows-x64@18.6.0-beta.19
corepack pnpm build
corepack pnpm test:media:local
corepack pnpm test:browser:real
```

Node.js 22+ and Chromium/Edge are needed for browser checks; set `BROWSER_PATH` if Edge is not in its standard Windows location. Leave port 5173 free for the isolated Vite process. The test generates its own real PNG and WebM, performs HTTP and browser uploads and tests persistence after API restart. The browser suite uses no API mocks. Screenshots and retained database artifacts are under `.cache/local-e2e/<run>/`.

After the real browser scenario, the runner separately invokes the clearly reported auth UI regression with API fixtures. The two result lines identify which checks used real services and which used fixtures.

The separate `node apps/web/scripts/smoke-ui.mjs` runs against a normal frontend dev server with isolated API fixtures. Its job is auth/error/verification UI regression, and its results must not be presented as real API integration.

## Explicit demonstration seed

`corepack pnpm db:demo` is opt-in and never runs at application startup. Set `GLOOMI_DEMO_PASSWORD` in the terminal, not by editing an existing `.env`. The seed creates three clearly labeled demo authors and nine original procedural PNG illustrations. It does not reset the database, change existing user passwords, overwrite real accounts or add duplicate posts on repeat runs.

```powershell
$env:GLOOMI_DEMO_PASSWORD = 'choose-a-demo-password'
corepack pnpm db:demo
```

The default seed refuses remote databases. Seeding a Neon target requires separate operator authorization and an explicit `--allow-remote-demo` argument. Do not run that against the primary database without permission. The automated browser test seeds only its own isolated local database and asserts idempotence.

## Current scope

Native Highlights, dedicated pronouns, per-post privacy/comment policies, mention/repost/story-reaction notifications and video processing need additional data models or services and are not implemented. They are not represented by fake controls or fake activity. Profile-level privacy and follow-request approval work with the existing schema. Phone Preview is available at `/phone-preview` on desktop and is never imposed on ordinary mobile browsing.
