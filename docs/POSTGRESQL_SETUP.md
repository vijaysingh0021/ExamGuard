# PostgreSQL Setup & Development Guide

## Prerequisites

- PostgreSQL 17 server installed and running.
- Node.js 22+ and npm.
- OpenSSL (required for Prisma).

## Configuration

1.  **Environment Variables**:
    Copy `server/.env.example` to `server/.env`.
    - `DATABASE_URL`: `postgresql://postgres:<password>@localhost:5432/examguard`
    - `CLIENT_URL`: `http://localhost:5173`
    - `PORT`: `3000`
    - `JWT_SECRET`: (Secure, random string)

2.  **Database Initialization**:
    Ensure the `examguard` database exists:
    ```bash
    createdb examguard
    ```

3.  **Schema Migration & Client**:
    ```bash
    cd server
    npx prisma migrate dev --name init
    npx prisma generate
    ```

4.  **Seed Development Data** (Use only in non-production environments):
    ```bash
    cd server
    DEMO_SEED=yes DEMO_SEED_PASSWORD=<password> npm run seed
    ```

## Backup & Restore

- **Backup**: `pg_dump examguard > backup.sql`
- **Restore**: `psql examguard < backup.sql`
