import bcrypt from 'bcryptjs';
import { connectDatabase } from '../src/db.js';
import { prisma } from '../src/prisma.js';

const password = process.env.DEMO_SEED_PASSWORD;
const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/').pathname.slice(1)).toLowerCase();
if (process.env.DEMO_SEED !== 'yes' || !password || password.length < 12 || /(^|[-_])(prod|production)([-_]|$)/.test(databaseName)) throw new Error('Refusing to seed. Set DEMO_SEED=yes and a 12+ character DEMO_SEED_PASSWORD, and use a non-production database name in DATABASE_URL.');

const people = [
  ['Aarav Sharma', 'aarav.admin@demo.examguard.test', 'institute_admin'],
  ['Priya Verma', 'priya.teacher@demo.examguard.test', 'teacher'],
  ['Rahul Mehta', 'rahul.teacher@demo.examguard.test', 'teacher'],
  ['Aditi Singh', 'aditi.candidate@demo.examguard.test', 'student', 'EG-C001'],
  ['Rohan Kumar', 'rohan.candidate@demo.examguard.test', 'student', 'EG-C002'],
  ['Neha Joshi', 'neha.candidate@demo.examguard.test', 'student', 'EG-C003'],
  ['Arjun Patel', 'arjun.candidate@demo.examguard.test', 'student', 'EG-C004'],
  ['Simran Kaur', 'simran.candidate@demo.examguard.test', 'student', 'EG-C005']
] as const;
const questions = [
  ['Which data structure follows first-in, first-out ordering?', ['Stack', 'Queue', 'Tree', 'Graph'], 'b'],
  ['Which SQL clause filters grouped results?', ['WHERE', 'HAVING', 'ORDER BY', 'SELECT'], 'b'],
  ['Which OS component selects the next process to run?', ['Compiler', 'Scheduler', 'Loader', 'Shell'], 'b'],
  ['Which protocol provides reliable, ordered transport?', ['UDP', 'IP', 'TCP', 'ARP'], 'c'],
  ['What is binary search complexity?', ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], 'b'],
  ['Which normal form removes partial dependency?', ['1NF', '2NF', '3NF', 'BCNF'], 'b'],
  ['Which keyword creates an immutable JavaScript binding?', ['var', 'let', 'const', 'static'], 'c'],
  ['Which device forwards packets between networks?', ['Hub', 'Switch', 'Router', 'Repeater'], 'c'],
  ['A mutex is primarily used for what?', ['Mutual exclusion', 'Compression', 'Encryption', 'Routing'], 'a'],
  ['Which traversal returns a binary-search tree in sorted order?', ['Preorder', 'Inorder', 'Postorder', 'Level order'], 'b']
] as const;

async function seed() {
  await connectDatabase();
  const org = await prisma.organization.upsert({ where: { slug: 'examguard-demo-institute' }, update: {}, create: { name: '[DEMO] ExamGuard Demo Institute', slug: 'examguard-demo-institute' } });
  const passwordHash = await bcrypt.hash(password!, 12);
  const identities = new Map<string, { id: string; name: string; candidateCode?: string }>();
  for (const [name, email, role, candidateCode] of people) {
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { name: `[DEMO] ${name}`, email, passwordHash } });
    await prisma.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } }, update: {}, create: { userId: user.id, organizationId: org.id, role } });
    identities.set(email, { id: user.id, name, candidateCode });
  }
  const candidateIds: string[] = [];
  for (const [, email, role] of people) {
    if (role !== 'student') continue;
    const person = identities.get(email)!;
    const candidate = await prisma.candidate.upsert({
      where: { organizationId_email: { organizationId: org.id, email } },
      update: {},
      create: { organizationId: org.id, userId: person.id, name: `[DEMO] ${person.name}`, email, externalId: person.candidateCode }
    });
    candidateIds.push(candidate.id);
  }
  const admin = identities.get('aarav.admin@demo.examguard.test')!;
  const title = '[DEMO] CSE Fundamentals Assessment';
  const exam = (await prisma.exam.findFirst({ where: { organizationId: org.id, title } }))
    ?? await prisma.exam.create({ data: { organizationId: org.id, title, instructions: 'Development-only synthetic assessment. Do not use for real examination decisions.', status: 'draft', durationMinutes: 30, createdById: admin.id } });
  if (await prisma.question.count({ where: { examId: exam.id, organizationId: org.id } }) === 0) {
    await prisma.question.createMany({ data: questions.map(([prompt, options, correctAnswer], position) => ({ organizationId: org.id, examId: exam.id, type: 'mcq' as const, prompt, options: options.map((text, index) => ({ id: String.fromCharCode(97 + index), text })), correctAnswer, marks: 1, negativeMarks: 0, position })) });
  }
  if (exam.status === 'draft') await prisma.exam.updateMany({ where: { id: exam.id, status: 'draft' }, data: { status: 'published' } });
  for (const candidateId of candidateIds) {
    await prisma.examAssignment.upsert({ where: { examId_candidateId: { examId: exam.id, candidateId } }, update: {}, create: { organizationId: org.id, examId: exam.id, candidateId } });
  }
  console.info('Development demo data is ready. Use the documented local password; no monitoring observations were created.');
}

seed()
  .catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
