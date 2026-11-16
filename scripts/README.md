# Workspace scripts

Development database seed logic is located in `server/scripts/seed.ts`. It requires `DEMO_SEED=yes`, a unique `DEMO_SEED_PASSWORD` of at least 12 characters, and a loopback non-production PostgreSQL database in `DATABASE_URL`. The seed never prints the password. The system-admin login is `platform.admin@demo.examguard.test`; all demo addresses use the reserved `.test` domain and do not receive email. See `docs/DEVELOPMENT_DEMO.md` for the other panel accounts and sample data.
