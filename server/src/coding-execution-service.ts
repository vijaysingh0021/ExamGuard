import type { CodeRunnerAdapter, RunnerResult, RunnerStatus } from './judge0-adapter.js';
import { outputMatches } from './coding.js';

export type ExecutionCase = {
  id: string;
  visibility: 'sample' | 'private';
  input: string;
  expectedOutput: string;
};

export type ExecutionCaseResult = {
  id: string;
  visibility: 'sample' | 'private';
  status: RunnerStatus | 'wrong_answer';
  passed: boolean;
  stdout?: string;
  stderr?: string;
  compileOutput?: string;
  executionTimeMs?: number;
  memoryKb?: number;
};

const isTerminal = (status: RunnerStatus) => status !== 'queued' && status !== 'running';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForResult(runner: CodeRunnerAdapter, token: string, deadline: number): Promise<RunnerResult> {
  while (Date.now() < deadline) {
    const result = await runner.getSubmission(token);
    if (isTerminal(result.status)) return result;
    await delay(500);
  }
  throw new Error('Judge0 execution timed out');
}

export async function executeCodingCases(input: {
  runner: CodeRunnerAdapter;
  cases: ExecutionCase[];
  languageId: number;
  sourceCode: string;
  cpuTimeLimitSeconds: number;
  memoryLimitKb: number;
  comparisonMode: 'exact' | 'whitespace_normalized';
  timeoutMs?: number;
  onToken?: (token: string) => Promise<void>;
}): Promise<ExecutionCaseResult[]> {
  const results: Array<ExecutionCaseResult | undefined> = Array(input.cases.length);
  const deadline = Date.now() + (input.timeoutMs ?? 90_000);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (Date.now() >= deadline) throw new Error('Judge0 execution timed out');
      const index = nextIndex++;
      const testCase = input.cases[index];
      if (!testCase) return;
      const { token } = await input.runner.createSubmission({
        languageId: input.languageId,
        sourceCode: input.sourceCode,
        stdin: testCase.input,
        cpuTimeLimitSeconds: input.cpuTimeLimitSeconds,
        memoryLimitKb: input.memoryLimitKb
      });
      await input.onToken?.(token);
      const result = await waitForResult(input.runner, token, deadline);
      const passed = result.status === 'accepted' && outputMatches(result.stdout ?? '', testCase.expectedOutput, input.comparisonMode);
      results[index] = {
        id: testCase.id,
        visibility: testCase.visibility,
        status: result.status === 'accepted' && !passed ? 'wrong_answer' : result.status,
        passed,
        ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
        ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
        ...(result.compileOutput === undefined ? {} : { compileOutput: result.compileOutput }),
        ...(result.timeSeconds === undefined ? {} : { executionTimeMs: Math.round(result.timeSeconds * 1000) }),
        ...(result.memoryKb === undefined ? {} : { memoryKb: result.memoryKb })
      };
    }
  }
  const workers = Array.from({ length: Math.min(3, input.cases.length) }, () => worker());
  const outcomes = await Promise.allSettled(workers);
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
  if (failed) throw failed.reason;
  if (results.some(result => !result)) throw new Error('Judge0 did not complete every test case');
  return results.filter((result): result is ExecutionCaseResult => result !== undefined);
}

export function aggregateExecutionStatus(results: ExecutionCaseResult[]): RunnerStatus {
  if (results.some(result => result.status === 'internal_error')) return 'internal_error';
  if (results.some(result => result.status === 'time_limit_exceeded')) return 'time_limit_exceeded';
  if (results.some(result => result.status === 'memory_limit_exceeded')) return 'memory_limit_exceeded';
  if (results.some(result => result.status === 'compile_error')) return 'compile_error';
  if (results.some(result => result.status === 'runtime_error')) return 'runtime_error';
  if (results.every(result => result.passed)) return 'accepted';
  return 'wrong_answer';
}

export function candidateExecutionResults(results: ExecutionCaseResult[]) {
  const visible = results.filter(result => result.visibility === 'sample').map(result => ({
    id: result.id,
    visibility: result.visibility,
    status: result.status,
    passed: result.passed,
    ...(result.stdout === undefined ? {} : { actualOutput: result.stdout }),
    ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
    ...(result.compileOutput === undefined ? {} : { compileOutput: result.compileOutput }),
    ...(result.executionTimeMs === undefined ? {} : { executionTimeMs: result.executionTimeMs }),
    ...(result.memoryKb === undefined ? {} : { memoryKb: result.memoryKb })
  }));
  const hidden = results.filter(result => result.visibility === 'private');
  return {
    cases: visible,
    privateTests: hidden.length ? { passed: hidden.filter(result => result.passed).length, total: hidden.length } : undefined
  };
}
