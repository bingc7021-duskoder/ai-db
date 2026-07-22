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

        // helper: extract first balanced JSON object from free text
        const extractJsonObject = (text: string): string | null => {
          const start = text.indexOf('{');
          if (start === -1) return null;
          let depth = 0;
          for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth === 0) return text.slice(start, i + 1);
          }
          return null;
        };

        // helper: try to extract SQL using regex (SELECT ... LIMIT ...)
        const extractSqlCandidate = (text: string): string | null => {
          const re = /((SELECT|WITH) [\s\S]*?LIMIT\s*\d+)/i;
          const m = text.match(re);
          if (m && m[1]) return m[1].trim();
          // fallback: any SELECT ...; or SELECT ... end of string
          const re2 = /(SELECT[\s\S]*?);?$/i;
          const m2 = text.match(re2);
          if (m2 && m2[0] && m2[0].length > 10) return m2[0].trim();
          return null;
        };

        // Attempt up to 2 LLM passes to generate JSON-wrapped SQL
        let rawSqlGen: string | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const sqlPrompt = `Target Database: PostgreSQL\nLive Schema Summary:\n${schemaSummaryString}\n\nGenerate a single, read-only PostgreSQL SELECT query with LIMIT 50 to answer or inspect the data for this user question: "${userQuestion}"\nRespond ONLY with a JSON object like: {"sql": "SELECT ...", "explanation": "..."}. Output must be valid JSON.`;
          try {
            rawSqlGen = await geminiService.generateDirect(sqlPrompt, true);
            logger?.logGeminiResponse?.({ rawText: rawSqlGen, responseTimeMs: 0, candidateCount: 1, rawGeminiResponse: null });
          } catch (e) {
            logger?.logError?.(e, { phase: 'sql-gen', attempt });
            rawSqlGen = null;
          }

          if (!rawSqlGen) continue;

          // Try JSON extraction first
          const jsonStr = extractJsonObject(rawSqlGen);
          if (jsonStr) {
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.sql && typeof parsed.sql === 'string') {
                const candidateSql = parsed.sql.trim();
                const validation = UserQueryValidator.validate(candidateSql);
                if (validation.isValid) {
                  console.log(`[RCA Pipeline] Executing live diagnostic query: ${candidateSql}`);
                  const dbResult = await this.dbService.execute(candidateSql);
                  executedSql = candidateSql;
                  queryRows = dbResult.rows || [];
                  queryRowCount = dbResult.rowCount || 0;
                  break;
                } else {
                  logger?.logError?.(new Error('Validator rejected SQL'), { candidateSql, validation });
                }
              }
            } catch (parseErr) {
              logger?.logError?.(parseErr, { jsonStr });
            }
          }

          // If JSON extraction failed, attempt to extract SQL via regex
          const sqlCandidate = extractSqlCandidate(rawSqlGen);
          if (sqlCandidate) {
            const validation = UserQueryValidator.validate(sqlCandidate);
            if (validation.isValid) {
              try {
                console.log(`[RCA Pipeline] Executing regex-extracted SQL: ${sqlCandidate}`);
                const dbResult = await this.dbService.execute(sqlCandidate);
                executedSql = sqlCandidate;
                queryRows = dbResult.rows || [];
                queryRowCount = dbResult.rowCount || 0;
                break;
              } catch (e) {
                logger?.logError?.(e, { phase: 'execute-regex', sqlCandidate });
              }
            } else {
              logger?.logError?.(new Error('Validator rejected regex-extracted SQL'), { sqlCandidate, validation });
            }
          }
        }

        // If LLM did not produce an executable SQL, fall back to safe server-side generator
        if (!executedSql) {
          const safeSql = this.buildSafeFallbackSql(userQuestion, metadata);
          if (safeSql) {
            const validation = UserQueryValidator.validate(safeSql);
            if (validation.isValid) {
              try {
                console.log(`[RCA Pipeline] Executing server-side fallback SQL: ${safeSql}`);
                const dbResult = await this.dbService.execute(safeSql);
                executedSql = safeSql;
                queryRows = dbResult.rows || [];
                queryRowCount = dbResult.rowCount || 0;
              } catch (e) {
                logger?.logError?.(e, { phase: 'execute-fallback', safeSql });
              }
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
      console.warn(`[RCA Pipeline] LLM fallback active (${geminiErr.message}). Generating programmatic RCA response from live metadata.`);

      const qLower = userQuestion.toLowerCase();
      const matchedTableObj = metadata.tables.find((t: any) => {
        const name = (t.tableName || t.name || '').toString().toLowerCase();
        return name && qLower.includes(name);
      });

      let findings = `### 1. Findings & Answer\n`;

      if (matchedTableObj) {
        const tName = matchedTableObj.tableName;
        const cols = matchedTableObj.columns || [];
        const colSummary = cols.map((c: any) => {
          const name = c.columnName || c.name || '';
          const type = c.dataType || c.type || '';
          const pkTag = c.isPrimaryKey ? ' [PRIMARY KEY]' : '';
          const fkTag = c.isForeignKey ? ' [FOREIGN KEY]' : '';
          return `  - **\`${name}\`**: \`${type}\`${pkTag}${fkTag}`;
        }).join('\n');

        findings += `Detailed breakdown for table **\`${tName}\`** (${cols.length} columns, ~${matchedTableObj.estimatedRows || 0} rows):\n\n${colSummary}\n`;
      } else if (/\b(max|most|largest|highest|biggest|top)\b/.test(qLower) && /\b(row|rows|record|records|table|tables)\b/.test(qLower)) {
        const sortedTables = [...(metadata.tables || [])].sort((a, b) => (Number(b.estimatedRows || 0) - Number(a.estimatedRows || 0)));
        const topTable = sortedTables[0];
        if (topTable) {
          findings += `The table with the **maximum rows** in the database is **\`${topTable.tableName}\`** (~${topTable.estimatedRows || 0} rows).\n\nTop tables by row estimate:\n` +
            sortedTables.slice(0, 5).map(t => `- **\`${t.tableName}\`**: ~${t.estimatedRows || 0} rows`).join('\n') + '\n';
        } else {
          findings += `No user tables found in database schema.\n`;
        }
      } else {
        const tableListStr = (metadata.tables && metadata.tables.length > 0)
          ? metadata.tables.map((t: any) => {
              const tName = t.tableName || (t as any).name || t;
              const colCount = Array.isArray(t.columns) ? t.columns.length : 0;
              const estRows = (typeof t.estimatedRows !== 'undefined') ? t.estimatedRows : '0';
              return `- **${tName}** (${colCount} columns, ~${estRows} rows)`;
            }).join('\n')
          : 'No user tables found in public schema.';

        findings += `Live PostgreSQL database tables currently present:\n\n${tableListStr}\n`;
      }

      if (executedSql) {
        findings += `\nExecuted diagnostic SQL: \`${executedSql}\` returning ${queryRowCount} rows.\n`;
        if (queryRowCount && queryRowCount > 0) {
          try {
            findings += `\nSample rows (first ${Math.min(5, queryRows.length)}):\n\n` + '```json\n' + JSON.stringify(queryRows.slice(0, 5), null, 2) + '\n```\n';
          } catch (_) {
            findings += `\nSample rows not available for display.\n`;
          }
        } else {
          findings += `\n*(Table currently contains 0 records)*\n`;
        }
      }

      const reasoning = `\n### 2. Technical Reasoning\nDiscovered directly from PostgreSQL system catalogs (information_schema) and live diagnostics. ${metadata.totalRelationships || metadata.relationships?.length || 0} foreign-key relationships detected.`;

      const recommendation = `\n### 3. Recommended Next Step\nReview column definitions, check indexes, or run targeted \`INSERT\` mock data scripts to populate records for analysis.`;

      const guided = `\n### 4. Guided Follow-Up Questions\n- **Inspect Column Details**: Would you like to review indexes and column types for \`${matchedTableObj?.tableName || 'this table'}\`?\n- **Populate Sample Data**: Shall we generate sample mock records to test queries?`;

      rcaAnswer = `${findings}\n${reasoning}\n${recommendation}\n\n${guided}`;
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

  private buildSafeFallbackSql(question: string, metadata: { tables: Array<{ tableName: string }> }): string | null {
    const qLower = question.toLowerCase();
    const matchedTable = metadata.tables.find((t) => {
      const name = (t.tableName || '').toString().toLowerCase();
      return !!name && qLower.includes(name);
    });

    if (!matchedTable) {
      if (/\b(max|most|largest|highest|biggest|top)\b/.test(qLower) && /\b(row|rows|record|records|table|tables)\b/.test(qLower)) {
        return `SELECT relname AS table_name, n_live_tup AS row_count FROM pg_stat_user_tables ORDER BY n_live_tup DESC`;
      }
      return null;
    }

    const tableName = matchedTable.tableName;
    const quotedTable = `"${tableName}"`;

    if (/\b(count|how many|number of|total)\b/.test(qLower)) {
      return `SELECT COUNT(*) AS total_rows FROM ${quotedTable}`;
    }

    if (/\b(columns|schema|structure|fields|attributes|details)\b/.test(qLower)) {
      return `SELECT * FROM information_schema.columns WHERE table_name = '${tableName}' LIMIT 50`;
    }

    return `SELECT * FROM ${quotedTable} LIMIT 50`;
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
      'why is', 'slow', 'performance', 'transactions', 'orders', 'users', 'user', 'balance',
      'stats', 'rows', 'data', 'inspect', 'compare', 'records', 'largest', 'select',
      'table', 'tables', 'schema', 'list', 'show', 'imp', 'important', 'what are', 'give', 'exist',
      'name', 'who', 'admin', 'role', 'permission', 'find', 'which', 'details', 'where', 'get',
      'info', 'about'
    ];
    return liveDataKeywords.some((kw) => q.includes(kw));
  }
}
