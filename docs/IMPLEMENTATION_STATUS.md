# Nearby radio observation prototype status

## Repository audit

- The React/Vite client and Express/MongoDB API already support tenant-scoped attempts, proctoring events, incidents, audit logs, and reviewer decisions.
- `device-monitor/` was only a placeholder; no previous desktop framework existed.
- The institution directory uses the Hipolabs public endpoint through the API. It has timeout, one retry, and a five-minute in-memory cache; failures expose a real unavailable state plus the existing review-request fallback.

## Implemented

- Windows .NET 8 companion source using `BluetoothLEAdvertisementWatcher` and Native Wi-Fi `WlanScan`/`WlanGetNetworkBssList`.
- Explicit consent, visible scan status, timestamps/activity log, scan-stop action, error reporting, and session-scoped in-memory identifier pseudonyms.
- MongoDB records for raw radio observations and separate candidate signals.
- Authenticated, rate-limited observation ingestion; the API verifies the bearer user owns the active candidate attempt and uses server timestamps.
- A conservative server rule creates a review-only candidate signal after three observations of a category within five minutes. It cannot pause, terminate, grade, or penalize an attempt.
- Authorized reviewer listing and decisions with audit logs.

## Not performed

- No .NET SDK is installed in this environment, so the Windows companion was not compiled here.
- No physical Windows/Bluetooth/Wi-Fi hardware validation occurred. Validate with Android/iPhone, accessories, routers, hotspots, radio-disabled state, and permission/API failures before deployment.

## Privacy and retention

Raw identifiers are pseudonymized per running companion session, not anonymous. The API stores only the pseudonym, RSSI when returned, scanner health, and an explicit limitation statement. Deploy a retention policy/TTL index appropriate to the institution before production; do not use radio signals as a disciplinary finding without human review.

## Product redesign

- Replaced the basic three-entry-card public homepage with a responsive, candidate-first ExamGuard product page.
- Added product, workflow, and security sections; a mobile navigation menu; only valid public routes in the footer; and a clearly labelled illustrative workspace preview with no fabricated operational data.
- Existing login, registration, password recovery, OAuth discovery, candidate institution selection, and backend authentication routes are unchanged.
- Client lint and production build passed. Visual browser testing was not performed in this environment.
