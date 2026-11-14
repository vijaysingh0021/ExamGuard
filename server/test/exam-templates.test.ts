import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { config as loadDotenv } from 'dotenv';
import { basename, resolve } from 'node:path';
import bcrypt from 'bcryptjs';

const repositoryRoot = basename(process.cwd()) === 'server' ? resolve(process.cwd(), '..') : process.cwd();
loadDotenv({ path: resolve(repositoryRoot, '.env'), override: false });

const originalEnv = { ...process.env };
const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) throw new Error('DATABASE_URL must be loaded from the root .env file.');
const testDatabaseUrl = new URL(configuredDatabaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(testDatabaseUrl.hostname) ||
  !['postgres:', 'postgresql:'].includes(testDatabaseUrl.protocol)
) {
  throw new Error('SAFETY VIOLATION: Template integration tests require a local PostgreSQL database.');
}
testDatabaseUrl.pathname = '/examguard_test';
process.env.DATABASE_URL = testDatabaseUrl.toString();
process.env.JWT_SECRET = 'x'.repeat(32);

const ORG_ID = '550e8400-e29b-41d4-a716-446655440010';
const OTHER_ORG_ID = '550e8400-e29b-41d4-a716-446655440011';
const ADMIN_ID = '550e8400-e29b-41d4-a716-446655440012';
const STUDENT_ID = '550e8400-e29b-41d4-a716-446655440013';
const CANDIDATE_ID = '550e8400-e29b-41d4-a716-446655440014';
const DRAFT_EXAM_ID = '550e8400-e29b-41d4-a716-446655440015';
const SCHEDULED_EXAM_ID = '550e8400-e29b-41d4-a716-446655440016';
const FOREIGN_TEMPLATE_ID = '550e8400-e29b-41d4-a716-446655440017';
const PRACTICE_EXAM_ID = '550e8400-e29b-41d4-a716-446655440018';
const PRACTICE_ATTEMPT_ID = '550e8400-e29b-41d4-a716-446655440019';
const INVITATION_ID = '550e8400-e29b-41d4-a716-446655440020';
const INVITATION_EMAIL = 'accepted-student@example.test';
const INVITATION_TOKEN = 'a'.repeat(43);

let prisma: typeof import('../src/prisma.js').prisma;
let signToken: typeof import('../src/auth.js').signToken;
let server: ReturnType<import('express').Express['listen']>;
let origin: string;
let adminToken: string;
let studentToken: string;

async function cleanup() {
  const organizationIds = [ORG_ID, OTHER_ORG_ID];
  await prisma.supportTicket.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.studentInvitation.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.examTemplate.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.examAssignment.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.attemptAnswer.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.examAttempt.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.question.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.exam.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.candidate.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: [ADMIN_ID, STUDENT_ID] } }, { email: INVITATION_EMAIL }] } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
}

