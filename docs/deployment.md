# ExamGuard Deployment Guide

## Overview

This guide covers production deployment of ExamGuard across all components:
- **Frontend**: React/Vite application (Vercel/Netlify/Static hosting)
- **Backend**: Express/TypeScript API (Render/Railway/ECS/Docker)
- **Database**: PostgreSQL 17 (Managed: Supabase/Neon/RDS/Cloud SQL)
- **AI Service**: FastAPI (GPU instance for YOLO inference)
- **Windows Companion**: .NET 8 WinForms app (MSI/ClickOnce distribution)

## Prerequisites

### Infrastructure Requirements
- PostgreSQL 17+ database
- Redis (optional, for session caching)
- S3-compatible object storage (AWS S3, Cloudflare R2, MinIO)
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

# Object Storage (S3-compatible)
OBJECT_STORAGE_ENDPOINT=https://your-account.r2.cloudflarestorage.com
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=examguard-private
OBJECT_STORAGE_ACCESS_KEY_ID=your-access-key
OBJECT_STORAGE_SECRET_ACCESS_KEY=your-secret-key

# Email (webhook provider)
EMAIL_URL=https://api.emailservice.com/send
EMAIL_FROM=noreply@examguard.example.com
EMAIL_PROVIDER=webhook

# OAuth Providers (configure in provider consoles)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-secret
MICROSOFT_TENANT_ID=common

# AI Service (optional)
AI_SERVICE_URL=https://ai.examguard.example.com
```

### AI Service (.env)
```bash
# YOLO Model (download and place in models/)
YOLO_MODEL_PATH=/app/models/yolov8n.pt

# Service Configuration
PORT=8000
HOST=0.0.0.0
```

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
CMD ["node", "dist/index.js"]
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

1. **Connect Repository**: Link GitHub repo
2. **Build Command**: `npm run build -w server`
3. **Start Command**: `npm run start -w server`
4. **Environment Variables**: Add all from `.env` above
5. **Health Check**: `GET /health` → `{"status":"ok"}`

### Option C: PM2 (VPS)
```bash
# Install PM2
npm install -g pm2

# Create ecosystem.config.js
module.exports = {
  apps: [{
    name: 'examguard-api',
    script: 'dist/index.js',
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
6. **Environment Variables**: Add `VITE_API_URL`

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

### GPU Instance (Required for YOLO)
```bash
# docker run with GPU
docker run -d \
  --name examguard-ai \
  --gpus all \
  -p 8000:8000 \
  -v $(pwd)/ai-service:/app \
  -v $(pwd)/models:/app/models \
  --env-file ai-service/.env \
  python:3.12-slim \
  bash -c "pip install -r requirements-ai.txt && python main.py"
```

### Dockerfile
```dockerfile
# ai-service/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-ai.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-ai.txt
COPY main.py .
EXPOSE 8000
CMD ["python", "main.py"]
```

### Health Check
```bash
curl http://localhost:8000/health
# Expected: {"mediapipe":"ready","phone_model":"ready","looking_away":"not_implemented"}
```

## Windows Companion Distribution

### Build Release
```bash
cd device-monitor
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishReadyToRun=true -o ./publish
```

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
| AI | `/health` | `{"mediapipe":"ready","phone_model":"ready"}` |

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
- [ ] S3 bucket: public access blocked, encryption enabled
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
| CORS errors | Origin not allowed | Add production domain to `CLIENT_URL` |
| File upload fails | S3 credentials/bucket policy | Verify keys, bucket exists, policy allows PUT |
| AI service 503 | Model not loaded | Check `YOLO_MODEL_PATH`, GPU availability |

### Debug Commands
```bash
# Check API health
curl https://api.examguard.example.com/health

# Test DB connection
npx tsx -e "import { PrismaClient } from './server/generated/prisma/client.js'; const p = new PrismaClient(); await p.\$queryRaw\`SELECT version()\`; console.log('OK');"

# Verify S3 access
aws s3 ls s3://examguard-private --endpoint-url https://...

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

### Start All Services (Docker Compose)
```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: examguard
      POSTGRES_USER: examguard
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports: ["5432:5432"]
  
  api:
    build: ./server
    environment:
      - DATABASE_URL=postgresql://examguard:${DB_PASSWORD}@postgres:5432/examguard
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    ports: ["4000:4000"]
    depends_on: [postgres]
  
  ai:
    build: ./ai-service
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    ports: ["8000:8000"]

volumes:
  postgres_data:
```

### Run
```bash
docker compose up -d
```

### Verify Deployment
```bash
# All services
curl http://localhost:4000/health
curl http://localhost:8000/health
```

---

*Last Updated: 2026-11-06*
*Version: 1.0.0*