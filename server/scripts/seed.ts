import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDatabase } from "../src/db.js";
import { Candidate, Exam, ExamAssignment, Membership, Organization, Question, User } from "../src/models.js";

const password = process.env.DEMO_SEED_PASSWORD;
const databaseName = (process.env.MONGODB_DB_NAME ?? "").toLowerCase();
if (process.env.DEMO_SEED !== "yes" || !password || password.length < 12 || /(^|[-_])(prod|production)([-_]|$)/.test(databaseName)) throw new Error("Refusing to seed. Set DEMO_SEED=yes and a 12+ character DEMO_SEED_PASSWORD, and use a non-production MONGODB_DB_NAME.");
const people = [["Aarav Sharma", "aarav.admin@demo.examguard.test", "institute_admin"], ["Priya Verma", "priya.teacher@demo.examguard.test", "teacher"], ["Rahul Mehta", "rahul.teacher@demo.examguard.test", "teacher"], ["Aditi Singh", "aditi.candidate@demo.examguard.test", "student", "EG-C001"], ["Rohan Kumar", "rohan.candidate@demo.examguard.test", "student", "EG-C002"], ["Neha Joshi", "neha.candidate@demo.examguard.test", "student", "EG-C003"], ["Arjun Patel", "arjun.candidate@demo.examguard.test", "student", "EG-C004"], ["Simran Kaur", "simran.candidate@demo.examguard.test", "student", "EG-C005"]] as const;
const questions = [["Which data structure follows first-in, first-out ordering?", ["Stack", "Queue", "Tree", "Graph"], "b"], ["Which SQL clause filters grouped results?", ["WHERE", "HAVING", "ORDER BY", "SELECT"], "b"], ["Which OS component selects the next process to run?", ["Compiler", "Scheduler", "Loader", "Shell"], "b"], ["Which protocol provides reliable, ordered transport?", ["UDP", "IP", "TCP", "ARP"], "c"], ["What is binary search complexity?", ["O(1)", "O(log n)", "O(n)", "O(n log n)"], "b"], ["Which normal form removes partial dependency?", ["1NF", "2NF", "3NF", "BCNF"], "b"], ["Which keyword creates an immutable JavaScript binding?", ["var", "let", "const", "static"], "c"], ["Which device forwards packets between networks?", ["Hub", "Switch", "Router", "Repeater"], "c"], ["A mutex is primarily used for what?", ["Mutual exclusion", "Compression", "Encryption", "Routing"], "a"], ["Which traversal returns a binary-search tree in sorted order?", ["Preorder", "Inorder", "Postorder", "Level order"], "b"]] as const;
async function seed() {
  await connectDatabase();
  const org = await Organization.findOneAndUpdate({ slug: "examguard-demo-institute" }, { $setOnInsert: { name: "[DEMO] ExamGuard Demo Institute", slug: "examguard-demo-institute" } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const identities = new Map<string, { id: string; name: string; candidateCode?: string }>();
  for (const [name, email, role, candidateCode] of people) {
    let user = await User.findOne({ email });
    if (!user) user = await User.create({ name: `[DEMO] ${name}`, email, passwordHash: await bcrypt.hash(password!, 12) });
    await Membership.findOneAndUpdate({ userId: user._id, organizationId: org._id }, { $setOnInsert: { role, active: true } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    identities.set(email, { id: user.id, name, candidateCode });
  }
  const candidateIds: string[] = [];
  for (const [, email, role] of people) if (role === "student") { const person = identities.get(email)!; const candidate = await Candidate.findOneAndUpdate({ organizationId: org._id, email }, { $setOnInsert: { organizationId: org._id, userId: person.id, name: `[DEMO] ${person.name}`, email, externalId: person.candidateCode } }, { upsert: true, new: true, setDefaultsOnInsert: true }); candidateIds.push(candidate.id); }
  const admin = identities.get("aarav.admin@demo.examguard.test")!;
  let exam = await Exam.findOne({ organizationId: org._id, title: "[DEMO] CSE Fundamentals Assessment" });
  if (!exam) exam = await Exam.create({ organizationId: org._id, title: "[DEMO] CSE Fundamentals Assessment", instructions: "Development-only synthetic assessment. Do not use for real examination decisions.", status: "draft", durationMinutes: 30, createdBy: admin.id });
  if (await Question.countDocuments({ examId: exam._id, organizationId: org._id }) === 0) await Question.insertMany(questions.map(([prompt, options, correctAnswer], position) => ({ organizationId: org._id, examId: exam!._id, type: "mcq", prompt, options: options.map((text, index) => ({ id: String.fromCharCode(97 + index), text })), correctAnswer, marks: 1, negativeMarks: 0, position })));
  if (exam.status === "draft") await Exam.updateOne({ _id: exam._id, status: "draft" }, { status: "published" });
  for (const candidateId of candidateIds) await ExamAssignment.findOneAndUpdate({ organizationId: org._id, examId: exam._id, candidateId }, {}, { upsert: true, new: true, setDefaultsOnInsert: true });
  console.info("Development demo data is ready. Use the documented local password; no monitoring observations were created.");
  await mongoose.disconnect();
}
seed().catch(async (error) => { console.error(error instanceof Error ? error.message : error); await mongoose.disconnect(); process.exitCode = 1; });
