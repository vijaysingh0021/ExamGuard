# ExamGuard Deployment Guide

## Overview

This guide covers production deployment of ExamGuard across all components:
- **Frontend**: React/Vite application (Vercel/Netlify/Static hosting)
- **Backend**: Express/TypeScript API (Render/Railway/ECS/Docker)
- **Database**: PostgreSQL 17 (Managed: Supabase/Neon/RDS/Cloud SQL)
- **AI Service**: FastAPI (GPU instance for YOLO inference)
- **Windows Companion**: .NET 8 WinForms app (MSI/ClickOnce distribution)

## Free-tier deployment (Vercel, Render, Supabase)

The repository includes a Vercel configuration for the client and a Render
Blueprint for the API. Supabase is used as the external PostgreSQL provider.
These free tiers are suitable only for development, demos, or a low-traffic
pilot, not for a high-stakes exam service:

- Render Free web services have 512 MB RAM, spin down after 15 minutes without
  inbound traffic, and can take about a minute to wake. The 750 monthly free
  instance-hours are shared across the workspace. Realtime sockets reconnect
  after a restart, but a restart can interrupt live monitoring.
- Supabase Free currently includes 500 MB of database storage and can pause a
  project after one week of inactivity. It does not include downloadable
  database backups. Do not use Render Free Postgres for retained exam data; it
  expires 30 days after creation.
- Supabase Storage plan limits and overage terms vary. Keep the evidence bucket
  private, monitor usage in the project dashboard, and apply the institution's
  evidence-retention policy.
- Free-plan quotas, availability, and provider terms can change. Check each
  provider's dashboard and current terms before inviting candidates.

### Deploy the client and API

1. Create a Supabase project in a region near the Render service. From
   **Connect**, copy the **Session pooler** connection string for the Render
   API (IPv4); use SSL and keep the password URL-encoded. Do not use the
   transaction pooler for Prisma migrations.
2. In Render, create a **Blueprint** from this repository and select the root
   `render.yaml`. The API build generates Prisma Client and the start command
   applies checked-in migrations before starting the server. `DATABASE_URL`
   and `JWT_SECRET` stay server-side.
3. In Vercel, import the repository with its root directory set to `.`. The
   included `vercel.json` builds only the client workspace and rewrites
   browser routes to `index.html`. Set the build-time variable
   `VITE_API_URL` to the Render API origin, with no trailing `/api`.
4. After Vercel provides the production URL, set Render's `CLIENT_URL` and
   `APP_BASE_URL` to that exact HTTPS origin, and `API_BASE_URL` to the
   Render HTTPS origin. Redeploy the API. These origins also secure CORS,
   OAuth callbacks, Socket.IO, and email links.
5. In Supabase, create the private `examguard-evidence` Storage bucket. In
   Render, set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `OBJECT_STORAGE_BUCKET=examguard-evidence`. The service role key bypasses
   Row Level Security, so keep it only in the backend secret store; never put
   it in `VITE_*` variables. Evidence keeps its existing organization-scoped
   object keys and is retrieved through short-lived API URLs.
6. Configure an active, verified sender and API key in Brevo, then set
   `EMAIL_PROVIDER=brevo`, `EMAIL_API_KEY`, and `MAIL_FROM` in Render.
   `MAIL_FROM` must be the verified address, optionally formatted as
   `ExamGuard <no-reply@your-verified-domain.example>`. Render Free blocks
   SMTP ports; the integration sends mail over HTTPS.
7. Configure OAuth callback URLs using the deployed API origin. Bootstrap the
   first platform administrator once from a trusted environment after
   migrations complete; do not put bootstrap credentials in the Blueprint.

Render's `sync: false` entries are intentionally left for you to fill in from
the provider dashboards. Never commit secrets, upload a private YOLO model to
the public repository, or expose the AI token to the browser.

The Blueprint build command installs the workspace dependencies, generates
Prisma Client, and runs `npm run build -w @examguard/server`. TypeScript compiles
the current server source, scripts, and tests into `server/dist`; do not commit
or manually upload stale build output. Deploy the changed source through the
Blueprint so Render rebuilds `server/dist` before starting the API.

### PWA and device support

The client has a web manifest and a service worker that caches only the
application shell and hashed static assets. API responses, exam answers, and
private evidence are not cached. Install from the browser's install prompt
(Android/desktop Chromium) or the browser's home-screen action where
supported. Offline installation does **not** make exams usable offline.

