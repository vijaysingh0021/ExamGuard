import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { z } from 'zod';

// Workspace scripts execute under `server/`; root scripts execute under the
// repository root. Prefer the repository .env in either case. Values supplied
// by the OS retain precedence because dotenv never overrides them.
const cwd = process.cwd();
const repositoryEnv = basename(cwd) === 'server' ? resolve(cwd, '..', '.env') : resolve(cwd, '.env');
const envFile = [repositoryEnv, resolve(cwd, '.env')].find(existsSync);
if (envFile) dotenv.config({ path: envFile, override: false });

const schema = z.object({
  MONGODB_URI: z.string().url().startsWith('mongodb'),
  MONGODB_DB_NAME: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional()
});
export type Config = z.infer<typeof schema>;
export const loadConfig = (env = process.env): Config => schema.parse(env);
export const configurationErrorMessage = () => 'Configuration is invalid. Set MONGODB_URI, MONGODB_DB_NAME, and a 32+ character JWT_SECRET in the root .env file.';
