import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { z } from 'zod';

// The Node and Python AI processes share one repository-root .env. Never load a
// server-local .env here, because that could silently give the services different
// AI credentials. Deployment environment variables still take precedence.
const cwd = process.cwd();
const repositoryRoot = basename(cwd) === 'server' ? resolve(cwd, '..') : cwd;
const repositoryEnv = resolve(repositoryRoot, '.env');
if (existsSync(repositoryEnv)) dotenv.config({ path: repositoryEnv, override: false });

const schema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgres'),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(4000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional()
});

const normalizeOrigin = (value: string) => {
  const withoutTrailingSlash = value.trim().replace(/\/+$/, '');
  try {
    return new URL(withoutTrailingSlash).origin;
  } catch {
    return withoutTrailingSlash;
  }
};

export const parseClientOrigins = (raw: string | undefined, fallback = 'http://localhost:5173'): string[] => {
  const candidates = (raw ?? fallback).split(',').map(value => value.trim()).filter(Boolean);
  const origins = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate);
    if (normalized) origins.add(normalized);
  }
  if (origins.size === 0) {
    try {
      return [new URL(fallback).origin];
    } catch {
      return [];
    }
  }
  return [...origins];
};

export const isClientOriginAllowed = (origin: string | undefined, raw: string | undefined = process.env.CLIENT_URL, fallback = 'http://localhost:5173') => {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  return parseClientOrigins(raw, fallback).includes(normalizedOrigin);
};

export type Config = z.infer<typeof schema>;
export const loadConfig = (env = process.env): Config => schema.parse(env);
export const configurationErrorMessage = () => 'Configuration is invalid. Set DATABASE_URL and a 32+ character JWT_SECRET in the root .env file.';
