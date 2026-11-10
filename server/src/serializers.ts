import type { Exam } from './generated/prisma/client.js';

type PolicyColumns = Pick<Exam, 'policyWindowSeconds' | 'policyWarningAt' | 'policyPauseAt' | 'policyTerminateAt' | 'policyAutomaticTerminationEnabled' | 'policyFullscreenRequired'>;

export const policyOf = (exam: PolicyColumns) => ({
  windowSeconds: exam.policyWindowSeconds,
  warningAt: exam.policyWarningAt,
  pauseAt: exam.policyPauseAt,
  terminateAt: exam.policyTerminateAt,
  automaticTerminationEnabled: exam.policyAutomaticTerminationEnabled,
  fullscreenRequired: exam.policyFullscreenRequired
});

export const examToJson = (exam: Exam) => {
  const { accessCodeHash, policyWindowSeconds, policyWarningAt, policyPauseAt, policyTerminateAt, policyAutomaticTerminationEnabled, policyFullscreenRequired, ...rest } = exam;
  return { ...rest, hasAccessCode: Boolean(accessCodeHash), interventionPolicy: policyOf(exam) };
};