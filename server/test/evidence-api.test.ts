import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceInventoryQuerySchema,
  evidenceReviewerRoles,
  evidenceMimeTypes,
  evidenceMaxBytes,
  evidenceUrlTtlSeconds,
  incidentReviewStatus,
  radioReviewStatus,
  evidencePaginationHeaders,
  evidenceOffset,
  privateEvidenceMetadataError,
  evidenceKeyMatchesAttempt,
  evidenceAttemptScopeMatches,
  uploadErrorHttpStatus,
  signedEvidenceUrlExpiresAt,
  signedEvidenceUrlExpired,
  sanitizeEvidenceDetails,
  canTransitionIncident,
  canTransitionRadio,
} from '../src/evidence-api.js';

const candidateId = '550e8400-e29b-41d4-a716-446655440001';
const examId = '550e8400-e29b-41d4-a716-446655440002';
const attemptId = '550e8400-e29b-41d4-a716-446655440003';

test('evidence inventory pagination defaults and maximums are validated', () => {
  assert.deepEqual(evidenceInventoryQuerySchema.parse({}), { page: 1, pageSize: 50 });
  assert.equal(evidenceInventoryQuerySchema.safeParse({ page: 1000, pageSize: 100 }).success, true);
  assert.equal(evidenceInventoryQuerySchema.safeParse({ page: 1001 }).success, false);
  assert.equal(evidenceInventoryQuerySchema.safeParse({ pageSize: 101 }).success, false);
  assert.equal(evidenceInventoryQuerySchema.safeParse({ page: 0 }).success, false);
});

test('evidence inventory validates candidate, exam, attempt, type and review filters', () => {
  assert.equal(evidenceInventoryQuerySchema.safeParse({ candidateId, examId, attemptId, type: 'radio_observation', reviewStatus: 'pending_review' }).success, true);
  assert.equal(evidenceInventoryQuerySchema.safeParse({ candidateId: 'bad' }).success, false);
  assert.equal(evidenceInventoryQuerySchema.safeParse({ type: 'screen_recording' }).success, false);
  assert.equal(evidenceInventoryQuerySchema.safeParse({ reviewStatus: 'dismissed' }).success, false);
});

test('evidence inventory rejects reversed date ranges and excessive search input', () => {
  assert.equal(evidenceInventoryQuerySchema.safeParse({ from: '2026-11-07T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' }).success, false);
  assert.equal(evidenceInventoryQuerySchema.safeParse({ search: 'x'.repeat(121) }).success, false);
});

test('review status mappings preserve human review semantics', () => {
  assert.equal(incidentReviewStatus('open'), 'pending_review');
  assert.equal(incidentReviewStatus('awaiting_student'), 'pending_review');
  assert.equal(incidentReviewStatus('resolved'), 'reviewed');
  assert.equal(incidentReviewStatus('escalated'), 'escalated');
  assert.equal(incidentReviewStatus(['open', 'resolved']), 'pending_review');
  assert.equal(incidentReviewStatus(['resolved', 'escalated']), 'escalated');
  assert.equal(radioReviewStatus([]), 'pending_review');
  assert.equal(radioReviewStatus(['pending_review']), 'pending_review');
  assert.equal(radioReviewStatus(['reviewed_no_concern']), 'reviewed');
});

