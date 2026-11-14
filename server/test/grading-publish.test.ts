import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { signToken } from '../src/auth.js';
import { prisma } from '../src/prisma.js';

const organizationId = '33333333-3333-4333-8333-333333333333';
const examId = '44444444-4444-4444-8444-444444444444';
const teacherId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';

type TestGrade = {
  id: string;
  organizationId: string;
  examId: string;
  status: string;
  candidate: { userId: string | null };
};

const grades = new Map<string, TestGrade>([
  ['graded-one', { id: 'graded-one', organizationId, examId, status: 'graded', candidate: { userId: studentId } }],
  ['graded-two', { id: 'graded-two', organizationId, examId, status: 'graded', candidate: { userId: null } }],
  ['pending', { id: 'pending', organizationId, examId, status: 'pending_manual', candidate: { userId: studentId } }],
  ['published', { id: 'published', organizationId, examId, status: 'published', candidate: { userId: studentId } }],
  ['other-exam', { id: 'other-exam', organizationId, examId: '55555555-5555-4555-8555-555555555555', status: 'graded', candidate: { userId: studentId } }],
  ['other-org', { id: 'other-org', organizationId: '66666666-6666-4666-8666-666666666666', examId, status: 'graded', candidate: { userId: studentId } }],
]);

const overrides: Array<() => void> = [];
const notifications: Array<Record<string, unknown>> = [];
const auditEntries: Array<Record<string, unknown>> = [];
let isPractice = false;
let server: ReturnType<import('express').Express['listen']>;
let origin: string;

function stub(target: object, method: string, implementation: unknown) {
  const record = target as Record<string, unknown>;
  const previous = Object.getOwnPropertyDescriptor(record, method);
  Object.defineProperty(record, method, { configurable: true, writable: true, value: implementation });
  overrides.push(() => {
    if (previous) Object.defineProperty(record, method, previous);
    else delete record[method];
  });
}

test.before(async () => {
  stub(prisma.membership, 'findFirst', async (query: unknown) => {
    const userId = (query as { where: { userId: string } }).where.userId;
    return { role: userId === teacherId ? 'teacher' : 'student', active: true };
  });
  stub(prisma.exam, 'findFirst', async (query: unknown) => {
    const where = (query as { where: { id: string; organizationId: string } }).where;
    return where.id === examId && where.organizationId === organizationId
      ? { id: examId, isPractice }
      : null;
  });
  stub(prisma.grade, 'findMany', async (query: unknown) => {
    const where = (query as { where: { organizationId: string; examId: string; status: string } }).where;
    return Array.from(grades.values())
      .filter(grade =>
        grade.organizationId === where.organizationId &&
        grade.examId === where.examId &&
        grade.status === where.status,
      )
      .map(grade => ({ id: grade.id, candidate: grade.candidate }));
  });
  stub(prisma.grade, 'count', async (query: unknown) => {
    const where = (query as { where: { organizationId: string; examId: string; status: string } }).where;
    return Array.from(grades.values()).filter(grade =>
      grade.organizationId === where.organizationId &&
      grade.examId === where.examId &&
      grade.status === where.status,
    ).length;
  });
  stub(prisma.grade, 'updateMany', async (query: unknown) => {
    const { where, data } = query as {
      where: { id: string; organizationId: string; examId: string; status: string };
      data: { status: string };
    };
    const grade = grades.get(where.id);
    if (
      !grade ||
      grade.organizationId !== where.organizationId ||
      grade.examId !== where.examId ||
      grade.status !== where.status
    ) return { count: 0 };
    grade.status = data.status;
    return { count: 1 };
  });
  stub(prisma, '$transaction', async (operation: unknown) => {
    if (typeof operation !== 'function') throw new Error('Expected an interactive transaction');
    return operation(prisma);
  });
  stub(prisma.notification, 'create', async (query: unknown) => {
    notifications.push((query as { data: Record<string, unknown> }).data);
    return {};
  });
  stub(prisma.auditLog, 'create', async (query: unknown) => {
    auditEntries.push((query as { data: Record<string, unknown> }).data);
    return {};
  });

  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const restore of overrides.reverse()) restore();
});

test('declares only graded results for the exam, notifies once, and skips practice or unauthorized requests', async () => {
  const tokenFor = (userId: string) => `Bearer ${signToken(userId)}`;
  const endpoint = (id = examId) => `${origin}/api/organizations/${organizationId}/exams/${id}/grades/publish`;
  const publish = (token?: string, id = examId) => fetch(endpoint(id), {
    method: 'POST',
    headers: token ? { Authorization: token } : {},
  });

  assert.equal((await publish()).status, 401);
  assert.equal((await publish(tokenFor(studentId))).status, 403);
  const invalidExam = await publish(tokenFor(teacherId), 'not-a-uuid');
  assert.equal(invalidExam.status, 404, await invalidExam.text());

  isPractice = true;
  assert.equal((await publish(tokenFor(teacherId))).status, 409);
  assert.equal(grades.get('graded-one')?.status, 'graded');

  isPractice = false;
  const response = await publish(tokenFor(teacherId));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    publishedCount: 2,
    pendingManualCount: 1,
    notifiedCount: 1,
  });
  assert.equal(grades.get('graded-one')?.status, 'published');
  assert.equal(grades.get('graded-two')?.status, 'published');
  assert.equal(grades.get('pending')?.status, 'pending_manual');
  assert.equal(grades.get('published')?.status, 'published');
  assert.equal(grades.get('other-exam')?.status, 'graded');
  assert.equal(grades.get('other-org')?.status, 'graded');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].userId, studentId);
  assert.equal(auditEntries.filter(entry => entry.action === 'grade.published').length, 2);
  assert.equal(auditEntries.filter(entry => entry.action === 'results.declared').length, 1);

  const repeat = await publish(tokenFor(teacherId));
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), {
    publishedCount: 0,
    pendingManualCount: 1,
    notifiedCount: 0,
  });
  assert.equal(notifications.length, 1);
});
