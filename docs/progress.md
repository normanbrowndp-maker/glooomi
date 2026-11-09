# Development progress

Updated 2026-11-09.

## Phase 3 implementation status

Phase 3 is implemented locally and prepared for integration. No live Neon or AWS credentials were used, so external connectivity and deployed behavior remain unverified.

- Neon is the intended managed PostgreSQL provider. Runtime Prisma uses `DATABASE_URL`; Prisma CLI reads `DIRECT_URL` first and falls back to `DATABASE_URL` through `prisma.config.ts`. Docker PostgreSQL remains the local and integration-test option. No database was connected or migrated in this phase.
- Private S3 media lifecycle is implemented for image and short-video uploads: authenticated intent, exact-key presigned POST, owner-bound database record, finalize-time size/content-type/signature checks, purpose-bound attachment, short-lived signed GET, owner avatar update, deletion of unattached media, and cleanup of abandoned uploads.
- Posts, stories, and profile avatars now reference `MediaAsset` records. The older `mediaUrl` fields remain for compatibility with existing rows; new writes use media IDs. New keys are under `private-media/`, outside the legacy CloudFront-readable `users/` prefix.
- The browser uploads directly to S3 without sending API credentials to S3, then finalizes through the API. Existing image and video display paths use signed URLs.
- Phase 1/2 authentication, Redis rate limits, encrypted transactional email outbox, and separate BullMQ worker remain in place.
- Migration `0004_private_media` adds nullable relations and media metadata without deleting existing content. It has not been applied to any database.

## Validation on 2026-11-09

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS: 21 unit tests; 11 integration tests skipped |
| API build | PASS |
| Web build | PASS |
| Worker build | PASS |
| Prisma Client generation | PASS |
| Prisma schema validation | PASS with a temporary localhost placeholder URL |
| Migration integration harness | SKIP: required isolated test DB URLs were not configured |
| `git diff --check` | PASS |
| Docker-backed integration | SKIP: Docker CLI unavailable |
| Terraform validation | SKIP: Terraform CLI unavailable |

No migration was applied. No Neon/AWS resources were created or accessed, no production database was connected, and no deployment or Terraform apply was run. The user-owned `.env.example` deletion and `.env` were left untouched.

## Remaining work

### Before a live demonstration

- Configure an approved Neon database URL locally and apply migrations only to that intended database.
- Configure an S3 bucket and least-privilege runtime credentials after reviewing cost and approving provisioning; then validate upload, finalize, signed delivery, and deletion end to end.
- Run local PostgreSQL/Redis integration tests with Docker and test auth, outbox recovery, and media flows against real services.
- Set cookie/CORS values for the actual demo origins and validate browser login/refresh/logout.

### Recommended follow-up

- Add multipart upload for large videos, media decode/scan, asynchronous FFmpeg thumbnails/transcoding, and media delivery range/egress strategy.
- Add social/media authorization integration tests, browser tests, and production worker deployment/monitoring configuration.
- Treat the existing RDS/CloudFront Terraform stack as legacy, cost-bearing infrastructure. Review and redesign it before any use with Neon; do not apply it as-is for this architecture.

See [architecture](architecture.md), [security](security.md), [roadmap](roadmap.md), and [audit](audit.md).
