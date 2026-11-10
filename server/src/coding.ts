/**
 * Runner-independent coding-assessment primitives.
 *
 * These declarations do not execute source code. A language becomes available
 * only after an isolated execution service has been configured and verified.
 */
export type OutputComparisonMode = 'exact' | 'whitespace_normalized';

export type CodingLanguage = {
  id: 'c' | 'cpp' | 'java' | 'python' | 'javascript';
  displayName: string;
  fileExtension: string;
  runnerStatus: 'not_configured';
};

export const declaredCodingLanguages: readonly CodingLanguage[] = [
  { id: 'c', displayName: 'C', fileExtension: '.c', runnerStatus: 'not_configured' },
  { id: 'cpp', displayName: 'C++', fileExtension: '.cpp', runnerStatus: 'not_configured' },
  { id: 'java', displayName: 'Java', fileExtension: '.java', runnerStatus: 'not_configured' },
  { id: 'python', displayName: 'Python', fileExtension: '.py', runnerStatus: 'not_configured' },
  { id: 'javascript', displayName: 'JavaScript', fileExtension: '.js', runnerStatus: 'not_configured' }
];

const normalizeWhitespace = (value: string) => value.replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).join('\n').trim();

export const outputMatches = (actual: string, expected: string, mode: OutputComparisonMode) =>
  mode === 'exact' ? actual === expected : normalizeWhitespace(actual) === normalizeWhitespace(expected);

export type RunnerCaseResult = {
  id: string;
  visibility: 'sample' | 'private';
  passed: boolean;
  status: 'accepted' | 'wrong_answer' | 'compile_error' | 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'runner_unavailable';
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  executionTimeMs?: number;
  memoryBytes?: number;
};

/** Returns only information a candidate may see after Run or Submit. */
export const candidateCaseResults = (results: RunnerCaseResult[]) => results.map(result => ({
  id: result.id,
  visibility: result.visibility,
  passed: result.passed,
  status: result.status,
  ...(result.visibility === 'sample' ? {
    input: result.input,
    expectedOutput: result.expectedOutput,
    actualOutput: result.actualOutput
  } : {}),
  executionTimeMs: result.executionTimeMs,
  memoryBytes: result.memoryBytes
}));