test('evidence access policy remains limited to existing image types and short-lived URLs', () => {
  assert.deepEqual(evidenceReviewerRoles, ['institute_admin', 'teacher', 'proctor']);
  assert.deepEqual(evidenceMimeTypes, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(evidenceMaxBytes, 5 * 1024 * 1024);
  assert.equal(evidenceUrlTtlSeconds, 60);
});

test('evidence pagination metadata and offsets are deterministic', () => {
  assert.deepEqual(evidencePaginationHeaders(2, 25, 51), { 'X-Page': '2', 'X-Page-Size': '25', 'X-Total-Count': '51', 'X-Total-Pages': '3' });
  assert.equal(evidenceOffset(3, 25), 50);
});

test('private evidence metadata rejects missing objects, unsupported MIME and oversized objects', () => {
  assert.deepEqual(privateEvidenceMetadataError(null), { status: 404, message: 'Evidence object is missing or expired' });
  assert.equal(privateEvidenceMetadataError({ contentType: 'application/pdf', contentLength: 100 })?.status, 415);
  assert.equal(privateEvidenceMetadataError({ contentType: 'image/jpeg', contentLength: 0 })?.status, 413);
  assert.equal(privateEvidenceMetadataError({ contentType: 'image/png', contentLength: evidenceMaxBytes + 1 })?.status, 413);
  assert.equal(privateEvidenceMetadataError({ contentType: 'image/webp', contentLength: 1024 }), null);
});

test('private evidence object keys must match the organization and attempt namespace', () => {
  const key = `organizations/${candidateId}/attempts/${attemptId}/evidence/object-id`;
  assert.equal(evidenceKeyMatchesAttempt(key, candidateId, attemptId), true);
  assert.equal(evidenceKeyMatchesAttempt(key, examId, attemptId), false);
  assert.equal(evidenceKeyMatchesAttempt(key, candidateId, examId), false);
  assert.equal(evidenceKeyMatchesAttempt(`organizations/${candidateId}/attempts/${attemptId}/evidence/`, candidateId, attemptId), false);
});

test('evidence record access requires matching organization, exam, candidate and attempt scope', () => {
  const attempt = { organizationId: candidateId, examId, candidateId: attemptId };
  assert.equal(evidenceAttemptScopeMatches(attempt, { organizationId: candidateId, examId, candidateId: attemptId }, candidateId), true);
  assert.equal(evidenceAttemptScopeMatches(attempt, { organizationId: examId, examId, candidateId: attemptId }, candidateId), false);
  assert.equal(evidenceAttemptScopeMatches({ ...attempt, candidateId: examId }, { organizationId: candidateId, examId, candidateId: attemptId }, candidateId), false);
  assert.equal(evidenceAttemptScopeMatches(null, { organizationId: candidateId, examId, candidateId: attemptId }, candidateId), false);
});

test('oversized uploads return HTTP 413 while other multer errors remain client errors', () => {
  assert.equal(uploadErrorHttpStatus('LIMIT_FILE_SIZE'), 413);
  assert.equal(uploadErrorHttpStatus('LIMIT_UNEXPECTED_FILE'), 400);
});

test('signed evidence URL expiry is deterministic and refreshable at the 60-second boundary', () => {
  const expiresAt = signedEvidenceUrlExpiresAt(1_000);
  assert.equal(expiresAt, 61_000);
  assert.equal(signedEvidenceUrlExpired(expiresAt, 60_999), false);
  assert.equal(signedEvidenceUrlExpired(expiresAt, 61_000), true);
});

test('reviewer event details redact storage internals and credential-like fields recursively', () => {
  assert.deepEqual(sanitizeEvidenceDetails({ visible: 'ok', evidenceKey: 'private/object', nested: { accessToken: 'secret', note: 'review context' }, path: '/srv/private', count: 2 }), { visible: 'ok', nested: { note: 'review context' }, count: 2 });
  assert.deepEqual(sanitizeEvidenceDetails(['safe', { bucketName: 'private-bucket' }]), ['safe', {}]);
  assert.equal(sanitizeEvidenceDetails('https://private.example/object'), '[redacted external resource reference]');
});


test('incident decisions follow the existing incident status transition policy', () => {
  assert.equal(canTransitionIncident('open', 'awaiting_student'), true);
  assert.equal(canTransitionIncident('open', 'escalated'), true);
  assert.equal(canTransitionIncident('awaiting_student', 'resolved'), true);
  assert.equal(canTransitionIncident('escalated', 'dismissed'), true);
  assert.equal(canTransitionIncident('resolved', 'dismissed'), false);
  assert.equal(canTransitionIncident('dismissed', 'resolved'), false);
  assert.equal(canTransitionIncident('unknown', 'resolved'), false);
});

test('radio decisions are one-way from pending_review and reject stale re-review', () => {
  assert.equal(canTransitionRadio('pending_review', 'reviewed_no_concern'), true);
  assert.equal(canTransitionRadio('pending_review', 'reviewed_concern_retained'), true);
  assert.equal(canTransitionRadio('reviewed_no_concern', 'reviewed_concern_retained'), false);
  assert.equal(canTransitionRadio('insufficient_evidence', 'reviewed_no_concern'), false);
});
