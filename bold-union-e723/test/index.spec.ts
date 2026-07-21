import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index';
import { SchemaSQLValidator, DataSQLValidator, UserQueryValidator } from '../src/services/validator.service';
import { AuthService } from '../src/services/auth.service';
import { signJwt } from '../src/utils/jwt';

// Shared mock database store for users
const mockUsersDb: any[] = [];

// Mock the `@neondatabase/serverless` module to prevent network calls
vi.mock('@neondatabase/serverless', () => {
  return {
    Pool: vi.fn().mockImplementation(() => {
      const mockQuery = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        const sqlUpper = sql.toUpperCase();

        // Match insert statement for user creation
        if (sqlUpper.includes('INSERT INTO APP_USERS')) {
          const newUser = {
            id: 'mock-uuid-' + Math.random().toString(36).substring(2, 9),
            google_id: params?.[0] || 'mock-google-id',
            email: params?.[1] || 'mock@example.com',
            name: params?.[2] || null,
            picture: params?.[3] || null,
            role: 'USER',
            is_active: true,
            last_login: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          mockUsersDb.push(newUser);
          return {
            rows: [newUser],
            rowCount: 1
          };
        }

        // Match select user by google_id
        if (sqlUpper.includes('SELECT * FROM APP_USERS WHERE GOOGLE_ID =')) {
          const googleId = params?.[0];
          const user = mockUsersDb.find((u) => u.google_id === googleId);
          return {
            rows: user ? [user] : [],
            rowCount: user ? 1 : 0
          };
        }

        // Match select user by email
        if (sqlUpper.includes('SELECT * FROM APP_USERS WHERE EMAIL =')) {
          const email = params?.[0];
          const user = mockUsersDb.find((u) => u.email === email);
          return {
            rows: user ? [user] : [],
            rowCount: user ? 1 : 0
          };
        }

        // Match select user by ID
        if (sqlUpper.includes('SELECT * FROM APP_USERS WHERE ID =')) {
          const id = params?.[0];
          const user = mockUsersDb.find((u) => u.id === id);
          return {
            rows: user ? [user] : [],
            rowCount: user ? 1 : 0
          };
        }

        // Match role or status check
        if (sqlUpper.includes('SELECT ROLE FROM APP_USERS WHERE ID =') || sqlUpper.includes('SELECT IS_ACTIVE FROM APP_USERS WHERE ID =')) {
          const id = params?.[0];
          const user = mockUsersDb.find((u) => u.id === id);
          return {
            rows: user ? [{ role: user.role, is_active: user.is_active }] : [],
            rowCount: user ? 1 : 0
          };
        }

        // Match select all users
        if (sqlUpper.includes('SELECT * FROM APP_USERS ORDER BY')) {
          return {
            rows: mockUsersDb,
            rowCount: mockUsersDb.length
          };
        }

        // Match update queries (role, status, last_login)
        if (sqlUpper.includes('UPDATE APP_USERS')) {
          const id = params?.[0];
          const user = mockUsersDb.find((u) => u.id === id);
          if (!user) {
            return { rows: [], rowCount: 0 };
          }

          if (sqlUpper.includes('SET ROLE =')) {
            user.role = params?.[1];
          } else if (sqlUpper.includes('SET IS_ACTIVE =')) {
            user.is_active = params?.[1];
          } else if (sqlUpper.includes('SET LAST_LOGIN =')) {
            user.name = params?.[1] || user.name;
            user.picture = params?.[2] || user.picture;
            user.last_login = new Date().toISOString();
          }
          user.updated_at = new Date().toISOString();

          return {
            rows: [user],
            rowCount: 1
          };
        }

        // General default select response
        if (sqlUpper.includes('SELECT')) {
          return {
            rows: [{ id: 100, name: 'Alice', role: 'admin' }],
            rowCount: 1
          };
        }

        // Return empty results for CREATE/ALTER/INSERT DDL/DML commands
        return {
          rows: [],
          rowCount: 0
        };
      });

      return {
        query: mockQuery,
        connect: vi.fn().mockImplementation(async () => {
          return {
            query: mockQuery,
            release: vi.fn()
          };
        }),
        runInTransaction: vi.fn().mockImplementation(async (cb) => {
          return await cb({ execute: mockQuery });
        })
      };
    })
  };
});

