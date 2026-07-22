import { DatabaseService } from './database.service';
import { PromptService, PromptType } from './PromptService';
import { GeminiService } from './GeminiService';

export interface DetailedSchemaMetadata {
  tables: Array<{
    tableName: string;
    columns: Array<{
      columnName: string;
      dataType: string;
      isNullable: boolean;
      isPrimaryKey: boolean;
      isForeignKey: boolean;
      foreignKeyRef?: { table: string; column: string };
    }>;
    estimatedRows: number;
  }>;
  relationships: Array<{
    sourceTable: string;
    sourceColumn: string;
    targetTable: string;
    targetColumn: string;
    constraintName: string;
  }>;
  indexes: Array<{
    tableName: string;
    indexName: string;
    indexDef: string;
  }>;
  views: Array<{
    viewName: string;
    definition?: string;
  }>;
  routines: Array<{
    routineName: string;
    routineType: 'FUNCTION' | 'PROCEDURE';
    returnType: string;
  }>;
  triggers: Array<{
    triggerName: string;
    tableName: string;
    eventManipulation: string;
    actionTiming: string;
  }>;
  constraints: Array<{
    constraintName: string;
    tableName: string;
    constraintType: string;
  }>;
  sequences: Array<{
    sequenceName: string;
    dataType: string;
  }>;
  enums: Array<{
    enumName: string;
    enumValues: string[];
  }>;
  totalTables: number;
  totalRelationships: number;
  totalIndexes: number;
  totalViews: number;
  totalRoutines: number;
  totalRows: number;
}

export class SchemaContextService {
  private static cache: {
    metadata: DetailedSchemaMetadata;
    summary: string;
    timestamp: number;
  } | null = null;

  // Cache Time-To-Live in milliseconds (45 seconds)
  private static CACHE_TTL_MS = 45000;

  constructor(private dbService: DatabaseService) {}

  /**
   * Explicitly invalidates cached metadata when database schema is created or altered.
   */
  public static invalidateCache(): void {
    console.log('[SchemaContextService] Invalidation triggered. Clearing metadata cache.');
    SchemaContextService.cache = null;
  }

