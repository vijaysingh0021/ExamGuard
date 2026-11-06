# Master Project Audit — ExamGuard

Audit date: 2026-11-06. This document describes observed repository state; it does not treat a route, UI, or schema alone as proof of a completed workflow.

## Architecture inventory

| Area | Observed implementation | Status |
| --- | --- | --- |
| Web client | React, Vite, TypeScript, Tailwind, Axios and React Query; Vitest + Testing Library component tests | PARTIALLY VERIFIED; no live API/browser journey run |
| API | Express TypeScript application factory, Socket.IO bootstrap, Zod validation | IMPLEMENTED BUT UNVERIFIED end-to-end |
| Database | PostgreSQL Prisma schema, six committed migrations, tenant-scoped models | VERIFIED schema state only |
| Identity | Password login/register/reset, JWT, membership roles, Google/Microsoft OIDC handlers | IMPLEMENTED BUT UNVERIFIED against a database |
| Exam flow | Exams, questions, assignments, attempts, answers, submission, grades and reports | IMPLEMENTED BUT UNVERIFIED end-to-end |
| Evidence | Private-storage adapter, ownership/deadline checks, MIME and signature validation | IMPLEMENTED BUT UNVERIFIED integration suite |
| Proctoring | Browser and radio signals produce review records; browser path is review-only | VERIFIED by source inspection and unit tests |
| AI service | FastAPI health and optional MediaPipe/YOLO analysis implementation, with unavailable-model handling tests | PARTIALLY VERIFIED; optional CV/model runtime unavailable/unverified |
| Device companion | .NET Windows BLE/Wi-Fi consent UI and telemetry client; Wi-Fi native scan runs off the UI thread | COMPILES; UNVERIFIED on compatible hardware |

## Verified facts

- Backend and frontend TypeScript builds pass when run independently.
- The server exposes tenant-scoped organization routes and candidate-attempt ownership checks.
- Browser proctoring signals are stored as `recorded` review signals; they do not automatically pause, terminate, grade, or punish an attempt.
- Both database-writing suites use an actual `SELECT current_database()` guard before cleanup or fixture setup and abort unless Prisma is connected to `examguard_test`.
- `examguard_test` has the 27 Prisma application tables plus `_prisma_migrations`; all six committed migrations are applied. This audit did not modify that database.
- Frontend component tests pass: authentication success/error/reset paths, candidate loading/error/navigation, and teacher assignment endpoint contracts (7 tests). Their Axios transport is controlled at the component boundary; this does not substitute for API or browser end-to-end acceptance.
- AI unit tests pass: valid frame result, non-image/empty input rejection, unavailable CV stack, unavailable optional model, and model inference failure (5 tests). The response continues to state that frames are processed in memory and no incident/action is created.
- The .NET device-monitor project builds with zero warnings/errors. No Bluetooth, Wi-Fi, consent prompt, or live backend behavior was exercised.

## Confirmed issues and safe priority work

1. **Database-writing integration coverage is blocked by authorization.** The complete inventory is `server/test/evidence-upload.test.ts` (creates/deletes organizations, users, candidates, exams, attempts and evidence fixture state) and `server/test/integration.test.ts` (creates/deletes organization, user, membership, candidate, exam, questions, attempt answers and attempts). Both now set the `examguard_test` URL before dynamically importing Prisma-dependent modules, then execute `SELECT current_database()` before cleanup/setup. Neither suite was run in this audit.
2. **AI readiness and integration are environment dependent.** The service intentionally reports unavailable inference when OpenCV, MediaPipe, or a configured YOLO model is absent. The backend currently exposes AI configuration only as health/status metadata; there is no reviewed, authenticated server-to-AI inference adapter. Adding one requires an explicit privacy, retention, timeout, authentication, and signal-schema decision; it must continue to create review-only records only.
3. **Companion validation is environment dependent.** Windows 10+ hardware, Bluetooth permission, Wi-Fi capability, consent interaction, and a paired live API are required.
4. **Email delivery is conditional.** Password-reset delivery only occurs with the configured webhook provider; status endpoints accurately report no adapter otherwise.

## Integration-suite target and safety status

| Suite | Fixture writes/deletes | Effective target protection | Run status |
| --- | --- | --- | --- |
| `server/test/evidence-upload.test.ts` | Yes | Sets `DATABASE_URL` before dynamic imports; checks Prisma `current_database()` is exactly `examguard_test` before setup/cleanup | Not run: requires write authorization |
| `server/test/integration.test.ts` | Yes | Sets `DATABASE_URL` before dynamic imports; checks Prisma `current_database()` is exactly `examguard_test` before setup/cleanup | Not run: requires write authorization |

