import { z } from 'zod';

export const codingLanguageId = z.enum(['c', 'cpp', 'java', 'python', 'javascript']);
export const codingProblemMode = z.enum(['function', 'stdin_stdout']);
export const codingDifficulty = z.enum(['easy', 'medium', 'hard']);
export const outputComparisonMode = z.enum(['exact', 'whitespace_normalized']);

export const codingQuestionInput = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(50_000),
  difficulty: codingDifficulty,
  mode: codingProblemMode,
  inputFormat: z.string().max(10_000).default(''),
  outputFormat: z.string().max(10_000).default(''),
  constraints: z.string().max(10_000).default(''),
  explanation: z.string().max(20_000).default(''),
  languageIds: z.array(codingLanguageId).min(1).max(5).refine(ids => new Set(ids).size === ids.length, 'Languages must be unique'),
  starterCode: z.record(codingLanguageId, z.string().max(200_000)).default({}),
  timeLimitMs: z.number().int().min(100).max(30_000).default(2_000),
  memoryLimitKb: z.number().int().min(16_384).max(1_048_576).default(262_144),
  comparisonMode: outputComparisonMode.default('exact'),
  marks: z.number().positive(),
  negativeMarks: z.number().min(0).default(0)
});

export const codingTestCaseInput = z.object({
  input: z.string().max(100_000),
  expectedOutput: z.string().max(100_000),
  visibility: z.enum(['sample', 'private']),
  position: z.number().int().nonnegative()
});

export const codingAutosaveInput = z.object({
  questionId: z.string().uuid(),
  languageId: codingLanguageId,
  sourceCode: z.string().max(200_000),
  version: z.number().int().positive().optional()
});

export const codingExecutionRequest = z.object({
  questionId: z.string().uuid(),
  languageId: codingLanguageId,
  sourceCode: z.string().min(1).max(200_000)
});

/** Keep rate controls separate for exploratory runs and score-affecting submits. */
export const codingRateLimits = {
  run: { windowMs: 60_000, limit: 12 },
  submit: { windowMs: 60_000, limit: 4 },
  autosave: { windowMs: 60_000, limit: 60 }
} as const;
