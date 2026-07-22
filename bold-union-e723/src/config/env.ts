import { Env } from '../models/types';

export interface AppConfig {
  databaseUrl: string;
  geminiApiKey: string;
  googleClientId: string;
  googleClientSecret: string;
  jwtSecret: string;
}

/**
 * Validates and retrieves required configurations from the Cloudflare environment bindings.
 * Throws a detailed error if any required configurations are missing.
 */
export function getAppConfig(env: Env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  const geminiApiKey = env.GEMINI_API_KEY;
  const googleClientId = env.GOOGLE_CLIENT_ID;
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET;
  const jwtSecret = env.JWT_SECRET || 'aetherdb-secure-default-jwt-secret-key-2026';

  if (!databaseUrl) {
    throw new Error('Configuration error: DATABASE_URL is missing. Please check your wrangler.jsonc or secret configuration.');
  }

  // Log warnings for optional configuration bindings if they are empty
  if (!geminiApiKey) {
    console.warn('Configuration warning: GEMINI_API_KEY binding is empty.');
  }
  if (!googleClientId) {
    console.warn('Configuration warning: GOOGLE_CLIENT_ID binding is empty.');
  }
  if (!googleClientSecret) {
    console.warn('Configuration warning: GOOGLE_CLIENT_SECRET binding is empty.');
  }

  return {
    databaseUrl,
    geminiApiKey: geminiApiKey || '',
    googleClientId: googleClientId || '',
    googleClientSecret: googleClientSecret || '',
    jwtSecret,
  };
}
