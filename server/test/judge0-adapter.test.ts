import test from 'node:test';
import assert from 'node:assert/strict';
import { Judge0HttpAdapter, judge0AdapterFromEnv, judge0LanguageIdsFromEnv } from '../src/judge0-adapter.js';

test('Judge0 remains unavailable until both endpoint and token are configured', () => {
  assert.equal(judge0AdapterFromEnv({}), null);
  assert.throws(() => judge0AdapterFromEnv({ JUDGE0_BASE_URL: 'https://judge0.example' }), /one of JUDGE0_AUTH_TOKEN or JUDGE0_RAPIDAPI_KEY/);
  assert.throws(() => judge0AdapterFromEnv({ JUDGE0_BASE_URL: 'http://judge0.internal', JUDGE0_AUTH_TOKEN: 'secret' }), /private HTTP/);
  assert.ok(judge0AdapterFromEnv({
    JUDGE0_BASE_URL: 'http://judge0.internal',
    JUDGE0_AUTH_TOKEN: 'secret',
    JUDGE0_PRIVATE_HTTP_CONFIRMED: 'true',
  }));
});

test('RapidAPI configuration requires HTTPS and an exclusive API key', () => {
  assert.ok(judge0AdapterFromEnv({
    JUDGE0_BASE_URL: 'https://judge0-ce.p.rapidapi.com',
    JUDGE0_RAPIDAPI_KEY: 'rapid-key',
  }));
  assert.throws(() => judge0AdapterFromEnv({
    JUDGE0_BASE_URL: 'http://judge0-ce.p.rapidapi.com',
    JUDGE0_RAPIDAPI_KEY: 'rapid-key',
  }), /requires HTTPS/);
  assert.throws(() => judge0AdapterFromEnv({
    JUDGE0_BASE_URL: 'https://judge0-ce.p.rapidapi.com',
    JUDGE0_AUTH_TOKEN: 'judge0-token',
    JUDGE0_RAPIDAPI_KEY: 'rapid-key',
  }), /either JUDGE0_AUTH_TOKEN or JUDGE0_RAPIDAPI_KEY/);
});

test('Judge0 language IDs use standard defaults and validate overrides', () => {
  assert.deepEqual(judge0LanguageIdsFromEnv({}), { c: 50, cpp: 54, java: 62, python: 71, javascript: 63 });
  assert.equal(judge0LanguageIdsFromEnv({ JUDGE0_LANGUAGE_ID_PYTHON: '99' }).python, 99);
  assert.throws(() => judge0LanguageIdsFromEnv({ JUDGE0_LANGUAGE_ID_PYTHON: 'python' }), /positive integer/);
});

test('Judge0 adapter uses the private auth header and does not send expected outputs', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ token: 'runner-token' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const runner = new Judge0HttpAdapter({
      baseUrl: 'https://judge0.example',
      authenticationHeaders: { 'X-Auth-Token': 'private-token' },
      requestTimeoutMs: 2000,
    });
    await runner.createSubmission({
      languageId: 71,
      sourceCode: 'print(1)',
      stdin: '',
      cpuTimeLimitSeconds: 2,
      memoryLimitKb: 65_536,
    });
    assert.equal(calls[0].url, 'https://judge0.example/submissions?base64_encoded=false&wait=false');
    assert.equal(new Headers(calls[0].init?.headers).get('X-Auth-Token'), 'private-token');
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.enable_network, false);
    assert.equal('expected_output' in body, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('RapidAPI requests use its key and host headers without a Judge0 token header', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ version: '1.13.1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const runner = judge0AdapterFromEnv({
      JUDGE0_BASE_URL: 'https://judge0-ce.p.rapidapi.com',
      JUDGE0_RAPIDAPI_KEY: 'rapid-key',
    });
    assert.ok(runner);
    await runner.checkReady();
    assert.equal(calls[0].url, 'https://judge0-ce.p.rapidapi.com/system_info');
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get('X-RapidAPI-Key'), 'rapid-key');
    assert.equal(headers.get('X-RapidAPI-Host'), 'judge0-ce.p.rapidapi.com');
    assert.equal(headers.get('X-Auth-Token'), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
