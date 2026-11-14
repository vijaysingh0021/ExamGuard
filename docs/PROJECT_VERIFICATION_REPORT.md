# ExamGuard Project Verification Report

**Checked:** 2026-11-13  
**Scope:** Current workspace code and local automated checks. This is not a production deployment certification.

## Summary

The project builds locally and the available client, server, AI-service, and Windows Companion checks pass. Bluetooth observations are now described in plain language in the Evidence Center, including when they appear alongside a camera review signal. The image-capture paths are connected to private storage and reviewer access, but a live exam using the deployed browser, API, database, object storage, camera, and radios was not available; actual hosted captures therefore cannot be confirmed here.

## Project components checked

- **Web client:** React, Vite, and TypeScript for student exams, exam management, and evidence review.
- **API:** Express and Prisma, with PostgreSQL-backed exams, monitoring events, radio observations, and evidence records.
- **AI service:** FastAPI image analysis, called through the API.
- **Windows Companion:** .NET app providing Bluetooth LE and Wi-Fi observations to the API.

## Bluetooth evidence and incident review

- Radio observations are recorded separately from camera evidence. Bluetooth broadcasts and Wi-Fi access-point scans do not identify a device owner or prove device use.
- Evidence records now use plain labels such as **“Bluetooth signal detected”** and **“Wi-Fi access point observed.”**
- The review detail gives a simple signal-strength description and explains that strength is not a dependable distance measurement. Technical values are secondary details; broadcast names are explicitly unverified.
- When a camera review signal has time-matched radio observations, the detail panel now explains in plain language that these signals occurred around the same time but are not linked to anything visible in the camera.
- Bluetooth and Wi-Fi can be unavailable or miss devices. The Companion's observations are best-effort, and the result must remain human-reviewed.

## Image-capture path review

1. **Periodic full-display stills:** The student must choose a full monitor in the browser's screen-sharing picker. The client captures immediately and then every 15 seconds, uploads JPEG stills to the API, and displays a warning if a frame cannot be captured or saved.
2. **AI camera checks:** The client samples a camera frame every six seconds and sends it to the API. The API requires consent, an active Companion heartbeat, and a working AI service. A camera frame is retained as private evidence when a signal is confirmed by the existing three-of-five-frame rule.
3. **Incident context images:** Recent camera frames can be attached before a confirmed AI incident; additional frames are captured and uploaded after it. The API links them to the incident and the review panel displays the available timeline. Capture or upload failures now raise a student-facing warning.
4. **Browser-event camera evidence:** Browser events can reference a recent camera frame. If that image cannot be captured, the event is still recorded and the student is told that camera evidence was unavailable.
5. **Reviewer access:** Image objects are stored under organization/attempt-scoped keys. The Evidence Center requests short-lived authenticated access rather than a public storage URL.

The screen-capture API now has integration coverage: a consented monitor image is written to mocked private storage and indexed as image evidence, while a non-monitor submission is rejected before storage. These tests do not operate a real browser camera or a production object-storage bucket, so they cannot establish that a frame was actually captured or visible for a particular hosted attempt. Check the Evidence Center for the attempt and timestamp, confirm the record indicates an image is attached, and inspect API/storage logs for any missing image. AI camera/context capture still needs a live browser-and-storage check.

## Screenshot: exam-start HTTP 500

The screenshot shows the client receiving HTTP 500 and displaying request reference `ad147e11-8665-47f1-a2ba-040df85c467d`. The API's unexpected-error handler generates a request reference, logs the underlying exception with that reference, and returns it to the client. The reference does not appear in the checked workspace, and hosted API logs are not available here, so the cause cannot be established from the screenshot alone.

For diagnosis, the operator should search the deployed API logs for the exact reference and inspect the associated exception, database connection, and migration state. Do not treat a migration mismatch as confirmed without the matching log. An operator can then decide whether retrying is safe; the student-facing message in the screenshot correctly advises a single retry and sharing the reference if it persists.

## Verification results

| Area | Command/check | Result |
|---|---|---|
| Server | `npm test` | 198 tests passed |
| Client | `npm run test -w client` | 136 tests passed |
| AI service | `python -m unittest discover -s ai-service -p 'test_*.py' -v` | 11 tests passed |
| TypeScript | `npm run typecheck` | Passed |
| Production build | `npm run build` | Passed; Vite reports a 1.28 MB minified JavaScript chunk above its 500 kB advisory threshold |
| Windows Companion | `dotnet build device-monitor\ExamGuard.DeviceMonitor.csproj --no-restore` | Passed with 0 warnings and 0 errors |
| Patch formatting | `git diff --check` | Passed; Git emitted line-ending conversion warnings for existing working-tree files |

The tests and builds are local checks. They do not prove hosted environment configuration, migrations, TLS/CORS, Companion installation on student machines, radio hardware compatibility, or end-to-end evidence delivery.

## Readiness and follow-up

- **Local code readiness:** Builds and listed automated checks pass.
- **Hosted exam readiness:** Not verified. Confirm the production API, database migrations, AI-service health/private connectivity, private storage, and Companion pairing before an exam.
- **Hardware readiness:** Not verified on a physical student's Windows device; Bluetooth/Wi-Fi detection depends on adapter, Windows permissions, and Companion availability.
- **Exam-start 500:** Unresolved until the matching API log for the screenshot reference is inspected.
- **Bundle size:** Consider code-splitting the largest client bundle in a separate performance task; the current warning does not fail the build.

See [deployment instructions](./deployment.md), [architecture](./architecture.md), and the [candidate exam guide](./CANDIDATE_EXAM_GUIDE.md) for operational setup.
