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
import { PipelineLogger } from '../utils/logger';

import { RCAPipelineService } from '../services/RCAPipelineService';

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
  const user = c.get('user');
  const logger = new PipelineLogger({
    endpoint: 'POST /query',
    timestamp: new Date().toISOString(),
    userRole: user?.role || 'authenticated_user',
    userEmail: user?.email || 'unknown@user.com'
  });

  logger.startTimer('Total request');
  const requestStartTime = Date.now();

  let snapshotContext: any = {
    markdownStatus: 'NOT_STARTED',
    metadataStatus: 'NOT_STARTED',
    promptPrepStatus: 'NOT_STARTED',
    geminiPayloadStatus: 'NOT_STARTED'
  };

  try {
    const body = await c.req.json<ChatQueryRequest>().catch(() => null);

    if (!body || (!body.question && !body.prompt && !body.sql)) {
      console.warn(`[VALIDATION ERROR] POST /query - Missing question, prompt, or SQL in request body`);
      return sendError(c, 400, 'Invalid Request: question, prompt, or SQL statement is required in request body');
    }

    const userQuestion = body.question || body.prompt || '';
    const conversationHistory = body.conversationHistory || [];

    // Stage 1: Log Incoming API Request
    logger.logIncomingRequest({
      question: userQuestion || body.sql || '',
      historyLength: conversationHistory.length
    });

    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const schemaContextService = new SchemaContextService(dbService);
    const promptService = new PromptService();

    // Stage 2 & 3: Log Schema Context & Documentation Prompts
    logger.startTimer('Markdown loading');
    const schemaPromptInfo = promptService.getPromptInfo(PromptType.SCHEMA_CONTEXT);
    logger.logSchemaContext(schemaPromptInfo);

    const allPromptsInfo = promptService.getAllPromptsInfo();
    logger.logDocumentationContext(allPromptsInfo);
    logger.endTimer('Markdown loading');
    snapshotContext.markdownStatus = 'LOADED_SUCCESS';

    if (userQuestion) {
      if (!config.geminiApiKey) {
        const cfgErr = new Error('Configuration Error: GEMINI_API_KEY is not configured on the backend.');
        logger.logError(cfgErr, snapshotContext);
        return sendError(c, 500, cfgErr.message);
      }

      const rcaService = new RCAPipelineService(dbService, config.geminiApiKey);
      const rcaResponse = await rcaService.processRCAQuery({
        userQuestion,
        conversationHistory,
        logger
      });

      const totalExecutionTimeMs = logger.endTimer('Total request');
      const chartData = rcaResponse.rows ? extractChartData(rcaResponse.rows) : [];

      const successPayload = {
        answer: rcaResponse.answer,
        sql: rcaResponse.sql,
        chartData,
        rows: rcaResponse.rows,
        rowCount: rcaResponse.rowCount,
        metadataSummary: rcaResponse.metadataSummary
      };

      logger.logFinalApiResponse({
        responseSize: Buffer.byteLength(JSON.stringify(successPayload), 'utf-8'),
        totalExecutionTimeMs,
        payloadPreview: successPayload
      });

      return sendSuccess(
        c,
        successPayload,
        'RCA Assistant response generated successfully',
        totalExecutionTimeMs
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
    const totalExecutionTimeMs = logger.endTimer('Total request');

    const directSqlPayload = {
      rows: dbResult.rows,
      rowCount: dbResult.rowCount,
      chartData: extractChartData(dbResult.rows)
    };

    logger.logFinalApiResponse({
      responseSize: Buffer.byteLength(JSON.stringify(directSqlPayload), 'utf-8'),
      totalExecutionTimeMs,
      payloadPreview: directSqlPayload
    });

    return sendSuccess(
      c,
      dbResult.rows,
      'Query executed successfully',
      totalExecutionTimeMs
    );
  } catch (error: any) {
    const totalExecutionTimeMs = logger.endTimer('Total request');
    logger.logError(error, snapshotContext);

    const isDbError = error instanceof DatabaseError;
    const statusCode = isDbError ? 400 : 500;
    const clientMessage = error.message || (isDbError ? 'Database operation failed' : 'Internal Server Error during query execution');

    return sendError(
      c,
      statusCode,
      clientMessage,
      error.stack || String(error)
    );
  }
});

export default queryRouter;
