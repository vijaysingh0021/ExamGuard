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

## Phase 0 audit — 2026-11-10

### Architecture reviewed

- Root workspaces: React/Vite client and Express/TypeScript server.
- Prisma/PostgreSQL schema with forward-only migrations, tenant-scoped IDs and role-based route authorization.
- Optional FastAPI frame-analysis boundary and Windows Companion boundary.
- Existing unit/integration coverage in `server/test/` and `client/src/test/`.

### Already implemented

- Tenant-scoped authentication, membership authorization, password hashing, OAuth PKCE/nonce/state validation and private evidence storage.
- Exam delivery, autosave/submission handling, grading, result publication, candidate verification status, notifications, audit logs and reviewer incident decisions.
- Browser visibility/fullscreen signals, AI rolling-window deduplication, optional YOLO phone inference, MediaPipe face/head-pose analysis, and Companion BLE/Wi-Fi observations.
- Evidence inventory pagination, access auditing, short-lived private URLs, storage-key scoping, metadata redaction and explicit radio-activity limitations.

### Gaps confirmed for incremental implementation

- Password recovery currently uses a hashed single-use link token. The requested six-digit OTP, five-minute expiry, resend cooldown, incorrect-attempt limit and session invalidation are not implemented.
- Identity verification currently submits a status request; the requested live-selfie/document capture, resubmission attachments and full reviewer document workflow are not complete.
- Student explanations have a persisted incident response path, but the complete request/follow-up/attachment/decision workflow and dedicated student UI need verification and completion.
- Browser activity records visibility/fullscreen events but does not yet consistently capture duration, regain events or configurable threshold summaries.
- Screen evidence, contextual before/after incident frames, and complete results/report exports/revision history remain incomplete.
- AI health and frame inference are implemented as opt-in boundaries; real model/image validation and hardware verification are unavailable in this environment.

### Baseline verification

- Server serial tests: passed.
- Server typecheck: passed.
- Server build: passed.
- Client typecheck: passed.
- Client production build: passed, with the existing chunk-size warning.
- Client tests: initially failed because the assistant log called `scrollTo` without a jsdom capability; guarded implementation is now applied and must be re-run.

### Phase 1 result

- Completed the default Evidence Center language pass in `client/src/evidence-center.tsx`.
- Event types now use reviewer-facing descriptions, radio activity is explicitly non-conclusive, and raw metadata/review metadata are behind an advanced-details disclosure.
- Added safe guards for browser-only dialog/scroll APIs and preserved the existing production behavior.
- The initial full-suite reconciliation found two fixture-contract issues in `client/src/test/workflows.test.tsx`:
  - `candidate and teacher workflows > shows a loading state, then routes an available candidate to readiness` failed at `CandidateDashboard` because the fixture omitted `candidate.name` (`candidate-dashboard.tsx:67`).
  - `candidate and teacher workflows > lets a teacher select candidates and posts each assignment to the real route contract` could not find a checkbox because the candidate-list fixture omitted `X-Page`, `X-Page-Size`, `X-Total-Count`, and `X-Total-Pages`; the production client intentionally refuses to show an unverified/incomplete assignment list.
- Reconciled the fixtures to the actual API contracts without weakening the application checks.
- Full client suite after reconciliation: **14 test files passed, 116 tests passed**.
- Client typecheck: **passed**.
- Client production build: **passed**; Vite reported the existing chunk-size warning for the 1,049 kB JavaScript bundle.
- Server serial regression suite: **passed** with exit code 0.

## Phase 2 implementation result — student explanations and reviewer responses

### Reused functionality

- Existing `StudentExplanation` model, incident status transitions, reviewer authorization, notification records, private storage interface, candidate dashboard, Evidence Center and audit-log helper.
- Existing five-megabyte multipart validation and private evidence storage; no public storage URL or credential is returned.

### Implemented

- Added additive explanation workflow fields for reviewer question, requester/decision identities, deadline, response timestamp, decision, decision reason/timestamp, and reopening timestamp.
- Added reviewer request, request detail, decision, clarification, and reopening APIs.
- Added student-owned request listing and response API with optional validated image/PDF attachment.
- Added idempotent notification creation for requests, responses, clarification, and decisions.
- Added student Explanation Requests section with simple statuses, deadlines, responses, and attachment submission.
- Added Evidence Center actions for requesting explanations, accepting, dismissing, escalating, and requesting clarification.
- Added audit records for request, reopening, response, follow-up, and decisions.
- Added email-outbox allow-list entries for explanation notifications.

### Database migration

