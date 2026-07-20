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
}
