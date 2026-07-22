import { DatabaseService } from './database.service';
import { GeminiService } from './GeminiService';
import { PromptService, PromptType } from './PromptService';
import { SchemaContextService } from './SchemaContextService';
import { UserQueryValidator } from './validator.service';
import { PipelineLogger } from '../utils/logger';

export interface RCAPipelineRequest {
  userQuestion: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  logger?: PipelineLogger;
}

export interface RCAPipelineResponse {
  answer: string;
  sql?: string;
  chartData?: Array<{ label: string; value: number }>;
  rows?: any[];
  rowCount?: number;
  metadataSummary: string;
  isRestrictedWrite?: boolean;
}

export class RCAPipelineService {
  private dbService: DatabaseService;
  private geminiApiKey: string;
  private promptService: PromptService;
  private schemaContextService: SchemaContextService;

  constructor(dbService: DatabaseService, geminiApiKey: string) {
    this.dbService = dbService;
    this.geminiApiKey = geminiApiKey;
    this.promptService = new PromptService();
    this.schemaContextService = new SchemaContextService(dbService);
  }

  /**
   * Main RCA Decision & Execution Pipeline:
   * 1. Detect Intent & Safety Checks
   * 2. Execute Live Read-Only SQL Queries if question involves data, behavior, or performance
   * 3. Compile Grounding Context (documentation.md + schema_context.md + backend_prompt.md + frontend_prompt.md + Live Metadata + Query Results + History)
   * 4. Gemini AI Synthesizes 4-Part Senior Database Engineer RCA Response
   */
  public async processRCAQuery(req: RCAPipelineRequest): Promise<RCAPipelineResponse> {
    const startTime = performance.now();
    const userQuestion = req.userQuestion.trim();
    const history = req.conversationHistory || [];
    const logger = req.logger;

    // Check for Restricted Write Operations
    const isWriteAttempt = this.detectWriteOperation(userQuestion);
    if (isWriteAttempt) {
      console.warn(`[RCA Pipeline] Intercepted restricted write operation attempt: "${userQuestion}"`);
      return {
        answer: `### 1. Findings & Answer
I understand what you're trying to achieve. However, this operation modifies the database. For safety reasons, direct data modification is currently disabled in this environment.

### 2. Technical Reasoning & Underlying Causes
Allowing direct data modification via automated channels poses risk to database consistency, foreign key constraints, and transactional integrity.

### 3. Recommended Next Investigation
I can assist you safely by:
- Previewing the affected data rows using a read-only \`SELECT\` query
- Generating the exact \`INSERT\` / \`UPDATE\` / \`DELETE\` SQL script for your manual review
- Estimating the number of affected records and evaluating constraint impact

### 4. Guided Follow-Up Questions
Would you like me to inspect the affected data rows first? Or shall I generate the SQL script for you to review?`,
        metadataSummary: 'Operation intercepted by safety policy (Read-only diagnostics active).',
        isRestrictedWrite: true
      };
    }

    // Retrieve Live Schema Metadata
    const metadata = await this.schemaContextService.getLiveMetadata();
    const schemaSummaryString = this.schemaContextService.buildSchemaSummaryString(metadata);

    // Determine if Live SQL Query is required for data/metrics/RCA
    let executedSql: string | undefined = undefined;
    let queryRows: any[] = [];
    let queryRowCount = 0;

    const requiresLiveData = this.detectLiveDataRequirement(userQuestion);
    if (requiresLiveData && metadata.totalTables > 0) {
      console.log(`[RCA Pipeline] Live data requirement detected. Generating read-only diagnostic SQL for: "${userQuestion}"`);
      try {
        const geminiService = new GeminiService(this.geminiApiKey, this.promptService);
        const sqlPrompt = `Target Database: PostgreSQL
Live Schema Summary:
${schemaSummaryString}

Generate a single, read-only PostgreSQL SELECT query with LIMIT 50 to answer or inspect the data for this user question: "${userQuestion}"
Respond ONLY with a JSON object: {"sql": "SELECT ...", "explanation": "..."}`;

        const rawSqlGen = await geminiService.generateDirect(sqlPrompt, false);
        const jsonMatch = rawSqlGen.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.sql && typeof parsed.sql === 'string') {
            const candidateSql = parsed.sql.trim();
            const validation = UserQueryValidator.validate(candidateSql);
            if (validation.isValid) {
              console.log(`[RCA Pipeline] Executing live diagnostic query: ${candidateSql}`);
              const dbResult = await this.dbService.execute(candidateSql);
              executedSql = candidateSql;
              queryRows = dbResult.rows || [];
              queryRowCount = dbResult.rowCount || 0;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[RCA Pipeline] Diagnostic SQL execution skipped:`, err.message);
      }
    }

    // Compile Prompt Context from Markdown Guidebooks
    const docPrompt = this.promptService.getPrompt(PromptType.DOCUMENTATION);
    const schemaPrompt = this.promptService.getPrompt(PromptType.SCHEMA_CONTEXT);
    const backendPrompt = this.promptService.getPrompt(PromptType.BACKEND_PROMPT);
    const frontendPrompt = this.promptService.getPrompt(PromptType.FRONTEND_PROMPT);

    // Combine Conversation Memory History
    let historyContext = '';
    if (history.length > 0) {
      historyContext = `Prior Investigation Memory:\n` +
        history.slice(-6).map((h) => `${h.role.toUpperCase()}: ${h.content}`).join('\n') + '\n\n';
    }

    // Build Execution Results Context
    let sqlResultContext = 'No live SQL query was executed for this step.\n';
    if (executedSql) {
      sqlResultContext = `Executed Live SQL Query: ${executedSql}\nReturned ${queryRowCount} rows:\n` +
        JSON.stringify(queryRows.slice(0, 10), null, 2) + '\n\n';
    }

    // Final Prompt for Gemini RCA Synthesis
    const combinedSystemPrompt = `${docPrompt}\n\n${schemaPrompt}\n\n${backendPrompt}\n\n${frontendPrompt}`;
    const fullUserPrompt = `${combinedSystemPrompt}

==========================================================
LIVE DATABASE CONTEXT
==========================================================
${schemaSummaryString}

${sqlResultContext}${historyContext}Developer Question: "${userQuestion}"

Synthesize a helpful, patient Senior Database Architect response following the strict 4-part structure (1. Findings & Answer, 2. Technical Reasoning & Underlying Causes, 3. Recommended Next Investigation, 4. Guided Follow-Up Questions).`;

    console.log(`[RCA Pipeline] Sending grounded prompt context (${fullUserPrompt.length} chars) to Gemini...`);
    const geminiService = new GeminiService(this.geminiApiKey, this.promptService);
    const rcaAnswer = await geminiService.generateDirect(fullUserPrompt, false, logger);

    const endTime = performance.now();
    console.log(`[RCA Pipeline] Completed RCA response synthesis in ${(endTime - startTime).toFixed(2)} ms`);

    return {
      answer: rcaAnswer,
      sql: executedSql,
      rows: queryRows,
      rowCount: queryRowCount,
      metadataSummary: `Answer grounded in live PostgreSQL schema (${metadata.totalTables} tables, ${metadata.totalRelationships} foreign key links).`
    };
  }

  /**
   * Detects if user prompt contains restricted DML/DDL write keywords.
   */
  private detectWriteOperation(question: string): boolean {
    const q = question.toUpperCase();
    const writeKeywords = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE TABLE', 'GRANT', 'REVOKE', 'VACUUM', 'REINDEX'];
    return writeKeywords.some((kw) => q.includes(kw));
  }

  /**
   * Detects if user prompt requires live data / row counts / RCA metrics execution.
   */
  private detectLiveDataRequirement(question: string): boolean {
    const q = question.toLowerCase();
    const liveDataKeywords = [
      'how many', 'count', 'top', 'recent', 'maximum', 'minimum', 'average', 'latest',
      'why is', 'slow', 'performance', 'transactions', 'orders', 'users', 'balance',
      'stats', 'rows', 'data', 'inspect', 'compare', 'records', 'largest'
    ];
    return liveDataKeywords.some((kw) => q.includes(kw));
  }
}