// Spy on Google ID token verification in AuthService
vi.spyOn(AuthService.prototype, 'verifyGoogleToken').mockImplementation(async (token: string) => {
  if (token === 'valid-google-token') {
    return {
      googleId: 'google-user-123',
      email: 'john.doe@example.com',
      emailVerified: true,
      name: 'John Doe',
      picture: 'https://example.com/john.png'
    };
  }
  if (token === 'deactivated-google-token') {
    return {
      googleId: 'google-user-deactivated',
      email: 'deactivated@example.com',
      emailVerified: true,
      name: 'Deactivated User',
      picture: 'https://example.com/deactivated.png'
    };
  }
  if (token === 'admin-google-token') {
    return {
      googleId: 'google-user-admin',
      email: 'admin@example.com',
      emailVerified: true,
      name: 'Admin User',
      picture: 'https://example.com/admin.png'
    };
  }
  if (token === 'super-admin-google-token') {
    return {
      googleId: 'google-user-super',
      email: 'super@example.com',
      emailVerified: true,
      name: 'Super Admin User',
      picture: 'https://example.com/super.png'
    };
  }
  throw new Error('Google token signature verification failed');
});

describe('SQL Validator Service Unit Tests', () => {
  describe('User SQL Validator (UserQueryValidator)', () => {
    it('should allow simple SELECT queries', () => {
      const res = UserQueryValidator.validate('SELECT * FROM users;');
      expect(res.isValid).toBe(true);
    });

    it('should allow SELECT queries with comments', () => {
      const res = UserQueryValidator.validate('SELECT id FROM customers; -- fetch only ids');
      expect(res.isValid).toBe(true);
    });

    it('should allow SELECT queries with CTEs', () => {
      const res = UserQueryValidator.validate('WITH active_users AS (SELECT * FROM users WHERE active = true) SELECT * FROM active_users;');
      expect(res.isValid).toBe(true);
    });

    it('should reject INSERT queries', () => {
      const res = UserQueryValidator.validate("INSERT INTO users (name) VALUES ('Bob');");
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject UPDATE queries', () => {
      const res = UserQueryValidator.validate("UPDATE users SET name = 'Bob' WHERE id = 1;");
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject DELETE queries', () => {
      const res = UserQueryValidator.validate('DELETE FROM users WHERE id = 1;');
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject nested modifications or combined queries', () => {
      const res1 = UserQueryValidator.validate('SELECT * FROM users; DROP TABLE users;');
      expect(res1.isValid).toBe(false);

      const res2 = UserQueryValidator.validate('SELECT * FROM users; INSERT INTO logs DEFAULT VALUES;');
      expect(res2.isValid).toBe(false);
    });

    it('should handle SQL keywords inside string literals safely without blocking', () => {
      const res = UserQueryValidator.validate("SELECT * FROM messages WHERE content = 'Please delete this account';");
      expect(res.isValid).toBe(true);
    });
  });

  describe('Schema SQL Validator (SchemaSQLValidator)', () => {
    it('should allow valid CREATE TABLE statements', () => {
      const res = SchemaSQLValidator.validate('CREATE TABLE products (id INT, price NUMERIC);');
      expect(res.isValid).toBe(true);
    });

    it('should allow ALTER TABLE statements', () => {
      const res = SchemaSQLValidator.validate('ALTER TABLE products ADD COLUMN description TEXT;');
      expect(res.isValid).toBe(true);
    });

    it('should allow CREATE INDEX/SEQUENCE/VIEW', () => {
      expect(SchemaSQLValidator.validate('CREATE INDEX idx_prod_price ON products(price);').isValid).toBe(true);
      expect(SchemaSQLValidator.validate('CREATE SEQUENCE seq_user_id START 100;').isValid).toBe(true);
      expect(SchemaSQLValidator.validate('CREATE VIEW active_products AS SELECT * FROM products;').isValid).toBe(true);
      expect(SchemaSQLValidator.validate('CREATE OR REPLACE VIEW active_products AS SELECT * FROM products;').isValid).toBe(true);
    });

    it('should reject DROP TABLE statements', () => {
      const res = SchemaSQLValidator.validate('DROP TABLE products;');
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('Forbidden operation');
    });

    it('should reject non-DDL statements like INSERT/UPDATE/DELETE', () => {
      expect(SchemaSQLValidator.validate("INSERT INTO products VALUES (1, 10);").isValid).toBe(false);
      expect(SchemaSQLValidator.validate("UPDATE products SET price = 12;").isValid).toBe(false);
    });
  });

  describe('Data SQL Validator (DataSQLValidator)', () => {
    it('should allow valid INSERT, UPDATE, DELETE statements', () => {
      expect(DataSQLValidator.validate("INSERT INTO products (id, price) VALUES (1, 10);").isValid).toBe(true);
      expect(DataSQLValidator.validate("UPDATE products SET price = 12 WHERE id = 1;").isValid).toBe(true);
      expect(DataSQLValidator.validate("DELETE FROM products WHERE id = 1;").isValid).toBe(true);
    });

    it('should reject DDL statements like CREATE/ALTER/DROP/TRUNCATE', () => {
      expect(DataSQLValidator.validate("CREATE TABLE temp (id INT);").isValid).toBe(false);
      expect(DataSQLValidator.validate("ALTER TABLE products ADD COLUMN description TEXT;").isValid).toBe(false);
      expect(DataSQLValidator.validate("DROP TABLE products;").isValid).toBe(false);
      expect(DataSQLValidator.validate("TRUNCATE TABLE products;").isValid).toBe(false);
    });

    it('should reject administrative queries like GRANT/REVOKE', () => {
      expect(DataSQLValidator.validate("GRANT ALL ON TABLE products TO web_user;").isValid).toBe(false);
      expect(DataSQLValidator.validate("REVOKE ALL ON TABLE products FROM web_user;").isValid).toBe(false);
    });

    it('should reject SELECT-only queries', () => {
      expect(DataSQLValidator.validate("SELECT * FROM products;").isValid).toBe(false);
    });
  });
});

