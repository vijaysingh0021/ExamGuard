/** Private service adapter for a separately deployed Judge0 instance. */
export type RunnerStatus = 'queued' | 'running' | 'accepted' | 'wrong_answer' | 'compile_error' | 'runtime_error' | 'time_limit_exceeded' | 'memory_limit_exceeded' | 'internal_error';

export type RunnerSubmission = {
  languageId: number;
  sourceCode: string;
  stdin: string;
  expectedOutput?: string;
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
  authenticationHeaders: Readonly<Record<string, string>>;
  requestTimeoutMs: number;
};

export type Judge0LanguageKey = 'c' | 'cpp' | 'java' | 'python' | 'javascript';
export type Judge0LanguageIds = Record<Judge0LanguageKey, number>;

const defaultLanguageIds: Judge0LanguageIds = {
  c: 50,
  cpp: 54,
  java: 62,
  python: 71,
  javascript: 63
};

const languageEnvNames: Record<Judge0LanguageKey, string> = {
  c: 'JUDGE0_LANGUAGE_ID_C',
  cpp: 'JUDGE0_LANGUAGE_ID_CPP',
  java: 'JUDGE0_LANGUAGE_ID_JAVA',
  python: 'JUDGE0_LANGUAGE_ID_PYTHON',
  javascript: 'JUDGE0_LANGUAGE_ID_JAVASCRIPT'
};

export function judge0LanguageIdsFromEnv(env: Record<string, string | undefined> = process.env): Judge0LanguageIds {
  const parse = (language: Judge0LanguageKey) => {
    const name = languageEnvNames[language];
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return defaultLanguageIds[language];
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
  };
  return { c: parse('c'), cpp: parse('cpp'), java: parse('java'), python: parse('python'), javascript: parse('javascript') };
}

export function judge0AdapterFromEnv(env: Record<string, string | undefined> = process.env): Judge0HttpAdapter | null {
  const baseUrl = env.JUDGE0_BASE_URL?.trim();
  const token = env.JUDGE0_AUTH_TOKEN?.trim();
  const rapidApiKey = env.JUDGE0_RAPIDAPI_KEY?.trim();
  if (!baseUrl && !token && !rapidApiKey) return null;
  if (!baseUrl || (!token && !rapidApiKey)) {
    throw new Error('JUDGE0_BASE_URL and one of JUDGE0_AUTH_TOKEN or JUDGE0_RAPIDAPI_KEY must be configured');
  }
  if (token && rapidApiKey) throw new Error('Configure either JUDGE0_AUTH_TOKEN or JUDGE0_RAPIDAPI_KEY, not both');
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('JUDGE0_BASE_URL must be a valid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('JUDGE0_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment');
  }
  if (rapidApiKey && parsed.protocol !== 'https:') throw new Error('RapidAPI requires HTTPS for JUDGE0_BASE_URL');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'http:' && !loopback && env.JUDGE0_PRIVATE_HTTP_CONFIRMED !== 'true') {
    throw new Error('Use HTTPS for JUDGE0_BASE_URL or explicitly confirm private HTTP with JUDGE0_PRIVATE_HTTP_CONFIRMED=true');
  }
  const customHeaderName = env.JUDGE0_AUTH_HEADER_NAME?.trim();
  if (rapidApiKey && customHeaderName) throw new Error('JUDGE0_AUTH_HEADER_NAME cannot be used with JUDGE0_RAPIDAPI_KEY');
  const headerName = customHeaderName || 'X-Auth-Token';
  if (!rapidApiKey && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName)) throw new Error('JUDGE0_AUTH_HEADER_NAME is invalid');
  const requestTimeoutMs = Number(env.JUDGE0_REQUEST_TIMEOUT_MS ?? 12_000);
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 60_000) {
    throw new Error('JUDGE0_REQUEST_TIMEOUT_MS must be between 1000 and 60000');
  }
  return new Judge0HttpAdapter({
    baseUrl: parsed.toString().replace(/\/$/, ''),
    authenticationHeaders: rapidApiKey
      ? { 'X-RapidAPI-Key': rapidApiKey, 'X-RapidAPI-Host': parsed.hostname }
      : { [headerName]: token! },
    requestTimeoutMs
  });
}

const judge0Status = (id: number): RunnerStatus => {
  if (id === 1) return 'queued';
  if (id === 2) return 'running';
  if (id === 3) return 'accepted';
  if (id === 4) return 'wrong_answer';
  if (id === 5) return 'time_limit_exceeded';
  if (id === 6) return 'compile_error';
  if (id === 7 || id === 8 || id === 9 || id === 10 || id === 11 || id === 12 || id === 14) return 'runtime_error';
  if (id === 13) return 'internal_error';
  return 'internal_error';
};

/** A deployment-supplied adapter. Its credential must stay server-side. */
export class Judge0HttpAdapter implements CodeRunnerAdapter {
  constructor(private readonly config: Judge0AdapterConfig) {}

  async checkReady(): Promise<void> {
    await this.request('/system_info', { method: 'GET' });
  }

  private async request(path: string, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { ...this.config.authenticationHeaders, 'Content-Type': 'application/json', ...init.headers }
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
        ...(submission.expectedOutput === undefined ? {} : { expected_output: submission.expectedOutput }),
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
