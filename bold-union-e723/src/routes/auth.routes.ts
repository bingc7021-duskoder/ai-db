import { Hono } from 'hono';
import { getAppConfig } from '../config/env';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { DatabaseService } from '../services/database.service';
import { GoogleLoginRequest } from '../models/auth.model';
import { sendSuccess, sendError } from '../utils/response';
import { AppContext } from '../types/auth';

const authRouter = new Hono<AppContext>();

/**
 * POST /auth/google
 * Validates Google credential token, finds or creates user, and returns app JWT.
 */
authRouter.post('/google', async (c) => {
  const body = await c.req.json<GoogleLoginRequest>().catch(() => null);
  if (!body || !body.credential || body.provider !== 'google') {
    console.warn('[AuthRouter] Failed Login: Invalid request body or provider');
    return sendError(c, 400, 'Invalid Request: Google credentials and provider must be specified');
  }

  try {
    const config = getAppConfig(c.env);
    const jwtSecret = config.jwtSecret;

    const authService = new AuthService(config.googleClientId, jwtSecret);
    const dbService = new DatabaseService(config.databaseUrl);
    const userService = new UserService(dbService);

    // Verify Google ID Token (cryptographically and claim validation)
    console.log('[AuthRouter] Verifying Google ID Token signature and claims...');
    const googleUser = await authService.verifyGoogleToken(body.credential);

    // Look up user by Google ID first
    let user = await userService.findByGoogleId(googleUser.googleId);
    let isNewUser = false;

    if (!user) {
      // Look up user by email next (to link pre-provisioned users)
      user = await userService.findByEmail(googleUser.email);
      
      if (!user) {
        // If user doesn't exist, create a new record
        console.log(`[AuthRouter] User not found. Creating new user record for: ${googleUser.email}`);
        user = await userService.createUser(
          googleUser.googleId,
          googleUser.email,
          googleUser.name,
          googleUser.picture
        );
        isNewUser = true;
        console.log(`[AuthRouter] User Creation: New user profile created for ${user.email} (ID: ${user.id})`);
      } else {
        // Link Google ID if found by email but Google ID was not populated
        console.log(`[AuthRouter] User found by email. Linking Google ID for: ${googleUser.email}`);
        user = await dbService.runInTransaction(async (tx) => {
          await tx.execute(
            'UPDATE app_users SET google_id = $2, updated_at = NOW() WHERE id = $1',
            [user!.id, googleUser.googleId]
          );
          const txUserService = new UserService(tx as any);
          return await txUserService.updateLastLogin(
            user!.id,
            googleUser.name,
            googleUser.picture
          );
        });
      }
    } else {
      // If user exists, update login metadata and profile info
      user = await userService.updateLastLogin(
        user.id,
        googleUser.name,
        googleUser.picture
      );
    }

    // Check if the user account is active
    if (!user.is_active) {
      console.warn(`[AuthRouter] Failed Login: Account is deactivated for ${user.email}`);
      return sendError(c, 403, 'Forbidden: Your account has been deactivated. Please contact support.');
    }

    // Resolve permissions associated with user role
    const permissions = await authService.getPermissionsForRole(user.role);

    // Generate JWT
    const token = await authService.generateSessionToken(
      user.id,
      user.google_id,
      user.email,
      user.role,
      permissions
    );

    console.log(`[AuthRouter] Successful Login: User ${user.email} authenticated. Role: ${user.role}`);

    return sendSuccess(
      c,
      {
        user: user.toJSON(),
        token,
        permissions,
      },
      'Authentication successful'
    );
  } catch (error: any) {
    console.warn(`[AuthRouter] Failed Login: ${error.message}`);
    return sendError(c, 401, 'Authentication failed', error.message);
  }
});

export default authRouter;
