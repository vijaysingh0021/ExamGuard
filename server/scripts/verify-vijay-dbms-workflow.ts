import mongoose from "mongoose";
import { signToken } from "../src/auth.js";
import { connectDatabase } from "../src/db.js";
import { Candidate, Exam, Membership, Question, User } from "../src/models.js";

const candidateEmail = process.env.TARGET_CANDIDATE_EMAIL?.trim().toLowerCase();
const password = process.env.CANDIDATE_PASSWORD;
if (!password) throw new Error("CANDIDATE_PASSWORD is required for the supported login verification.");
if (!candidateEmail) throw new Error("TARGET_CANDIDATE_EMAIL is required for the supported login verification.");
const baseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const call = async (path: string, options: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error ?? "request failed"}`);
  return body;
};
async function verify() {
  await connectDatabase();
  const candidate = await Candidate.findOne({ email: candidateEmail }).lean();
  if (!candidate?.userId) throw new Error("Candidate login is not linked.");
  const exam = await Exam.findOne({ organizationId: candidate.organizationId, title: "DBMS Practice Test" }).lean();
  if (!exam) throw new Error("DBMS Practice Test is missing.");
  const adminMembership = await Membership.findOne({ organizationId: candidate.organizationId, role: "institute_admin", active: true }).lean();
  if (!adminMembership) throw new Error("Active administrator is missing.");
  const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email: candidateEmail, password }) });
  const candidateAuth = { authorization: `Bearer ${login.token}` };
  const before = await call("/api/student/dashboard", { headers: candidateAuth });
  if (!before.assignments.some((assignment: any) => assignment.exam?._id === String(exam._id))) throw new Error("Assigned exam absent from candidate dashboard.");
  const verification = await call(`/api/organizations/${candidate.organizationId}/candidates/${candidate._id}/verification`, { method: "POST", headers: candidateAuth, body: "{}" });
  const adminAuth = { authorization: `Bearer ${signToken(String(adminMembership.userId))}` };
  await call(`/api/organizations/${candidate.organizationId}/verifications/${verification._id}/review`, { method: "POST", headers: adminAuth, body: JSON.stringify({ approved: true, reason: "Development test identity review" }) });
  const started = await call(`/api/student/organizations/${candidate.organizationId}/exams/${exam._id}/start`, { method: "POST", headers: candidateAuth, body: "{}" });
  const keys = await Question.find({ organizationId: candidate.organizationId, examId: exam._id }).select("_id correctAnswer").lean();
  for (const question of keys) await call(`/api/student/attempts/${started.attempt.id}/answers/${question._id}`, { method: "PUT", headers: candidateAuth, body: JSON.stringify({ value: question.correctAnswer }) });
  const submitted = await call(`/api/student/attempts/${started.attempt.id}/submit`, { method: "POST", headers: candidateAuth, body: "{}" });
  const grade = await call(`/api/organizations/${candidate.organizationId}/attempts/${started.attempt.id}/grade`, { method: "POST", headers: adminAuth, body: "{}" });
  await call(`/api/organizations/${candidate.organizationId}/grades/${grade._id}/publish`, { method: "POST", headers: adminAuth, body: "{}" });
  const after = await call("/api/student/dashboard", { headers: candidateAuth });
  const released = after.assignments.find((assignment: any) => assignment.exam?._id === String(exam._id))?.grade;
  if (!released || released.totalMarks !== 10 || released.maxMarks !== 10) throw new Error("Published grade was not visible only after release.");
  console.log(JSON.stringify({ login: "passed", dashboardAssignment: "passed", verification: "submitted and admin-approved", attempt: { status: submitted.status, receiptCode: submitted.receiptCode }, grade: { totalMarks: released.totalMarks, maxMarks: released.maxMarks, released: true } }, null, 2));
  await mongoose.disconnect();
}
verify().catch(async (error) => { console.error(error instanceof Error ? error.message : error); await mongoose.disconnect(); process.exitCode = 1; });
