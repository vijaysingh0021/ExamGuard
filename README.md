# ExamGuard

Multi-institute online examinations and AI-assisted integrity operations. The React/Vite client lives in `client/`; the Express/PostgreSQL (Prisma) API lives in `server/`. `ai-service/` and `device-monitor/` are intentional service boundaries; no dedicated hardware integration is included.

## Run locally

1. Install PostgreSQL 16+ and create an empty database plus a user for it. In development the user also needs the `CREATEDB` permission, because Prisma uses a temporary shadow database when it creates migrations.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and a 32+ character `JWT_SECRET`.
3. Run `npm install`, then from `server/` run `npx prisma migrate deploy` (or `npx prisma migrate dev` while changing the schema) and `npx prisma generate`.
4. Run `npm run dev` from the repository root and open `http://localhost:5173`.

The API deliberately exits when the PostgreSQL configuration or connection fails. It does not fall back to a different database.

### Demo data

To add clearly labelled development data after the migrations are applied, use a non-production database and run (PowerShell):

```powershell
$env:DEMO_SEED = 'yes'
$env:DEMO_SEED_PASSWORD = 'choose-a-local-password-with-12-or-more-characters'
npm.cmd run seed
```

Sign in with `aarav.admin@demo.examguard.test` (institute) or `aditi.candidate@demo.examguard.test` (student) and the password above. See `docs/DEVELOPMENT_DEMO.md` for details.

### Maintenance

PostgreSQL has no automatic expiry of short-lived rows. Remove expired password-reset tokens, OAuth states and radio observations periodically (for example daily) with `npx tsx scripts/purge-expired.ts` from `server/`.

## Verification

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

Deployment, mail, private storage, AI-service setup, and OAuth callback registration are documented in [docs/deployment.md](docs/deployment.md).

## OAuth and account recovery

Google and Microsoft use server-side OIDC authorization-code flows with PKCE, state, nonce, and ID-token validation. Configure the matching client ID, secret, `API_BASE_URL`, and registered callback URL before the sign-in buttons appear. A provider identity must already be explicitly linked to an ExamGuard user; accounts are never auto-created or merged by matching email. Password-reset tokens are random, stored hashed, expire after 15 minutes, and are single-use.

## Public institution directory

The student institution-selection flow uses the public Hipolabs Universities API through the server-side `InstitutionDirectory` abstraction. Results are public directory listings, not verified ExamGuard institutions or proof of a student's membership. Searches are rate limited, timeout after six seconds, and return at most 25 results. India includes all 28 states and 8 union territories for filtering; the public directory remains incomplete and does not assert UGC recognition, affiliation, or accreditation.

Tenant isolation is server-enforced: protected routes resolve the JWT user to an active organization membership before querying organization records. Client organization IDs alone confer no access.

## Private candidate documents

Candidate photos and optional ID documents are accepted only through authenticated candidate routes and are stored under organization-scoped keys in a private S3-compatible bucket. Configure all `OBJECT_STORAGE_*` values before using uploads. The server never returns a public storage URL or storage credential. Use a bucket policy that blocks public access and encrypts objects at rest.

Exam attempts have a server-created deadline and cannot be autosaved or submitted once closed. Question delivery omits `correctAnswer`; answers are available only after a future authorized results-release workflow.

## AI proctoring and incident review

The `ai-service/` FastAPI boundary is software-only and opt-in. It supports a health/capability report for MediaPipe face analysis and an optional YOLO phone model; it does not claim an active detection model when one is absent. Browser signals (visibility/fullscreen) are explicitly distinct from AI signals. There is no fake Bluetooth, Wi-Fi, or other-app discovery because browsers do not provide that capability.

Signals are deduplicated in a configured cooldown window, recorded before Socket.IO broadcasts, and converted to explainable review-priority points—not cheating probabilities or automatic outcomes. Review actions require a reason and create audit entries. Automated signals must be reviewed by authorized people; no signal can automatically fail a student.