describe('Worker HTTP Routes Integration Tests', () => {
  const mockEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    GEMINI_API_KEY: 'test-api-key',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    JWT_SECRET: 'test-jwt-secret'
  };

  let userToken: string;
  let adminToken: string;
  let superAdminToken: string;

  beforeEach(async () => {
    // Reset mock users DB before each test run
    mockUsersDb.length = 0;

    // Helper to generate quick JWTs
    const generateToken = async (id: string, googleId: string, email: string, role: any, permissions: string[]) => {
      const now = Math.floor(Date.now() / 1000);
      return await signJwt(
        {
          id,
          googleId,
          email,
          role,
          permissions,
          iat: now,
          exp: now + 3600
        },
        mockEnv.JWT_SECRET
      );
    };

    userToken = await generateToken('u1', 'g1', 'user@example.com', 'USER', ['QUERY_DATABASE']);
    adminToken = await generateToken('a1', 'g2', 'admin@example.com', 'ADMIN', [
      'CREATE_SCHEMA',
      'INSERT_DATA',
      'QUERY_DATABASE',
      'MANAGE_USERS'
    ]);
    superAdminToken = await generateToken('s1', 'g3', 'super@example.com', 'SUPER_ADMIN', []);
  });

  it('should return health check details at GET /', async () => {
    const res = await app.request('/', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.endpoints).toBeDefined();
  });

  it('should return 404 for non-existing route', async () => {
    const res = await app.request('/does-not-exist', { method: 'GET' }, mockEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.message).toContain('Route not found');
  });

  it('should run valid queries via POST /query with valid USER token', async () => {
    const res = await app.request(
      '/query',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify({ sql: 'SELECT * FROM users;' })
      },
      mockEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data).toEqual([{ id: 100, name: 'Alice', role: 'admin' }]);
  });

  it('should reject queries via POST /query if unauthenticated', async () => {
    const res = await app.request(
      '/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT * FROM users;' })
      },
      mockEnv
    );
    expect(res.status).toBe(401);
  });

  it('should reject invalid SQL queries via POST /query even when authenticated', async () => {
    const res = await app.request(
      '/query',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify({ sql: 'DELETE FROM users;' })
      },
      mockEnv
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.message).toContain('Invalid SQL');
  });

  it('should run valid schema commands via POST /admin/create-schema with ADMIN token', async () => {
    const res = await app.request(
      '/admin/create-schema',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ sql: 'CREATE TABLE logs (id SERIAL);' })
      },
      mockEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it('should block admin schema endpoints for USER role (403)', async () => {
    const res = await app.request(
      '/admin/create-schema',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`
        },
        body: JSON.stringify({ sql: 'CREATE TABLE logs (id SERIAL);' })
      },
      mockEnv
    );
    expect(res.status).toBe(403);
  });

  it('should run valid data commands via POST /admin/insert-data with ADMIN token', async () => {
    const res = await app.request(
      '/admin/insert-data',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({ sql: "INSERT INTO logs (message) VALUES ('test message');" })
      },
      mockEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it('should retrieve database schema structure via GET /schema with USER token', async () => {
    const res = await app.request(
      '/schema',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      },
      mockEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.tables).toBeDefined();
    expect(body.metadata).toBeDefined();
  });

  it('should block GET /schema if unauthenticated', async () => {
    const res = await app.request(
      '/schema',
      { method: 'GET' },
      mockEnv
    );
    expect(res.status).toBe(401);
  });

  it('should execute cleanup successfully via POST /admin/cleanup with ADMIN token', async () => {
    const res = await app.request(
      '/admin/cleanup',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${adminToken}`
        }
      },
      mockEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
  });

  it('should block POST /admin/cleanup for USER role (403)', async () => {
    const res = await app.request(
      '/admin/cleanup',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      },
      mockEnv
    );
    expect(res.status).toBe(403);
  });
});

