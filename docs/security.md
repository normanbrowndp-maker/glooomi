# Security status

Updated 2026-11-09. This is an implementation summary, not a production security certification. External services and end-to-end behavior have not been verified.

## Authentication and email

- Refresh JWT is returned only as an HttpOnly cookie. Access JWT is held in application memory and sent as a bearer token.
- Refresh and logout require a CSRF token echoed in a custom header. Configure exact CORS origins, cookie domain, SameSite, and Secure settings for deployment.
- Refresh tokens are hashed and AES-GCM encrypted at rest for rotation. For 15 seconds after rotation, replay of the immediately previous token can return the same current token to support simultaneous tabs. A stolen old refresh token can therefore be replayed during this window if the attacker can also satisfy the CSRF check; after the window, reuse revokes all user sessions. Reduce the grace window if the residual risk is unacceptable.
- Verification codes are HMAC-SHA256 digests with ten-minute expiry, at most five failed attempts, atomic one-time consumption, resend cooldown, and Redis-backed distributed limits for auth operations.
- Email recipient and code are AES-GCM encrypted in outbox rows; queue payloads contain only outbox IDs. SMTP secrets and codes are not intentionally logged. SMTP/PostgreSQL acknowledgment cannot be atomic, so a retry after ambiguous SMTP acceptance may duplicate a message.

## Media controls

- Authenticated upload intents create a database record owned by the caller and issue a five-minute exact-key presigned POST. Size range and declared content type are constrained by the signed policy.
- Finalization verifies S3-reported length and content type plus a supported magic-byte signature. MIME type alone is not trusted. Avatar uploads are images only; videos are limited to 50 MiB and images to 10 MiB.
- Assets must be READY, owned by the caller, unexpired, and created for the matching purpose before they can be attached. The attachment state change and business record write share a transaction.
- New objects use the private `private-media/` prefix. API-mediated signed GET URLs expire after five minutes; they are bearer links until expiration. The older Terraform CloudFront grant is scoped to `users/*` for legacy objects and does not grant access to the new prefix.
- Owner deletion is refused for attached media. Expired unattached pending/ready and failed/deleted objects are retried by cleanup. Database/storage operations are not atomic; deletion may be delayed if S3 is unavailable.
- Signature checks are lightweight format checks, not malware scanning or full decoder validation. Large videos, multipart uploads, FFmpeg processing, and range-aware delivery are not implemented.
- Existing legacy `mediaUrl` rows can still contain public URLs. New writes use media IDs; legacy content needs a separate controlled migration if it must be made private.

## Operational limitations

- Redis is required in production for distributed rate limits and the email queue. Alerting and failure behavior must be exercised with the deployed Redis configuration.
- No live Neon, S3, Gmail, or browser integration tests were run in this environment. No production database was accessed and no infrastructure was provisioned.
- The legacy Terraform template still defines RDS, CloudFront, ECS, and other potentially billable resources. Do not apply it for the Neon target architecture without redesign and explicit cost review.