The UI is responsive and can be opened on modern mobile and desktop browsers,
but the current secure-exam start gate requires the Windows Companion and
full-display sharing. Android and iOS do not have that Companion, and mobile
browsers may not expose the required display-capture API. Do not bypass these
checks; secure exams on those devices require a supported Companion and a
separately reviewed monitoring design.

### Cloud AI and the zero-budget limit

The API is configured to call an HTTPS AI service; production must not point
`AI_SERVICE_URL` at a personal computer or localhost. The Render Free instance has only
512 MB RAM and shares the workspace's free hours, which is not a dependable
place to run this Python, MediaPipe, and YOLO stack. The Blueprint therefore
asks for `AI_SERVICE_URL` and `AI_SERVICE_TOKEN` but does not deploy an AI
service that may fail to load the real model. The AI image and authorized
YOLO weights must be deployed to a separate cloud host with enough memory;
no reliable always-on host for this model is included in the requested
zero-cost Vercel/Render/Supabase setup. Until that is configured, monitoring
readiness will fail closed and secure exams cannot start.
Render Free services cannot receive private-network traffic. If an AI host is
used with the free API, configure its network-accessible HTTPS URL in
`AI_SERVICE_URL` and enforce the shared `AI_SERVICE_TOKEN`; never expose an
unauthenticated inference endpoint. The token must be at least 32 characters
and identical on the API and AI service. The API's readiness probe authenticates
to `/health/ready` and requires MediaPipe face detection, YOLO phone detection,
head-orientation, and multiple-face detection to be ready.

### Examination readiness and start gate

The readiness page checks browser APIs and live camera, microphone, and
full-display tracks, and displays the exam assignment/window and live AI and
private-storage checks. A display track is accepted only when the browser
reports `displaySurface=monitor`; stopping or switching away from that track
marks it failed and the UI checks it again before manual submission. The API
independently verifies the AI service and private storage before creating an
attempt, and does not release exam questions until the attempt has a recent,
authenticated Windows Companion heartbeat. Browser hardware tracks cannot be
cryptographically attested by a website, so do not treat a client readiness
response as server proof of camera or display state.

The storage probe creates and removes a temporary local directory in local
development, or calls Supabase Storage's bucket-info endpoint in production.
Verify that the service role key permits this check as well as the application's
object read/write operations. Readiness reports
service availability; test the complete candidate flow against the production
services and a physical Windows machine before inviting candidates.

Run the end-to-end Supabase check from the repository root with
`npm run storage:smoke -w @examguard/server`. It loads the root `.env`, uses a
unique `smoke-tests/` key, checks private access and an SDK download, then
attempts deletion even after a failure. The smoke test never prints credentials
or the short-lived API URL; a cleanup failure is reported separately and fails
the command. Run it only against the intended Supabase project.

The backend already publishes incident events through Socket.IO. The incident
timeline now subscribes when an authorized staff member filters by a valid
exam UUID and refreshes the review queue on incoming events. This requires the
Render API to be awake and reachable; free-tier restarts can interrupt the
connection.

## Prerequisites

### Infrastructure Requirements
- PostgreSQL 17+ database
- Redis (optional, for session caching)
- Supabase Storage private bucket
- SMTP/Webhook email provider
- OAuth credentials (Google, Microsoft)

