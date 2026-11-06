# gloomi

Mobile-first social network starter based on the provided gloomi Figma screens. The current implementation is a working product foundation: account registration and Gmail SMTP verification, persisted profiles, follow-aware feed, photo/video posts, likes, comments, discovery/search, expiring stories, notifications, and private conversations over REST plus Socket.IO.

## Stack

- `apps/web`: React, TypeScript, Vite, React Router, TanStack Query, Axios, CSS variables.
- `apps/api`: NestJS REST API, Socket.IO gateway, JWT authentication, DTO validation, bcrypt password hashing, Nodemailer Gmail SMTP, bounded multipart uploads to S3.
- `prisma`: PostgreSQL schema and migrations.
- `infrastructure/terraform`: AWS VPC, private RDS PostgreSQL, private Redis, S3 media bucket behind CloudFront, ECR, ECS Fargate, ALB, CloudWatch, IAM roles.
- `docker-compose.yml`: local PostgreSQL and Redis services.

## Local development

Prerequisites: Node.js 20+, Corepack/pnpm 9+, and a Neon database.

1. Create a Neon project and copy both connection strings from its Connect dialog. Use the pooled URL (hostname contains `-pooler`) for `DATABASE_URL`; use the direct URL (without `-pooler`) for `DIRECT_URL`. Both should require TLS (`sslmode=require`).
2. Copy `.env.example` to `.env`, add those URLs, and set distinct random JWT secrets. SMTP values may stay blank while working on the UI and API; registration email delivery needs Gmail credentials.
3. Install dependencies: `corepack pnpm install`.
4. Generate Prisma Client and apply migrations to Neon: `corepack pnpm db:generate` then `corepack pnpm db:migrate`.
5. Start the API and frontend: `corepack pnpm dev`.
6. Open `http://localhost:5173`.

The API listens on `http://localhost:3000`; endpoints are under `/api`. Swagger is not enabled yet. Uploaded media is disabled until `S3_BUCKET` is configured and the runtime identity can write to it. No demo accounts or fixture social content are injected: feed, stories, and discovery use database rows created through the API.

## Required environment values

- `DATABASE_URL`: Neon pooled PostgreSQL connection string for the running API.
- `DIRECT_URL`: Neon direct PostgreSQL connection string used by Prisma CLI migrations.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: independent high-entropy secrets.
- `WEB_ORIGIN`: exact allowed browser origin(s), comma-separated.
- Gmail SMTP: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER`, `SMTP_PASSWORD` (Google App Password), `SMTP_FROM` (verified sender address), `SMTP_FROM_NAME`.
- Media: `AWS_REGION`, `S3_BUCKET`, `MEDIA_PUBLIC_BASE_URL` (CloudFront media distribution in AWS).
- Optional realtime worker connection: `REDIS_URL`. The current chat gateway uses Socket.IO directly and does not require Redis for local development.

Do not commit `.env`. In AWS, inject JWT and SMTP values from Secrets Manager; use the RDS managed master secret. Configure Gmail's App Password and sender mailbox outside this repository.

## AWS preparation

The Terraform under `infrastructure/terraform` is a deployment template and does not create anything until an operator runs Terraform. Review every resource and expected charge, configure an encrypted remote state backend and locking, issue an ACM certificate in the selected region, create the Secrets Manager values listed in `terraform.tfvars.example`, push an immutable API image to ECR, and supply a real DNS record before applying. Set `deletion_protection` and final-snapshot behavior deliberately for production.

The initial template favors a low-capacity single-AZ development database and a single Redis node. For production, select multi-AZ database/cache options, add NAT or VPC endpoints as appropriate, configure autoscaling and a deploy pipeline, define backups/restore drills, alarms, WAF/rate limits, and custom CloudFront domains. Public media reads are served through CloudFront; the S3 bucket itself stays private. The browser app is currently built locally; static web hosting/deploy automation is a follow-up infrastructure task.

Before applying, validate the Terraform plan in the intended AWS account. Never run `terraform apply` from this repository without explicit operator review.

## Current API surface

- `POST /api/auth/register`, `/login`, `/verify-email`, `/resend-code`, `/refresh`, `/logout`; `GET /api/auth/me`.
- `GET /api/feed`, `/explore`, `/search/users`, `/profiles/:username`; authenticated profile changes via `PATCH /api/profiles/me`.
- `POST /api/posts`, `/posts/:id/like`, `/posts/:id/save`, `/posts/:id/comments`; `GET /api/posts/:id/comments` and `/api/saved`.
- `POST /api/profiles/:id/follow`, `/unfollow`; `GET/POST /api/stories`.
- `GET /api/conversations`; `POST /api/conversations/:peerId`; `GET/POST /api/conversations/:id/messages`.
- Socket.IO namespace `/messages`: `conversation:join`, `message:send`, and `message:new`.
- `GET /api/notifications`; `POST /api/media/upload`.

## Known gaps

Password reset, follow-request approval, reposts, highlights/story archive, moderation/report workflows, rate limiting, robust refresh-token rotation, media transcoding, accessible video playback, browser push, and AWS static frontend hosting are not implemented yet. No production deployment, Gmail delivery, or Terraform plan has been run in this environment. Profile editing and basic saved-post endpoints are implemented; a dedicated saved-posts screen is still pending.
