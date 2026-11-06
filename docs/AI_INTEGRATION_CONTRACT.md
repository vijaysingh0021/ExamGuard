# AI integration contract

Status: **NOT IMPLEMENTED**. This contract defines the minimum conditions for a future authenticated integration; it is not evidence that model inference is enabled.

## Current boundary

`ai-service/main.py` accepts one uploaded image frame in memory, rejects non-images, empty frames, oversized frames, invalid images, unavailable CV dependencies, and unavailable model inference. It does not persist frames, create incidents, grade, pause, terminate, or otherwise act on an exam. The backend currently exposes only AI configuration status and does not call the service.

## Required contract before implementation

1. The API must authenticate to a private AI service using a dedicated rotating service credential, never a candidate JWT. The AI service must reject missing or invalid credentials.
2. The API must authenticate the candidate, verify candidate/organization/attempt ownership, require `in_progress` status, and enforce server deadline before forwarding a frame.
3. A product decision must define explicit, revocable candidate consent for camera capture and the UI disclosure shown before capture. Consent status must be stored/audited at the exam-session level before any inference call.
4. The API must send a short-lived request identifier, organization/attempt association, bounded image bytes, MIME type, and no unrelated identity fields. Maximum frame size is 5 MB at the API and 10 MB at the service; the integration must use the lower 5 MB limit.
5. Frames are processed in memory only. No frame, raw image bytes, biometric template, face identity, device identifier, or inference payload may be logged. Any temporary processing storage must be disabled by default and have an explicit deletion schedule.
6. The API must use a bounded timeout, cancellation on client disconnect, and a small retry policy only for transient transport failure. It must not retry invalid input or create duplicate review records.
7. The service response must be validated against a strict schema and include service/model version, model availability, face presence/count, optional phone detection confidence, and explicit limitations. Missing model/version or malformed responses are service failures.
8. Thresholds and model labels must be configuration reviewed and versioned. No facial recognition is permitted.
9. A validated response may create only a review-only proctoring event associated with the authorized attempt. It must be deduplicated, auditable, and visible only to authorized reviewers. It must never change attempt state, create a misconduct conclusion, or modify grading.
10. Health must distinguish API reachability, dependency availability, model availability, and model version. A health response is not inference validation.

## Blocking decisions

The repository has no persisted consent policy or approved retention schedule for AI frames, no AI service credential configuration, and no approved model/version. Those are product and security decisions, not safe defaults. Therefore an authenticated adapter has deliberately not been added.

## Evidence required for future verification

- A validated local model and optional dependencies installed on a non-production host.
- Contract tests for API authentication, candidate ownership, active attempt/deadline checks, payload limits, timeout, malformed response, unavailable model, and deduplicated review-only record creation.
- A live integration test using only approved test fixtures and no retained images.