test.before(async () => {
  ({ prisma } = await import('../src/prisma.js'));
  ({ signToken } = await import('../src/auth.js'));
  const database = await prisma.$queryRaw<Array<{ databaseName: string }>>`
    SELECT current_database() AS "databaseName"
  `;
  if (database[0]?.databaseName !== 'examguard_test') {
    await prisma.$disconnect();
    throw new Error('SAFETY VIOLATION: Tests refuse to modify a database other than examguard_test.');
  }
  await cleanup();

  const passwordHash = await bcrypt.hash('TestPassword123', 4);
  await prisma.organization.createMany({
    data: [
      { id: ORG_ID, name: 'Template Test Org', slug: 'template-test-org' },
      { id: OTHER_ORG_ID, name: 'Template Other Org', slug: 'template-other-org' },
    ],
  });
  await prisma.user.createMany({
    data: [
      { id: ADMIN_ID, name: 'Template Admin', email: 'template-admin@example.test', passwordHash },
      { id: STUDENT_ID, name: 'Calendar Student', email: 'calendar-student@example.test', passwordHash },
    ],
  });
  await prisma.membership.createMany({
    data: [
      { userId: ADMIN_ID, organizationId: ORG_ID, role: 'institute_admin', active: true },
      { userId: STUDENT_ID, organizationId: ORG_ID, role: 'student', active: true },
    ],
  });
  await prisma.candidate.create({
    data: {
      id: CANDIDATE_ID,
      organizationId: ORG_ID,
      userId: STUDENT_ID,
      name: 'Calendar Student',
      email: 'calendar-student@example.test',
    },
  });

  const future = new Date(Date.now() + 86_400_000);
  const later = new Date(future.getTime() + 3_600_000);
  await prisma.exam.createMany({
    data: [
      {
        id: DRAFT_EXAM_ID,
        organizationId: ORG_ID,
        title: 'Snapshot source draft',
        instructions: 'Draft instructions',
        durationMinutes: 45,
        status: 'draft',
        startsAt: future,
        endsAt: later,
        accessCodeHash: await bcrypt.hash('private-code', 4),
        createdById: ADMIN_ID,
        policyWindowSeconds: 240,
      },
      {
        id: SCHEDULED_EXAM_ID,
        organizationId: ORG_ID,
        title: 'Calendar assigned exam',
        durationMinutes: 30,
        status: 'scheduled',
        startsAt: future,
        endsAt: later,
        createdById: ADMIN_ID,
      },
      {
        id: PRACTICE_EXAM_ID,
        organizationId: ORG_ID,
        title: 'Practice only exam',
        durationMinutes: 20,
        status: 'completed',
        isPractice: true,
        createdById: ADMIN_ID,
      },
    ],
  });
  await prisma.examAttempt.create({
    data: {
      id: PRACTICE_ATTEMPT_ID,
      organizationId: ORG_ID,
      examId: PRACTICE_EXAM_ID,
      candidateId: CANDIDATE_ID,
      userId: STUDENT_ID,
      status: 'submitted',
      startedAt: future,
      deadlineAt: later,
      submittedAt: future,
    },
  });
  await prisma.question.create({
    data: {
      organizationId: ORG_ID,
      examId: DRAFT_EXAM_ID,
      type: 'coding',
      prompt: 'Implement addition',
      options: [],
      marks: 5,
      negativeMarks: 0,
      position: 0,
      codingQuestion: {
        create: {
          organizationId: ORG_ID,
          title: 'Add two values',
          description: 'Read two values and print their sum.',
          difficulty: 'easy',
          mode: 'stdin_stdout',
          languageIds: ['python'],
          starterCode: { python: 'a, b = map(int, input().split())' },
          testCases: {
            create: [
              { organizationId: ORG_ID, input: '2 3', expectedOutput: '5', visibility: 'sample', position: 0 },
              { organizationId: ORG_ID, input: '10 20', expectedOutput: '30', visibility: 'private', position: 1 },
            ],
          },
        },
      },
    },
  });
  await prisma.examAssignment.create({
    data: { organizationId: ORG_ID, examId: SCHEDULED_EXAM_ID, candidateId: CANDIDATE_ID },
  });
  await prisma.examTemplate.create({
    data: {
      id: FOREIGN_TEMPLATE_ID,
      organizationId: OTHER_ORG_ID,
      createdById: ADMIN_ID,
      name: 'Other tenant template',
      settings: {},
      questions: [],
    },
  });

  const { createApp } = await import('../src/app.js');
  const { address } = await new Promise<{ address: string }>((resolveAddress, reject) => {
    server = createApp().listen(0, '127.0.0.1', () => {
      const listeningAddress = server.address();
      if (!listeningAddress || typeof listeningAddress === 'string') {
        reject(new Error('Test server did not bind to a TCP port.'));
        return;
      }
      resolveAddress({ address: `http://127.0.0.1:${listeningAddress.port}` });
    });
    server.once('error', reject);
  });
  origin = address;
  adminToken = signToken(ADMIN_ID);
  studentToken = signToken(STUDENT_ID);
});

test.after(async () => {
  if (server) await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  await cleanup();
  await prisma.$disconnect();
  process.env = originalEnv;
});

