import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const aiServiceDirectory = resolve(repositoryRoot, 'ai-service');
const envFile = resolve(repositoryRoot, '.env');
const envText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
const envValue = (name) => {
  if (process.env[name]) return process.env[name];
  const line = envText.split(/\r?\n/).find((entry) => entry.trimStart().startsWith(`${name}=`));
  if (!line) return undefined;
  const value = line.slice(line.indexOf('=') + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, '$2');
};
const configuredPython = envValue('AI_SERVICE_PYTHON');
const python = configuredPython
  ? resolve(repositoryRoot, configuredPython)
  : resolve(
    aiServiceDirectory,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );

if (!existsSync(python)) {
  console.error('ExamGuard AI Python is missing. Set AI_SERVICE_PYTHON or create ai-service/.venv and install ai-service/requirements.txt.');
  process.exitCode = 1;
} else {
  const configuredUrl = envValue('AI_SERVICE_URL') ?? 'http://127.0.0.1:8001';
  let port;
  try {
    const serviceUrl = new URL(configuredUrl);
    if (serviceUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(serviceUrl.hostname)) {
      throw new Error();
    }
    port = serviceUrl.port || (serviceUrl.protocol === 'https:' ? '443' : '80');
  } catch {
    console.error('AI_SERVICE_URL must be a valid localhost URL for automatic local AI startup.');
    process.exitCode = 1;
  }

  if (port) {
    console.log(`Starting the local ExamGuard AI service on 127.0.0.1:${port}`);
    const service = spawn(
      python,
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', port],
      { cwd: aiServiceDirectory, env: process.env, stdio: 'inherit' },
    );
    const stopService = () => service.kill();
    process.on('SIGINT', stopService);
    process.on('SIGTERM', stopService);
    service.on('error', (error) => {
      console.error(`Could not start the local ExamGuard AI service: ${error.message}`);
      process.exitCode = 1;
    });
    service.on('exit', (code) => { process.exitCode = code ?? 0; });
  }
}
