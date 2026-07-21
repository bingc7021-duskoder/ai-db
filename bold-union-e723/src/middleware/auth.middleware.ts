import { MiddlewareHandler } from 'hono';
import { getAppConfig } from '../config/env';
import { AuthService } from '../services/auth.service';
import { sendError } from '../utils/response';
import { AppContext } from '../types/auth';

/**
 * Authentication middleware that validates the JWT session token
 * from the Authorization header and attaches the user payload to Hono context.
 */
export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[AuthMiddleware] Request rejected: missing or malformed Authorization header');
    return sendError(c, 401, 'Unauthorized: Access token is missing or malformed');
  }

  const token = authHeader.substring(7);
  try {
    const config = getAppConfig(c.env);
    
    // Read JWT_SECRET from environment bindings
    const jwtSecret = c.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('[AuthMiddleware] Configuration error: JWT_SECRET environment binding is missing');
      return sendError(c, 500, 'Internal Server Error: Secure environment configuration is missing');
    }

    const authService = new AuthService(config.googleClientId, jwtSecret);
    const payload = await authService.verifySessionToken(token);

    // Attach user to context
    c.set('user', {
      id: payload.id,
      googleId: payload.googleId,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions,
    });

    await next();
  } catch (error: any) {
    const isExpired = error.message && error.message.toLowerCase().includes('expired');
    if (isExpired) {
      console.warn('[AuthMiddleware] Request rejected: Token Expiry encountered');
    } else {
      console.warn(`[AuthMiddleware] Request rejected: JWT verification failed: ${error.message}`);
    }

    return sendError(
      c,
      401,
      isExpired ? 'Unauthorized: Access token has expired' : 'Unauthorized: Invalid access token',
      error.message
    );
  }
};