  /**
   * Dynamically fetches complete PostgreSQL database metadata (or returns cached version).
   */
  public async getLiveMetadata(): Promise<DetailedSchemaMetadata> {
    const now = Date.now();
    if (
      SchemaContextService.cache &&
      now - SchemaContextService.cache.timestamp < SchemaContextService.CACHE_TTL_MS
    ) {
      console.log('[SchemaContextService] Returning cached live schema metadata.');
      return SchemaContextService.cache.metadata;
    }

    console.log('[SchemaContextService] Cache miss/expired. Querying PostgreSQL system catalogs...');

    // 1. Columns & Tables Query
    const columnsQuery = `
      SELECT 
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        (
          SELECT EXISTS (
            SELECT 1 
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_name = c.table_name
              AND kcu.column_name = c.column_name
          )
        ) AS is_primary_key
      FROM information_schema.columns c
      JOIN information_schema.tables t 
        ON t.table_name = c.table_name 
        AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position;
    `;

    // 2. Foreign Key Relationships Query
    const relationsQuery = `
      SELECT
        tc.constraint_name,
        tc.table_name AS source_table, 
        kcu.column_name AS source_column, 
        ccu.table_name AS target_table,
        ccu.column_name AS target_column 
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_schema = 'public';
    `;

    // 3. Indexes Query
    const indexesQuery = `
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public';
    `;

    // 4. Views Query
    const viewsQuery = `
      SELECT table_name AS view_name, view_definition
      FROM information_schema.views
      WHERE table_schema = 'public';
    `;

    // 5. Routines Query (Functions & Procedures)
    const routinesQuery = `
      SELECT routine_name, routine_type, data_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name NOT LIKE 'pg_%';
    `;

    // 6. Triggers Query
    const triggersQuery = `
      SELECT trigger_name, event_object_table AS table_name, event_manipulation, action_timing
      FROM information_schema.triggers
      WHERE trigger_schema = 'public';
    `;

    // 7. Constraints Query
    const constraintsQuery = `
      SELECT constraint_name, table_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = 'public';
    `;

    // 8. Sequences Query
    const sequencesQuery = `
      SELECT sequence_name, data_type
      FROM information_schema.sequences
      WHERE sequence_schema = 'public';
    `;

    // 9. Enums Query
    const enumsQuery = `
      SELECT t.typname AS enum_name, e.enumlabel AS enum_value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY enum_name, e.enumsortorder;
    `;

    // 10. Estimated Row Counts
    const rowCountsQuery = `
      SELECT c.relname AS table_name, COALESCE(GREATEST(c.reltuples, 0), 0) AS estimated_rows
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r';
    `;

    try {
      const [
        columnsRes,
        relationsRes,
        indexesRes,
        viewsRes,
        routinesRes,
        triggersRes,
        constraintsRes,
        sequencesRes,
        enumsRes,
        rowCountsRes
      ] = await Promise.all([
        this.dbService.execute(columnsQuery).catch((e: any) => { console.error('[SchemaContextService] columnsQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(relationsQuery).catch((e: any) => { console.error('[SchemaContextService] relationsQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(indexesQuery).catch((e: any) => { console.error('[SchemaContextService] indexesQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(viewsQuery).catch((e: any) => { console.error('[SchemaContextService] viewsQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(routinesQuery).catch((e: any) => { console.error('[SchemaContextService] routinesQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(triggersQuery).catch((e: any) => { console.error('[SchemaContextService] triggersQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(constraintsQuery).catch((e: any) => { console.error('[SchemaContextService] constraintsQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(sequencesQuery).catch((e: any) => { console.error('[SchemaContextService] sequencesQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(enumsQuery).catch((e: any) => { console.error('[SchemaContextService] enumsQuery failed', e); return { rows: [], rowCount: 0 }; }),
        this.dbService.execute(rowCountsQuery).catch((e: any) => { console.error('[SchemaContextService] rowCountsQuery failed', e); return { rows: [], rowCount: 0 }; })
      ]);

      // Process FK Map
      const fkMap: Record<string, { table: string; column: string }> = {};
      const relationships = relationsRes.rows.map((r: any) => {
        fkMap[`${r.source_table}.${r.source_column}`] = {
          table: r.target_table,
          column: r.target_column
        };
        return {
          sourceTable: r.source_table,
          sourceColumn: r.source_column,
          targetTable: r.target_table,
          targetColumn: r.target_column,
          constraintName: r.constraint_name
        };
      });

      // Process Row Counts Map
      const rowCountsMap: Record<string, number> = {};
      for (const r of rowCountsRes.rows) {
        rowCountsMap[r.table_name] = Math.round(Number(r.estimated_rows));
      }

      // Group Columns by Table
      const tablesMap: Record<string, any[]> = {};
      for (const r of columnsRes.rows) {
        if (!tablesMap[r.table_name]) {
          tablesMap[r.table_name] = [];
        }
        const foreignKeyRef = fkMap[`${r.table_name}.${r.column_name}`];
        tablesMap[r.table_name].push({
          columnName: r.column_name,
          dataType: String(r.data_type).toLowerCase(),
          isNullable: r.is_nullable === 'YES',
          isPrimaryKey: !!r.is_primary_key,
          isForeignKey: !!foreignKeyRef,
          foreignKeyRef
        });
      }

      const tables = Object.entries(tablesMap).map(([tableName, columns]) => ({
        tableName,
        columns,
        estimatedRows: rowCountsMap[tableName] || 0
      }));

      // Process Enums Grouping
      const enumMap: Record<string, string[]> = {};
      for (const r of enumsRes.rows) {
        if (!enumMap[r.enum_name]) enumMap[r.enum_name] = [];
        enumMap[r.enum_name].push(r.enum_value);
      }
      const enums = Object.entries(enumMap).map(([enumName, enumValues]) => ({
        enumName,
        enumValues
      }));

      const metadata: DetailedSchemaMetadata = {
        tables,
        relationships,
        indexes: indexesRes.rows.map((r: any) => ({
          tableName: r.tablename,
          indexName: r.indexname,
          indexDef: r.indexdef
        })),
        views: viewsRes.rows.map((r: any) => ({
          viewName: r.view_name,
          definition: r.view_definition
        })),
        routines: routinesRes.rows.map((r: any) => ({
          routineName: r.routine_name,
          routineType: String(r.routine_type).toUpperCase() as 'FUNCTION' | 'PROCEDURE',
          returnType: r.data_type || 'void'
        })),
        triggers: triggersRes.rows.map((r: any) => ({
          triggerName: r.trigger_name,
          tableName: r.table_name,
          eventManipulation: r.event_manipulation,
          actionTiming: r.action_timing
        })),
        constraints: constraintsRes.rows.map((r: any) => ({
          constraintName: r.constraint_name,
          tableName: r.table_name,
          constraintType: r.constraint_type
        })),
        sequences: sequencesRes.rows.map((r: any) => ({
          sequenceName: r.sequence_name,
          dataType: r.data_type
        })),
        enums,
        totalTables: tables.length,
        totalRelationships: relationships.length,
        totalIndexes: indexesRes.rows.length,
        totalViews: viewsRes.rows.length,
        totalRoutines: routinesRes.rows.length,
        totalRows: Object.values(rowCountsMap).reduce((a, b) => a + b, 0)
      };

      const summary = this.buildSchemaSummaryString(metadata);

      // Cache result
      SchemaContextService.cache = {
        metadata,
        summary,
        timestamp: Date.now()
      };

      return metadata;
    } catch (err: any) {
      console.error('[SchemaContextService] Failed to build live schema metadata:', err);
      throw err;
    }
  }

  /**
   * Formats structured metadata into a clear, comprehensive Markdown schema summary for Gemini.
   */
  public buildSchemaSummaryString(meta: DetailedSchemaMetadata): string {
    if (meta.totalTables === 0) {
      return 'NO USER TABLES EXIST IN THE CURRENT DATABASE ENVIRONMENT.';
    }

    let summary = `### DATABASE TABLES & COLUMNS (${meta.totalTables} Tables Total)\n\n`;
    for (const t of meta.tables) {
      summary += `Table: "${t.tableName}" (${t.columns.length} columns, ~${t.estimatedRows} rows)\n`;
      summary += t.columns.map(c => {
        let details = `${c.columnName} [${c.dataType}]`;
        if (c.isPrimaryKey) details += ' (PRIMARY KEY)';
        if (c.isForeignKey && c.foreignKeyRef) {
          details += ` (FOREIGN KEY -> ${c.foreignKeyRef.table}.${c.foreignKeyRef.column})`;
        }
        if (!c.isNullable) details += ' NOT NULL';
        return `  - ${details}`;
      }).join('\n');
      summary += '\n\n';
    }

    if (meta.relationships.length > 0) {
      summary += `### FOREIGN KEY RELATIONSHIPS (${meta.totalRelationships} Total)\n\n`;
      summary += meta.relationships.map(r => 
        `  - ${r.sourceTable} (${r.sourceColumn}) ---> ${r.targetTable} (${r.targetColumn}) [Constraint: ${r.constraintName}]`
      ).join('\n');
      summary += '\n\n';
    }

    if (meta.indexes.length > 0) {
      summary += `### INDEXES (${meta.totalIndexes} Total)\n\n`;
      summary += meta.indexes.map(i => `  - Index "${i.indexName}" on Table "${i.tableName}": ${i.indexDef}`).join('\n');
      summary += '\n\n';
    }

    if (meta.views.length > 0) {
      summary += `### VIEWS (${meta.totalViews} Total)\n\n`;
      summary += meta.views.map(v => `  - View "${v.viewName}"`).join('\n');
      summary += '\n\n';
    }

    if (meta.routines.length > 0) {
      summary += `### STORED PROCEDURES & FUNCTIONS (${meta.totalRoutines} Total)\n\n`;
      summary += meta.routines.map(r => `  - ${r.routineType} "${r.routineName}" (Returns: ${r.returnType})`).join('\n');
      summary += '\n\n';
    }

    if (meta.triggers.length > 0) {
      summary += `### TRIGGERS (${meta.triggers.length} Total)\n\n`;
      summary += meta.triggers.map(tr => `  - Trigger "${tr.triggerName}" on Table "${tr.tableName}" (${tr.actionTiming} ${tr.eventManipulation})`).join('\n');
      summary += '\n\n';
    }

    if (meta.constraints.length > 0) {
      summary += `### CONSTRAINTS (${meta.constraints.length} Total)\n\n`;
      summary += meta.constraints.map(cs => `  - Constraint "${cs.constraintName}" on Table "${cs.tableName}" [Type: ${cs.constraintType}]`).join('\n');
      summary += '\n\n';
    }

    if (meta.enums.length > 0) {
      summary += `### ENUMS (${meta.enums.length} Total)\n\n`;
      summary += meta.enums.map(e => `  - Enum "${e.enumName}": [${e.enumValues.join(', ')}]`).join('\n');
      summary += '\n\n';
    }

    return summary.trim();
  }

  /**
   * Constructs the complete, grounded prompt payload for Gemini.
   */
  public async buildFullPromptContext(
    userQuestion: string,
    conversationHistory: any[] = []
  ): Promise<{ prompt: string; schemaSummary: string; metadata: DetailedSchemaMetadata }> {
    const metadata = await this.getLiveMetadata();
    const schemaSummary = SchemaContextService.cache
      ? SchemaContextService.cache.summary
      : this.buildSchemaSummaryString(metadata);

    const promptService = new PromptService();
    const groundingRules = promptService.getPrompt(PromptType.SCHEMA_CONTEXT);

    let historyContext = '';
    if (conversationHistory && conversationHistory.length > 0) {
      historyContext = '\n### CONVERSATION HISTORY\n' + conversationHistory.map(msg => 
        `${msg.sender === 'user' ? 'User' : 'Assistant'}: ${msg.text || msg.content || ''}`
      ).join('\n') + '\n\n';
    }

    const fullPrompt = `${groundingRules}

${historyContext}### CURRENT LIVE DATABASE SCHEMA METADATA
${schemaSummary}

---

USER QUESTION:
${userQuestion}
`;

    return {
      prompt: fullPrompt,
      schemaSummary,
      metadata
    };
  }
}
