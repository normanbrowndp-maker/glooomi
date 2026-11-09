# Repository audit notes

Updated 2026-11-09. This captures the implementation findings that informed Phase 3; it is not a fresh exhaustive audit of every endpoint.

## Starting state

- Branch was `main`; the working tree already contained Phase 1/2 changes, including authentication, email outbox/worker, Redis limiting, docs, and migration files. `.env.example` and the older `neon.ts` were already deleted in the user-owned working state and were not restored.
- The code used NestJS/Prisma/PostgreSQL, React/Vite, Redis/BullMQ, and a Terraform template centered on RDS/ECS/CloudFront. The brief sets Neon as the intended managed PostgreSQL target and AWS S3 as media storage.
- Previous media flow wrote directly to S3 and returned a public-style URL without a persisted ownership/lifecycle record. The Terraform CloudFront bucket policy covered the bucket's full object prefix, making those keys readable through the distribution.
- Post and story records held URL strings only, which could not enforce ownership or media purpose at attachment time.
- Existing phase documentation still called RDS primary and media delivery public; this was corrected to match the Phase 3 code and selected architecture.

## Phase 3 changes informed by findings

- Added a Prisma media asset lifecycle and migration while keeping existing media URL fields for compatibility.
- Replaced public URL upload with authenticated presigned upload intent, finalize/signature validation, ownership-bound attachment, private signed delivery, and cleanup.
- Narrowed legacy CloudFront object reads to `users/*`; new `private-media/*` keys are not granted to CloudFront.
- Added Neon-oriented Prisma CLI configuration with direct URL preference and pooled/runtime URL fallback; retained Docker PostgreSQL for local work.
- Updated README and architecture/security/progress/roadmap docs. No migration or cloud resource was applied.

## Verification limits

Unit tests, static checks, builds, Prisma generation/validation, and the Git whitespace check were run. PostgreSQL/Redis-backed integration, live S3/Neon/Gmail behavior, and Terraform validation could not be verified because test service URLs and local Docker/Terraform tooling were unavailable. See [progress](progress.md) for exact results.
