# Nearby radio observation prototype status

## Repository audit

- The React/Vite client and Express/PostgreSQL API already support tenant-scoped attempts, proctoring events, incidents, audit logs, and reviewer decisions.
- `device-monitor/` was only a placeholder; no previous desktop framework existed.
- The institution directory uses the Hipolabs public endpoint through the API. It has timeout, one retry, and a five-minute in-memory cache; failures expose a real unavailable state plus the existing review-request fallback.

## Implemented

- Windows .NET 8 companion source using `BluetoothLEAdvertisementWatcher` and Native Wi-Fi `WlanScan`/`WlanGetNetworkBssList`.
- Explicit consent, visible scan status, timestamps/activity log, scan-stop action, error reporting, and session-scoped in-memory identifier pseudonyms.
- PostgreSQL tables for raw radio observations and separate candidate signals.
- Authenticated, rate-limited observation ingestion; the API verifies the bearer user owns the active candidate attempt and uses server timestamps.
- A conservative server rule creates a review-only candidate signal after three observations of a category within five minutes. It cannot pause, terminate, grade, or penalize an attempt.
- Authorized reviewer listing and decisions with audit logs.

## Not performed

- The Windows companion was compiled with .NET SDK 10.0.402 against its `net8.0-windows` target. Hardware and browser permission testing remain unperformed.
- No physical Windows/Bluetooth/Wi-Fi hardware validation occurred. Validate with Android/iPhone, accessories, routers, hotspots, radio-disabled state, and permission/API failures before deployment.

## Privacy and retention

Raw identifiers are pseudonymized per running companion session, not anonymous. The API stores only the pseudonym, RSSI when returned, scanner health, and an explicit limitation statement. Radio observations now receive a 30-day MongoDB TTL expiry by default; signals should be retained only under the institution's documented review policy. Do not use radio signals as a disciplinary finding without human review.

## Master enhancement audit

- OAuth, password recovery, role-scoped APIs, public institution fallback, Windows companion source, observation ingestion, review-only signals, and the public product redesign are present.
- The generic staff monitoring screen still needs a dedicated radio-evidence UI despite the existing authorized listing/review APIs; it was not misrepresented as live device detection.
- The companion uses the server's short-lived, exam-scoped pairing credential and verifies it before enabling scans. It still requires real Windows radio hardware to validate.

## Product redesign

- Replaced the basic three-entry-card public homepage with a responsive, candidate-first ExamGuard product page.
- Added product, workflow, and security sections; a mobile navigation menu; only valid public routes in the footer; and a clearly labelled illustrative workspace preview with no fabricated operational data.
- Existing login, registration, password recovery, OAuth discovery, candidate institution selection, and backend authentication routes are unchanged.
- Client lint and production build passed. Visual browser testing was not performed in this environment.

## Candidate readiness and companion pairing

- The candidate entry flow now provides explicit camera and microphone checks. Each check asks through the browser permission prompt, shows a real camera preview or microphone level only after consent, and offers stop controls. Media tracks and audio resources are released when stopped or when the readiness screen unmounts. No audio is recorded or transmitted for this check.
- Camera and microphone remain optional in the current exam schema; the readiness screen does not imply an exam requires them. Instructions acknowledgement and an online connection are required before the existing server-authorized start call.
- The Windows companion verifies the existing short-lived, exam-scoped pairing token before it can scan. It receives the attempt context from the API rather than asking a candidate to paste raw organization, candidate, or attempt identifiers.
- The readiness screen now accurately calls the Windows companion optional rather than implying that it is required. After an attempt starts, the candidate can use **Pair Windows companion** to request the existing server-issued, ten-minute, active-attempt-only pairing token. The token is displayed only in the modal for manual transfer to the Windows app and is cleared on close; it is not persisted by the browser.
- On 2026-10-18, `dotnet build device-monitor/ExamGuard.DeviceMonitor.csproj --no-restore` completed successfully with zero warnings and errors. The client typecheck/build also passed after adding the pairing UI. Bluetooth and Wi-Fi behavior still needs validation on a physical supported Windows laptop with available radios.

## Candidate examination workflow

