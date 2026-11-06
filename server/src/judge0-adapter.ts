/**
 * Private service adapter contract for a separately deployed Judge0 instance.
 * This module is not wired into Express until the database migration and
 * infrastructure review are complete; it never executes code locally.
 */
export type RunnerStatus = 'queued' | 'running' | 'accepted' | 'wrong_answer' | 'compile_error' | 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'internal_error';

export type RunnerSubmission = {
  languageId: number;
  sourceCode: string;
  stdin: string;
  expectedOutput: string;
  cpuTimeLimitSeconds: number;
  memoryLimitKb: number;
};

export type RunnerResult = {
  token: string;
  status: RunnerStatus;
  stdout?: string;
  stderr?: string;
  compileOutput?: string;
  timeSeconds?: number;
  memoryKb?: number;
};

export interface CodeRunnerAdapter {
  createSubmission(submission: RunnerSubmission): Promise<{ token: string }>;
  getSubmission(token: string): Promise<RunnerResult>;
}

export class RunnerUnavailableError extends Error {
  constructor() {
    super('Secure code execution is not configured for this environment');
    this.name = 'RunnerUnavailableError';
  }
}

export class UnavailableRunnerAdapter implements CodeRunnerAdapter {
  async createSubmission(_submission: RunnerSubmission): Promise<{ token: string }> { throw new RunnerUnavailableError(); }
  async getSubmission(_token: string): Promise<RunnerResult> { throw new RunnerUnavailableError(); }
}

export type Judge0AdapterConfig = {
  baseUrl: string;
  authorizationHeader: string;
  requestTimeoutMs: number;
};

const judge0Status = (id: number): RunnerStatus => {
  if (id === 1 || id === 2) return 'queued';
  if (id === 3) return 'accepted';
  if (id === 4) return 'wrong_answer';
  if (id === 5) return 'time_limit_exceeded';
  if (id === 6) return 'compile_error';
  if (id === 7 || id === 8 || id === 9 || id === 10 || id === 11 || id === 12) return 'runtime_error';
  if (id === 13) return 'internal_error';
  return 'internal_error';
};

/** A deployment-supplied adapter. Its credential must stay server-side. */
export class Judge0HttpAdapter implements CodeRunnerAdapter {
  constructor(private readonly config: Judge0AdapterConfig) {}

  private async request(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: this.config.authorizationHeader, 'Content-Type': 'application/json', ...init.headers }
      });
      if (!response.ok) throw new Error(`Judge0 request failed with status ${response.status}`);
      return response.json() as Promise<Record<string, unknown>>;
    } finally {
      clearTimeout(timer);
    }
  }

  async createSubmission(submission: RunnerSubmission) {
    const body = await this.request('/submissions?base64_encoded=false&wait=false', {
      method: 'POST',
      body: JSON.stringify({
        language_id: submission.languageId,
        source_code: submission.sourceCode,
        stdin: submission.stdin,
        expected_output: submission.expectedOutput,
        cpu_time_limit: submission.cpuTimeLimitSeconds,
        memory_limit: submission.memoryLimitKb,
        enable_network: false
      })
    });
    if (typeof body.token !== 'string') throw new Error('Judge0 response did not include a submission token');
    return { token: body.token };
  }

  async getSubmission(token: string): Promise<RunnerResult> {
    const body = await this.request(`/submissions/${encodeURIComponent(token)}?base64_encoded=false`, { method: 'GET' });
    const statusId = typeof (body.status as { id?: unknown } | undefined)?.id === 'number' ? (body.status as { id: number }).id : 13;
    return {
      token,
      status: judge0Status(statusId),
      stdout: typeof body.stdout === 'string' ? body.stdout : undefined,
      stderr: typeof body.stderr === 'string' ? body.stderr : undefined,
      compileOutput: typeof body.compile_output === 'string' ? body.compile_output : undefined,
      timeSeconds: typeof body.time === 'string' ? Number(body.time) : undefined,
      memoryKb: typeof body.memory === 'number' ? body.memory : undefined
    };
  }
}
