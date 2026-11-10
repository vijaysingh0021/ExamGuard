import { z } from 'zod';

export const validateAnswerValue = (question: { type: string; options?: unknown }, value: unknown) => {
  const optionIds = new Set((Array.isArray(question.options) ? question.options : []).map(option => (option as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === 'string'));
  const invalid = () => new z.ZodError([{ code: 'custom', path: ['value'], message: 'Invalid selected option' }]);
  if (question.type === 'multiple_select') {
    const selected = z.array(z.string()).max(optionIds.size).parse(value);
    if (new Set(selected).size !== selected.length || selected.some(id => !optionIds.has(id))) throw invalid();
    return selected;
  }
  if (question.type === 'mcq' || question.type === 'true_false') {
    const selected = z.string().parse(value);
    if (!optionIds.has(selected)) throw invalid();
    return selected;
  }
  return z.string().max(50_000).parse(value);
};
