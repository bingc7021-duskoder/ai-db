import { Pool } from '@neondatabase/serverless';
import { DatabaseQueryResult } from '../models/types';

/**
 * Custom Error class to wrap database exceptions.
 * Prevents internal details and stack traces from leaking to clients directly,
 * while preserving structure and original error metadata.
 */
export class DatabaseError extends Error {
  public code?: string;
  public detail?: string;
  public hint?: string;

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = 'DatabaseError';
    if (originalError) {
      this.code = originalError.code;
      this.detail = originalError.detail;
      this.hint = originalError.hint;
    }
    // Restore prototype chain
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class DatabaseService {
  // Re-use connection pool across request invocations in the same worker isolate
  private static pool: Pool | null = null;

  constructor(databaseUrl: string) {
    if (!DatabaseService.pool) {
      console.log('[DatabaseService] Initializing Neon connection pool...');
      DatabaseService.pool = new Pool({
        connectionString: databaseUrl,
      });
    }
  }

  /**
   * Executes a validated SQL statement (query or DDL command) on Neon PostgreSQL.
   */
  public async execute(sql: string, params?: any[]): Promise<DatabaseQueryResult> {
    if (!DatabaseService.pool) {
      throw new DatabaseError('Database connection pool is not initialized');
    }

    try {
      console.log(`[DatabaseService] Executing query: ${sql}`);
      const result = await DatabaseService.pool.query(sql, params);

      return {
        rows: result.rows || [],
        rowCount: typeof result.rowCount === 'number' ? result.rowCount : (result.rows ? result.rows.length : 0),
      };
    } catch (error: any) {
      console.error('[DatabaseService] Database query execution failure:', error);
      throw new DatabaseError(error.message || String(error), error);
    }
  }

  /**
   * Runs multiple queries inside an interactive transaction block.
   */
  public async runInTransaction<T>(
    callback: (client: { execute: (sql: string, params?: any[]) => Promise<DatabaseQueryResult> }) => Promise<T>
  ): Promise<T> {
    if (!DatabaseService.pool) {
      throw new DatabaseError('Database connection pool is not initialized');
    }

    const client = await DatabaseService.pool.connect();
    try {
      console.log('[DatabaseService] Beginning interactive transaction...');
      await client.query('BEGIN');

      const transactionClient = {
        execute: async (sql: string, params?: any[]) => {
          const result = await client.query(sql, params);
          return {
            rows: result.rows || [],
            rowCount: typeof result.rowCount === 'number' ? result.rowCount : (result.rows ? result.rows.length : 0),
          };
        }
      };

      const result = await callback(transactionClient);
      await client.query('COMMIT');
      console.log('[DatabaseService] Interactive transaction committed successfully.');
      return result;
    } catch (error: any) {
      console.warn('[DatabaseService] Interactive transaction failed, rolling back...', error);
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[DatabaseService] Rollback error:', rollbackError);
      }
      throw new DatabaseError(error.message || String(error), error);
    } finally {
      client.release();
    }
  }

  /**
   * Fetches schema information for all user tables in the database,
   * including columns, foreign key relationships, indexes, and stored procedures/functions.
   */
  public async getSchemaSummary(): Promise<string> {
    const columnsQuery = `
      SELECT 
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable
      FROM 
        information_schema.tables t
      JOIN 
        information_schema.columns c ON t.table_name = c.table_name
      WHERE 
        t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
      ORDER BY 
        t.table_name, c.ordinal_position;
    `;

    const relationsQuery = `
      SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM 
        information_schema.table_constraints AS tc 
      JOIN 
        information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN 
        information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE 
        tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_schema = 'public';
    `;

    const indexesQuery = `
      SELECT
        tablename,
        indexname,
        indexdef
      FROM
        pg_indexes
      WHERE
        schemaname = 'public';
    `;

    const routinesQuery = `
      SELECT 
        routine_name,
        routine_type,
        data_type
      FROM 
        information_schema.routines
      WHERE 
        routine_schema = 'public';
    `;

    try {
      const [columnsResult, relationsResult, indexesResult, routinesResult] = await Promise.all([
        this.execute(columnsQuery).catch(() => ({ rows: [], rowCount: 0 })),
        this.execute(relationsQuery).catch(() => ({ rows: [], rowCount: 0 })),
        this.execute(indexesQuery).catch(() => ({ rows: [], rowCount: 0 })),
        this.execute(routinesQuery).catch(() => ({ rows: [], rowCount: 0 }))
      ]);

      if (columnsResult.rows.length === 0) {
        return 'No user tables found in the database.';
      }

      // Group columns by table
      const tablesMap: Record<string, string[]> = {};
      for (const row of columnsResult.rows) {
        const { table_name, column_name, data_type, is_nullable } = row;
        if (!tablesMap[table_name]) {
          tablesMap[table_name] = [];
        }
        tablesMap[table_name].push(`${column_name} (${data_type}${is_nullable === 'YES' ? ', nullable' : ''})`);
      }

      let summary = '### TABLES AND COLUMNS\n\n';
      summary += Object.entries(tablesMap)
        .map(([tableName, columns]) => `Table "${tableName}":\n  - ${columns.join('\n  - ')}`)
        .join('\n\n');

      // Add Relationships
      if (relationsResult.rows.length > 0) {
        summary += '\n\n### FOREIGN KEY RELATIONSHIPS\n\n';
        summary += relationsResult.rows
          .map(row => `Table "${row.table_name}" (${row.column_name}) references Table "${row.foreign_table_name}" (${row.foreign_column_name})`)
          .join('\n');
      }

      // Add Indexes
      if (indexesResult.rows.length > 0) {
        summary += '\n\n### INDEXES\n\n';
        summary += indexesResult.rows
          .map(row => `Index "${row.indexname}" on Table "${row.tablename}": ${row.indexdef}`)
          .join('\n');
      }

      // Add Stored Functions & Procedures
      if (routinesResult.rows.length > 0) {
        summary += '\n\n### STORED FUNCTIONS AND PROCEDURES\n\n';
        summary += routinesResult.rows
          .map(row => `${row.routine_type.toUpperCase()} "${row.routine_name}" returns ${row.data_type}`)
          .join('\n');
      }

      return summary;
    } catch (error) {
      console.error('[DatabaseService] Failed to fetch schema summary:', error);
      return 'Error retrieving database schema.';
    }
  }

