-- REVIEW ONLY: prepared for explicit approval. This migration has not been applied.

CREATE TYPE "CodingProblemMode" AS ENUM ('function', 'stdin_stdout');
CREATE TYPE "CodingDifficulty" AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE "CodingTestCaseVisibility" AS ENUM ('sample', 'private');
CREATE TYPE "CodeSubmissionKind" AS ENUM ('run', 'submit');
CREATE TYPE "ExecutionStatus" AS ENUM ('queued', 'running', 'accepted', 'wrong_answer', 'compile_error', 'runtime_error', 'time_limit_exceeded', 'memory_limit_exceeded', 'runner_unavailable', 'internal_error');
CREATE TYPE "OutputComparisonMode" AS ENUM ('exact', 'whitespace_normalized');

ALTER TYPE "QuestionType" ADD VALUE 'coding';

CREATE TABLE "coding_questions" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "difficulty" "CodingDifficulty" NOT NULL,
  "mode" "CodingProblemMode" NOT NULL,
  "inputFormat" TEXT NOT NULL DEFAULT '',
  "outputFormat" TEXT NOT NULL DEFAULT '',
  "constraints" TEXT NOT NULL DEFAULT '',
  "explanation" TEXT NOT NULL DEFAULT '',
  "languageIds" TEXT[] NOT NULL,
  "starterCode" JSONB NOT NULL DEFAULT '{}',
  "timeLimitMs" INTEGER NOT NULL DEFAULT 2000,
  "memoryLimitKb" INTEGER NOT NULL DEFAULT 262144,
  "comparisonMode" "OutputComparisonMode" NOT NULL DEFAULT 'exact',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coding_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "coding_test_cases" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "codingQuestionId" UUID NOT NULL,
  "input" TEXT NOT NULL,
  "expectedOutput" TEXT NOT NULL,
  "visibility" "CodingTestCaseVisibility" NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coding_test_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attempt_codes" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "attemptId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "codingQuestionId" UUID NOT NULL,
  "languageId" TEXT NOT NULL,
  "sourceCode" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attempt_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "code_submissions" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "attemptId" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "questionId" UUID NOT NULL,
  "codingQuestionId" UUID NOT NULL,
  "languageId" TEXT NOT NULL,
  "sourceCode" TEXT NOT NULL,
  "kind" "CodeSubmissionKind" NOT NULL,
  "status" "ExecutionStatus" NOT NULL DEFAULT 'queued',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "code_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "execution_jobs" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "runnerToken" TEXT,
  "status" "ExecutionStatus" NOT NULL DEFAULT 'queued',
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "execution_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "execution_results" (
  "id" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "testCaseId" UUID NOT NULL,
  "status" "ExecutionStatus" NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "executionTimeMs" INTEGER,
  "memoryKb" INTEGER,
  "stdout" TEXT,
  "stderr" TEXT,
  "compileOutput" TEXT,
  "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "execution_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coding_questions_questionId_key" ON "coding_questions"("questionId");
CREATE INDEX "coding_questions_organizationId_idx" ON "coding_questions"("organizationId");
CREATE UNIQUE INDEX "coding_test_cases_codingQuestionId_position_key" ON "coding_test_cases"("codingQuestionId", "position");
CREATE INDEX "coding_test_cases_organizationId_visibility_idx" ON "coding_test_cases"("organizationId", "visibility");
CREATE UNIQUE INDEX "attempt_codes_attemptId_questionId_key" ON "attempt_codes"("attemptId", "questionId");
CREATE INDEX "attempt_codes_organizationId_savedAt_idx" ON "attempt_codes"("organizationId", "savedAt");
CREATE INDEX "code_submissions_organizationId_attemptId_submittedAt_idx" ON "code_submissions"("organizationId", "attemptId", "submittedAt" DESC);
CREATE INDEX "code_submissions_candidateId_submittedAt_idx" ON "code_submissions"("candidateId", "submittedAt" DESC);
CREATE UNIQUE INDEX "execution_jobs_submissionId_key" ON "execution_jobs"("submissionId");
CREATE UNIQUE INDEX "execution_jobs_runnerToken_key" ON "execution_jobs"("runnerToken");
CREATE INDEX "execution_jobs_organizationId_status_queuedAt_idx" ON "execution_jobs"("organizationId", "status", "queuedAt");
CREATE UNIQUE INDEX "execution_results_jobId_testCaseId_key" ON "execution_results"("jobId", "testCaseId");
CREATE INDEX "execution_results_testCaseId_idx" ON "execution_results"("testCaseId");

ALTER TABLE "coding_questions" ADD CONSTRAINT "coding_questions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coding_questions" ADD CONSTRAINT "coding_questions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "coding_test_cases" ADD CONSTRAINT "coding_test_cases_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "coding_test_cases" ADD CONSTRAINT "coding_test_cases_codingQuestionId_fkey" FOREIGN KEY ("codingQuestionId") REFERENCES "coding_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attempt_codes" ADD CONSTRAINT "attempt_codes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attempt_codes" ADD CONSTRAINT "attempt_codes_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attempt_codes" ADD CONSTRAINT "attempt_codes_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attempt_codes" ADD CONSTRAINT "attempt_codes_codingQuestionId_fkey" FOREIGN KEY ("codingQuestionId") REFERENCES "coding_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exam_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_codingQuestionId_fkey" FOREIGN KEY ("codingQuestionId") REFERENCES "coding_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "code_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "execution_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "coding_test_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
