# Development progress

Updated 2026-11-06.

## Product foundation

- Started from an empty repository and implemented the gloomi mobile-first social product from the supplied Russian prompt and Figma feed reference (`4:19659`, 390 × 844).
- Workspace contains a React/Vite client, NestJS API, PostgreSQL/Prisma data model, Neon connection configuration, environment template, and AWS Terraform template.
- Implemented registration, login, email verification, refresh/logout, profiles and privacy setting, follow requests, feed/discovery, image/video posts, likes, saved posts, comments, stories, notifications, conversations, persisted REST messaging, Socket.IO message events, and bounded multipart S3 uploads.
- Frontend includes auth, feed, post/story creation and story view, search/discovery, profile editing/following, save/like/comment actions, notifications, and conversations.
- Gmail delivery needs a configured Gmail App Password. No email credentials are included, so delivery has not been verified.

## AWS preparation

- Terraform defines a VPC, private RDS PostgreSQL, encrypted Redis replication group, private/versioned/encrypted media bucket with CloudFront OAC, ECR, ECS Fargate API, HTTPS ALB, CloudWatch, and IAM roles.
- IAM Policy Autopilot reviewed API S3 upload and Secrets Manager access. The task role applies the generated actions with Terraform resource ARNs narrowed to the application bucket prefix and RDS managed secret.
- Infrastructure is code only. No AWS resources were created and no paid deployment was attempted.

## Validation completed

- Prisma schema formatted, validated, and generated; `prisma/migrations/0001_init/migration.sql` regenerated from the current schema.
- API and web TypeScript checks pass.
- API unit tests pass: 4 tests in `social.service.spec.ts`.
- API Nest build and web production Vite build pass.

## Remaining verification and product work

- A Neon-backed runtime smoke test is pending Neon connection strings in `.env`. Terraform CLI is also unavailable, so Terraform formatting, validation, and plan remain unverified.
- No AWS deployment, Gmail delivery, or end-to-end browser session has been run.
- Remaining product work includes password reset, follow-request approval, moderation/reporting, rate limiting and hardened refresh-token rotation, media transcoding, browser push, a dedicated saved-post screen, and static web hosting/deployment.
