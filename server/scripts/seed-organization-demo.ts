import bcrypt from 'bcryptjs';
import { connectDatabase } from '../src/db.js';
import { isUuid } from '../src/ids.js';
import { passwordPolicy } from '../src/password-reset.js';
import { prisma } from '../src/prisma.js';

const organizationId = process.env.DEMO_ORGANIZATION_ID;
const studentPassword = process.env.DEMO_STUDENT_PASSWORD;

if (process.env.DEVELOPMENT_SETUP !== 'yes') throw new Error('Refusing demo setup. Set DEVELOPMENT_SETUP=yes for this explicit development-only operation.');
if (!organizationId || !studentPassword) throw new Error('DEMO_ORGANIZATION_ID and DEMO_STUDENT_PASSWORD are required.');
if (!isUuid(organizationId)) throw new Error('DEMO_ORGANIZATION_ID must be an organization UUID.');
if (!passwordPolicy(studentPassword)) throw new Error('DEMO_STUDENT_PASSWORD does not meet the application password policy.');
const requiredStudentPassword = studentPassword;

const students = [
  { name: '[DEMO] Aanya Sharma', email: 'aanya.demo@examguard.test' },
  { name: '[DEMO] Kabir Mehta', email: 'kabir.demo@examguard.test' },
  { name: '[DEMO] Meera Joshi', email: 'meera.demo@examguard.test' }
] as const;

const exams = [
  { title: '[DEMO] DBMS Fundamentals', durationMinutes: 20, instructions: 'Development demo assessment. Select one answer for each question and submit before the server deadline.', questions: [
    ['Which key uniquely identifies a table record?', ['Primary key', 'Foreign key', 'Index', 'View'], 'a'],
    ['Which command retrieves rows from a table?', ['UPDATE', 'SELECT', 'INSERT', 'DELETE'], 'b'],
    ['A foreign key helps enforce which rule?', ['Referential integrity', 'Compression', 'Sorting', 'Caching'], 'a']
  ] },
  { title: '[DEMO] SQL Foundations', durationMinutes: 25, instructions: 'Development demo assessment. Read each SQL question carefully and submit your attempt before time expires.', questions: [
    ['Which SQL clause filters rows?', ['WHERE', 'GROUP BY', 'ORDER BY', 'JOIN'], 'a'],
    ['Which statement makes a transaction permanent?', ['ROLLBACK', 'COMMIT', 'GRANT', 'REVOKE'], 'b'],
    ['Which join returns matching rows from both tables?', ['LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN'], 'c']
  ] },
  { title: '[DEMO] Data Structures Warm-up', durationMinutes: 15, instructions: 'Development demo assessment. This short test is intended only to verify the ExamGuard student workflow.', questions: [
    ['Which structure follows LIFO order?', ['Queue', 'Stack', 'Tree', 'Graph'], 'b'],
    ['Binary search requires which input?', ['Sorted data', 'Random data', 'A hash table', 'A linked list only'], 'a'],
    ['Which structure uses FIFO order?', ['Stack', 'Queue', 'Heap', 'Set'], 'b']
  ] }
] as const;

