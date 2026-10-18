import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDatabase } from "../src/db.js";
import { passwordPolicy } from "../src/password-reset.js";
import { Candidate, Exam, ExamAssignment, Incident, Membership, Organization, ProctoringEvent, Question, User } from "../src/models.js";

const organizationId = process.env.DEMO_ORGANIZATION_ID;
const studentPassword = process.env.DEMO_STUDENT_PASSWORD;

if (process.env.DEVELOPMENT_SETUP !== "yes") {
  throw new Error("Refusing demo setup. Set DEVELOPMENT_SETUP=yes for this explicit development-only operation.");
}
if (!organizationId || !studentPassword) {
  throw new Error("DEMO_ORGANIZATION_ID and DEMO_STUDENT_PASSWORD are required.");
}
if (!passwordPolicy(studentPassword)) {
  throw new Error("DEMO_STUDENT_PASSWORD does not meet the application password policy.");
}
const requiredStudentPassword = studentPassword;

const students = [
  { name: "[DEMO] Aanya Sharma", email: "aanya.demo@examguard.test" },
  { name: "[DEMO] Kabir Mehta", email: "kabir.demo@examguard.test" },
  { name: "[DEMO] Meera Joshi", email: "meera.demo@examguard.test" },
] as const;

const exams = [
  {
    title: "[DEMO] DBMS Fundamentals",
    durationMinutes: 20,
    instructions: "Development demo assessment. Select one answer for each question and submit before the server deadline.",
    questions: [
      ["Which key uniquely identifies a table record?", ["Primary key", "Foreign key", "Index", "View"], "a"],
      ["Which command retrieves rows from a table?", ["UPDATE", "SELECT", "INSERT", "DELETE"], "b"],
      ["A foreign key helps enforce which rule?", ["Referential integrity", "Compression", "Sorting", "Caching"], "a"],
    ],
  },
  {
    title: "[DEMO] SQL Foundations",
    durationMinutes: 25,
    instructions: "Development demo assessment. Read each SQL question carefully and submit your attempt before time expires.",
    questions: [
      ["Which SQL clause filters rows?", ["WHERE", "GROUP BY", "ORDER BY", "JOIN"], "a"],
      ["Which statement makes a transaction permanent?", ["ROLLBACK", "COMMIT", "GRANT", "REVOKE"], "b"],
      ["Which join returns matching rows from both tables?", ["LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "CROSS JOIN"], "c"],
    ],
  },
  {
    title: "[DEMO] Data Structures Warm-up",
    durationMinutes: 15,
    instructions: "Development demo assessment. This short test is intended only to verify the ExamGuard student workflow.",
    questions: [
      ["Which structure follows LIFO order?", ["Queue", "Stack", "Tree", "Graph"], "b"],
      ["Binary search requires which input?", ["Sorted data", "Random data", "A hash table", "A linked list only"], "a"],
      ["Which structure uses FIFO order?", ["Stack", "Queue", "Heap", "Set"], "b"],
    ],
  },
] as const;

async function seed() {
  await connectDatabase();
  const organization = await Organization.findById(organizationId);
  if (!organization) throw new Error("The requested organization was not found.");
  const adminMembership = await Membership.findOne({ organizationId: organization._id, active: true, role: "institute_admin" });
  if (!adminMembership) throw new Error("The organization has no active institute administrator.");

  const candidates = [];
  for (const student of students) {
    let user = await User.findOne({ email: student.email });
    if (!user) {
      user = await User.create({ name: student.name, email: student.email, passwordHash: await bcrypt.hash(requiredStudentPassword, 12) });
    }
    await Membership.findOneAndUpdate(
      { userId: user._id, organizationId: organization._id },
      { $setOnInsert: { role: "student", active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const candidate = await Candidate.findOneAndUpdate(
      { organizationId: organization._id, email: student.email },
      { $set: { name: student.name, userId: user._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    candidates.push(candidate);
  }

  const now = Date.now();
  for (let index = 0; index < exams.length; index += 1) {
    const fixture = exams[index];
    let exam = await Exam.findOne({ organizationId: organization._id, title: fixture.title });
    if (!exam) {
      exam = await Exam.create({
        organizationId: organization._id,
        title: fixture.title,
        instructions: fixture.instructions,
        durationMinutes: fixture.durationMinutes,
        status: "published",
        startsAt: new Date(now - 60 * 60_000),
        endsAt: new Date(now + 14 * 24 * 60 * 60_000),
        requireVerification: false,
        randomizeQuestions: true,
        randomizeOptions: true,
        createdBy: adminMembership.userId,
      });
      await Question.insertMany(fixture.questions.map(([prompt, options, correctAnswer], position) => ({
        organizationId: organization._id,
        examId: exam!._id,
        type: "mcq",
        prompt,
        options: options.map((text, optionIndex) => ({ id: String.fromCharCode(97 + optionIndex), text })),
        correctAnswer,
        marks: 1,
        negativeMarks: 0,
        position,
      })));
    }
    await ExamAssignment.findOneAndUpdate(
      { organizationId: organization._id, examId: exam._id, candidateId: candidates[index]._id },
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  const incidentFixtures = [
    { candidate: candidates[0], examTitle: exams[0].title, type: "fullscreen_exit", severity: "low", priority: 10, label: "[DEMO] Fullscreen exit", details: "Simulated training signal: the candidate exited fullscreen. This is not proof of misconduct." },
    { candidate: candidates[1], examTitle: exams[1].title, type: "visibility_hidden", severity: "low", priority: 10, label: "[DEMO] Tab focus lost", details: "Simulated training signal: the exam tab was hidden. This is not proof of misconduct." },
    { candidate: candidates[2], examTitle: exams[2].title, type: "multiple_faces", severity: "medium", priority: 25, label: "[DEMO] Multiple-face review", details: "Simulated training signal for reviewer workflow only. No real camera image or person is involved." },
  ] as const;
  for (const fixture of incidentFixtures) {
    const exam = await Exam.findOne({ organizationId: organization._id, title: fixture.examTitle });
    if (!exam) continue;
    let event = await ProctoringEvent.findOne({ organizationId: organization._id, candidateId: fixture.candidate._id, type: fixture.type, fingerprint: `demo-${fixture.candidate.id}-${fixture.type}` });
    if (!event) event = await ProctoringEvent.create({ organizationId: organization._id, examId: exam._id, candidateId: fixture.candidate._id, type: fixture.type, occurredAt: new Date(), source: "browser", fingerprint: `demo-${fixture.candidate.id}-${fixture.type}`, warningCount: 1, policyAction: "warning", details: { demo: true, evidence: "simulated_no_image" } });
    await Incident.findOneAndUpdate(
      { organizationId: organization._id, candidateId: fixture.candidate._id, type: fixture.type, details: fixture.details },
      { $setOnInsert: { organizationId: organization._id, examId: exam._id, candidateId: fixture.candidate._id, eventIds: [event._id], severity: fixture.severity, type: fixture.type, status: "open", details: fixture.details, riskPriority: fixture.priority, contributingSignals: [{ type: fixture.type, weight: fixture.priority, eventId: event.id }] } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  console.log(JSON.stringify({ organization: { id: organization.id, name: organization.name }, demoStudents: students.map(({ name, email }) => ({ name, email })), demoAssessments: exams.map(({ title }) => title), demoIncidents: incidentFixtures.map(({ label }) => label) }, null, 2));
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
