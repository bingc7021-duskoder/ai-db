import { MiddlewareHandler } from 'hono';
import { Permission, AppContext } from '../types/auth';
import { sendError } from '../utils/response';

/**
 * Authorization middleware that ensures the user has a specific permission.
 * Automatically allows access to SUPER_ADMIN.
 */
export function requirePermission(requiredPermission: Permission): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const user = c.get('user');
    
    if (!user) {
      console.warn('[AuthorizationMiddleware] Request rejected: no user session context found');
      return sendError(c, 401, 'Unauthenticated: Authentication required');
    }

    // SUPER_ADMIN has access to all actions
    if (user.role === 'SUPER_ADMIN') {
      await next();
      return;
    }

    // Check if the required permission is present in user's permissions
    const hasPermission = user.permissions && user.permissions.includes(requiredPermission);
    if (!hasPermission) {
      console.warn(
        `[AuthorizationMiddleware] Permission Denied: User ${user.email} (Role: ${user.role}) attempted action requiring '${requiredPermission}'`
      );
      return sendError(
        c,
        403,
        `Forbidden: You do not have the required permission: ${requiredPermission}`
      );
    }

    await next();
  };
}
