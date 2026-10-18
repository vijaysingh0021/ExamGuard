import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDatabase } from "../src/db.js";
import { Candidate, Exam, ExamAssignment, Membership, Organization, Question, User } from "../src/models.js";

const email = process.env.TARGET_CANDIDATE_EMAIL?.trim().toLowerCase();
const testTitle = process.env.TEST_TITLE ?? "DBMS Practice Test";
const dbmsQuestions = [
  ["Which key uniquely identifies each record in a table?", ["Foreign key", "Primary key", "Composite attribute", "Index"], "a"],
  ["Which normal form removes partial dependencies?", ["1NF", "2NF", "3NF", "BCNF"], "b"],
  ["Which SQL statement retrieves rows from a table?", ["SELECT", "UPDATE", "INSERT", "DELETE"], "a"],
  ["A foreign key primarily enforces what?", ["Referential integrity", "Sorting", "Encryption", "Replication"], "a"],
  ["Which join returns rows that match in both tables?", ["LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "CROSS JOIN"], "c"],
  ["What does ACID's A stand for?", ["Atomicity", "Availability", "Authorization", "Aggregation"], "a"],
  ["Which clause groups rows sharing a value?", ["ORDER BY", "GROUP BY", "HAVING", "WHERE"], "b"],
  ["Which command permanently saves a transaction?", ["ROLLBACK", "COMMIT", "GRANT", "REVOKE"], "b"],
  ["Which index structure is commonly used for range queries?", ["B-tree", "Hash only", "Queue", "Stack"], "a"],
  ["Which isolation issue allows one transaction to read uncommitted data?", ["Phantom read", "Dirty read", "Deadlock", "Starvation"], "b"],
] as const;

if (process.env.DEVELOPMENT_SETUP !== "yes") throw new Error("Refusing setup. Set DEVELOPMENT_SETUP=yes for this explicit local development operation.");
if (!email) throw new Error("TARGET_CANDIDATE_EMAIL is required for this explicit development operation.");

async function configure() {
  await connectDatabase();
  const candidate = await Candidate.findOne({ email });
  if (!candidate) throw new Error("The requested candidate was not found.");
  const organization = await Organization.findById(candidate.organizationId);
  if (!organization) throw new Error("The candidate organization was not found.");
  const adminMembership = await Membership.findOne({ organizationId: organization._id, active: true, role: "institute_admin" });
  if (!adminMembership) throw new Error("No active institute administrator exists for this organization.");
  let user = await User.findOne({ email });
  let temporaryPassword: string | undefined;
  if (!user) {
    temporaryPassword = `EgDev-${crypto.randomBytes(15).toString("base64url")}`;
    user = await User.create({ name: candidate.name, email, passwordHash: await bcrypt.hash(temporaryPassword, 12) });
  }
  await Membership.findOneAndUpdate({ userId: user._id, organizationId: organization._id }, { $setOnInsert: { role: "student", active: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!candidate.userId) await Candidate.updateOne({ _id: candidate._id, userId: { $in: [null, undefined] } }, { userId: user._id });
  let exam = await Exam.findOne({ organizationId: organization._id, title: testTitle });
  if (!exam) {
    const now = Date.now();
    exam = await Exam.create({ organizationId: organization._id, title: testTitle, instructions: "Development practice assessment. Answer all questions, review your responses, and submit before the 15-minute server deadline.", durationMinutes: 15, status: "draft", startsAt: new Date(now - 5 * 60_000), endsAt: new Date(now + 24 * 60 * 60_000), requireVerification: true, randomizeQuestions: false, randomizeOptions: false, createdBy: adminMembership.userId });
    await Question.insertMany(dbmsQuestions.map(([prompt, options, correctAnswer], position) => ({ organizationId: organization._id, examId: exam!._id, type: "mcq", prompt, options: options.map((text, index) => ({ id: String.fromCharCode(97 + index), text })), correctAnswer, marks: 1, negativeMarks: 0, position })));
    await Exam.updateOne({ _id: exam._id, status: "draft" }, { status: "published" });
    exam.status = "published";
  }
  await ExamAssignment.findOneAndUpdate({ organizationId: organization._id, examId: exam._id, candidateId: candidate._id }, {}, { upsert: true, new: true, setDefaultsOnInsert: true });
  console.log(JSON.stringify({ organization: { id: organization.id, name: organization.name }, candidate: { id: candidate.id, email, userCreated: Boolean(temporaryPassword), emailVerified: Boolean(candidate.emailVerifiedAt) }, exam: { id: exam.id, title: exam.title, status: exam.status, questionCount: await Question.countDocuments({ organizationId: organization._id, examId: exam._id }) }, temporaryPassword }, null, 2));
  await mongoose.disconnect();
}
configure().catch(async (error) => { console.error(error instanceof Error ? error.message : error); await mongoose.disconnect(); process.exitCode = 1; });
