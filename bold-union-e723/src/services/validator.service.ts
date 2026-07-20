import { Token, SQLValidationResult } from '../models/types';

/**
 * Tokenizes a SQL string into typed tokens, keeping track of strings, comments, and keywords.
 * This is a secure scanner that prevents keyword spoofing inside comments or string literals.
 */
export function tokenizeSQL(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    // 1. Single-line comment: --
    if (char === '-' && nextChar === '-') {
      const start = i;
      i += 2;
      while (i < len && sql[i] !== '\n') {
        i++;
      }
      tokens.push({ type: 'comment', value: sql.substring(start, i) });
      continue;
    }

    // 2. Multi-line comment: /* ... */
    if (char === '/' && nextChar === '*') {
      const start = i;
      i += 2;
      while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      if (i < len) {
        i += 2; // skip */
      }
      tokens.push({ type: 'comment', value: sql.substring(start, i) });
      continue;
    }

    // 3. String literals (single quotes): '...'
    if (char === "'") {
      const start = i;
      i++; // skip opening '
      while (i < len) {
        if (sql[i] === "'") {
          // Check for escaped single quote in SQL style (two consecutive single quotes)
          if (sql[i + 1] === "'") {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      tokens.push({ type: 'string', value: sql.substring(start, i) });
      continue;
    }

    // 4. Double-quoted identifiers: "..."
    if (char === '"') {
      const start = i;
      i++; // skip opening "
      while (i < len) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          i++;
        }
      }
      tokens.push({ type: 'identifier', value: sql.substring(start, i) });
      continue;
    }

    // 5. Dollar-quoted strings: $$...$$ or $tag$...$tag$
    if (char === '$') {
      const start = i;
      let tagEnd = i + 1;
      while (tagEnd < len && sql[tagEnd] !== '$') {
        tagEnd++;
      }
      if (tagEnd < len && sql[tagEnd] === '$') {
        const tag = sql.substring(start, tagEnd + 1); // e.g. $$ or $body$
        i = tagEnd + 1;
        const matchIndex = sql.indexOf(tag, i);
        if (matchIndex !== -1) {
          i = matchIndex + tag.length;
          tokens.push({ type: 'string', value: sql.substring(start, i) });
          continue;
        }
      }
    }

    // 6. Whitespace (skip but acts as token separator)
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // 7. Words (keywords and unquoted identifiers)
    if (/[a-zA-Z_]/.test(char)) {
      const start = i;
      i++;
      while (i < len && /[a-zA-Z0-9_$]/.test(sql[i])) {
        i++;
      }
      const val = sql.substring(start, i);
      tokens.push({ type: 'keyword', value: val });
      continue;
    }

    // 8. Punctuation/Operators (e.g., ;, ,, (, ), etc.)
    tokens.push({ type: 'punctuation', value: char });
    i++;
  }

  return tokens;
}

/**
 * Splits a list of tokens into individual statements by separating on semicolon.
 * Skips comments completely.
 */
export function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [];
  let currentStatement: Token[] = [];

  for (const token of tokens) {
    if (token.type === 'comment') {
      continue;
    }

    if (token.type === 'punctuation' && token.value === ';') {
      if (currentStatement.length > 0) {
        statements.push(currentStatement);
        currentStatement = [];
      }
    } else {
      currentStatement.push(token);
    }
  }

  if (currentStatement.length > 0) {
    statements.push(currentStatement);
  }

  return statements;
}

