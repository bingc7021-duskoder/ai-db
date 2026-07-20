import { neon } from '@neondatabase/serverless';
import { DatabaseQueryResult } from '../models/types';

export class DatabaseService {
  private sqlClient: any;

  constructor(databaseUrl: string) {
    // Initialize the Neon serverless HTTP client with fullResults: true
    // to get row count, fields, and other database execution metadata.
    this.sqlClient = neon(databaseUrl, { fullResults: true });
  }

  /**
   * Executes a validated SQL statement (query or DDL command) on Neon PostgreSQL.
   * No hardcoded queries are present here. Everything is passed dynamically.
   */
  public async execute(sql: string): Promise<DatabaseQueryResult> {
    try {
      // Execute the query
      const result = await this.sqlClient(sql);

      return {
        rows: result.rows || [],
        rowCount: typeof result.rowCount === 'number' ? result.rowCount : (result.rows ? result.rows.length : 0),
      };
    } catch (error: any) {
      // Log the detailed database error internally
      console.error('Database query execution failure:', error);
      
      // Propagate a clean message with DB-specific context to route handlers
      const dbErrorMessage = error.message || String(error);
      throw new Error(`Database Error: ${dbErrorMessage}`);
    }
  }
}