- The active examination view restores answers returned by the server after a refresh or resumed attempt, presents one question at a time with a responsive palette, supports previous/next navigation and local mark-for-review state, and shows server-confirmed autosave status.
- Multiple-select answers are persisted as validated option-ID arrays rather than overwriting each selection. The protected answer endpoint now rejects invalid option IDs, duplicate multi-select IDs, non-array multi-select input, and non-string written answers.
- Candidates receive a submission review count and must confirm normal submission. At the displayed server deadline, the client requests submission once; server-side deadline/state checks remain authoritative. Browser and live MongoDB testing are still required to verify these paths against a configured deployment.
- The readiness screen now requires successful camera and microphone permission checks plus acknowledgement before enabling Start. Starting requests browser fullscreen (where supported). During an active attempt, tab visibility loss and fullscreen exit show an immediate candidate warning, trigger the browser's native page-leave warning, and post the existing authorized review-only proctoring event. These signals remain subject to the configured server intervention policy and are not themselves findings of misconduct.

## Candidate portal and demo fixtures

- Students now receive an organization-scoped candidate dashboard rather than the staff workspace. It retrieves only their server-linked candidate record, assigned exams, their own attempts, receipts, and grades that have been explicitly published. It exposes the existing readiness/exam route only while an assigned assessment is available.
- `GET /api/student/dashboard` derives the candidate from the authenticated membership; it does not accept candidate, organization, or grade identifiers from the browser.
- The development seeder now requires `DEMO_SEED=yes`, a 12+ character `DEMO_SEED_PASSWORD`, and a non-production-like database name. It creates idempotent, `[DEMO]`-labelled synthetic users, linked candidate records, a ten-question CSE assessment, and assignments—never monitoring observations. See `docs/DEVELOPMENT_DEMO.md`. It was not run here because no configured non-production database was provided.

## Configured development institute and candidate test

- The configured database was inspected through the existing Mongoose models (no organization was created). Organization and candidate names, email addresses, and identifiers are deliberately omitted from repository documentation.
- The pre-existing requested assessment was not altered. Its lock was real: it had a question but no assignment for the requested candidate, no candidate login/membership link, and required approved identity verification. Its published state, duration, and organization scope were retained; email verification was not changed.
- A development-only linked student login and organization membership were created for the pre-existing candidate. The normal candidate verification submission and authorized admin review endpoints were then exercised; identity review is distinct from email verification.
- A development-only DBMS practice assessment was created in the existing organization with ten private-answer MCQs, 15-minute duration, no negative marks, a short active development window, and the requested candidate assignment. An actual API run submitted it, persisted answers and a receipt, auto-graded it, and released the grade. A separate live retake fixture was created for manual use.
- Actual API verification against the configured database/local server: candidate login, candidate dashboard assignment visibility, candidate verification submission, admin approval, test start, ten answer saves, server submission, grade generation, grade release, and candidate post-release result visibility all passed. Browser UI and email-delivery testing were not performed.

## Institution search experience

- The candidate institution screen now uses a more structured assessment-platform layout, with clear account access, directory-search, results, review-request, and search-guidance states. It validates the institution name before calling the API and distinguishes an unavailable public directory from an invalid or incomplete search.
- The configured Hipolabs public directory returned `503` during a live `Graphic Era` lookup, so no fallback colleges were fabricated. A valid development request for `Graphic Era University` / Uttarakhand was accepted by the real review-request endpoint (`201`); this creates an `InstitutionRequest` for staff review and does not create or verify an institution.

## Administrator-created student accounts

- The candidate page now creates a candidate profile, a separate student `User`, and a student organization membership in one authorized server flow. The administrator supplies the student's initial password; it must meet the existing password policy, is bcrypt-hashed, is never returned by the API, and cannot overwrite an existing ExamGuard account.
- Students created this way sign in through the normal login screen and are routed to their candidate dashboard, where only their server-authorized assignments and released results are visible. Exams that require identity verification still use the existing candidate verification and reviewer approval workflow.

## Separate portals and assignment control

- `/login` now presents an explicit workspace choice. `/student/login` accepts only student memberships and opens the candidate assessment dashboard; `/institute/login` accepts institute-admin, teacher, or proctor memberships and opens the management workspace. A user who selects the wrong portal receives a clear non-authenticating message and a link to the correct portal.
- An empty student dashboard means no `ExamAssignment` exists for that student's server-linked candidate record; it is not a display fallback. The institute Candidates page now lets an authorized user open a student's details and assign an already published, scheduled, or live organization assessment. The server still verifies organization ownership, exam publication state, duplicate assignment prevention, and all start-time, verification, and attempt restrictions.
- `npm run typecheck` passed after these changes. Manual browser verification should assign an eligible assessment to the intended candidate, then sign out and use that candidate's Student login; the assignment will appear only if its availability and verification requirements are currently satisfied.
- Candidate details now exposes **Approve identity** and **Reject** to authorized institute administrators and proctors when a candidate has actually submitted (or resubmitted) identity verification. It uses the existing role-scoped review endpoint, requires a reason on rejection, records the review/audit action, and does not change email-verification state.

