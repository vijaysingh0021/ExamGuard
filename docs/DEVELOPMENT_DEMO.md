# Development demo data

The fixture is disabled by default. It creates a clearly labelled demo organization, two teachers, one administrator, five candidate accounts, ten objective questions, one published assessment, and candidate assignments. It creates no monitoring observations.

Use a dedicated, non-production PostgreSQL database (the database name in `DATABASE_URL` must not look like production):

```powershell
$env:DEMO_SEED = 'yes'
$env:DEMO_SEED_PASSWORD = 'choose-a-local-password-with-12-or-more-characters'
npm.cmd run seed
```

The script refuses production-like database names, requires the explicit opt-in and password, uses upserts, and does not print the password. Sign in with the password above and one of: `aarav.admin@demo.examguard.test`, `priya.teacher@demo.examguard.test`, `rahul.teacher@demo.examguard.test`, or the five `*.candidate@demo.examguard.test` accounts. Demo records are prefixed with `[DEMO]`.
