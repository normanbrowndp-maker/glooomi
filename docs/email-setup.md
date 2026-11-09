# Email setup

## Local development with Mailpit

Start the isolated development services:

```sh
docker compose up -d postgres redis mailpit
```

Use these local values in `.env` (do not commit the file):

```env
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_SECURE=false
SMTP_FROM=no-reply@gloomi.local
SMTP_FROM_NAME=gloomi
REDIS_URL=redis://localhost:6379
```

Mailpit captures outgoing mail at [http://localhost:8025](http://localhost:8025). The local SMTP transport is unauthenticated only for Mailpit on port 1025.

## Gmail SMTP

Create a Google App Password for the sending mailbox and configure:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=yourmail@gmail.com
SMTP_PASSWORD=your_16_character_app_password
SMTP_SECURE=true
SMTP_FROM=yourmail@gmail.com
SMTP_FROM_NAME=gloomi
SMTP_CONNECTION_TIMEOUT=10000
SMTP_GREETING_TIMEOUT=10000
SMTP_SOCKET_TIMEOUT=20000
```

Store production credentials in AWS Secrets Manager. Do not use a Google account password, Gmail API, or OAuth for this SMTP integration. `GET /api/health/email` reports redacted SMTP and Redis status; it never returns credentials.

## Retry and data handling

Signup and password-reset operations write the verification record and an AES-GCM-encrypted `EmailOutbox` row in one PostgreSQL transaction. The API dispatcher enqueues only the outbox UUID. The separate worker decrypts the payload in memory and sends through the same `MailService` implementation used by the API health check.

BullMQ retries delivery up to five times with exponential backoff. Outbox polling recovers jobs after API/worker restarts and uses a database lease plus a stable job ID to deduplicate enqueueing. Failed jobs end in `FAILED` and have their encrypted payload cleared. Email delivery is at-least-once: if SMTP accepts a message and the worker loses the acknowledgment before updating PostgreSQL, a retry may deliver the same message again; a stable `Message-ID` is used to help downstream diagnostics.