export class SchemaSQLValidator {
  /**
   * Validates SQL statement(s) for the Admin Schema endpoint.
   * Rules:
   * - Must begin with CREATE or ALTER.
   * - Only allows creating/altering: TABLE, INDEX, SEQUENCE, VIEW.
   * - Strictly blocks drop/delete/update/insert/grant/revoke/truncate/copy/merge commands.
   */
  public static validate(sql: string): SQLValidationResult {
    if (!sql || sql.trim().length === 0) {
      return { isValid: false, reason: 'SQL input cannot be empty' };
    }

    try {
      const tokens = tokenizeSQL(sql);
      const statements = splitStatements(tokens);

      if (statements.length === 0) {
        return { isValid: false, reason: 'No valid SQL statements found' };
      }

      const allowedFirstKeywords = new Set(['CREATE', 'ALTER']);
      const allowedCreateTargets = new Set(['TABLE', 'INDEX', 'SEQUENCE', 'VIEW', 'OR']); // OR is allowed for "CREATE OR REPLACE VIEW"
      const allowedAlterTargets = new Set(['TABLE', 'INDEX', 'SEQUENCE', 'VIEW']);

      const forbiddenKeywords = new Set([
        'DROP',
        'TRUNCATE',
        'DELETE',
        'UPDATE',
        'INSERT',
        'GRANT',
        'REVOKE',
        'COPY',
        'MERGE'
      ]);

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt.length === 0) continue;

        // Check first keyword
        const firstToken = stmt[0];
        if (firstToken.type !== 'keyword') {
          return {
            isValid: false,
            reason: `Statement #${i + 1} must begin with an allowed SQL keyword (CREATE or ALTER)`
          };
        }

        const firstKeyword = firstToken.value.toUpperCase();
        if (!allowedFirstKeywords.has(firstKeyword)) {
          return {
            isValid: false,
            reason: `Forbidden operation in statement #${i + 1}: '${firstKeyword}'. Only CREATE and ALTER statements are allowed.`
          };
        }

        // Validate targets for CREATE or ALTER
        if (stmt.length < 2) {
          return {
            isValid: false,
            reason: `Incomplete SQL command in statement #${i + 1}`
          };
        }

        const secondToken = stmt[1];
        if (secondToken.type !== 'keyword') {
          return {
            isValid: false,
            reason: `Invalid syntax in statement #${i + 1}: expected target identifier after ${firstKeyword}`
          };
        }

        const secondKeyword = secondToken.value.toUpperCase();

        if (firstKeyword === 'CREATE') {
          if (!allowedCreateTargets.has(secondKeyword)) {
            return {
              isValid: false,
              reason: `Forbidden CREATE target: '${secondKeyword}' in statement #${i + 1}. Only TABLE, INDEX, SEQUENCE, and VIEW are allowed.`
            };
          }
          // Extra check for CREATE OR REPLACE VIEW
          if (secondKeyword === 'OR') {
            if (stmt.length < 4 || 
                stmt[2].value.toUpperCase() !== 'REPLACE' || 
                stmt[3].value.toUpperCase() !== 'VIEW') {
              return {
                isValid: false,
                reason: `Forbidden CREATE target in statement #${i + 1}. Expected 'CREATE OR REPLACE VIEW'.`
              };
            }
          }
        } else if (firstKeyword === 'ALTER') {
          if (!allowedAlterTargets.has(secondKeyword)) {
            return {
              isValid: false,
              reason: `Forbidden ALTER target: '${secondKeyword}' in statement #${i + 1}. Only TABLE, INDEX, SEQUENCE, and VIEW can be altered.`
            };
          }
        }

        // Scan all keywords in this statement for absolute blocklist (e.g. DROP, DELETE)
        for (const token of stmt) {
          if (token.type === 'keyword') {
            const kw = token.value.toUpperCase();
            if (forbiddenKeywords.has(kw)) {
              return {
                isValid: false,
                reason: `Forbidden keyword '${kw}' detected in statement #${i + 1}`
              };
            }
          }
        }
      }

      return { isValid: true };
    } catch (error: any) {
      return {
        isValid: false,
        reason: `SQL parsing error: ${error.message || error}`
      };
    }
  }
}