The historical import-order risk was that static ESM imports initialized `prisma.ts` before the test module assigned `DATABASE_URL`, allowing repository `.env` values to select `examguard`. Both suites now avoid that order. The guards never fall back to `examguard`.

## Workflow implementation assessment

The source contains the following API/client chain, but it has not been executed against a test database in this audit: teacher creates draft exam, adds questions, publishes it, assigns candidates; a candidate starts an authorized attempt, answers autosave, and submits; staff can grade and publish results; the candidate dashboard displays only released grades. Browser proctoring and optional companion records are explicitly review-only.

The missing link is optional AI inference-to-signal orchestration. The FastAPI service has a disclosed frame-analysis endpoint, but no backend production adapter calls it or turns its response into a review record. This must remain deliberately unimplemented until the required privacy/security contract is approved; direct browser-to-AI inference or automatic disciplinary action would not meet the project constraints.

## Latest validation (2026-11-06)

| Command | Result |
| --- | --- |
| `npm.cmd run test -w client` | PASS — 1 file, 8 tests |
| `npm.cmd run build -w client` | PASS — Vite production build |
| `npm.cmd run typecheck -w server` | PASS |
| `npm.cmd run build -w server` | PASS |
| `npx.cmd tsx --test test/answers.test.ts test/auth.test.ts test/companion.test.ts test/config.test.ts test/exam.test.ts test/grading.test.ts test/ids.test.ts test/institutions.test.ts test/intervention.test.ts test/password-reset.test.ts test/proctor.test.ts test/serializers.test.ts test/upload-validation.test.ts` (from `server`) | PASS — 49 tests |
| `python -m unittest discover -s ai-service -p "test*.py"` | PASS — 5 tests |
| `dotnet build --no-restore` in `device-monitor` | PASS — 0 warnings, 0 errors |

## Organization settings milestone (2026-11-06)

- The former `/app/settings` placeholder is now an API-backed organization profile page. It loads the authenticated membership's organization with `GET /api/organizations/:organizationId` and, for `institute_admin` only, saves the persisted `name` and `slug` fields with `PATCH /api/organizations/:organizationId`.
- Both handlers deliberately scope by `req.auth.organizationId`, rather than trusting a path identifier from the browser. The update is role-protected, Zod-validated, audited as `organization.updated`, and the existing Prisma unique-conflict handler returns `409` when a slug is already taken.
- The page has labelled fields, inline and focusable form errors, a retry state, loading state, read-only state for teachers/proctors, and saved feedback. It does not present contact details, branding, retention controls, or organization-wide assessment policy controls because the current Prisma `Organization` model has no fields for them.
- This milestone was validated without a database connection: `npm.cmd run typecheck` and `npm.cmd run build` from `server` passed; `npm.cmd run test` from `client` passed (1 file, 8 tests); and `npm.cmd run build` from `client` passed. Database-writing integration suites were not run.

## Completion-phase progress

- Dependency audit was rerun after frontend test tooling was added. Scoped non-major remediation upgraded Vite to 6.4.5, upgraded Vitest to 4.1.12 (compatible with Vite 6 and Node 24), and updated vulnerable transitive packages. The audit now reports one remaining high-severity Zod 3 finding; the available fix is the breaking Zod 4 migration, which was not forced. Details: `DEPENDENCY_SECURITY_AUDIT.md`.
- OAuth completion no longer puts a session payload in a query string. The backend redirects with a fragment, and the login client consumes then removes that fragment before navigation. Frontend regression coverage passed.
- `SECURITY_REVIEW.md` and `AI_INTEGRATION_CONTRACT.md` record verified controls and explicitly blocked product/security decisions. No AI adapter was added because consent, retention, service authentication, and model approval are not defined.
- UI UX Pro Max was used to generate and persist an ExamGuard design system at `design-system/examguard/MASTER.md`. Shared frontend tokens, accessible focus treatment, responsive labelled workspace navigation, and low-distraction exam-surface rules were implemented. `EXAMGUARD_DESIGN_SYSTEM.md` and `EXAMGUARD_UI_UX_IMPLEMENTATION_REPORT.md` record the concrete milestone and its browser-validation limitation.
- The user then explicitly requested a full visual replacement. UI UX Pro Max regenerated the master design direction and teacher/candidate/monitoring page guidance. The marketing composition and former dark sidebar were replaced by an editorial public narrative and responsive role-aware top application bar. Existing API-bound application workflows remain present; later replacement milestones still need to extract and redesign their individual route components.

## Database-writing-suite execution request

The following suites are ready but **must not be run without explicit approval**:

| Command (run from `server`) | Guard before all mutations | Setup writes | Cleanup deletes |
| --- | --- | --- | --- |
| `npx.cmd tsx --test test/integration.test.ts` | Dynamic Prisma/auth imports, then `SELECT current_database()` must equal `examguard_test` | One fixed-ID organization, user, membership, candidate, exam, and two questions | Matching fixed-ID `attempt_answers`, `exam_attempts`, `questions`, `memberships`, `candidates`, `users`, and `organizations` only |
| `npx.cmd tsx --test test/evidence-upload.test.ts` | Dynamic Prisma/auth/app imports, then `SELECT current_database()` must equal `examguard_test` | Two fixed-ID organizations; three users/memberships/candidates; four exams; two questions; five fixed-ID attempts (active, cross-candidate, cross-org, expired, submitted) | Only fixed IDs / their test-owned organizations, exams, attempts, attempt answers, memberships, candidates, users, and organizations. Object storage is mocked; no real object is written. |

No migration, schema mutation, reset, or initialization is required. The test URL is established before importing `prisma.ts`, and the runtime database identity guard aborts before setup/cleanup so neither suite can silently fall back to `examguard`.

Explicit approval is now required before executing either command because each intentionally creates and deletes these fixtures in `examguard_test`.

## Security review findings

| Control | Observed state |
| --- | --- |
| Authentication | JWT verification, UUID-only subjects, generic invalid-credential response, bcrypt password hashes, rate limits |
| Authorization | Membership role checks and organization filters on protected organization routes; candidate attempt queries include authenticated user ownership |
| Evidence | Authentication precedes upload handling; file size, allowed type, magic bytes, private object storage and attempt ownership checks are present |
| Tenant isolation | Protected handlers use organization membership or owner-scoped candidate/attempt queries; DB integration tests remain required to prove this behavior |
| Real time | Socket join validates JWT, active membership, allowed role and exam/organization relation |
| Remaining limitation | No independent penetration test, production CORS review, or browser CSRF deployment review has been performed |

## Required manual actions

- Explicitly authorize controlled fixture writes before database integration suites run.
- Provide a non-production object-storage configuration to validate evidence persistence.
- Install optional AI dependencies and a validated local YOLO model before claiming inference readiness.
- Test the Windows companion on supported Windows hardware with visible consent controls.
- Add a browser test runner and CI job before production readiness is claimed.

## Validation policy

Only tests that do not write to a database may run without further approval. Database migrations, seed scripts, resets, and deployment actions require explicit approval.

## Coding examination planning milestone (2026-11-06)

- `CODING_EXAMINATION_ARCHITECTURE.md` records the observed gap (no coding question type, test-case storage, source persistence, job/result model, editor, or isolated runner) and the exact tenant-scoped data/API/security design needed to close it.
- `server/src/coding.ts` contains only runner-independent safety primitives: five proposed languages are explicitly `not_configured`; output comparison supports exact and opt-in whitespace-normalized modes; private test input/output is removed from candidate response projections.
- `server/test/coding.test.ts` passed 3/3: unavailable language declaration, comparison-mode distinction, and private-case redaction. Server typecheck and build passed after this addition.
- No schema/migration, database write, code execution, runner deployment, environment edit, or editor dependency installation occurred. A genuine coding assessment remains blocked on an approved migration and independently reviewed isolated runner deployment.

## Coding examination implementation milestone (2026-11-06)

- Added a native Monaco-based coding examination workspace with split problem/editor panels, accessible width control, dark/light editor choice, full-screen control, question navigation, visible sample cases, starter-code/language selection, autosave state, result console, and responsive fallbacks. It is only selected for a future server payload with `QuestionType.coding`; traditional examinations are unchanged.
- The workspace deliberately disables Run, Submit, final coding submission, and server-history claims when persistence/secure execution is unavailable. It keeps no source code in localStorage and does not display private tests.
- Added server-side request validation, execution rate-limit policy, runner/submission interfaces, output normalization/redaction, and candidate/organization/active-attempt/deadline authorization primitives. The unconfigured runner adapter throws an explicit error and contains no local execution path.
- Prepared, but did not apply, `20261106223000_add_coding_assessments`: the matching Prisma schema adds coding questions, cases, attempt source, submissions, jobs, and results with organization-scoped relationships. `prisma validate` passed locally without database access.
- Validation: coding-focused unit tests passed 7/7; server typecheck and build passed; client tests passed 9/9 (including the coding-workspace unavailable-runner/privacy/navigation test); client production build passed. The Monaco dependency install reported the pre-existing remaining npm audit result: 1 high-severity dependency advisory, whose only reported remediation is a breaking Zod major upgrade; it was not forced.
- Infrastructure blockers remain: reviewed isolated Judge0 (or equivalent) deployment, private service credential, server-owned language-ID/version mapping, migration approval/application to a controlled test database, and runner isolation/resource-limit verification. No database connection, migration, runner request, deployment, or environment change occurred.