  /**
   * Returns structured schema information for the frontend (tables, columns, foreign keys, metadata).
   */
  public async getSchemaStructure(): Promise<{ tables: any[]; metadata: any }> {
    const columnsQuery = `
      SELECT 
        c.table_name,
        c.column_name,
        c.data_type,
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
      FROM 
        information_schema.columns c
      JOIN 
        information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE 
        c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND t.table_name != 'app_users'
      ORDER BY 
        c.table_name, c.ordinal_position;
    `;

    const relationsQuery = `
      SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM 
        information_schema.table_constraints AS tc 
      JOIN 
        information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN 
        information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE 
        tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_schema = 'public'
        AND tc.table_name != 'app_users'
        AND ccu.table_name != 'app_users';
    `;

    const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != 'app_users') AS table_count,
        (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename != 'app_users') AS index_count,
        (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'public') AS view_count,
        (SELECT COALESCE(SUM(reltuples), 0) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname != 'app_users') AS row_count;
    `;

    try {
      const [columnsResult, relationsResult, statsResult] = await Promise.all([
        this.execute(columnsQuery).catch(() => ({ rows: [], rowCount: 0 })),
        this.execute(relationsQuery).catch(() => ({ rows: [], rowCount: 0 })),
        this.execute(statsQuery).catch(() => ({ rows: [], rowCount: 0 }))
      ]);

      // Build relations map for fast lookup
      // Key: table_name.column_name
      const relationsMap: Record<string, { table: string; column: string }> = {};
      for (const rel of relationsResult.rows) {
        relationsMap[`${rel.table_name}.${rel.column_name}`] = {
          table: rel.foreign_table_name,
          column: rel.foreign_column_name
        };
      }

      // Group columns by table name
      const tablesMap: Record<string, any[]> = {};
      for (const row of columnsResult.rows) {
        const { table_name, column_name, data_type, is_primary_key } = row;
        if (!tablesMap[table_name]) {
          tablesMap[table_name] = [];
        }
        
        const foreignKeyRef = relationsMap[`${table_name}.${column_name}`];
        tablesMap[table_name].push({
          name: column_name,
          type: String(data_type).toUpperCase(),
          isPrimaryKey: !!is_primary_key,
          isForeignKey: !!foreignKeyRef,
          foreignKeyRef
        });
      }

      const tables = Object.entries(tablesMap).map(([name, columns]) => ({
        name,
        columns
      }));

      const stats = statsResult.rows[0] || { table_count: 0, index_count: 0, view_count: 0, row_count: 0 };
      const metadata = {
        tableCount: Number(stats.table_count),
        relationshipCount: relationsResult.rows.length,
        indexCount: Number(stats.index_count),
        viewCount: Number(stats.view_count),
        rowCount: Math.round(Number(stats.row_count)),
        summary: `Active database schema containing ${stats.table_count} tables and ${relationsResult.rows.length} relationships.`
      };

      return {
        tables,
        metadata
      };
    } catch (error) {
      console.error('[DatabaseService] Failed to retrieve structured schema:', error);
      return {
        tables: [],
        metadata: {
          tableCount: 0,
          relationshipCount: 0,
          indexCount: 0,
          viewCount: 0,
          rowCount: 0,
          summary: 'Failed to retrieve active database structure.'
        }
      };
    }
  }
}

