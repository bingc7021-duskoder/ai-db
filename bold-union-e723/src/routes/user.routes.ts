import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/authorization.middleware';
import { UserService } from '../services/user.service';
import { DatabaseService } from '../services/database.service';
import { getAppConfig } from '../config/env';
import { sendSuccess, sendError } from '../utils/response';
import { AppContext, UserRole } from '../types/auth';

const userRouter = new Hono<AppContext>();

// Enforce JWT authentication on all routes in this path
userRouter.use('*', requireAuth);

/**
 * GET /users/me
 * Returns authenticated user profile.
 */
userRouter.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return sendError(c, 401, 'Unauthorized: User context missing');
  }

  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const userService = new UserService(dbService);

    const dbUser = await userService.findByGoogleId(user.googleId);
    if (!dbUser) {
      console.warn(`[UserRouter] GET /users/me - User profile not found for google_id: ${user.googleId}`);
      return sendError(c, 404, 'User profile not found');
    }

    return sendSuccess(c, dbUser.toJSON(), 'User profile retrieved successfully');
  } catch (error: any) {
    console.error('[UserRouter] Error retrieving user profile:', error);
    return sendError(c, 500, 'Internal Server Error', error.message);
  }
});

/**
 * GET /users
 * Returns all users. Restricted to ADMIN/SUPER_ADMIN only (requires MANAGE_USERS permission).
 */
userRouter.get('/', requirePermission('MANAGE_USERS'), async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const userService = new UserService(dbService);

    const users = await userService.findAll();
    return sendSuccess(
      c,
      users.map((u) => u.toJSON()),
      'Users list retrieved successfully'
    );
  } catch (error: any) {
    console.error('[UserRouter] Error retrieving all users:', error);
    return sendError(c, 500, 'Internal Server Error', error.message);
  }
});

/**
 * PATCH /users/:id/role
 * Changes user role. SUPER_ADMIN only.
 */
userRouter.patch('/:id/role', async (c) => {
  const adminUser = c.get('user');
  if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
    console.warn(`[UserRouter] Permission Denied: Non-SUPER_ADMIN attempted role modification`);
    return sendError(c, 403, 'Forbidden: Only SUPER_ADMIN can change user roles');
  }

  const userId = c.req.param('id');
  const body = await c.req.json<{ role: string }>().catch(() => null);

  if (!body || !body.role) {
    return sendError(c, 400, 'Invalid Request: role is required');
  }

  const targetRole = body.role as UserRole;
  if (targetRole !== 'USER' && targetRole !== 'ADMIN' && targetRole !== 'SUPER_ADMIN') {
    return sendError(c, 400, `Invalid Request: Unsupported role '${body.role}'`);
  }

  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const userService = new UserService(dbService);

    // Verify user exists first
    const checkResult = await dbService.execute('SELECT role FROM app_users WHERE id = $1', [userId]);
    if (checkResult.rowCount === 0 || !checkResult.rows[0]) {
      return sendError(c, 404, 'User not found');
    }

    const previousRole = checkResult.rows[0].role;
    const updatedUser = await userService.updateRole(userId, targetRole);

    console.log(
      `[UserRouter] Role Changes: Role of user ${userId} changed from ${previousRole} to ${targetRole} by ${adminUser.email}`
    );

    return sendSuccess(
      c,
      updatedUser.toJSON(),
      `User role updated successfully to ${targetRole}`
    );
  } catch (error: any) {
    console.error('[UserRouter] Error updating user role:', error);
    return sendError(c, 500, 'Internal Server Error', error.message);
  }
});

/**
 * PATCH /users/:id/status
 * Activates / Deactivates user. SUPER_ADMIN only.
 */
userRouter.patch('/:id/status', async (c) => {
  const adminUser = c.get('user');
  if (!adminUser || adminUser.role !== 'SUPER_ADMIN') {
    console.warn(`[UserRouter] Permission Denied: Non-SUPER_ADMIN attempted status modification`);
    return sendError(c, 403, 'Forbidden: Only SUPER_ADMIN can modify user status');
  }

  const userId = c.req.param('id');
  const body = await c.req.json<{ isActive: boolean }>().catch(() => null);

  if (!body || typeof body.isActive !== 'boolean') {
    return sendError(c, 400, 'Invalid Request: isActive is required and must be a boolean');
  }

  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const userService = new UserService(dbService);

    // Verify user exists first
    const checkResult = await dbService.execute('SELECT is_active FROM app_users WHERE id = $1', [userId]);
    if (checkResult.rowCount === 0 || !checkResult.rows[0]) {
      return sendError(c, 404, 'User not found');
    }

    const previousStatus = checkResult.rows[0].is_active;
    const updatedUser = await userService.updateStatus(userId, body.isActive);

    console.log(
      `[UserRouter] Status Changes: Account status of user ${userId} changed from ${previousStatus} to ${body.isActive} by ${adminUser.email}`
    );

    return sendSuccess(
      c,
      updatedUser.toJSON(),
      body.isActive ? 'User profile activated successfully' : 'User profile deactivated successfully'
    );
  } catch (error: any) {
    console.error('[UserRouter] Error updating user status:', error);
    return sendError(c, 500, 'Internal Server Error', error.message);
  }
});

export default userRouter;
