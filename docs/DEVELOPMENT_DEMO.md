# Development Demo

The seed creates clearly marked synthetic records. Run it only against an isolated, non-production PostgreSQL database after applying migrations.

## Seed

From the repository root in PowerShell:

```powershell
$env:DEMO_SEED = 'yes'
$env:DEMO_SEED_PASSWORD = '<unique-local-password-of-at-least-12-characters>'
npm.cmd run seed
```

Use only a loopback, non-production PostgreSQL database. The seed requires the explicit password, does not provide a shared default, and never prints it. Re-running the seed refreshes the demo account passwords and roles.

| Panel / role | Dummy sign-in email | Login page |
|---|---|---|
| System administrator | `platform.admin@demo.examguard.test` | `/system/login` |
| University administrator | `aarav.admin@demo.examguard.test` | `/institute/login` |
| Exam coordinator | `priya.teacher@demo.examguard.test` | `/teacher/login` |
| Proctor | `karan.proctor@demo.examguard.test` | `/institute/login` |
| Student / candidate | `aditi.candidate@demo.examguard.test` | `/student/login` |

These are synthetic `.test` addresses, not real Gmail accounts, and they cannot receive mail. The seed includes a demo institution, candidate roster, published CSE fundamentals assessment, questions, exam assignments, and sample subjects on the teacher profiles. Records are labelled `[DEMO]`; no monitoring observations or real identity documents are generated.

## Coordinator approval workflow

1. Ensure `.env` has `LOCAL_EVIDENCE_DIR=./.local-evidence` for local testing, or configure a private Supabase Storage bucket with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `OBJECT_STORAGE_BUCKET`.
2. Open `/coordinator/register` and search for the seeded demo institution.
3. Submit the application with test proof files: a government ID, university ID, and authorization letter. Each must be a valid PDF, JPEG, PNG, or WebP under 5 MB.
4. Sign in as `aarav.admin@demo.examguard.test` with the password set in `DEMO_SEED_PASSWORD`, open **People and roles**, inspect the private proof files, and approve or reject the coordinator.
5. Before approval the coordinator account is inactive and sign-in is blocked. On approval the account becomes active, and the applicant receives an in-app notification.

Local evidence files are private and remain on the configured machine; this demo does not automatically delete them. Do not upload real identity documents to a shared development environment. Deployments should use private object storage and apply the institution's retention policy.
