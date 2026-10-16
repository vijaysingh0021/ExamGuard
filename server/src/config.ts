import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// npm workspaces execute the server with `server/` as cwd, while production
// processes commonly use the repository root. Load a local file only when
// present; already-provided environment variables always retain precedence.
const envFile = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '.env')].find(existsSync);
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
