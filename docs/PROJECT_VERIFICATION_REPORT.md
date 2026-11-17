# ExamGuard Project Verification Report

**Checked:** 2026-11-17
**Scope:** Local source, automated tests, builds, local browser state, and read-only public health checks. No production records were changed.

## Final follow-up verification (2026-11-17)

This dated follow-up supersedes earlier test counts and adds the production-origin Companion check performed after the report above was written.

| Area | Evidence | Result |
|---|---|---|
| Backend | `npm run test -w server` against loopback `examguard_test` | **234 passed, 0 failed, 0 skipped** |
| Frontend | `npm run test -w client` | **166 passed, 0 failed, 0 skipped** |
| AI service | `python -m unittest discover -v` | **57 passed, 0 failed, 6 skipped** (63 total; six authorized image fixtures absent) |
| Windows Companion auth helper | `dotnet run --project device-monitor.tests\ExamGuard.DeviceMonitor.SessionTests.csproj` | **Passed**: valid, missing, malformed, distinct-session, mismatched-session, and idle-expiry cases |
| Builds | Server and client build scripts; `dotnet build device-monitor\ExamGuard.DeviceMonitor.csproj --no-restore` | **Passed**; Companion build had 0 warnings and 0 errors |
| Assistant routes | Isolated-database HTTP integration test for teacher, proctor, institute admin, wrong-organization access, grounded/refused responses, analytics facts, and invalid input | **Passed** |
| Render health | Read-only `GET https://exam-guardd.onrender.com/health` | **HTTP 200**, `{"status":"ok"}` |
| Stable Vercel site | Opened `https://examguard-sooty.vercel.app/` in browser | **Loaded** |

### Companion production-origin 401: confirmed cause and fix status

- A browser request from the exact stable Vercel origin to `http://127.0.0.1:43117/health` included a fresh, correctly formatted 64-hex Bearer token. It returned **401** with the Companion's generic “Local browser session is not authorized” response. This confirms the request passed CORS/preflight and reached the local Companion; the failure was authorization, not a missing header or CORS rejection. The token was generated and used in-browser and was not recorded or displayed.
- The running Companion executable predates the current source. Its previous authorization logic retained a single browser token for the whole Companion process. The local Edge session had already registered its token, so a separate production-origin browser session was rejected.
- Current source replaces that single-token state with a bounded set of independent browser sessions, constant-time token comparison, idle expiry, and health-only re-registration. `/pair` and `/stop` still require an already registered browser session; exam pairing continues to use the server-issued, short-lived, attempt-scoped JWT.
- The current source passes the Companion authorization tests and builds successfully, but the updated executable was **not installed or launched**. The user was unavailable to approve replacing the running desktop program. Consequently, the stable-site 401 is not yet resolved on this machine and must not be reported as fixed in production. A signed/current Companion package and an approved local restart are still required for physical re-verification.

### Local application and exam lifecycle evidence

- The existing local browser was already open at `http://localhost:5173/app/take/...`. Its live page showed an active attempt with a running timer, “All changes saved,” active camera, current AI frame analysis, and Companion-connected status. The Companion window showed its local bridge ready.
- This was an already-active attempt with unknown ownership/backend configuration. It was not altered, submitted, or used to create additional records. This observation does not establish a complete teacher-to-results lifecycle. Fresh exam creation, student readiness, start, save/reload, submission, grading, and teacher review were not executed as one verified browser flow.
- The local readiness page had shown AI and private-evidence readiness, but this is not evidence of an actual Supabase evidence upload/download or of a full Cloud Run deployment health check.

### External and high-impact verification limits

- Supabase upload/retrieval was not attempted because no explicitly isolated test-storage project/bucket was provided. The smoke script writes an object; running it against unknown configuration could write to production storage, which was intentionally avoided.
- No authenticated production workflow was exercised. The production site opened unauthenticated; no production account credentials or permission to create/alter production exam records were supplied.
- Cloud Run was not independently queried because the service URL was not provided and reading `.env` was prohibited. The current local readiness UI did show authenticated AI-service readiness.
- The Companion executable was not replaced or relaunched after the required approval request could not be answered. No package signing certificate or release workflow was available in the repository.

