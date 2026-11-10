export const automaticallyGrade = (
  questions: Array<{ id: string; type: string; correctAnswer?: unknown; marks: number; negativeMarks: number }>,
  answers: Array<{ questionId: string; value?: unknown }>
) => {
  const normalize = (value: unknown) => JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
  return questions.reduce((result, question) => {
    if (!['mcq', 'multiple_select', 'true_false', 'short_answer'].includes(question.type) || question.correctAnswer == null) return result;
    const answer = answers.find(x => x.questionId === question.id)?.value;
    const equal = normalize(answer) === normalize(question.correctAnswer);
    return { marks: result.marks + (equal ? question.marks : answer == null ? 0 : -question.negativeMarks), needsManual: result.needsManual };
  }, { marks: 0, needsManual: questions.some(q => q.type === 'descriptive') });
};

/** Total is always automatic + manual marks, so re-running automatic grading can never discard manual marking. */
export const totalMarks = (autoMarks: number, manualMarks?: number | null) => autoMarks + (manualMarks ?? 0);
export const manualMarksWithinBounds = (autoMarks: number, manualMarks: number, maxMarks: number) => Number.isFinite(manualMarks) && manualMarks >= 0 && autoMarks + manualMarks <= maxMarks;
/**
 * Status after (re-)running automatic grading. Grade.manualMarks defaults to 0 (never null), so "has manual marks" cannot be
 * read from that column. A grade for an exam with descriptive questions only reaches 'graded' through the manual-marking
 * route, so an existing 'graded' status means a person already finished it and re-grading must not reopen it.
 */
export const gradeStatusAfterAuto = (needsManual: boolean, existingStatus?: string | null): 'pending_manual' | 'graded' => (needsManual && existingStatus !== 'graded' ? 'pending_manual' : 'graded');

/** Same equality rule automatic grading uses, exposed for question-level analytics. */
export const isAnswerCorrect = (answer: unknown, correct: unknown) => {
  const normalize = (value: unknown) => JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
  return answer != null && normalize(answer) === normalize(correct);
};
