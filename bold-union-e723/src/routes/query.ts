import { Hono } from 'hono';
import { Env, SQLRequest } from '../models/types';
import { UserQueryValidator } from '../services/validator.service';
import { DatabaseService, DatabaseError } from '../services/database.service';
import { getAppConfig } from '../config/env';
import { sendSuccess, sendError } from '../utils/response';
import { AppContext } from '../types/auth';
import { requireAuth } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/authorization.middleware';

const queryRouter = new Hono<AppContext>();

// Enforce JWT authentication on all query routes
queryRouter.use('*', requireAuth);

/**
 * POST /query
 * Receives SELECT SQL statement, validates it is SELECT-only, runs it on Neon PostgreSQL, and returns rows as JSON.
 */
queryRouter.post('/', requirePermission('QUERY_DATABASE'), async (c) => {
  const startTime = performance.now();
  console.log(`[API CALL] POST /query - Start`);

  try {
    const body = await c.req.json<SQLRequest>().catch(() => null);

    if (!body || !body.sql) {
      console.warn(`[VALIDATION ERROR] POST /query - Missing SQL in request body`);
      return sendError(c, 400, 'Invalid Request: SQL statement is required in request body');
    }

    const sqlQuery = body.sql;
    console.log(`[LOG] SQL received for user query validation:\n${sqlQuery}`);

    // Validate SELECT-only query SQL
    const validation = UserQueryValidator.validate(sqlQuery);
    if (!validation.isValid) {
      console.warn(`[VALIDATION ERROR] POST /query - Blocked SQL: ${validation.reason}`);
      return sendError(c, 400, 'Invalid SQL: Command rejected by validator rules', validation.reason);
    }

    // Connect to database
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);

    // Execute query
    console.log(`[LOG] Executing select query on Neon database...`);
    const dbResult = await dbService.execute(sqlQuery);

    const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
    console.log(`[SUCCESS] POST /query - Retained ${dbResult.rowCount} rows - Execution time: ${executionTimeMs}ms`);

    return sendSuccess(
      c,
      dbResult.rows,
      'Query executed successfully',
      executionTimeMs
    );
  } catch (error: any) {
    const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
    console.error(`[FAILURE] POST /query - Execution time: ${executionTimeMs}ms - Error:`, error);

    const isDbError = error instanceof DatabaseError;
    const statusCode = isDbError ? 400 : 500;
    const clientMessage = isDbError
      ? 'Database operation failed'
      : 'Internal Server Error or Database failure during execution';

    return sendError(
      c,
      statusCode,
      clientMessage,
      error.message || String(error)
    );
  }
});

export default queryRouter;