## Executive summary

The local backend, frontend, AI service, and build checks were verified using an isolated loopback PostgreSQL `examguard_test` database. The test process received an explicit `TEST_DATABASE_URL`; tests left no application records, and the temporary test cluster was stopped and removed after validation.

The latest backend suite passed in that isolated local test database: 234 passed, 0 failed, 0 skipped. The frontend suite passed: 166 passed, 0 failed, 0 skipped. The AI service suite passed: 57 passed, 0 failed, 6 skipped (fixture-based tests intentionally skipped because the labeled fixtures are absent). Backend and frontend builds passed; the Windows Companion source also built and its authorization tests passed.

A focused inspection of the AI inference code confirmed there is no active `_FACE_RESULT_CACHE`, `_reuse_last_face_result`, or equivalent stale per-frame face-result reuse in the live pipeline. The live code reprocesses each frame independently; the negative assertion is retained in the regression tests to prevent that stale behavior from returning.

## Backend environment and validation protocol

The backend test runner requires `TEST_DATABASE_URL` to be set explicitly and to target a loopback PostgreSQL database named `examguard_test`.

Verified validation sequence used in this environment:

- PostgreSQL 17 was present on the machine under `C:\Program Files\PostgreSQL\17` even though it was not on the shell `PATH`.
- An isolated temporary cluster was created on `127.0.0.1:55432` with a dedicated `examguard_test` database.
- `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/examguard_test` was set for the backend test process.
- `npx prisma migrate deploy` was run against that database before final validation.
- The temporary database was confirmed empty of residual application records after test cleanup.
- The temporary cluster was then stopped and removed.

## Validation results

| Area | Command/check | Result |
|---|---|---|
| Backend tests | `cd D:\ExamGuard-local-integration; $env:TEST_DATABASE_URL='<loopback examguard_test URL>'; npm run test -w server` | **Passed**: **234 passed, 0 failed, 0 skipped** |
| Frontend tests | `cd D:\ExamGuard-local-integration; npm run test -w client` | **Passed**: **166 passed, 0 failed, 0 skipped** |
| AI service | `cd D:\ExamGuard-local-integration\ai-service; python -m unittest discover -v` | **Passed**: **57 passed, 0 failed, 6 skipped** |
| Server lint | `cd D:\ExamGuard-local-integration; npm run lint -w server` | **Passed** |
| Server build | `cd D:\ExamGuard-local-integration; npm run build -w server` | **Passed** |
| Import check | `cd D:\ExamGuard-local-integration; node server/scripts/check-imports.mjs` | **Passed** |
| API contract check | `cd D:\ExamGuard-local-integration; node server/scripts/check-api-contract.mjs` | **Passed** |
| Migration drift check | `cd D:\ExamGuard-local-integration; node server/scripts/check-migrations.mjs` | **Passed** |
| Prisma migrations | `cd D:\ExamGuard-local-integration\server; $env:DATABASE_URL='postgresql://postgres@127.0.0.1:55432/examguard_test'; npx prisma migrate deploy` | **Passed**: no pending migrations |

## AI stale-face-cache verification

A direct source search of the live AI service for stale face-result reuse markers returned only the negative assertion in [ai-service/test_inference.py](../ai-service/test_inference.py): the code asserts `_FACE_RESULT_CACHE` is absent and that identical frames are still processed independently. There were no active matches for:

- `_FACE_RESULT_CACHE`
- `_reuse_last_face_result`
- similar stale per-frame face-result caches or frame-similarity shortcuts in `ai-service/main.py`

This confirms the active inference pipeline does not reuse stale face boxes, stale head-pose results, or stale looking-away classifications across incoming frames. No rewrite was needed because the current implementation already processes each frame independently.

## AI validation limits

The AI suite intentionally skips the labeled fixture-based model tests when the required image samples are absent. The reported skip count is therefore expected rather than a failure:

- `test-phone-far.jpg`
- `test-phone-occluded.jpg`
- `test-no-phone.jpg`
- `test-many-faces.jpg`
- `test-no-faces.jpg`
- `test-looking-forward.jpg`
- `test-looking-away.jpg`

