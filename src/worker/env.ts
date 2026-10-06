import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type * as schema from './db/schema';
import type { Role } from './db/schema';

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  RATE_LIMIT: KVNamespace;
  ASSETS: Fetcher;
  APP_ENV: 'production' | 'development';
  TURNSTILE_SITE_KEY: string;
  ALLOWED_ORIGINS?: string;
  // secrets
  TURNSTILE_SECRET_KEY?: string;
  UPLOAD_SIGNING_SECRET?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
}

export type DB = DrizzleD1Database<typeof schema>;

export interface SessionUser {
  id: number;
  name: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  role: Role;
  flatId: number | null;
  mustResetPassword: boolean;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: DB;
    user: SessionUser | undefined;
    sessionId: number | undefined;
  };
}
