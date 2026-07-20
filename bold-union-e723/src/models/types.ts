/**
 * Cloudflare Worker Environment Bindings
 */
export interface Env {
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

/**
 * SQL execution request body payload
 */
export interface SQLRequest {
  sql: string;
}

/**
 * Standard API JSON Response
 */
export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  executionTimeMs?: number;
}

/**
 * Result details from a SQL query execution
 */
export interface DatabaseQueryResult {
  rows: Record<string, any>[];
  rowCount: number;
}

/**
 * Lexical SQL Token structure for security validation
 */
export interface Token {
  type: 'keyword' | 'string' | 'identifier' | 'operator' | 'punctuation' | 'comment';
  value: string;
}

/**
 * Result of SQL validation checking
 */
export interface SQLValidationResult {
  isValid: boolean;
  reason?: string;
}