async function request(path: string, token?: string, init: RequestInit = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

test('exam templates enforce permissions, preserve draft snapshots, and remain tenant-scoped', async () => {
  const base = `/api/organizations/${ORG_ID}/exam-templates`;
  assert.equal((await request(base)).status, 401);
  assert.equal((await request(base, studentToken)).status, 403);
  assert.equal((await request(`/api/organizations/${OTHER_ORG_ID}/exam-templates`, adminToken)).status, 403);

  const createdResponse = await request(base, adminToken, {
    method: 'POST',
    body: JSON.stringify({ name: 'Coding baseline', description: 'Reusable coding setup', sourceExamId: DRAFT_EXAM_ID }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string; name: string };
  assert.equal(created.name, 'Coding baseline');

  const listResponse = await request(base, adminToken);
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await listResponse.json() as Array<{ id: string }>).map(template => template.id), [created.id]);

  const detailResponse = await request(`${base}/${created.id}`, adminToken);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json() as {
    settings: Record<string, unknown>;
    questions: Array<{ prompt: string; coding: { title: string }; codingTestCases: Array<{ expectedOutput: string; visibility: string }> }>;
  };
  assert.equal(detail.settings.title, 'Snapshot source draft');
  assert.equal(detail.settings.durationMinutes, 45);
  assert.equal(detail.settings.policyWindowSeconds, undefined);
  assert.deepEqual(detail.settings.interventionPolicy, {
    windowSeconds: 240,
    warningAt: 1,
    pauseAt: 3,
    terminateAt: 5,
    automaticTerminationEnabled: false,
    fullscreenRequired: false,
  });
  assert.equal('startsAt' in detail.settings, false);
  assert.equal('endsAt' in detail.settings, false);
  assert.equal('accessCodeHash' in detail.settings, false);
  assert.equal(detail.questions[0].prompt, 'Implement addition');
  assert.equal(detail.questions[0].coding.title, 'Add two values');
  assert.deepEqual(detail.questions[0].codingTestCases.map(testCase => testCase.expectedOutput), ['5', '30']);
  assert.deepEqual(detail.questions[0].codingTestCases.map(testCase => testCase.visibility), ['sample', 'private']);

  assert.equal((await request(`${base}/${FOREIGN_TEMPLATE_ID}`, adminToken)).status, 404);
  assert.equal((await request(`${base}/${FOREIGN_TEMPLATE_ID}`, adminToken, { method: 'DELETE' })).status, 404);
  assert.equal(await prisma.examTemplate.count({ where: { id: FOREIGN_TEMPLATE_ID, organizationId: OTHER_ORG_ID } }), 1);

  const deleteResponse = await request(`${base}/${created.id}`, adminToken, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);
  assert.equal(await prisma.examTemplate.count({ where: { id: created.id, organizationId: ORG_ID } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { organizationId: ORG_ID, targetType: 'ExamTemplate', targetId: created.id } }), 2);
});

test('student dashboard returns only assigned exam data for the calendar', async () => {
  const response = await request('/api/student/dashboard', studentToken);
  assert.equal(response.status, 200);
  const dashboard = await response.json() as {
    assignments: Array<{ exam: { id: string; title: string; startsAt: string | null; endsAt: string | null } }>;
  };
  assert.deepEqual(dashboard.assignments.map(({ exam }) => exam.id), [SCHEDULED_EXAM_ID]);
  assert.equal(dashboard.assignments[0].exam.title, 'Calendar assigned exam');
  assert.ok(dashboard.assignments[0].exam.startsAt);
  assert.ok(dashboard.assignments[0].exam.endsAt);
});

test('coding question editor payload saves without duplicating outer marks inside coding details', async () => {
  const response = await request(`/api/organizations/${ORG_ID}/exams/${DRAFT_EXAM_ID}/questions`, adminToken, {
    method: 'POST',
    body: JSON.stringify({
      type: 'coding',
      prompt: 'Read an integer and print its digits in reverse order.',
      options: [],
      marks: 1,
      negativeMarks: 0,
      coding: {
        title: 'Reverse digits',
        description: 'Read N and print its digits in reverse order.',
        difficulty: 'easy',
        mode: 'stdin_stdout',
        inputFormat: 'A non-negative integer N.',
        outputFormat: 'Print N with its digits reversed.',
        constraints: '0 <= N <= 1000000000',
        explanation: '',
        languageIds: ['python'],
        starterCode: { python: '' },
        timeLimitMs: 2000,
        memoryLimitKb: 262144,
        comparisonMode: 'exact',
      },
      codingTestCases: [
        { input: '12340', expectedOutput: '4321', visibility: 'sample', position: 0 },
        { input: '1000', expectedOutput: '1', visibility: 'private', position: 1 },
        { input: '0', expectedOutput: '0', visibility: 'private', position: 2 },
      ],
    }),
  });
  assert.equal(response.status, 201);
  const saved = await response.json() as { marks: number; negativeMarks: number; codingQuestion: { title: string; testCases: Array<{ input: string; expectedOutput: string; visibility: string }> } };
  assert.equal(saved.marks, 1);
  assert.equal(saved.negativeMarks, 0);
  assert.equal(saved.codingQuestion.title, 'Reverse digits');
  assert.deepEqual(saved.codingQuestion.testCases.map(({ input, expectedOutput, visibility }) => ({ input, expectedOutput, visibility })), [
    { input: '12340', expectedOutput: '4321', visibility: 'sample' },
    { input: '1000', expectedOutput: '1', visibility: 'private' },
    { input: '0', expectedOutput: '0', visibility: 'private' },
  ]);
});

test('practice attempts stay outside official grading and analytics', async () => {
  const gradeResponse = await request(
    `/api/organizations/${ORG_ID}/attempts/${PRACTICE_ATTEMPT_ID}/grade`,
    adminToken,
    { method: 'POST', body: JSON.stringify({}) },
  );
  assert.equal(gradeResponse.status, 409);
  assert.equal(await prisma.grade.count({ where: { attemptId: PRACTICE_ATTEMPT_ID } }), 0);

  const analyticsResponse = await request(
    `/api/organizations/${ORG_ID}/reports/analytics?examId=${PRACTICE_EXAM_ID}`,
    adminToken,
  );
  assert.equal(analyticsResponse.status, 400);
  assert.equal((await analyticsResponse.json() as { error: string }).error, 'Practice exams are excluded from official analytics');
});

test('student invitation preview, acceptance, and one-time use are enforced', async () => {
  const base = `/api/organizations/${ORG_ID}/students/import`;
  const previewResponse = await request(`${base}/preview`, adminToken, {
    method: 'POST',
    body: JSON.stringify({
      students: [
        { name: 'Existing student', email: 'calendar-student@example.test' },
        { name: 'Existing account', email: 'template-admin@example.test' },
        { name: 'New student', email: 'new-student@example.test' },
        { name: 'Repeated student', email: 'new-student@example.test' },
      ],
    }),
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json() as { rows: Array<{ status: string }> };
  assert.deepEqual(preview.rows.map(row => row.status), ['candidate_exists', 'account_exists', 'ready', 'duplicate_in_file']);

  await prisma.studentInvitation.create({
    data: {
      id: INVITATION_ID,
      organizationId: ORG_ID,
      createdById: ADMIN_ID,
      email: INVITATION_EMAIL,
      name: 'Invited Student',
      tokenHash: crypto.createHash('sha256').update(INVITATION_TOKEN).digest('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const invitationResponse = await request(`/api/public/student-invitations/${INVITATION_TOKEN}`);
  assert.equal(invitationResponse.status, 200);
  assert.equal((await invitationResponse.json() as { email: string }).email, INVITATION_EMAIL);

  const accept = () => request('/api/auth/student-invitations/accept', undefined, {
    method: 'POST',
    body: JSON.stringify({ token: INVITATION_TOKEN, password: 'StrongPass123!' }),
  });
  const acceptedResponse = await accept();
  assert.equal(acceptedResponse.status, 201);
  const accepted = await acceptedResponse.json() as { user: { id: string }; role: string };
  assert.equal(accepted.role, 'student');
  assert.equal(await prisma.membership.count({ where: { userId: accepted.user.id, organizationId: ORG_ID, role: 'student', active: true } }), 1);
  assert.equal(await prisma.candidate.count({ where: { organizationId: ORG_ID, email: INVITATION_EMAIL, userId: accepted.user.id } }), 1);
  assert.equal((await accept()).status, 404);
});

test('support tickets are tenant-scoped and enforce role and closed-ticket rules', async () => {
  const base = `/api/organizations/${ORG_ID}/support/tickets`;
  const createdResponse = await request(base, studentToken, {
    method: 'POST',
    body: JSON.stringify({ subject: 'Cannot open document', body: 'The assigned document does not open.' }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json() as { id: string };

  const staffList = await request(base, adminToken);
  assert.equal(staffList.status, 200);
  assert.equal((await staffList.json() as Array<{ id: string }>).some(ticket => ticket.id === created.id), true);
  assert.equal((await request(`/api/organizations/${OTHER_ORG_ID}/support/tickets/${created.id}`, adminToken)).status, 403);
  assert.equal((await request(`${base}/${created.id}/status`, studentToken, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'closed' }),
  })).status, 403);

  const closeResponse = await request(`${base}/${created.id}/status`, adminToken, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'closed' }),
  });
  assert.equal(closeResponse.status, 200);
  assert.equal((await closeResponse.json() as { status: string }).status, 'closed');
  assert.equal((await request(`${base}/${created.id}/messages`, studentToken, {
    method: 'POST',
    body: JSON.stringify({ body: 'I still need help.' }),
  })).status, 409);
});
