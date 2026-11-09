# Roadmap

Updated 2026-11-09.

## Required before a live demonstration

1. Set up an approved Neon PostgreSQL database and configure pooled `DATABASE_URL`; set direct `DIRECT_URL` for migrations. Verify both URLs point to the intended non-production project before applying migrations.
2. Start Docker PostgreSQL/Redis/Mailpit and run the integration suite, including migration compatibility checks.
3. Configure an approved private S3 bucket and least-privilege AWS identity. Exercise upload intent, direct upload, finalize, post/story/avatar attachment, signed delivery, expiry, and cleanup.
4. Configure demo web/API origin, cookie policy, SMTP credentials (or Mailpit), and Redis; verify email and browser session flows.

## Recommended improvements

- Add social authorization integration coverage for private profiles, posts, stories, comments, and media.
- Add browser end-to-end tests for multi-tab refresh, CSRF, logout, upload progress, and failure recovery.
- Add full media decoding/scanning and stronger content validation before publication.
- Define separate API and email-worker deployment processes, health checks, logs, alerts, and operational recovery.
- Review legacy Terraform for Neon and private S3; remove RDS/public CloudFront assumptions before any apply.

## Optional future enhancements

- S3 multipart uploads for large videos, asynchronous FFmpeg thumbnails/transcoding, and lifecycle cleanup for abandoned parts.
- Range-aware video delivery, CDN private distribution, moderation/reporting, browser push, follow-request approval, saved-post UI, and static frontend hosting.
