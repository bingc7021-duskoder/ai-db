import { Context } from 'hono';
import { ApiResponse } from '../models/types';

/**
 * Sends a standard success JSON response.
 * @param c Hono Context
 * @param data Optional payload to return
 * @param message Optional developer/user message
 * @param executionTimeMs Optional query execution duration in milliseconds
 * @param status HTTP Status Code (default 200)
 */
export function sendSuccess<T = any>(
  c: Context,
  data?: T,
  message?: string,
  executionTimeMs?: number,
  status: number = 200
) {
  const response: ApiResponse<T> = {
    success: true,
    message,
    data,
    executionTimeMs
  };
  return c.json(response, status as any);
}

/**
 * Sends a standard error JSON response.
 * @param c Hono Context
 * @param status HTTP Status Code
 * @param message Client-facing error description
 * @param error Optional detailed technical error/stack
 */
export function sendError(
  c: Context,
  status: number,
  message: string,
  error?: string
) {
  const response: ApiResponse = {
    success: false,
    message,
    error
  };
  return c.json(response, status as any);
}