### Domain & SSL
- Primary domain (e.g., `examguard.example.com`)
- API subdomain (e.g., `api.examguard.example.com`)
- Valid SSL certificates (Let's Encrypt or managed)

## Environment Configuration

### Backend (.env)
```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/examguard?sslmode=require

# Authentication
JWT_SECRET=your-32+-character-random-secret
PORT=4000
NODE_ENV=production

# URLs (update with your domains)
CLIENT_URL=https://examguard.example.com
APP_BASE_URL=https://examguard.example.com
API_BASE_URL=https://api.examguard.example.com

# Private Supabase Storage API. Copy the project URL and service role key from
# the Supabase project settings. Bucket visibility must remain PRIVATE.
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>
OBJECT_STORAGE_BUCKET=examguard-evidence

# Email (local SMTP example; Render Free must use the Brevo HTTPS API below)
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-mailbox@gmail.com
SMTP_PASS=your-google-app-password
MAIL_FROM="ExamGuard <your-mailbox@gmail.com>"

# Render production: configure a sender that is active and verified in Brevo.
# EMAIL_PROVIDER=brevo
# EMAIL_API_KEY=<Brevo API key>
# MAIL_FROM="ExamGuard <no-reply@your-verified-domain.example>"

# Alternatively use the webhook provider:
# EMAIL_PROVIDER=webhook
# EMAIL_URL=https://api.emailservice.com/send
# EMAIL_FROM=noreply@examguard.example.com

# OAuth Providers (configure in provider consoles)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-secret
MICROSOFT_TENANT_ID=common

# AI Service (required for secure examination readiness)
# Local: http://127.0.0.1:8001; production: a network-accessible HTTPS URL
AI_SERVICE_URL=https://ai.example.com
AI_SERVICE_TOKEN=<same 32+ character secret configured for the AI service>

# Self-hosted Judge0 (optional; keep private and reachable only by the API)
JUDGE0_BASE_URL=https://judge0.internal.example.com
JUDGE0_AUTH_TOKEN=<Judge0 service token>
# JUDGE0_AUTH_HEADER_NAME=X-Auth-Token # default
# JUDGE0_PRIVATE_HTTP_CONFIRMED=true # only for a trusted private network
```

For local Gmail SMTP, enable 2-Step Verification and create an App Password for `SMTP_PASS`; a normal Google account password will not work. Keep all mail settings in the backend's secret manager or untracked server-side `.env`, never in frontend variables or source control. For Brevo, use its API key (not its SMTP relay credentials), set `EMAIL_PROVIDER=brevo`, and set `MAIL_FROM` to a sender that Brevo lists as active and verified. Signup email verification and password recovery use the same provider.

Run `npm run email:verify -w @examguard/server` in the configured server environment to check Brevo authentication and sender verification without sending an email. It exits unsuccessfully if the provider is unavailable or rejects the check. A successful check does not prove that a recipient will accept delivery. On Render Free, use the Brevo HTTPS API; do not configure SMTP.

### Isolated coding execution (Judge0)

Run Judge0 on a native Linux execution host or use the hosted Judge0 CE service
through RapidAPI. Docker Desktop/WSL2 may not provide the cgroups and filesystem
features required by Judge0's worker sandbox; do not weaken that sandbox to make
it run there. Do not expose a self-hosted API publicly or connect the browser
directly to it. Configure network-disabled execution and resource limits in
Judge0 itself; ExamGuard also sends `enable_network=false` with each
submission. The API checks the configured service with authenticated
`GET /system_info` before enabling Run/Submit.

For a self-hosted or standard Judge0-compatible instance, set `JUDGE0_BASE_URL`
to the URL reachable **from the API process** and set `JUDGE0_AUTH_TOKEN` in the
backend's secret manager or untracked root `.env`. The token is sent in the
`X-Auth-Token` header by default; override the header name with
`JUDGE0_AUTH_HEADER_NAME` only if the instance is configured differently.

For Judge0 CE through RapidAPI, set `JUDGE0_BASE_URL` to
`https://judge0-ce.p.rapidapi.com` and set `JUDGE0_RAPIDAPI_KEY` in the backend's
secret manager or untracked root `.env`. The API sends `X-RapidAPI-Key` and
`X-RapidAPI-Host` headers. Configure exactly one authentication mode; do not
set both `JUDGE0_AUTH_TOKEN` and `JUDGE0_RAPIDAPI_KEY`. RapidAPI receives the
candidate's source code and execution input, so use this option only if your
institution approves that data transfer. Check the provider's current quotas
and terms before using it for live exams.

Never use a `VITE_*` variable for Judge0 URLs or credentials. Store all runner
credentials only on the API server.

Use HTTPS unless the API and Judge0 communicate over a trusted private network.
For private HTTP only, explicitly set `JUDGE0_PRIVATE_HTTP_CONFIRMED=true`.
Standard Judge0 language IDs are used by default (C 50, C++ 54, Java 62,
Python 71, JavaScript 63); override individual IDs with `JUDGE0_LANGUAGE_ID_C`,
`JUDGE0_LANGUAGE_ID_CPP`, `JUDGE0_LANGUAGE_ID_JAVA`,
`JUDGE0_LANGUAGE_ID_PYTHON`, or `JUDGE0_LANGUAGE_ID_JAVASCRIPT` if your
installation uses different IDs.

Run samples execute only visible cases. Submit evaluates the question's full
test set, but private inputs and expected outputs stay in the API/database and
are never returned to the candidate. Verify the Judge0 sandbox, worker
isolation, CPU/memory/time limits, and network policy before using it with
untrusted exam submissions. If Judge0 is unconfigured or unavailable, Run and
Submit remain disabled.

### AI Service (.env)
```bash
# This must be identical to the backend's AI_SERVICE_TOKEN.
AI_SERVICE_TOKEN=<same 32+ character secret configured for the backend>

# YOLO11n weights
YOLO_MODEL_PATH=/app/models/yolo11n.pt

# Service Configuration
PORT=8000
HOST=0.0.0.0
```

For local development, both services load the repository-root `.env`; do not
create separate `server/.env` or `ai-service/.env` token values. Process
environment variables override `.env`, so deployments must inject the same
secret into both services using their secret manager. Keep the token out of
client configuration and logs. Production requires `AI_SERVICE_URL` to be a
network-accessible HTTPS URL, not localhost. The backend's authenticated
readiness check verifies the shared Bearer credential; `/health/ready` is also
Bearer-protected, while `/health` exposes non-secret diagnostics only.

### Frontend (Vercel/Netlify Environment Variables)
```bash
VITE_API_URL=https://api.examguard.example.com
```

## Database Setup

### 1. Create Database
```bash
# Using psql
createdb examguard

# Or via managed provider dashboard
```

### 2. Run Migrations
```bash
cd server
npx prisma migrate deploy
npx prisma generate
```

### 3. Verify Connection
```bash
npx tsx -e "import { PrismaClient } from './generated/prisma/client.js'; const p = new PrismaClient(); await p.\$queryRaw\`SELECT 1\`; console.log('DB connected'); await p.\$disconnect();"
```

### 4. Create the initial System Admin

The initial System Admin account is created once by the bootstrap script. Supply
`SYSTEM_ADMIN_EMAIL` and a unique `SYSTEM_ADMIN_PASSWORD` (at least 14
characters) through the deployment secret manager or a protected local
environment. Do not put these credentials in frontend variables, source
control, shell history, or public deployment logs.

Run the bootstrap once after applying migrations:

```bash
cd server
npm run bootstrap:platform-admin
```

The script requires `SYSTEM_ADMIN_BOOTSTRAP=yes`, creates the account only when
no platform-admin account or reserved system organization already exists, and
refuses to update an existing account on later runs. Disable/remove the
bootstrap flag immediately afterward. Sign in with the email and password
injected for that one-time run, then change the password from the account
settings page. If the bootstrap reports that setup was already initialized,
use the existing account-recovery process; do not rerun it to replace
credentials.

## Backend Deployment

### Option A: Docker (Recommended)

#### Dockerfile
```dockerfile
# server/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
RUN npm ci --workspaces --include-workspace-root

COPY . .
RUN npm run build -w server

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package*.json ./
COPY --from=builder /app/server/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4000
CMD ["node", "dist/src/index.js"]
```

#### Build & Run
```bash
docker build -t examguard-api -f server/Dockerfile .
docker run -d \
  --name examguard-api \
  -p 4000:4000 \
  --env-file .env \
  examguard-api
```

### Option B: Render/Railway/ECS

1. **Connect Repository**: Link the GitHub repository and use the root
   `render.yaml` Blueprint.
2. **Build Command**: `npm ci --include=dev && cd server && npx prisma generate && cd .. && npm run build -w @examguard/server`
3. **Start Command**: `cd server && npx prisma migrate deploy && cd .. && npm run start -w @examguard/server`
4. **Environment Variables**: Configure the production variables listed in
   [Free-tier deployment](#deploy-the-client-and-api), including private
   storage, Brevo, and the HTTPS AI endpoint.
5. **Health Check**: `GET /health` → `{"status":"ok"}`

### Option C: PM2 (VPS)
```bash
# Install PM2
npm install -g pm2

# Create ecosystem.config.js
module.exports = {
  apps: [{
    name: 'examguard-api',
    script: 'dist/src/index.js',
    cwd: '/path/to/server',
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    }
  }]
};

# Start
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## Frontend Deployment

### Vercel (Recommended)

1. **Import Project**: Connect GitHub repo
2. **Framework Preset**: Vite
3. **Root Directory**: `client`
4. **Build Command**: `npm run build`
5. **Output Directory**: `dist`
6. **Environment Variables**: Add `VITE_API_URL` as the API origin, e.g. `https://api.examguard.example.com` (no trailing `/api`). Set the API's `CLIENT_URL` to the exact HTTPS frontend origin. The frontend build uses this value for all API requests.

### Netlify
```toml
# netlify.toml
[build]
  base = "client"
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Static Hosting (S3 + CloudFront, Azure Static Web Apps)
```bash
cd client
npm run build
# Upload dist/ contents to static hosting
```

## AI Service Deployment

The AI process must run continuously on a network-accessible host, not on each
student's device. The API calls it server-to-server; only the browser calls
the API. For production, the URL configured in `AI_SERVICE_URL` must be HTTPS
and reachable from the API host. Protect `/analyze` and `/health/ready` with
the shared Bearer token and do not expose an unauthenticated inference endpoint.

Build the included container and run it with the same random 32+ character
`AI_SERVICE_TOKEN` used by the API. Mount compatible YOLO weights read-only:

```powershell
docker network create examguard-private
docker build -t examguard-ai .\ai-service
docker run -d --name examguard-ai --restart unless-stopped `
  --network examguard-private `
  -e AI_SERVICE_TOKEN=$env:AI_SERVICE_TOKEN `
  -e YOLO_MODEL_PATH=/app/models/yolo11n.pt `
  -v C:\examguard\models:/app/models:ro `
  examguard-ai
```

For local-only Docker development, attach the API container to the same private
network. In production, terminate TLS at the AI service or a trusted HTTPS
proxy and set `AI_SERVICE_URL` to that network-accessible HTTPS URL; the
backend rejects production HTTP and localhost URLs. Set the identical
`AI_SERVICE_TOKEN` on both services. Never put `AI_SERVICE_TOKEN` or the AI
URL in `VITE_*` frontend variables.

The API readiness check verifies the model automatically. Set up a platform
health check for the AI container at `/health`; its authenticated readiness
endpoint is `/health/ready` and requires the shared bearer token. The model
weights must exist and include a recognized phone class. CPU inference works
but may need more resources; GPU is optional.

### Health Check
```bash
curl http://localhost:8000/health
# Expect mediapipe=ready, looking_away=ready, and phone_model=ready only when
# compatible YOLO weights with a recognized phone class are loaded.
```

### Local development commands

From the repository root, `npm run dev` starts the client, API, and local AI
service together. The local API and AI service use `AI_SERVICE_URL=http://127.0.0.1:8001`.
To validate before deployment, run `npm run lint`, `npm run typecheck`,
`npm test`, and `npm run build`. The production server-only build is
`npm run build -w @examguard/server`; it compiles the updated server sources
into `server/dist`.

## Windows Companion Distribution

### Build Release
```powershell
dotnet publish .\device-monitor\ExamGuard.DeviceMonitor.csproj -c Release -r win-x64 --self-contained true
```

Package the published Companion files together with `Register-ExamGuard-Companion.ps1`. Students run the script once and enter the deployed HTTPS API origin and website origin; the Companion allows only those configured origins. Sign the executable and distribute the package from an institution-controlled HTTPS location. See [the candidate exam setup guide](./CANDIDATE_EXAM_GUIDE.md).

### Create Installer (WiX/Inno Setup)
```xml
<!-- Example WiX fragment -->
<Component>
  <File Source="publish\ExamGuard.DeviceMonitor.exe" KeyPath="yes" />
  <File Source="publish\ExamGuard.DeviceMonitor.runtimeconfig.json" />
  <File Source="publish\ExamGuard.DeviceMonitor.deps.json" />
</Component>
```

### Distribution Checklist
- [ ] Code signing certificate applied
- [ ] Auto-update mechanism configured
- [ ] Privacy policy included
- [ ] System requirements documented (Windows 10 19041+, Bluetooth LE, Wi-Fi)
- [ ] Installation tested on clean VM

## Database Maintenance

### Automated Cleanup (Daily Cron)
```bash
# server/scripts/purge-expired.ts
import { PrismaClient } from '../src/generated/prisma/client.js';
const prisma = new PrismaClient();
await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
await prisma.oAuthAuthorization.deleteMany({ where: { expiresAt: { lt: new Date() } } });
await prisma.radioObservation.deleteMany({ where: { expiresAt: { lt: new Date() } } });
await prisma.$disconnect();
```

### Backup Strategy
```bash
# Daily backup
pg_dump examguard > backups/examguard-$(date +%F).sql

# Restore
psql examguard < backups/examguard-2026-11-06.sql
```

## Monitoring & Observability

### Health Endpoints
| Service | Endpoint | Expected |
|---------|----------|----------|
| API | `/health` | `{"status":"ok"}` |
| AI | `/health` | `mediapipe=ready`; `phone_model=ready` only when compatible YOLO weights load |

### Key Metrics to Monitor
- **API**: Response latency, error rate, active connections
- **Database**: Connection pool usage, query latency, deadlocks
- **Storage**: Bucket size, upload/download latency
- **AI**: Inference latency, GPU memory, model availability

### Logging
```bash
# Structured JSON logging (recommend Pino/Winston)
npm install pino pino-pretty
```

## Security Checklist

### Pre-Deployment
- [ ] All secrets in secure vault (not in repo)
- [ ] Database SSL/TLS enforced
- [ ] Supabase evidence bucket: private access enabled
- [ ] CORS origins restricted to production domains
- [ ] Rate limits configured for production traffic
- [ ] Security headers verified (CSP, HSTS, etc.)
- [ ] OAuth redirect URIs match production URLs
- [ ] JWT_SECRET is 32+ characters, rotated periodically

### Post-Deployment
- [ ] Penetration test scheduled
- [ ] Dependency audit: `npm audit` / `pip-audit`
- [ ] Log aggregation configured
- [ ] Alerting for: error spikes, auth failures, storage quota

## Rollout Strategy

### Blue-Green Deployment
1. Deploy new version to green environment
2. Run smoke tests against green
3. Switch load balancer to green
4. Monitor for 30 minutes
4. Decommission blue

### Canary Release
1. Route 5% traffic to new version
2. Monitor error rates and latency
3. Gradually increase to 100%
4. Rollback if issues detected

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `DATABASE_URL` invalid | Wrong format/credentials | Verify connection string, test with `psql` |
| Prisma migrate fails | Shadow DB permissions | Grant `CREATEDB` to DB user |
| JWT verification fails | Secret mismatch | Ensure same `JWT_SECRET` across services |
| CORS errors | Origin not allowed | Add the exact production frontend origin to `CLIENT_URL`; set `VITE_API_URL` at frontend build time |
| File upload fails | Supabase service role key or bucket configuration | Verify `SUPABASE_URL`, the server-only service role key, and private bucket name |
| AI service 503 | Model not loaded | Check `YOLO_MODEL_PATH`, GPU availability |
| Exam start returns HTTP 500 | API error or database not migrated | Share the displayed request reference with the operator; inspect matching API logs and run `npx prisma migrate deploy` before retrying |

### Debug Commands
```bash
# Check API health
curl https://api.examguard.example.com/health

# Test DB connection
npx tsx -e "import { PrismaClient } from './server/generated/prisma/client.js'; const p = new PrismaClient(); await p.\$queryRaw\`SELECT version()\`; console.log('OK');"

# Verify Supabase Storage access without printing credentials or signed URLs
npm run storage:smoke -w @examguard/server

# Check AI service
curl https://ai.examguard.example.com/health
```

## Version & Release Management

### Semantic Versioning
- **Major**: Breaking API changes, schema migrations
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes, security patches

### Release Process
1. Update version in `package.json` (root, client, server)
2. Generate changelog
3. Tag release: `git tag v1.0.0`
4. Deploy to staging
5. Run integration tests
6. Deploy to production
7. Monitor for 1 hour

---

## Quick Reference

1. Deploy the API, apply database migrations, and configure private storage.
2. Deploy the AI container on a private network reachable by the API; use the same `AI_SERVICE_TOKEN` for both.
3. Build the client with `VITE_API_URL` set to the HTTPS API origin. Set API `CLIENT_URL` to the HTTPS client origin.
4. Build and sign the Windows Companion package. Provide the API/client origins to the one-time registration script.
5. Test the full readiness and exam-start flow from a real Windows student device before inviting candidates.
6. Share [the candidate exam setup guide](./CANDIDATE_EXAM_GUIDE.md) and the institution's Companion download with candidates.

*Last Updated: 2026-11-06*
*Version: 1.0.0*