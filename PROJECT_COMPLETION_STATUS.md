# ExamGuard completion status

## Completed

- Preserved the existing tenant-scoped Express/PostgreSQL examination, grading, verification, reporting, and proctoring implementation.
- Added password-policy enforcement to organization registration and made recovery responses account-enumeration safe.
- Added Google and Microsoft OIDC authorization-code sign-in support with PKCE, nonce, state, issuer/audience validation, short-lived server-side authorization state, and explicit existing-identity linking only.
- Added login-provider discovery and real provider actions only when server credentials are configured.
- Added directory retry, five-minute result caching, timeout behavior, and an actionable review-request fallback while retaining the distinction between public results and verified institutions.
- Updated the environment example with an API base URL and OAuth callback directions.

## Verification run

- `npm run build -w client` — passed.
- `npm run build -w server` — passed.
- `npm run test -w server -- --test-concurrency=1` — 19 passed.
- The default parallel test command exceeded this host's memory while launching workers; the serial command above passed.

## External configuration required

- PostgreSQL connection details (`DATABASE_URL`) and applied Prisma migrations.
- A private S3-compatible bucket for candidate documents.
- A mail-webhook endpoint for password-reset delivery.
- Google and/or Microsoft application registrations, client credentials, and exact API callback URLs.
- Optional FastAPI dependencies and a validated YOLO model if camera/phone analysis is required.

## Known limitation

The app intentionally does not claim browser detection of nearby devices, Wi-Fi/Bluetooth, or other local applications. Automated proctoring signals are review priorities, not automatic findings of misconduct.
