# Gmail SMTP and email verification

## Local direct mode (default outside production)

Local development no longer requires Redis, BullMQ or an email worker. With the existing database and SMTP configuration, run `corepack pnpm dev` and open `http://localhost:5173`. Do not run migrations against the primary database or change `.env` without permission.

`EMAIL_DELIVERY_MODE=direct` is the default outside production. Registration creates the account but does not send a message or create a code. The first verification screen displays the email and “Отправить код”. Only this explicit action calls `/api/auth/resend-code`, which commits a HMAC-hashed, expiring code to PostgreSQL and then awaits SMTP outside the transaction. No outbox row is created. Redis connections, outbox polling and workers are disabled in this mode. Local request limits use process memory even if a stale `REDIS_URL` is configured. Code attempts and cooldown remain in PostgreSQL.

SMTP success means acceptance by the SMTP server, not guaranteed Inbox delivery. If SMTP fails, HTTP 503 (`EMAIL_DELIVERY_FAILED`) keeps the account and code available; the UI offers a resend after 60 seconds. A timeout may occur after acceptance, so a code that arrives can still be entered. Codes expire after 10 minutes, allow five incorrect attempts, and are invalidated by a resend. Cooldown returns HTTP 429 with `retryAfterSeconds` instead of pretending another message was sent.

Registration returns the same neutral continuation message for a new, unverified or verified email without creating duplicate accounts or changing existing passwords. Resend success also returns a neutral message for unknown/verified/unverified addresses. Use the login-screen confirmation action, or log in with the correct password for an unverified account to open step one. Requesting a fresh code never calls `/register`. Password reset uses the same transport but a separate verification purpose and screen; its codes cannot confirm an email.

After an accepted request, step two shows six individual digit cells, full-code paste, keyboard navigation, confirmation and resend. Both success and limit responses provide `retryAfterSeconds`; the UI persists its deadline rather than restarting a 60-second timer on reload. The response includes `expiresAt`. Session storage retains only the email, step and timing metadata, never codes, passwords or session tokens. Reload neither sends mail nor registers an account. Successful confirmation clears the draft and enters the application using the existing secure session logic.

Required Gmail variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `EMAIL_CODE_PEPPER` (keep the existing pepper, at least 32 bytes). Gmail examples appear below. Google App Password display spaces are removed only in memory. Port 587 with `SMTP_SECURE=false` requires STARTTLS. See [Nodemailer Gmail guidance](https://nodemailer.com/guides/using-gmail).

After `corepack pnpm build`, run `node apps/api/scripts/check-email-local.mjs` for read-only diagnostics. It checks presence and compatibility without printing values, authenticates SMTP without sending email, then starts/stops an isolated API on port 3317 in direct mode without Redis. Database startup performs no migrations or writes.

Run `corepack pnpm typecheck`, `corepack pnpm test`, and `corepack pnpm build`. Unit tests mock SMTP/PostgreSQL and exclude the separately invoked legacy integration suite. `GET /api/health/email` reports `mode`, redacted SMTP health and Redis `not_required` in direct mode. Fixed safe reason codes replace raw SMTP error logging.

## Optional legacy Mailpit environment

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

Keep credentials private. Use a Google App Password, not the regular account password. `GET /api/health/email` never returns credentials. SMTP authentication health alone does not prove delivery of a particular message.

## Optional queue mode: retry and data handling

The following architecture applies only to `EMAIL_DELIVERY_MODE=queue` (the production default). It needs Redis and a separately running `corepack pnpm dev:worker`. Queue success reports a queued request rather than successful delivery. Production still requires Redis for distributed auth rate limits even when direct email is explicitly selected. Existing outbox rows and accounts are preserved and ignored by the dispatcher in direct mode.

Explicit verification-code and password-reset requests write the verification record and an AES-GCM-encrypted `EmailOutbox` row in one PostgreSQL transaction in queue mode. Registration itself does not request a code in either mode. The API dispatcher enqueues only the outbox UUID. The separate worker decrypts the payload in memory and sends through the same `MailService` implementation used by the API health check.

BullMQ retries delivery up to five times with exponential backoff. Outbox polling recovers jobs after API/worker restarts and uses a database lease plus a stable job ID to deduplicate enqueueing. Failed jobs end in `FAILED` and have their encrypted payload cleared. Email delivery is at-least-once: if SMTP accepts a message and the worker loses the acknowledgment before updating PostgreSQL, a retry may deliver the same message again; a stable `Message-ID` is used to help downstream diagnostics.
