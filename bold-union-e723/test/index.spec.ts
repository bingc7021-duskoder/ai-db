import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index';
import { ValidatorService } from '../src/services/validator.service';

// Mock the `@neondatabase/serverless` module to prevent network calls
vi.mock('@neondatabase/serverless', () => {
  const mockQueryFn = vi.fn().mockImplementation(async (sql: string) => {
    if (sql.toUpperCase().includes('SELECT')) {
      return {
        rows: [{ id: 100, name: 'Alice', role: 'admin' }],
        rowCount: 1
      };
    }
    // Return empty results for CREATE/ALTER DDL commands
    return {
      rows: [],
      rowCount: 0
    };
  });

  return {
    neon: vi.fn().mockImplementation(() => mockQueryFn)
  };
});

describe('SQL Validator Service Unit Tests', () => {
  describe('User SQL Validator (validateUserSQL)', () => {
    it('should allow simple SELECT queries', () => {
      const res = ValidatorService.validateUserSQL('SELECT * FROM users;');
      expect(res.isValid).toBe(true);
    });

    it('should allow SELECT queries with comments', () => {
      const res = ValidatorService.validateUserSQL('SELECT id FROM customers; -- fetch only ids');
      expect(res.isValid).toBe(true);
    });

    it('should allow SELECT queries with CTEs', () => {
      const res = ValidatorService.validateUserSQL('WITH active_users AS (SELECT * FROM users WHERE active = true) SELECT * FROM active_users;');
      expect(res.isValid).toBe(true);
    });

    it('should reject INSERT queries', () => {
      const res = ValidatorService.validateUserSQL("INSERT INTO users (name) VALUES ('Bob');");
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject UPDATE queries', () => {
      const res = ValidatorService.validateUserSQL("UPDATE users SET name = 'Bob' WHERE id = 1;");
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject DELETE queries', () => {
      const res = ValidatorService.validateUserSQL('DELETE FROM users WHERE id = 1;');
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject nested modifications or combined queries', () => {
      const res1 = ValidatorService.validateUserSQL('SELECT * FROM users; DROP TABLE users;');
      expect(res1.isValid).toBe(false);

      const res2 = ValidatorService.validateUserSQL('SELECT * FROM users; INSERT INTO logs DEFAULT VALUES;');
      expect(res2.isValid).toBe(false);
    });

    it('should handle SQL keywords inside string literals safely without blocking', () => {
      const res = ValidatorService.validateUserSQL("SELECT * FROM messages WHERE content = 'Please delete this account';");
      expect(res.isValid).toBe(true);
    });
  });

  describe('Admin SQL Validator (validateAdminSQL)', () => {
    it('should allow valid CREATE TABLE statements', () => {
      const res = ValidatorService.validateAdminSQL('CREATE TABLE products (id INT, price NUMERIC);');
      expect(res.isValid).toBe(true);
    });

    it('should allow ALTER TABLE statements', () => {
      const res = ValidatorService.validateAdminSQL('ALTER TABLE products ADD COLUMN description TEXT;');
      expect(res.isValid).toBe(true);
    });

    it('should allow CREATE INDEX/SEQUENCE/VIEW', () => {
      expect(ValidatorService.validateAdminSQL('CREATE INDEX idx_prod_price ON products(price);').isValid).toBe(true);
      expect(ValidatorService.validateAdminSQL('CREATE SEQUENCE seq_user_id START 100;').isValid).toBe(true);
      expect(ValidatorService.validateAdminSQL('CREATE VIEW active_products AS SELECT * FROM products;').isValid).toBe(true);
      expect(ValidatorService.validateAdminSQL('CREATE OR REPLACE VIEW active_products AS SELECT * FROM products;').isValid).toBe(true);
    });

    it('should reject DROP TABLE statements', () => {
      const res = ValidatorService.validateAdminSQL('DROP TABLE products;');
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject non-DDL statements like INSERT/UPDATE/DELETE', () => {
      expect(ValidatorService.validateAdminSQL("INSERT INTO products VALUES (1, 10);").isValid).toBe(false);
      expect(ValidatorService.validateAdminSQL("UPDATE products SET price = 12;").isValid).toBe(false);
    });
  });
});

describe('Worker HTTP Routes Integration Tests', () => {
  const mockEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    GEMINI_API_KEY: 'test-api-key',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret'
  };

  it('should return health check details at GET /', async () => {
    const res = await app.request('/', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.endpoints).toBeDefined();
  });

  it('should return 404 for non-existing route', async () => {
    const res = await app.request('/does-not-exist', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.message).toContain('Route not found');
  });

  it('should run valid queries via POST /query', async () => {
    const res = await app.request(
      '/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT * FROM users;' })
      },
      mockEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ id: 100, name: 'Alice', role: 'admin' }]);
    expect(body.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should reject invalid SQL queries via POST /query', async () => {
    const res = await app.request(
      '/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'DELETE FROM users;' })
      },
      mockEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.message).toContain('Invalid SQL');
  });

  it('should run valid schema commands via POST /admin/create-schema', async () => {
    const res = await app.request(
      '/admin/create-schema',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'CREATE TABLE logs (id SERIAL);' })
      },
      mockEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.message).toContain('Schema operation executed successfully');
  });

  it('should block DROP statements via POST /admin/create-schema', async () => {
    const res = await app.request(
      '/admin/create-schema',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'DROP TABLE logs;' })
      },
      mockEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.message).toContain('Invalid SQL');
  });
});
