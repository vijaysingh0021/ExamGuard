# Security review

Audit date: 2026-11-06. This is a source and automated-test review, not a penetration test or security certification.

## Verified controls

- JWT bearer authentication validates UUID subjects; tokens expire after eight hours. Companion tokens are audience scoped and expire after ten minutes.
- Passwords use bcrypt with 12 rounds. Reset tokens are high-entropy, stored as hashes, expire after 15 minutes, and are atomically single-use.
- Login errors do not reveal whether an account exists. Password reset responses are generic. Auth and reset endpoints are rate limited.
- OAuth uses provider state, nonce, PKCE and one-time stored authorization state. OAuth completion session data now travels in a URL fragment and the client clears that fragment before session use, avoiding query-string/referrer/server-log exposure.
- Protected organization routes require active membership and a permitted role. Candidate attempt routes scope attempts to the authenticated candidate user. Socket exam subscriptions validate JWT, membership role, organization, and exam relationship before joining a room.
- Evidence is authenticated before processing, ownership/deadline/status checked, size/MIME/signature checked, and written using generated private object keys. Retrieval uses short-lived signed storage URLs only for authorized incident views.
- Browser and radio signals are review-only. They do not automatically pause, terminate, accuse, or grade a candidate.
- API responses use `no-store`, disable `X-Powered-By`, set `nosniff`, restrictive permissions policy, same-site resource policy, a referrer policy, and production HSTS.

## Findings and limits

| Status | Finding | Action |
| --- | --- | --- |
| Remediated | OAuth session payload was in the callback query string. | Moved to fragment and cleared client-side after parsing; regression test added. |
| Open | Zod 3 advisory for constrained collection exhaustion. | Body size limit and schema bounds mitigate input size; upgrade to Zod 4 requires dedicated compatibility migration. |
| Open | CORS has a single configured origin but no deployment-specific verification. | Confirm production `CLIENT_URL`, TLS reverse-proxy behavior, and origin policy during deployment. |
| Open | Password-reset email is an optional webhook adapter. | Verify outbound allowlist, timeout, authentication, and provider privacy contract before enabling. |
| Blocked | AI service has no authenticated API adapter or approved consent/retention policy. | See `AI_INTEGRATION_CONTRACT.md`; do not expose service publicly. |
| Unverified | Database IDOR/cross-tenant integration suites write fixtures. | Their guards are prepared; execution requires owner approval. |

## Review scope limits

No migrations, production-data checks, external OAuth callbacks, object-storage calls, live AI inference, hardware scanning, or database-writing tests were performed. No claim of compliance or certification is made.
