# Email worker architecture

## Processes

- API process: handles HTTP requests, writes outbox rows inside business transactions, and polls eligible outbox rows every two seconds.
- Email worker process: starts independently with `pnpm dev:worker` (or `pnpm --filter @gloomi/api start:worker` after build). It consumes `gloomi-emails` jobs and uses `MailService` for SMTP; SMTP transport logic is not duplicated.
- PostgreSQL is the durable source of truth. Redis/BullMQ is the delivery queue and can be rebuilt from pending or expired-lease outbox rows.

## State flow

`PENDING → PROCESSING → SENT`

Enqueue/SMTP failures are retried with capped exponential backoff. Worker crashes leave a `PROCESSING` lease; the API dispatcher reclaims it after two minutes. Delivery attempts are capped at five and outbox dispatch attempts at ten. Terminal failures become `FAILED` and encrypted payload columns are cleared.

The `jobId` is the outbox UUID and is unique in PostgreSQL. Queue data contains only `{ outboxId }`; it never contains recipient addresses or verification codes. Email recipient and code are stored together as AES-256-GCM ciphertext in PostgreSQL, keyed from `EMAIL_CODE_PEPPER` with domain separation. Outbox creation and code creation happen in the same transaction.

Delivery is at-least-once because SMTP and PostgreSQL cannot commit atomically. Stable Message-IDs and the outbox job ID make retries traceable, while an ambiguous SMTP acknowledgment can still result in duplicate mail.

SIGTERM/SIGINT close the BullMQ worker and Nest application context, which closes Prisma, Redis, and pooled SMTP connections gracefully.

## Local test services

`docker compose up -d postgres redis mailpit postgres-test postgres-migration-test` starts isolated application-test and migration-test databases. The migration verification runs each migration inside a transaction and rolls it back, preserving any data in the dedicated migration-test database.