No claim of real-world accuracy or benchmark improvement is made beyond the local automated correctness checks above.

## Database cleanup confirmation

After the backend tests completed, the temporary `examguard_test` database was queried directly and all expected application tables were empty:

- `organizations`: 0
- `users`: 0
- `exams`: 0
- `exam_attempts`: 0
- `incidents`: 0
- `incident_events`: 0
- `evidence_objects`: 0
- `notifications`: 0

The temporary test cluster was then stopped and removed to leave the environment clean.

## Historical local workflow smoke tests (browser-verified; see dated follow-up above)

The app was started locally with the documented config and a working local PostgreSQL database. The following browser-verified workflows were exercised in this environment:

### 1) Public entry pages and registration flow
- Action performed: opened `/`, `/login`, `/register`, `/student/login`, and `/institute/login` in the browser.
- Expected result: landing pages and role-based sign-in pages load; institution registration page renders required identity-application fields.
- Actual result: all pages loaded successfully and the registration form showed the institution application fields, document upload slots, and review button.
- Test evidence: browser page snapshots for `/` and `/register` showed the sign-in/registration UI and required fields.
- Status: PASS

### 2) System admin login
- Action performed: signed in as `platform.admin@demo.examguard.test` with the local demo password.
- Expected result: platform admin session loads the system administration workspace and route guards allow the admin view.
- Actual result: login succeeded and the app loaded `/app` with the “System administration” overview and platform control-center modules.
- Test evidence: browser URL and dashboard text confirmed “System administration” and “Platform control center” after sign-in.
- Status: PASS

### 3) Institute administrator login
- Action performed: signed in as `aarav.admin@demo.examguard.test` with the local demo password.
- Expected result: institute admin session loads the institution overview and admin tools.
- Actual result: login succeeded and `/app` loaded the institution overview dashboard.
- Test evidence: browser snapshot showed “Overview” and the signed-in workspace banner for the demo institute.
- Status: PASS

### 4) Student login and dashboard access
- Action performed: signed in as `aditi.candidate@demo.examguard.test` and opened the student dashboard.
- Expected result: candidate dashboard shows assigned assessments and a secure exam workspace.
- Actual result: login succeeded and the student dashboard rendered “My assessments” with a live exam card and exam calendar.
- Test evidence: browser snapshot showed “Hello, [DEMO]”, “My assessments”, “Available now”, and the exam titled “[DEMO] CSE Fundamentals Assessment”.
- Status: PASS

### 5) Student exam readiness gate
- Action performed: clicked “Start readiness” on the candidate exam card.
- Expected result: the exam readiness page loads the mandatory checks and allows start only when all required requirements pass.
- Actual result: the readiness page rendered correctly and showed all required checks; camera, microphone, display sharing, and Companion checks remained pending or unavailable because the local browser on this environment does not expose those hardware permissions or the Windows Companion.
- Test evidence: browser snapshot showed required checks with state transitions including “Camera: Pending”, “Microphone: Pending”, “Full-display sharing: Pending”, and “Windows Companion: Unavailable”; the “Start secure exam” button remained disabled.
- Status: PASS (correct secure gating behavior), with local hardware blocker noted.

### 6) Session persistence / active session continuity
- Action performed: reloaded the signed-in student route after login and verified the browser remained in the authenticated session.
- Expected result: session persists across page refresh while the app remains in the same authenticated browser session.
- Actual result: the app stayed signed in and reloaded the candidate workspace without returning to the public sign-in page.
- Test evidence: browser page remained at `/app` or `/app/take/...` under an authenticated session after reload.
- Status: PASS

### 7) Password recovery UI and backend behavior
- Action performed: accessed `/forgot-password` and submitted a valid demo email address to the password-reset request endpoint.
- Expected result: the flow either sends an email reset code or returns a clear, security-safe message if the email provider is unavailable.
- Actual result: the route loaded successfully and the API returned a secure failure when email delivery was not configured for the local environment. The application did not display a false success or leak account existence.
- Test evidence: backend route `POST /api/auth/password-reset/request` returned a 503 status with the safe message when the email provider is unavailable; the browser UI remained in the reset flow.
- Status: PASS with environment blocker (email provider not configured locally)