describe('Authentication and Authorization Flow Integration Tests', () => {
  const mockEnv = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    GEMINI_API_KEY: 'test-api-key',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    JWT_SECRET: 'test-jwt-secret'
  };

  beforeEach(() => {
    mockUsersDb.length = 0;
  });

  describe('POST /auth/google', () => {
    it('should successfully register and login a new user', async () => {
      const res = await app.request(
        '/auth/google',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: 'valid-google-token',
            provider: 'google'
          })
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.token).toBeDefined();
      expect(body.data.user.email).toBe('john.doe@example.com');
      expect(body.data.user.role).toBe('USER');
      expect(body.data.permissions).toEqual(['QUERY_DATABASE']);
    });

    it('should return 401 for invalid Google tokens', async () => {
      const res = await app.request(
        '/auth/google',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: 'invalid-token-value',
            provider: 'google'
          })
        },
        mockEnv
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('should prevent deactivated users from logging in (403)', async () => {
      // First, create the user
      await app.request(
        '/auth/google',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: 'deactivated-google-token',
            provider: 'google'
          })
        },
        mockEnv
      );

      // Deactivate the user in DB
      const dbUser = mockUsersDb.find((u) => u.email === 'deactivated@example.com');
      expect(dbUser).toBeDefined();
      dbUser.is_active = false;

      // Attempt login again
      const res = await app.request(
        '/auth/google',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: 'deactivated-google-token',
            provider: 'google'
          })
        },
        mockEnv
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.success).toBe(false);
      expect(body.message).toContain('deactivated');
    });
  });

  describe('User Dashboard Endpoints', () => {
    let userToken: string;
    let superAdminToken: string;
    let registeredUser: any;

    beforeEach(async () => {
      // Register John Doe
      const loginRes = await app.request(
        '/auth/google',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credential: 'valid-google-token',
            provider: 'google'
          })
        },
        mockEnv
      );
      const loginBody = (await loginRes.json()) as any;
      userToken = loginBody.data.token;
      registeredUser = loginBody.data.user;

      // Generate a SUPER_ADMIN token for admin actions
      const now = Math.floor(Date.now() / 1000);
      superAdminToken = await signJwt(
        {
          id: 's1',
          googleId: 'g3',
          email: 'super@example.com',
          role: 'SUPER_ADMIN',
          permissions: [],
          iat: now,
          exp: now + 3600
        },
        mockEnv.JWT_SECRET
      );
    });

    it('should return my user profile on GET /users/me', async () => {
      const res = await app.request(
        '/users/me',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${userToken}` }
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.email).toBe('john.doe@example.com');
    });

    it('should deny GET /users for general USER role', async () => {
      const res = await app.request(
        '/users',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${userToken}` }
        },
        mockEnv
      );

      expect(res.status).toBe(403);
    });

    it('should allow GET /users for SUPER_ADMIN', async () => {
      const res = await app.request(
        '/users',
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${superAdminToken}` }
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it('should allow SUPER_ADMIN to change user role', async () => {
      const res = await app.request(
        `/users/${registeredUser.id}/role`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${superAdminToken}`
          },
          body: JSON.stringify({ role: 'ADMIN' })
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.role).toBe('ADMIN');

      // Verify DB role update
      const dbUser = mockUsersDb.find((u) => u.id === registeredUser.id);
      expect(dbUser.role).toBe('ADMIN');
    });

    it('should deny role modification by non-SUPER_ADMIN users', async () => {
      const res = await app.request(
        `/users/${registeredUser.id}/role`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`
          },
          body: JSON.stringify({ role: 'ADMIN' })
        },
        mockEnv
      );

      expect(res.status).toBe(403);
    });

    it('should allow SUPER_ADMIN to toggle user status', async () => {
      const res = await app.request(
        `/users/${registeredUser.id}/status`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${superAdminToken}`
          },
          body: JSON.stringify({ isActive: false })
        },
        mockEnv
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.data.isActive).toBe(false);

      // Verify DB status update
      const dbUser = mockUsersDb.find((u) => u.id === registeredUser.id);
      expect(dbUser.is_active).toBe(false);
    });
  });
});
