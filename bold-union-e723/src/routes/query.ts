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

      // Stage 4: Log Database Metadata
      logger.startTimer('Metadata generation');
      const metaFetchStart = new Date().toISOString();
      const metadata = await schemaContextService.getLiveMetadata();
      const metaFetchCompleted = new Date().toISOString();
      const metadataFetchTimeMs = logger.endTimer('Metadata generation');
      snapshotContext.metadataStatus = 'FETCHED_SUCCESS';

      const totalColumns = metadata.tables.reduce((acc, t) => acc + t.columns.length, 0);
      const totalFunctions = metadata.routines.filter(r => r.routineType === 'FUNCTION').length;
      const totalProcedures = metadata.routines.filter(r => r.routineType === 'PROCEDURE').length;
      const schemaSummaryString = schemaContextService.buildSchemaSummaryString(metadata);

      logger.logDatabaseMetadata({
        fetchStarted: metaFetchStart,
        fetchCompleted: metaFetchCompleted,
        executionTimeMs: metadataFetchTimeMs,
        totalTables: metadata.totalTables,
        totalColumns,
        totalForeignKeys: metadata.totalRelationships,
        totalIndexes: metadata.totalIndexes,
        totalFunctions,
        totalProcedures,
        totalTriggers: metadata.triggers.length,
        totalViews: metadata.totalViews,
        rawMetadataObj: metadata,
        summaryString: schemaSummaryString
      });

      // Stage 5: Log Final Prompt Preparation
      logger.startTimer('Prompt generation');
      const { prompt: fullPrompt, schemaSummary } = await schemaContextService.buildFullPromptContext(
        userQuestion,
        conversationHistory
      );
      logger.endTimer('Prompt generation');
      snapshotContext.promptPrepStatus = 'PREPARED_SUCCESS';
      snapshotContext.fullPromptLength = fullPrompt.length;

      const groundingRules = promptService.getPrompt(PromptType.SCHEMA_CONTEXT);

      logger.logFinalPromptPrep({
        totalPromptLength: fullPrompt.length,
        systemPromptLength: groundingRules.length,
        markdownContextLength: groundingRules.length,
        schemaSummaryLength: schemaSummary.length,
        userQuestion,
        finalCombinedPrompt: fullPrompt
      });

      // Stage 6 & 7: Gemini Request and Response (Handled inside GeminiService)
      snapshotContext.geminiPayloadStatus = 'POSTING_TO_GEMINI';
      const geminiService = new GeminiService(config.geminiApiKey, promptService);
      const geminiAnswer = await geminiService.generateDirect(fullPrompt, false, logger);

      // Stage 8: Response Parsing
      logger.startTimer('Response parsing');
      let parsedSql: string | null = null;
      let parsedExplanation = '';
      let jsonParsingStatus = 'N/A (Plain Natural Language Response)';
      const formattingCleanupPerformed: string[] = [];

      try {
        const jsonMatch = geminiAnswer.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          formattingCleanupPerformed.push('Extracted JSON object using regex match /\\{[\\s\\S]*\\}/');
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.sql && typeof parsed.sql === 'string') {
            parsedSql = parsed.sql;
            parsedExplanation = parsed.explanation || '';
            jsonParsingStatus = 'SUCCESS (Parsed valid JSON with SQL field)';
          } else {
            jsonParsingStatus = 'PARTIAL (Parsed JSON, no SQL field found)';
          }
        }
      } catch (err: any) {
        jsonParsingStatus = `FAILED (${err.message})`;
      }

      logger.logResponseParsing({
        rawText: geminiAnswer,
        parsedText: parsedExplanation || geminiAnswer,
        jsonParsingStatus,
        formattingCleanup: formattingCleanupPerformed
      });
      logger.endTimer('Response parsing');

      // Execute SQL if present
      if (parsedSql) {
        console.log(`[LOG] Parsed executable SQL query: ${parsedSql}`);
        const validation = UserQueryValidator.validate(parsedSql);
        if (validation.isValid) {
          try {
            const dbResult = await dbService.execute(parsedSql);
            const chartData = extractChartData(dbResult.rows);
            const totalExecutionTimeMs = logger.endTimer('Total request');

            const successPayload = {
              answer: parsedExplanation || geminiAnswer,
              sql: parsedSql,
              chartData,
              rows: dbResult.rows,
              metadataSummary: `Query executed against active ${metadata.totalTables} tables.`
            };

            // Stage 9: Log Final API Response
            const payloadStr = JSON.stringify(successPayload);
            logger.logFinalApiResponse({
              responseSize: Buffer.byteLength(payloadStr, 'utf-8'),
              totalExecutionTimeMs,
              payloadPreview: successPayload
            });

            return sendSuccess(
              c,
              successPayload,
              'Schema-grounded query executed successfully',
              totalExecutionTimeMs
            );
          } catch (dbErr: any) {
            console.warn(`[LOG] Generated SQL execution error, returning grounded explanation:`, dbErr);
          }
        }
      }

      // Return grounded natural language answer
      const totalExecutionTimeMs = logger.endTimer('Total request');
      const naturalLanguagePayload = {
        answer: geminiAnswer,
        sql: parsedSql || undefined,
        metadataSummary: `Answer grounded in current live PostgreSQL schema (${metadata.totalTables} tables, ${metadata.totalRelationships} FK relations).`
      };

      // Stage 9: Log Final API Response
      const payloadStr = JSON.stringify(naturalLanguagePayload);
      logger.logFinalApiResponse({
        responseSize: Buffer.byteLength(payloadStr, 'utf-8'),
        totalExecutionTimeMs,
        payloadPreview: naturalLanguagePayload
      });

      return sendSuccess(
        c,
        naturalLanguagePayload,
        'Grounded response generated successfully',
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
      directSqlPayload,
      'Query executed successfully',
      totalExecutionTimeMs
    );
  } catch (error: any) {
    const totalExecutionTimeMs = logger.endTimer('Total request');
    logger.logError(error, snapshotContext);

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
