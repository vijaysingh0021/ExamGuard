import mongoose from "mongoose";
import { connectDatabase } from "../src/db.js";
import { Candidate, Exam, ExamAssignment, ExamAttempt, Membership, Organization, Question, User, VerificationRequest } from "../src/models.js";

const candidateEmail = process.env.TARGET_CANDIDATE_EMAIL?.trim().toLowerCase();
if (!candidateEmail) throw new Error("TARGET_CANDIDATE_EMAIL is required for this explicit inspection.");

async function inspect() {
  await connectDatabase();
  const candidate = await Candidate.findOne({ email: candidateEmail }).lean();
  if (!candidate) throw new Error("Candidate not found");
  const organization = await Organization.findById(candidate.organizationId).lean();
  const candidateUser = candidate.userId ? await User.findById(candidate.userId).select("name email").lean() : null;
  const membership = candidate.userId ? await Membership.findOne({ userId: candidate.userId, organizationId: candidate.organizationId, active: true }).lean() : null;
  const verification = await VerificationRequest.findOne({ organizationId: candidate.organizationId, candidateId: candidate._id }).lean();
  const exam = await Exam.findOne({ organizationId: candidate.organizationId, title: /daa exam/i }).lean();
  const questions = exam ? await Question.countDocuments({ organizationId: candidate.organizationId, examId: exam._id }) : 0;
  const assignment = exam ? await ExamAssignment.findOne({ organizationId: candidate.organizationId, examId: exam._id, candidateId: candidate._id }).lean() : null;
  const attempts = exam ? await ExamAttempt.find({ organizationId: candidate.organizationId, examId: exam._id, candidateId: candidate._id }).lean() : [];
  console.log(JSON.stringify({ organization: organization && { id: String(organization._id), name: organization.name }, candidate: { id: String(candidate._id), name: candidate.name, email: candidate.email, emailVerified: Boolean(candidate.emailVerifiedAt), userLinked: Boolean(candidate.userId), candidateUser, membership: membership?.role ?? null, verification: verification?.status ?? null }, exam: exam && { id: String(exam._id), title: exam.title, status: exam.status, durationMinutes: exam.durationMinutes, startsAt: exam.startsAt, endsAt: exam.endsAt, requireVerification: exam.requireVerification, accessCodeRequired: Boolean(exam.accessCodeHash), questionCount: questions, assigned: Boolean(assignment), attempts: attempts.map((attempt) => ({ status: attempt.status, deadlineAt: attempt.deadlineAt, receiptCode: attempt.receiptCode })) } }, null, 2));
  await mongoose.disconnect();
}
inspect().catch(async (error) => { console.error(error instanceof Error ? error.message : error); await mongoose.disconnect(); process.exitCode = 1; });
