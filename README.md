# gloomi

Mobile-first social network starter based on the provided gloomi Figma screens. The current implementation is a working product foundation: account registration and Gmail SMTP verification, persisted profiles, follow-aware feed, photo/video posts, likes, comments, discovery/search, expiring stories, notifications, and private conversations over REST plus Socket.IO.

## Stack

- `apps/web`: React, TypeScript, Vite, React Router, TanStack Query, Axios, CSS variables.
- `apps/api`: NestJS REST API, Socket.IO gateway, JWT authentication, DTO validation, bcrypt password hashing, Gmail SMTP/Mailpit, transactional email outbox, Redis rate limits, separate BullMQ worker, private S3 media lifecycle.
- `prisma`: PostgreSQL schema and migrations.
- `infrastructure/terraform`: legacy AWS RDS/ECS/CloudFront template. It is not the selected Neon architecture and may create billable resources if applied.
- `docker-compose.yml`: local PostgreSQL, Redis, Mailpit, and isolated integration-test databases.

## Local development

Prerequisites: Node.js 20+, Corepack/pnpm 9+, Docker Desktop, and PostgreSQL 16 (Docker Compose provides PostgreSQL and Redis).

1. Start local services with `docker compose up -d postgres redis mailpit`.
2. Create `.env` with the environment values documented below. For Docker, set local `DATABASE_URL` and `DIRECT_URL` to the local database; for Neon, use the pooled URL as `DATABASE_URL` and direct URL as `DIRECT_URL`. Set distinct random JWT and email-code secrets.
3. Install dependencies: `corepack pnpm install`.
4. Generate Prisma Client and apply migrations to the configured PostgreSQL database: `corepack pnpm db:generate` then `corepack pnpm db:migrate`.
5. Start the API and frontend: `corepack pnpm dev`.
6. Open `http://localhost:5173`.

Start the email worker in a second terminal with `corepack pnpm dev:worker`. Local SMTP capture is available at `http://localhost:8025`.

The API listens on `http://localhost:3000`; endpoints are under `/api`. Swagger is not enabled yet. Uploaded media is disabled until `S3_BUCKET` is configured and the runtime identity can write to it. No demo accounts or fixture social content are injected: feed, stories, and discovery use database rows created through the API.

## Required environment values

- `DATABASE_URL`: PostgreSQL URL used by the API runtime. For local Docker Compose: `postgresql://gloomi:gloomi@localhost:5432/gloomi?schema=public`. For Neon, use the pooled connection string.
- `DIRECT_URL` (optional): direct PostgreSQL URL preferred by Prisma CLI for migrations. For Neon use its direct endpoint; locally it can equal `DATABASE_URL`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: independent high-entropy secrets.
- `EMAIL_CODE_PEPPER`: independent high-entropy secret for HMAC hashing verification codes.
- `WEB_ORIGIN`: exact allowed browser origin(s), comma-separated.
- Email-code and outbox encryption key: `EMAIL_CODE_PEPPER` (at least 32 bytes; AWS runtime loads it from Secrets Manager).
- Gmail SMTP: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD` (Google App Password), `SMTP_FROM` (verified sender address), `SMTP_FROM_NAME`; optional timeouts `SMTP_CONNECTION_TIMEOUT`, `SMTP_GREETING_TIMEOUT`, and `SMTP_SOCKET_TIMEOUT`.
- Local Mailpit: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, blank user/password, `SMTP_SECURE=false`, `SMTP_FROM=no-reply@gloomi.local`.
- Cookie settings: `COOKIE_SAME_SITE` (`lax` by default; use `none` only for cross-site HTTPS deployments), optional `COOKIE_DOMAIN`.
- Media: `AWS_REGION` and `S3_BUCKET`; AWS SDK default credential chain is used. New `private-media/` objects are private and delivered with five-minute signed URLs. No public media base URL is needed.
- `REDIS_URL`: required in production for distributed auth rate limiting and BullMQ outbox delivery. Local development can fall back to process-local rate limiting, but use Docker Compose Redis to exercise queues.

Do not commit `.env`. Configure credentials locally through a secure mechanism. Gmail delivery requires a Google App Password and verified sender mailbox. No external resource is created automatically.

## AWS preparation

The Terraform under `infrastructure/terraform` is a legacy deployment template and does not create anything unless applied. It includes RDS, ECS, Redis, ALB, and CloudFront resources that can incur charges and does not represent the selected Neon architecture. Review and redesign it before any use; no `terraform apply` was run.

Neon is the intended managed PostgreSQL provider. AWS S3 is the intended media provider. Local Docker Compose remains available for PostgreSQL, Redis, Mailpit, and isolated tests. S3 provisioning and all deployment work require separate review and authorization because they may incur costs.

Before applying, validate the Terraform plan in the intended AWS account. Never run `terraform apply` from this repository without explicit operator review.

## Current API surface

- `POST /api/auth/register`, `/login`, `/verify-email`, `/resend-code`, `/refresh`, `/logout`, `/logout-all`, `/password-reset/request`, `/password-reset/confirm`; `GET /api/auth/me` and `/api/auth/csrf`.
- `GET /api/feed`, `/explore`, `/search/users`, `/profiles/:username`; authenticated profile changes via `PATCH /api/profiles/me`.
- `POST /api/posts`, `/posts/:id/like`, `/posts/:id/save`, `/posts/:id/comments`; `GET /api/posts/:id/comments` and `/api/saved`.
- `POST /api/profiles/:id/follow`, `/unfollow`; `GET/POST /api/stories`.
- `GET /api/conversations`; `POST /api/conversations/:peerId`; `GET/POST /api/conversations/:id/messages`.
- Socket.IO namespace `/messages`: `conversation:join`, `message:send`, and `message:new`.
- `GET /api/notifications`; authenticated media flow: `POST /api/media/uploads`, `POST /api/media/uploads/:id/finalize`, `POST /api/media/avatar`, `DELETE /api/media/:id`.

## Known gaps

Multipart video uploads, media scanning/FFmpeg processing, range-aware streaming, moderation/report workflows, browser push, and frontend hosting remain incomplete. The private S3 flow is implemented but not verified against a live bucket. Email worker and Redis rate limiting run locally but need an approved deployment target and production monitoring. No production deployment, live Gmail/Neon/S3 connection, Terraform plan, or Terraform apply has been run. A dedicated saved-posts screen is still pending.

## Integration testing

Docker Compose provides separate databases on ports 5433 and 5434 for API and migration tests. Start them with `docker compose up -d postgres-test postgres-migration-test redis mailpit`, set `DATABASE_URL_TEST`, `DATABASE_URL_MIGRATION_TEST`, and `REDIS_URL_TEST` to those local services, then run `corepack pnpm test:integration`. The test runner rejects non-loopback hosts and non-test database names; it never targets production RDS.