### 8) AI service and private evidence readiness
- Action performed: opened the candidate readiness gate and observed the live readiness checks from the backend for AI and private storage.
- Expected result: AI service and private evidence storage are ready only when the service and storage are actually reachable and authenticated.
- Actual result: the readiness page reported `AI proctoring: Ready` and `Private evidence storage: Ready` in the local environment, confirming the API health checks passed and the private evidence test path was reachable.
- Test evidence: browser snapshot from `Examination readiness` showed the AI and private storage status as ready while the camera/display/hardware checks remained blocked by local operating-system permissions.
- Status: PASS (local backend/service readiness confirmed)

### 9) Teacher exam creation, delivery, and candidate assignment
- Action performed: logged in as `priya.teacher@demo.examguard.test`, opened `/app/exams`, and inspected the assessment plan and assignment dialog.
- Expected result: a teacher or coordinator can view the exam list, create an assessment, and assign candidates to a published exam.
- Actual result: the teacher workspace rendered the exam list with the published demo assessment, the “New examination” action, and the assignment dialog listing candidate records for the exam. The assignment dialog showed the live exam UUID and candidate list, confirming the delivery workflow is functional in the local environment.
- Test evidence: browser page snapshots from `/app/exams` showed the exam row `"[DEMO] CSE Fundamentals Assessment"` and the “Assign candidates” dialog with candidate entries such as `"[DEMO] Aditi Singh"` and `aditi.candidate@demo.examguard.test`.
- Status: PASS (teacher exam management and assignment UI active)

### 10) Full exam attempt start and completion status
- Action performed: selected the student exam from the candidate dashboard and opened the exam readiness page.
- Expected result: once every mandatory readiness check passes, the secure exam starts and the timer/answer workflow becomes active.
- Actual result: the exam could not be started in this browser because the mandatory checks remained pending or unavailable: camera blocked, microphone blocked, full display sharing not enabled, and the Windows Companion unavailable. The app correctly kept the “Start secure exam” button disabled and refused to bypass the checks.
- Test evidence: the readiness page showed `Camera: Pending`, `Microphone: Pending`, `Full-display sharing: Pending`, `Windows Companion: Unavailable`, and the button remained disabled.
- Status: BLOCKED by local hardware and platform permissions; not a product defect.

## Final workflow acceptance status

| Workflow | Status | Evidence |
|---|---|---|
| Platform admin login | PASS | Local system-admin login succeeded with `platform.admin@demo.examguard.test` and the workspace rendered the platform overview. |
| Institution admin login | PASS | Local institute-admin login succeeded with `aarav.admin@demo.examguard.test` and the institution overview loaded. |
| Teacher / coordinator exam list | PASS | The teacher workspace rendered the exam list and the assignment dialog with the real candidate roster. |
| Candidate dashboard and exam assignment visibility | PASS | Candidate `aditi.candidate@demo.examguard.test` saw the assigned exam on the dashboard and the readiness route loaded. |
| Mandatory readiness gating | PASS | The app blocked exam start until permissions and hardware checks were actually satisfied. |
| Real exam attempt start | BLOCKED | Camera, microphone, screen-share, and Companion checks cannot be satisfied in this browser environment. |
| Coding execution / live grading | BLOCKED | Requires the configured Judge0 or execution service and a fully ready exam session. |
| Private evidence upload / download | BLOCKED | Requires a real browser/media session and the institution’s private evidence storage configuration beyond local readiness checks. |
| Companion pairing and monitoring | BLOCKED | Requires the local Windows Companion application and hardware on the host machine. |

## Residual validation and release status

These checks were not re-run outside the local environment because they require external services, physical hardware, or production-like staging configuration:

- hosted Cloud Run benchmark and latency analysis
- real browser/Companion hardware verification
- signed Companion installer validation
- live Supabase private-storage upload/retrieval verification beyond the backend readiness check
- staged deployment and authorization checks

This report reflects actual verified local evidence. It does not claim full production readiness or hosted-system certification.
