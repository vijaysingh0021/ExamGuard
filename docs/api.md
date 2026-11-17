# ExamGuard API overview

This page describes the API boundaries and principal route families in the
current server. It is an orientation guide, not an OpenAPI specification. The
authoritative request validation and response behavior are in
`server/src/app.ts` and the corresponding tests under `server/test/`.

## Base URL and authentication

The API is served by the Express backend. The backend `/health` endpoint is
intended for service health checks; it does not expose credentials. Protected
user routes require the ExamGuard bearer session and enforce the authenticated
user's role, active organization membership, and resource ownership. Platform
administration routes require platform-admin authorization.

The Windows Companion uses a separate, short-lived, attempt-scoped credential
for its pairing and radio-observation routes. The AI service credential is
server-to-server only and must never be sent by the browser.

Send JSON for JSON routes. Image and document routes use multipart form uploads
and apply server-side content validation. Do not upload candidate evidence
directly to a public bucket or call the AI service from browser code.

## Route families

| Route family | Purpose |
|---|---|
| `GET /health` | Backend liveness/health information |
| `/api/auth/*` | Sign-in, account recovery, email verification, and OAuth flows |
| `/api/organizations/:organizationId/*` | Organization-scoped exams, questions, candidates, assignments, analytics, evidence, and staff workflows |
| `/api/student/*` | Authenticated candidate dashboard, attempts, answers, coding runs, submissions, and student explanation workflows |
| `/api/student/attempts/:attemptId/ai-frame` | Multipart camera-frame analysis through the authenticated backend |
| `/api/student/attempts/:attemptId/ai-context-frame` | Context-frame handling for an active attempt |
| `/api/student/attempts/:attemptId/evidence` | Candidate evidence upload |
| `/api/student/attempts/:attemptId/screen-capture` | Consent- and attempt-checked screen still upload |
| `/api/student/attempts/:attemptId/companion-pairing` | Request an attempt-scoped Companion credential |
| `/api/student/companion-pairing` | Companion pairing verification/health flow |
| `/api/student/radio-observations` | Companion-submitted, session-scoped radio observations |
| `/api/platform/*` | Platform administrator operations and institution/staff verification |

This table lists principal families, not every route. Role access is enforced
in the server handlers; clients must not treat a hidden button or supplied
organization ID as authorization.

## Common proctoring flow

1. The authenticated student creates an attempt through the student exam
   start route after server-side readiness checks.
2. The browser uploads sampled camera frames to the API's `ai-frame` route.
   The API validates attempt state and consent, then calls the AI service with
   its private service credential.
3. Confirmed signals and permitted evidence are associated with the attempt
   through backend records. A successful AI response alone is not proof that
   evidence was stored.
4. The Companion obtains a short-lived credential for the active attempt,
   verifies pairing, and submits consented radio observations independently
   of browser camera monitoring.
5. Authorized organization staff retrieve evidence through authenticated API
   routes and review incidents; automated signals do not determine outcomes.

The backend and AI service share a maximum of 20 faces per frame. An AI
response over that limit is an explicit error and must not be silently
truncated. The backend remains responsible for authorization, evidence
association, and storage.

## Validation and change process

Run the backend route-contract check with:

```powershell
node server/scripts/check-api-contract.mjs
```

This checks statically resolvable client method/path shapes against registered
server routes; it is not a substitute for endpoint integration tests. Add or
update focused tests in `server/test/` when changing authorization, validation,
or response behavior. A generated OpenAPI document is not currently maintained.
