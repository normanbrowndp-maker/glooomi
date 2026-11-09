# GLOOMI architecture

Updated 2026-11-10. Describes local implementation. No cloud resources were provisioned; Gmail authentication and read-only existing-database diagnostics were verified separately from isolated integration tests.

## Runtime

- Browser: React/Vite. The short-lived access JWT is held in memory. Refresh state uses an HttpOnly cookie scoped to `/api/auth`; refresh/logout also require the CSRF token in `X-CSRF-Token`.
- API: NestJS REST and Socket.IO, Prisma 6, PostgreSQL, Redis/BullMQ, Nodemailer, AWS SDK for S3.
- Database target: Neon PostgreSQL. The API reads `DATABASE_URL`, normally the Neon pooled connection string. Prisma CLI config (`prisma.config.ts`) reads `DIRECT_URL` for direct migration connections and falls back to `DATABASE_URL`. For local Docker PostgreSQL, both can point to the same local database. `DIRECT_URL` is optional when the supplied `DATABASE_URL` is suitable for migrations.
- Local services: the configured PostgreSQL database and direct Gmail SMTP are sufficient. Private filesystem media is the development default. The real integration suite uses a disposable standalone PostgreSQL under `.cache`, without Docker or Redis. Docker Compose remains a legacy optional configuration. No Neon project or database is created by the application.
- Email: outside production, direct SMTP is the default. Registration creates the account without sending mail; the explicit verification request creates a hashed code and then awaits Gmail SMTP using an App Password, without Redis or an email worker. Optional `EMAIL_DELIVERY_MODE=queue` retains the encrypted transactional outbox, BullMQ dispatcher and separate worker. SMTP acceptance does not guarantee Inbox delivery. See [email setup](email-setup.md).
- Abuse controls: production requires Redis-backed fixed-window counters across API instances. Local direct SMTP mode uses process-memory counters and never connects to Redis. Code attempts, expiry, consumption and resend cooldown remain in PostgreSQL in both modes.
- Media: owner, purpose, type, exact size, object key and lifecycle state remain in PostgreSQL. Development selects local storage: an authenticated bounded raw PUT streams to a private UUID file, finalize verifies its bytes, and attachment is atomic. Read capabilities expire after five minutes and video supports Range. Optional S3 mode retains presigned POST/finalize/signed GET. See [local media](local-media.md).
- AWS: S3 is the intended cloud media service. Existing Terraform still describes an older RDS/CloudFront/ECS stack and is not the target architecture. It remains un-applied and may incur charges if provisioned; it needs redesign before use with Neon.

## Data and media lifecycle

`MediaAsset` progresses from `PENDING` to `READY` to `ATTACHED`; failed/deleted assets and expired unattached `PENDING`/`READY` objects are cleaned up. Attachment and the related post/story/profile write share a database transaction. Only the owner can create/finalize/delete an asset or attach it to a matching purpose. Avatars are images only. Existing `mediaUrl` columns remain nullable/compatible for old rows, while new API writes use media IDs.

New S3 objects use `private-media/`. The legacy CloudFront policy in Terraform permits reads only from `users/`; no new private object is made publicly readable by that distribution. Signed GET URLs expire after five minutes. Current upload limits are 10 MiB for images and 50 MiB for videos; large-file multipart and FFmpeg processing are future work.

## Important boundaries

- Never return refresh tokens in JSON or store them in browser storage.
- Do not put secrets into client bundles or source control.
- SMTP delivery is at-least-once across the SMTP/database acknowledgment boundary; ambiguous acceptance can result in a duplicate email.
- A 15-second refresh grace allows concurrent tabs using the previous refresh token to receive the same rotated token. Reuse after that interval revokes all sessions for that user; the short grace remains a bounded replay risk.
- Signed URLs are bearer credentials until expiry. Keep them short-lived and do not log them.
- Migrations are not applied automatically by application startup.