## Development delivery fixtures and workspace polish

- The Examinations list now has a direct **Assign candidates** action for every published, scheduled, or live assessment. An authorized institute user can select multiple existing candidates in one dialog; every selection still goes through the organization-scoped assignment API and its duplicate-safe upsert.
- Added `server/scripts/seed-organization-demo.ts`, an explicit `DEVELOPMENT_SETUP=yes` / organization-ID / password guarded, idempotent fixture script. On 2026-10-18 it was intentionally run for the configured development organization only, creating three clearly labelled `[DEMO]` student accounts and three `[DEMO]` published MCQ assessments. Each account has one active two-week assignment; no pre-existing user, candidate, exam, attempt, or result was overwritten or deleted. These demo assessments deliberately have `requireVerification: false` because they are labelled development workflow fixtures, not proctored production exams.
- The application surface now has layered blue/indigo gradients, a low-contrast grid, and translucent cards so the management workspace remains readable while feeling less like a plain white page.
- Corrected a responsive shell issue exposed by narrow/DevTools layouts: the navigation rail is now non-shrinking and the content area has a `min-width: 0`, so navigation labels are not clipped. Corrected the background layer sizing so the decorative radial gradient no longer repeats in every grid cell. The empty incident state now communicates that no real incidents exist while preserving the review-only policy statement; no dummy incident records were inserted.
- Monitoring now has actionable service descriptions, a manual refresh/retry state, clear observation/indicator counts, and a consent-based activation checklist for the already implemented Windows companion flow. Unconfigured private storage and email delivery remain accurately shown as unavailable; video recording is not represented as enabled because it requires configured private object storage plus a documented retention policy and candidate consent.
- Added three idempotent, explicitly `[DEMO]` simulated incident fixtures (fullscreen exit, tab-focus loss, and multiple-face review) for the development organization only. They are training data for the reviewer UI, state that they are not findings of wrongdoing, contain no captured image or real student allegation, and can be dismissed/resolved using the normal authorized workflow. Corrected the Mongoose nested `contributingSignals` schema so signal type, weight, and event ID persist correctly.
- The incident queue now has status filters and an authorized reviewer case-detail drawer. “Request explanation” is shown as **Ask student for context** and is explained as an optional fairness step for ambiguous signals; after it is requested, the UI displays the pending state instead of offering duplicate requests. The student-facing response deadline remains server controlled.

## Exam builder

- Added `/app/exam-builder`: a real API-backed, four-step draft editor for title, instructions, schedule, duration, supported settings, dynamic questions/options/answers/marks, review, and publish/schedule.
- Drafts and question creation use the existing protected organization APIs; publish now rejects empty exams and schedules an exam when its configured start is in the future.
- The route is available only to an authenticated workspace user. The examinations-list `New examination` action now navigates to the builder rather than creating an untitled draft, and existing draft rows can be reopened through an Edit draft action.
- The editor now also lists organization question banks and uses the existing copy endpoint, so it never edits or deletes the source bank question. Persisted draft questions can be removed through a draft-only, organization-scoped endpoint.
- Refined shared workspace surfaces, mobile navigation sizing, cards, inputs, focus states, reduced-motion behavior, dashboard header, examinations table, and the builder stepper. Client lint/build and server lint/build/unit verification passed; a browser + configured MongoDB workflow run remains required to verify persisted records in a live environment.

## Production hardening pass (2026-10-18)

- Authentication now rejects bearer tokens without a non-empty string subject instead of coercing a missing subject into a user identifier. Companion authentication follows the same rule.
- Organization authorization rejects malformed organization context before a database lookup. Socket live-monitoring subscriptions now validate both organization and exam identifiers, verify that the exam belongs to that organization, and reject invalid room requests.
- API responses now disable framework identification, prevent API caching, and return baseline `nosniff`, referrer, permissions, and same-site resource-policy headers. HSTS is enabled only when `NODE_ENV=production`; TLS termination/deployment configuration still needs verification in the production host.
- The one-off development utilities now require `TARGET_CANDIDATE_EMAIL` from the environment rather than embedding a personal email in source. They remain explicitly development-gated and should not be used against production data.
- Verification completed: server/client TypeScript checks, client typecheck lint, 20 server unit tests, production server/client build, and Windows companion `dotnet build --no-restore` all passed. `git diff --check` passed; documentation was searched for previously committed development organization/candidate identifiers and none remain.