export class DataSQLValidator {
  /**
   * Validates SQL statement(s) for the Admin Data Initialization endpoint.
   * Rules:
   * - Must begin with INSERT, UPDATE, or DELETE.
   * - Strictly blocks schema changes (CREATE, ALTER, DROP, TRUNCATE) and administrative controls (GRANT, REVOKE).
   */
  public static validate(sql: string): SQLValidationResult {
    if (!sql || sql.trim().length === 0) {
      return { isValid: false, reason: 'SQL input cannot be empty' };
    }

    try {
      const tokens = tokenizeSQL(sql);
      const statements = splitStatements(tokens);

      if (statements.length === 0) {
        return { isValid: false, reason: 'No valid SQL statements found' };
      }

      const allowedFirstKeywords = new Set(['INSERT', 'UPDATE', 'DELETE']);
      const forbiddenKeywords = new Set([
        'CREATE',
        'ALTER',
        'DROP',
        'TRUNCATE',
        'GRANT',
        'REVOKE',
        'COPY',
        'MERGE',
        'REPLACE',
        'RENAME'
      ]);

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt.length === 0) continue;

        // Check first keyword
        const firstToken = stmt[0];
        if (firstToken.type !== 'keyword') {
          return {
            isValid: false,
            reason: `Statement #${i + 1} must begin with an allowed SQL keyword (INSERT, UPDATE, or DELETE)`
          };
        }

        const firstKeyword = firstToken.value.toUpperCase();
        if (!allowedFirstKeywords.has(firstKeyword)) {
          return {
            isValid: false,
            reason: `Forbidden operation in statement #${i + 1}: '${firstKeyword}'. Only INSERT, UPDATE, and DELETE statements are allowed.`
          };
        }

        // Scan all keywords in this statement to block forbidden ones
        for (const token of stmt) {
          if (token.type === 'keyword') {
            const kw = token.value.toUpperCase();
            if (forbiddenKeywords.has(kw)) {
              return {
                isValid: false,
                reason: `Forbidden keyword '${kw}' detected in statement #${i + 1}`
              };
            }
          }
        }
      }

      return { isValid: true };
    } catch (error: any) {
      return {
        isValid: false,
        reason: `SQL parsing error: ${error.message || error}`
      };
    }
  }
}

export class UserQueryValidator {
  /**
   * Validates SQL statement(s) for the User Query endpoint.
   * Rules:
   * - Must ONLY contain SELECT or WITH statements.
   * - Prohibits INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE, etc.
   */
  public static validate(sql: string): SQLValidationResult {
    if (!sql || sql.trim().length === 0) {
      return { isValid: false, reason: 'SQL input cannot be empty' };
    }

    try {
      const tokens = tokenizeSQL(sql);
      const statements = splitStatements(tokens);

      if (statements.length === 0) {
        return { isValid: false, reason: 'No valid SQL statements found' };
      }

      // Forbidden keywords for user queries
      const forbiddenKeywords = new Set([
        'INSERT',
        'UPDATE',
        'DELETE',
        'DROP',
        'ALTER',
        'TRUNCATE',
        'CREATE',
        'REPLACE',
        'RENAME',
        'GRANT',
        'REVOKE',
        'INTO',
        'COPY',
        'MERGE'
      ]);

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt.length === 0) continue;

        // Check first token of statement
        const firstToken = stmt[0];
        if (firstToken.type !== 'keyword') {
          return {
            isValid: false,
            reason: `Statement #${i + 1} must begin with an allowed SQL keyword (SELECT or WITH)`
          };
        }

        const firstKeyword = firstToken.value.toUpperCase();
        if (firstKeyword !== 'SELECT' && firstKeyword !== 'WITH') {
          return {
            isValid: false,
            reason: `Forbidden operation in statement #${i + 1}: '${firstKeyword}'. Only SELECT queries are allowed.`
          };
        }

        // Scan all keywords in this statement to block forbidden ones
        for (const token of stmt) {
          if (token.type === 'keyword') {
            const kw = token.value.toUpperCase();
            if (forbiddenKeywords.has(kw)) {
              return {
                isValid: false,
                reason: `Forbidden keyword '${kw}' detected in statement #${i + 1}`
              };
            }
          }
        }
      }

      return { isValid: true };
    } catch (error: any) {
      return {
        isValid: false,
        reason: `SQL parsing error: ${error.message || error}`
      };
    }
  }
}

/**
 * @deprecated Use SchemaSQLValidator, DataSQLValidator, or UserQueryValidator directly.
 */
export class ValidatorService {
  public static validateUserSQL(sql: string): SQLValidationResult {
    return UserQueryValidator.validate(sql);
  }

  public static validateAdminSQL(sql: string): SQLValidationResult {
    return SchemaSQLValidator.validate(sql);
  }
}
