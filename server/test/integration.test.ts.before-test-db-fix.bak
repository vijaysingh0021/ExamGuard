import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../src/config.js';
import { isUuid } from '../src/ids.js';

const previousEnv = { ...process.env };

// ESM evaluates static imports before this module body. Keep Prisma-dependent
// modules dynamic so they cannot initialize from the repository .env.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://postgres:123456@localhost:5432/examguard_test',
  JWT_SECRET: 'x'.repeat(32)
});

let prisma: typeof import('../src/prisma.js').prisma;
let signToken: typeof import('../src/auth.js').signToken;
let tenantFilter: typeof import('../src/auth.js').tenantFilter;

const TEST_ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440001';
const TEST_CANDIDATE_ID = '550e8400-e29b-41d4-a716-446655440002';
const TEST_EXAM_ID = '550e8400-e29b-41d4-a716-446655440003';
const TEST_ATTEMPT_ID = '550e8400-e29b-41d4-a716-446655440004';

async function cleanup() {
  // Delete in correct order to satisfy foreign key constraints
  await prisma.attemptAnswer.deleteMany({ where: { attemptId: TEST_ATTEMPT_ID } });
  await prisma.examAttempt.deleteMany({ where: { OR: [{ id: TEST_ATTEMPT_ID }, { examId: TEST_EXAM_ID }] } });
  await prisma.question.deleteMany({ where: { examId: TEST_EXAM_ID } });
  await prisma.membership.deleteMany({ where: { userId: TEST_USER_ID } });
  await prisma.exam.deleteMany({ where: { id: TEST_EXAM_ID } });
  // Delete ALL candidates for this organization first (handles any orphaned test data)
  await prisma.candidate.deleteMany({ where: { organizationId: TEST_ORG_ID } });
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  await prisma.organization.deleteMany({ where: { id: TEST_ORG_ID } });
}

test.before(async () => {
  ({ prisma } = await import('../src/prisma.js'));
  ({ signToken, tenantFilter } = await import('../src/auth.js'));

  const connection = await prisma.$queryRaw<Array<{ databaseName: string }>>`
    SELECT current_database() AS "databaseName"
  `;
  if (connection[0]?.databaseName !== 'examguard_test') {
    await prisma.$disconnect();
    throw new Error('Integration tests refuse to modify a database other than examguard_test.');
  }

  await cleanup();

  const passwordHash = await bcrypt.hash('TestPass123', 12);

  await prisma.organization.create({ data: { id: TEST_ORG_ID, name: 'Test Org', slug: 'test-org' } });
  await prisma.user.create({ data: { id: TEST_USER_ID, name: 'Test User', email: 'test@example.com', passwordHash } });
  await prisma.membership.create({ data: { userId: TEST_USER_ID, organizationId: TEST_ORG_ID, role: 'institute_admin', active: true } });
  await prisma.candidate.create({ data: { id: TEST_CANDIDATE_ID, organizationId: TEST_ORG_ID, userId: TEST_USER_ID, name: 'Test Candidate', email: 'candidate@example.com' } });

  const exam = await prisma.exam.create({ data: {
    id: TEST_EXAM_ID,
    organizationId: TEST_ORG_ID,
    title: 'Test Exam',
    durationMinutes: 60,
    status: 'published',
    createdById: TEST_USER_ID
  }});

  const TEST_Q1_ID = '550e8400-e29b-41d4-a716-446655440005';
const TEST_Q2_ID = '550e8400-e29b-41d4-a716-446655440006';

await prisma.question.createMany({ data: [
    { id: TEST_Q1_ID, organizationId: TEST_ORG_ID, examId: TEST_EXAM_ID, type: 'mcq', prompt: 'Q1', options: [{id:'a',text:'A'},{id:'b',text:'B'}], correctAnswer: 'a', marks: 1, negativeMarks: 0, position: 0 },
    { id: TEST_Q2_ID, organizationId: TEST_ORG_ID, examId: TEST_EXAM_ID, type: 'mcq', prompt: 'Q2', options: [{id:'a',text:'A'},{id:'b',text:'B'}], correctAnswer: 'b', marks: 1, negativeMarks: 0, position: 1 },
  ]});
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
  process.env = previousEnv;
});

test('tenantFilter scopes query to organization', () => {
  assert.deepEqual(tenantFilter(TEST_ORG_ID), { organizationId: TEST_ORG_ID });
  assert.notDeepEqual(tenantFilter(TEST_ORG_ID), { organizationId: 'other-org' });
});

test('signToken generates valid JWT', () => {
  const token = signToken(TEST_USER_ID);
  assert.ok(typeof token === 'string');
  assert.ok(token.split('.').length === 3);
});

test('loadConfig validates required fields', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    JWT_SECRET: 'x'.repeat(32)
  });
  assert.equal(config.DATABASE_URL, 'postgresql://user:pass@localhost:5432/test');
  assert.equal(config.JWT_SECRET.length, 32);
});

test('isUuid validates UUIDs correctly', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';
  const invalidUuid = 'not-a-uuid';
  assert.equal(isUuid(validUuid), true);
  assert.equal(isUuid(invalidUuid), false);
});

test('bcrypt password hashing and verification', async () => {
  const password = 'TestPassword123';
  const hash = await bcrypt.hash(password, 12);
  const match = await bcrypt.compare(password, hash);
  const mismatch = await bcrypt.compare('wrong', hash);
  assert.equal(match, true);
  assert.equal(mismatch, false);
});

test('JWT signing and verification round-trip', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    JWT_SECRET: 'test-secret-key-for-testing-purposes-only'
  });
  const token = jwt.sign({ sub: TEST_USER_ID }, config.JWT_SECRET, { expiresIn: '1h' });
  const decoded = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
  assert.equal(decoded.sub, TEST_USER_ID);
});

test('organization tenant isolation filter', () => {
  const filter1 = tenantFilter('org-1');
  const filter2 = tenantFilter('org-2');
  assert.deepEqual(filter1, { organizationId: 'org-1' });
  assert.deepEqual(filter2, { organizationId: 'org-2' });
  assert.notDeepEqual(filter1, filter2);
});
