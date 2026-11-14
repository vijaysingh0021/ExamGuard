# ExamGuard

Multi-institute online examinations and AI-assisted integrity operations. The React/Vite client lives in `client/`; the Express/PostgreSQL (Prisma) API lives in `server/`. `ai-service/` and `device-monitor/` are intentional service boundaries; no dedicated hardware integration is included.

## Run locally

1. Install PostgreSQL 16+ and create an empty database plus a user for it. In development the user also needs the `CREATEDB` permission, because Prisma uses a temporary shadow database when it creates migrations.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a 32+ character `JWT_SECRET`.
3. Run `npm install`, then from `server/` run `npx prisma migrate deploy` (or `npx prisma migrate dev` while changing the schema) and `npx prisma generate`.
4. Create the AI service environment and install its dependencies: `python -m venv ai-service/.venv`, then `ai-service\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt` in PowerShell.
5. Configure `AI_SERVICE_TOKEN` (at least 32 characters) and `YOLO_MODEL_PATH` in `.env`, pointing to a supported local YOLO model. Use `AI_SERVICE_URL=http://127.0.0.1:8001`.
6. Run `npm run dev` from the repository root and open `http://localhost:5173`. This starts the client, API, and local AI service together.

The API deliberately exits when the PostgreSQL configuration or connection fails. It does not fall back to a different database.

### Demo data

To add clearly labelled development data after the migrations are applied, use a non-production database and run (PowerShell):

```powershell
$env:DEMO_SEED = 'yes'
npm.cmd run seed
```

The demo password is `ExamGuard-Demo-2026!` for all seeded roles. Sign in with `platform.admin@demo.examguard.test` (system administrator), `aarav.admin@demo.examguard.test` (university administrator), `priya.teacher@demo.examguard.test` (coordinator), `karan.proctor@demo.examguard.test` (proctor), or `aditi.candidate@demo.examguard.test` (student). These `.test` addresses are fake and cannot receive email; the seed adds labelled sample exams, questions, candidates, and assignments. See [docs/DEVELOPMENT_DEMO.md](docs/DEVELOPMENT_DEMO.md) for all panel login paths and safety details.

For local coordinator identity applications, keep `LOCAL_EVIDENCE_DIR=./.local-evidence` enabled in `.env`; uploads are stored privately on this machine. Coordinators request access at `/coordinator/register`, submit a government ID, university ID, and authorization letter, and remain unable to sign in until the university administrator approves them in **People and roles**. Use private object storage instead of local storage for deployment.

Student applications at `/student/register` also require a government-issued ID. It is stored in private evidence storage and is available to the institution administrator during the application review in **Candidates**. The account remains inactive until approval.

### Maintenance

PostgreSQL has no automatic expiry of short-lived rows. Remove expired password-reset tokens, OAuth states and radio observations periodically (for example daily) with `npx tsx scripts/purge-expired.ts` from `server/`.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

Deployment, mail, private storage, hosted AI-service setup, and OAuth callback registration are documented in [docs/deployment.md](docs/deployment.md). Share [the candidate exam setup guide](docs/CANDIDATE_EXAM_GUIDE.md) with students before their exam.

## OAuth and account recovery

Google and Microsoft use server-side OIDC authorization-code flows with PKCE, state, nonce, and ID-token validation. Configure the matching client ID, secret, `API_BASE_URL`, and registered callback URL before the sign-in buttons appear. A provider identity must already be explicitly linked to an ExamGuard user; accounts are never auto-created or merged by matching email. Password-reset tokens are random, stored hashed, expire after 15 minutes, and are single-use.

## Public institution directory

The student institution-selection flow uses the public Hipolabs Universities API through the server-side `InstitutionDirectory` abstraction. Results are public directory listings, not verified ExamGuard institutions or proof of a student's membership. Searches are rate limited, timeout after six seconds, and return at most 25 results. India includes all 28 states and 8 union territories for filtering; the public directory remains incomplete and does not assert UGC recognition, affiliation, or accreditation.

Tenant isolation is server-enforced: protected routes resolve the JWT user to an active organization membership before querying organization records. Client organization IDs alone confer no access.

## Practice, invitations, and support

Teachers and institute administrators can mark an exam as practice. Practice attempts still use the normal readiness and proctoring flow, but cannot be graded or published as official results and are excluded from official analytics and operational counts. The student CSV invitation workflow previews duplicates and existing accounts before sending one-time links; email delivery must be configured, and links expire after seven days. Students can create support tickets and follow replies in-app; organization staff manage ticket status. A saved high-contrast control is available in the application navigation.

## Private candidate documents

Candidate photos and optional ID documents are accepted only through authenticated candidate routes and are stored under organization-scoped keys in a private S3-compatible bucket. Configure all `OBJECT_STORAGE_*` values before using uploads. The server never returns a public storage URL or storage credential. Use a bucket policy that blocks public access and encrypts objects at rest.

Exam attempts have a server-created deadline and cannot be autosaved or submitted once closed. Question delivery omits `correctAnswer`; answers are available only after a future authorized results-release workflow.

## AI proctoring and incident review

The `ai-service/` FastAPI boundary is software-only and opt-in. It supports MediaPipe face analysis and YOLO detections for the device classes available in the configured weights. A rough screen-size/view-alignment heuristic can raise a Potential Visual Assistance review signal only when a potentially readable screen overlaps in time with a near/medium BLE advertisement from the same attempt. RSSI zones are source-specific and configurable; they are not distance measurements and require venue calibration. BLE names are optional advertised labels, not verified identities; Wi-Fi scans observe access points, not connected clients. Camera/radio correlation is temporal only and never asserts that observations describe the same device. Browser signals (visibility/fullscreen) are explicitly distinct from AI signals.

Signals are deduplicated in a configured cooldown window, recorded before Socket.IO broadcasts, and converted to explainable review-priority points—not cheating probabilities or automatic outcomes. The visual-readability heuristic performs no OCR and cannot establish that text was present or readable. Review actions require a reason and create audit entries. Automated signals must be reviewed by authorized people; no signal can automatically fail a student.


## Project status and documentation
ExamGuard is **not declared production-ready**. The latest local verification results and remaining hosted, hardware, and deployment checks are recorded in [the project verification report](docs/PROJECT_VERIFICATION_REPORT.md). A successful local build or test run does not certify a hosted exam environment.

Quick local verification (PowerShell):
```powershell
npm ci; npm run typecheck; npm test; npm test -w client; npm run build
node server/scripts/check-imports.mjs; node server/scripts/check-api-contract.mjs; node server/scripts/check-migrations.mjs
```
Background jobs stay off (`BACKGROUND_JOBS_ENABLED=false`) until the migrations are applied to an isolated development database.

If port `4000` is already in use, run the API on another port and point Vite at it:
```powershell
$env:PORT="4001"
$env:VITE_API_PROXY_TARGET="http://localhost:4001"
npm run dev
```
