import { Hono } from 'hono';
import { Env, SQLRequest } from '../models/types';
import { UserQueryValidator } from '../services/validator.service';
import { DatabaseService, DatabaseError } from '../services/database.service';
import { getAppConfig } from '../config/env';
import { sendSuccess, sendError } from '../utils/response';
import { PromptService, PromptType } from '../services/PromptService';
import { GeminiService } from '../services/GeminiService';
import { SchemaContextService } from '../services/SchemaContextService';
import { AppContext } from '../types/auth';
import { requireAuth } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/authorization.middleware';

export interface ChatQueryRequest {
  question?: string;
  prompt?: string;
  sql?: string;
  conversationHistory?: any[];
}

const queryRouter = new Hono<AppContext>();

// Enforce JWT authentication on all query routes
queryRouter.use('*', requireAuth);

/**
  * Helper function to extract potential chart data from query result rows.
  */
function extractChartData(rows: any[]): { label: string; value: number }[] {
  if (!rows || rows.length === 0) return [];
  
  const sample = rows[0];
  let labelKey = '';
  let valueKey = '';
  
  for (const [key, value] of Object.entries(sample)) {
    if (typeof value === 'number') {
      valueKey = key;
    } else if (typeof value === 'string' && !labelKey) {
      labelKey = key;
    }
  }
  
  if (!valueKey) {
    for (const [key, value] of Object.entries(sample)) {
      if (!isNaN(Number(value)) && typeof value !== 'object') {
        valueKey = key;
        break;
      }
    }
  }
  
  if (!labelKey) {
    labelKey = Object.keys(sample)[0] || '';
  }
  
  if (labelKey && valueKey && labelKey !== valueKey) {
    return rows.slice(0, 10).map(row => ({
      label: String(row[labelKey]),
      value: Number(row[valueKey])
    }));
  }
  
  return [];
}

/**
 * POST /query
 * Single Gateway endpoint: receives natural language question or SELECT SQL statement,
 * dynamically gathers grounded live PostgreSQL schema context via SchemaContextService,
 * passes grounded context to Gemini, and returns the accurate response to the frontend.
 */
queryRouter.post('/', requirePermission('QUERY_DATABASE'), async (c) => {
  const startTime = performance.now();
  console.log(`[API CALL] POST /query - Start`);

  try {
    const body = await c.req.json<ChatQueryRequest>().catch(() => null);

    if (!body || (!body.question && !body.prompt && !body.sql)) {
      console.warn(`[VALIDATION ERROR] POST /query - Missing question, prompt, or SQL in request body`);
      return sendError(c, 400, 'Invalid Request: question, prompt, or SQL statement is required in request body');
    }

    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const schemaContextService = new SchemaContextService(dbService);

    const userQuestion = body.question || body.prompt || '';
    const conversationHistory = body.conversationHistory || [];

    if (userQuestion) {
      console.log(`[LOG] Question received for schema context pipeline: ${userQuestion}`);
      if (!config.geminiApiKey) {
        return sendError(c, 500, 'Configuration Error: GEMINI_API_KEY is not configured on the backend.');
      }

      // Build complete, grounded prompt payload with dynamic live metadata & strict rules
      const { prompt: fullPrompt, metadata } = await schemaContextService.buildFullPromptContext(
        userQuestion,
        conversationHistory
      );

      const promptService = new PromptService();
      const geminiService = new GeminiService(config.geminiApiKey, promptService);

      // Request grounded response from Gemini
      const geminiAnswer = await geminiService.generateDirect(fullPrompt, false);

      // Check if Gemini generated a JSON payload containing an executable SQL query
      let parsedSql: string | null = null;
      let parsedExplanation = '';
      try {
        const jsonMatch = geminiAnswer.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.sql && typeof parsed.sql === 'string') {
            parsedSql = parsed.sql;
            parsedExplanation = parsed.explanation || '';
          }
        }
      } catch (err) {
        // Response is natural language explanation
      }

      // If a SQL query was parsed, validate and execute it
      if (parsedSql) {
        console.log(`[LOG] Parsed executable SQL query: ${parsedSql}`);
        const validation = UserQueryValidator.validate(parsedSql);
        if (validation.isValid) {
          try {
            const dbResult = await dbService.execute(parsedSql);
            const chartData = extractChartData(dbResult.rows);
            const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

            return sendSuccess(
              c,
              {
                answer: parsedExplanation || geminiAnswer,
                sql: parsedSql,
                chartData,
                rows: dbResult.rows,
                metadataSummary: `Query executed against active ${metadata.totalTables} tables.`
              },
              'Schema-grounded query executed successfully',
              executionTimeMs
            );
          } catch (dbErr: any) {
            console.warn(`[LOG] Generated SQL execution error, returning grounded explanation:`, dbErr);
          }
        }
      }

      // Return grounded natural language answer
      const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2));
      return sendSuccess(
        c,
        {
          answer: geminiAnswer,
          sql: parsedSql || undefined,
          metadataSummary: `Answer grounded in current live PostgreSQL schema (${metadata.totalTables} tables, ${metadata.totalRelationships} FK relations).`
        },
        'Grounded response generated successfully',
        executionTimeMs
      );
    }

    // Direct SQL execution flow
    const sqlQuery = body.sql!;
    console.log(`[LOG] Raw SQL received for execution:\n${sqlQuery}`);
    const validation = UserQueryValidator.validate(sqlQuery);
    if (!validation.isValid) {
      return sendError(c, 400, 'Invalid SQL: Command rejected by validator rules', validation.reason);
    }

    const dbResult = await dbService.execute(sqlQuery);
    const executionTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

    return sendSuccess(
      c,
      {
        rows: dbResult.rows,
        rowCount: dbResult.rowCount,
        chartData: extractChartData(dbResult.rows)
      },
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
      : 'Internal Server Error or Database failure during query execution';

    return sendError(
      c,
      statusCode,
      clientMessage,
      error.message || String(error)
    );
  }
});

export default queryRouter;