async function seed() {
  await connectDatabase();
  const organization = await prisma.organization.findUnique({ where: { id: organizationId! } });
  if (!organization) throw new Error('The requested organization was not found.');
  const adminMembership = await prisma.membership.findFirst({ where: { organizationId: organization.id, active: true, role: 'institute_admin' } });
  if (!adminMembership) throw new Error('The organization has no active institute administrator.');

  const passwordHash = await bcrypt.hash(requiredStudentPassword, 12);
  const candidates = [];
  for (const student of students) {
    const user = await prisma.user.upsert({ where: { email: student.email }, update: {}, create: { name: student.name, email: student.email, passwordHash } });
    await prisma.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: organization.id } }, update: {}, create: { userId: user.id, organizationId: organization.id, role: 'student' } });
    candidates.push(await prisma.candidate.upsert({
      where: { organizationId_email: { organizationId: organization.id, email: student.email } },
      update: { name: student.name, userId: user.id },
      create: { organizationId: organization.id, name: student.name, email: student.email, userId: user.id }
    }));
  }

  const now = Date.now();
  for (let index = 0; index < exams.length; index += 1) {
    const fixture = exams[index];
    let exam = await prisma.exam.findFirst({ where: { organizationId: organization.id, title: fixture.title } });
    if (!exam) {
      exam = await prisma.exam.create({ data: {
        organizationId: organization.id, title: fixture.title, instructions: fixture.instructions, durationMinutes: fixture.durationMinutes, status: 'published',
        startsAt: new Date(now - 60 * 60_000), endsAt: new Date(now + 14 * 24 * 60 * 60_000), requireVerification: false, randomizeQuestions: true, randomizeOptions: true, createdById: adminMembership.userId
      } });
      await prisma.question.createMany({ data: fixture.questions.map(([prompt, options, correctAnswer], position) => ({
        organizationId: organization.id, examId: exam!.id, type: 'mcq' as const, prompt,
        options: options.map((text, optionIndex) => ({ id: String.fromCharCode(97 + optionIndex), text })), correctAnswer, marks: 1, negativeMarks: 0, position
      })) });
    }
    await prisma.examAssignment.upsert({ where: { examId_candidateId: { examId: exam.id, candidateId: candidates[index].id } }, update: {}, create: { organizationId: organization.id, examId: exam.id, candidateId: candidates[index].id } });
  }

  const incidentFixtures = [
    { candidate: candidates[0], examTitle: exams[0].title, type: 'fullscreen_exit', severity: 'low', priority: 10, label: '[DEMO] Fullscreen exit', details: 'Simulated training signal: the candidate exited fullscreen. This is not proof of misconduct.' },
    { candidate: candidates[1], examTitle: exams[1].title, type: 'visibility_hidden', severity: 'low', priority: 10, label: '[DEMO] Tab focus lost', details: 'Simulated training signal: the exam tab was hidden. This is not proof of misconduct.' },
    { candidate: candidates[2], examTitle: exams[2].title, type: 'multiple_faces', severity: 'medium', priority: 25, label: '[DEMO] Multiple-face review', details: 'Simulated training signal for reviewer workflow only. No real camera image or person is involved.' }
  ] as const;
  for (const fixture of incidentFixtures) {
    const exam = await prisma.exam.findFirst({ where: { organizationId: organization.id, title: fixture.examTitle } });
    if (!exam) continue;
    const fingerprint = `demo-${fixture.candidate.id}-${fixture.type}`;
    const event = (await prisma.proctoringEvent.findFirst({ where: { organizationId: organization.id, candidateId: fixture.candidate.id, type: fixture.type, fingerprint } }))
      ?? await prisma.proctoringEvent.create({ data: { organizationId: organization.id, examId: exam.id, candidateId: fixture.candidate.id, type: fixture.type, occurredAt: new Date(), source: 'browser', fingerprint, warningCount: 1, policyAction: 'warning', details: { demo: true, evidence: 'simulated_no_image' } } });
    const existing = await prisma.incident.findFirst({ where: { organizationId: organization.id, candidateId: fixture.candidate.id, type: fixture.type, details: fixture.details } });
    if (!existing) {
      await prisma.incident.create({ data: {
        organizationId: organization.id, examId: exam.id, candidateId: fixture.candidate.id, severity: fixture.severity, type: fixture.type, status: 'open', details: fixture.details, riskPriority: fixture.priority,
        contributingSignals: [{ type: fixture.type, weight: fixture.priority, eventId: event.id }], events: { create: { eventId: event.id } }
      } });
    }
  }

  console.log(JSON.stringify({ organization: { id: organization.id, name: organization.name }, demoStudents: students.map(({ name, email }) => ({ name, email })), demoAssessments: exams.map(({ title }) => title), demoIncidents: incidentFixtures.map(({ label }) => label) }, null, 2));
}

seed()
  .catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
