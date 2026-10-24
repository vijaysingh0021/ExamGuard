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