- Added forward-only migration `server/prisma/migrations/20261110010000_explanation_workflow/migration.sql`.
- Verified the migration against `server/prisma/schema.prisma` with `prisma validate`.
- Applied only to PostgreSQL database `examguard_dev` on `localhost:5432` with `prisma migrate deploy`.
- The protected `examguard` database was not connected to, modified, migrated, reset, or deleted.

### Phase 2 verification

- Isolated development E2E workflow: **passed** against `examguard_dev`.
  - Reviewer request and duplicate-request prevention: passed.
  - Student-owned listing and cross-student isolation: passed.
  - Unauthorized reviewer and cross-organization access: passed.
  - Invalid attachment type/content rejection: passed.
  - Valid private PDF attachment upload and organization/candidate-scoped key: passed.
  - Student response, duplicate submission prevention, clarification, follow-up response, and acceptance: passed.
  - Response lock after reviewer decision: passed.
  - Request/response/follow-up/decision notifications and per-explanation deduplication: passed.
  - Response/decision timestamps and immutable audit records: passed.
- Server tests: **180 passed, 0 failed**.
- Client tests: **14 files, 117 passed, 0 failed**.
- Server typecheck: passed.
- Server build: passed.
- Client typecheck: passed.
- Client production build: passed.
- Vite emitted the existing bundle-size warning; no build failure.
- Fixed notification deduplication so separate explanation requests with identical titles do not suppress each other's clarification or decision notifications; retries for the same explanation remain deduplicated.
- Phase 2 is **complete and regression-verified** for the implemented workflow.

### Known limitations and manual verification

- Email delivery requires the configured existing provider and outbox worker; in-app notifications are implemented independently.
- Attachment access is stored privately but a dedicated student/reviewer attachment download UI is not yet exposed; the existing secure storage boundary remains the access control point.
- Deadline reminder scheduling is not implemented; request and clarification notifications are sent immediately.

## Phase 3 implementation result — secure password recovery and email OTP

### Audit and reused functionality

- Reused the existing `PasswordResetToken` model, password policy, authentication routes, direct secret-email delivery, audit helper, and client Forgot/Reset password pages.
- No duplicate password-recovery model or authentication flow was introduced.

### Implemented

- Replaced reset-link issuance with a six-digit cryptographically secure OTP flow.
- Stores only a SHA-256 OTP hash; OTPs expire through configurable TTL, are single-use, and have bounded verification attempts.
- Added resend cooldown and retained IP rate limiting for password-reset endpoints.
- Preserved generic request responses for registered and unknown email addresses.
- Added OTP verification and opaque reset-session token exchange.
- Invalidated sessions issued by the current authentication flow after password change using the existing user `updatedAt` timestamp as the session epoch.
- Added password-change confirmation email delivery.
- Added client loading, error, verification, expiry/replay error, and success states.
- Never logs OTPs or passwords.

### Database migration

- Added additive migration `server/prisma/migrations/20261110020000_password_reset_otp/migration.sql`.
- Applied only to `localhost:5432/examguard_dev`.
- The protected `examguard` database was not accessed or modified.
- No database migration was applied to `examguard_test`; existing server tests remained compatible.

### Phase 3 verification

- Server tests: **182 passed, 0 failed**.
- Client tests: **14 files, 118 passed, 0 failed**.
- Server typecheck: passed.
- Client typecheck: passed.
- Server production build: passed.
- Client production build: passed.
- Isolated development HTTP probe: passed for enumeration protection, OTP delivery, resend cooldown, OTP verification, replay prevention, password-change confirmation email, and invalidation of the pre-reset JWT.
- Existing Vite bundle-size warning remains informational.

### Known limitations

- The existing webhook email provider remains the delivery boundary; if it is unavailable, the request remains generic and no usable OTP is issued.
- Password reset rate limiting remains process-local through the existing express-rate-limit infrastructure; a distributed deployment would require a shared limiter store.

### Incremental implementation plan

1. Evidence Center plain-language presentation and advanced-details disclosure.
2. Student explanation request, response, attachment and reviewer decision workflow.
3. Six-digit email OTP recovery with rate/attempt controls and invalidation.
4. Identity capture/document workflow with private storage and reviewer access.
5. Browser activity duration/regain tracking and threshold summaries.
6. Consent-based screen evidence with lifecycle and retention controls.
7. Real AI inference validation and evidence association.
8. Incident frame quality/context improvements.
9. Results, reports, publication scheduling and audited revisions.
10. Targeted security, regression, build and manual hardware verification.
