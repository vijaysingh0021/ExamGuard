# Workspace scripts

Development database seed logic is located in `server/scripts/seed.ts`. It requires `DEMO_SEED=yes` and a non-production PostgreSQL database in `DATABASE_URL`. All accounts use `ExamGuard-Demo-2026!` unless `DEMO_SEED_PASSWORD` overrides it. The system-admin login is `platform.admin@demo.examguard.test`; all demo addresses use the reserved `.test` domain and do not receive email. See `docs/DEVELOPMENT_DEMO.md` for the other panel accounts and sample data.
