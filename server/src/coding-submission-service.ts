import type { CodeRunnerAdapter, RunnerResult, RunnerSubmission } from './judge0-adapter.js';

export type CodingAttemptAccess = {
  attemptId: string;
  organizationId: string;
  candidateUserId: string;
  status: 'in_progress' | 'paused' | 'terminated' | 'submitted' | 'expired';
  deadlineAt: Date;
};

export const canWriteCodingSubmission = (access: CodingAttemptAccess, actor: { userId: string; organizationId: string }, now = new Date()) =>
  access.organizationId === actor.organizationId && access.candidateUserId === actor.userId && access.status === 'in_progress' && access.deadlineAt > now;

export type CodingSubmissionStore = {
  saveAttemptCode(input: { attemptId: string; questionId: string; organizationId: string; languageId: string; sourceCode: string }): Promise<void>;
  createExecutionJob(input: { attemptId: string; questionId: string; organizationId: string; kind: 'run' | 'submit'; languageId: string; sourceCode: string }): Promise<{ submissionId: string; jobId: string }>;
  attachRunnerToken(jobId: string, token: string): Promise<void>;
  persistRunnerResult(jobId: string, result: RunnerResult): Promise<void>;
};

/**
 * Orchestrates a database-backed submission only after its caller has loaded
 * authorized test cases. It accepts no browser-supplied private test data.
 */
export class CodingSubmissionService {
  constructor(private readonly store: CodingSubmissionStore, private readonly runner: CodeRunnerAdapter) {}

  async queue(input: { access: CodingAttemptAccess; actor: { userId: string; organizationId: string }; questionId: string; kind: 'run' | 'submit'; languageId: string; sourceCode: string; runnerSubmission: RunnerSubmission }) {
    if (!canWriteCodingSubmission(input.access, input.actor)) throw new Error('Coding submission is not authorized for this attempt');
    const job = await this.store.createExecutionJob({ attemptId: input.access.attemptId, questionId: input.questionId, organizationId: input.access.organizationId, kind: input.kind, languageId: input.languageId, sourceCode: input.sourceCode });
    const runner = await this.runner.createSubmission(input.runnerSubmission);
    await this.store.attachRunnerToken(job.jobId, runner.token);
    return job;
  }
}
