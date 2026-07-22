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

    // Build Concise Memory & Context for High Speed (< 1.5s)
    let historyContext = '';
    if (history && Array.isArray(history) && history.length > 0) {
      historyContext = `Prior Memory:\n` +
        history.slice(-3).map((h: any) => {
          const role = String(h?.role || h?.sender || 'USER').toUpperCase();
          const content = String(h?.content || h?.text || h?.message || '').slice(0, 150);
          return `${role}: ${content}`;
        }).join('\n') + '\n\n';
    }

    let sqlResultContext = '';
    if (executedSql) {
      sqlResultContext = `Live SQL Executed: ${executedSql} (${queryRowCount} rows):\n` +
        JSON.stringify(queryRows.slice(0, 5)) + '\n\n';
    }

    // High-Speed Short & Presentable RCA System Prompt
    const conciseRcaPrompt = `You are a Senior Database RCA Architect. Keep responses SHORT, CRISP, AND HIGHLY PRESENTABLE. Avoid long walls of text.

FORMAT (Strict 4 Short Sections):
### 1. Findings & Answer
- 2 to 3 concise, bulleted key findings based directly on live DB data.

### 2. Technical Reasoning
- 1 to 2 sentence core PostgreSQL technical explanation (indexes, fanout, scan type, row counts).

### 3. Recommended Next Step
- 1 short, actionable diagnostic recommendation.

### 4. Guided Follow-Up Questions
- **[Option 1]** Short guided follow-up question
- **[Option 2]** Short guided follow-up question

RULES:
- Never ask the developer to run SQL manually.
- Use clean Markdown, bold metrics, and concise bullet points.`;

    const fullUserPrompt = `${conciseRcaPrompt}

==========================================================
LIVE DB SCHEMA & DATA
==========================================================
${schemaSummaryString.slice(0, 2500)}

${sqlResultContext}${historyContext}Developer Question: "${userQuestion}"`;

    let rcaAnswer = '';
    try {
      console.log(`[RCA Pipeline] Fast-path LLM synthesis (${fullUserPrompt.length} chars)...`);
      const geminiService = new GeminiService(this.geminiApiKey, this.promptService);
      rcaAnswer = await geminiService.generateDirect(fullUserPrompt, false, logger);
    } catch (geminiErr: any) {
      console.warn(`[RCA Pipeline] LLM fallback active (${geminiErr.message}). Outputting direct live schema findings...`);
      
      const tableListStr = metadata.tables.length > 0
        ? metadata.tables.map(t => `- **${t.tableName}** (${t.columns.length} columns, ~${t.estimatedRows} rows)`).join('\n')
        : 'No user tables found in public schema.';

      rcaAnswer = `### 1. Findings & Answer
Live PostgreSQL database tables currently present:

${tableListStr}

### 2. Technical Reasoning
Discovered directly from PostgreSQL system catalogs (\`information_schema\`). ${metadata.totalRelationships} FK relationships defined.

### 3. Recommended Next Step
Inspect column definitions or check row estimates for performance tuning.

### 4. Guided Follow-Up Questions
- **Inspect Column Details**: Would you like to review indexes and column types?
- **Scan Growth Trends**: Shall we inspect row distribution and table sizes?`;
    }

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
      'stats', 'rows', 'data', 'inspect', 'compare', 'records', 'largest', 'select',
      'table', 'tables', 'schema', 'list', 'show', 'imp', 'important', 'what are', 'give', 'exist'
    ];
    return liveDataKeywords.some((kw) => q.includes(kw));
  }
}
