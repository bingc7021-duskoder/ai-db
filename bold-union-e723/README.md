# AI-Powered Database Platform Backend

A production-ready, secure, and type-safe backend built on Cloudflare Workers, TypeScript, and Hono. It connects to a Neon PostgreSQL database and provides two endpoints to safely validate and execute SQL commands.

---

## Architecture & Principles
1. **No SQL Generation**: The backend executes SQL queries sent directly in request payloads. It *never* constructs or generates SQL.
2. **Strict SQL Validator (Lexical Analyzer)**: Prevents SQL injections and unauthorized commands by parsing statements at the token level, skipping comments and string literals to avoid keyword spoofing.
3. **Modular Routing**: Zero business logic inside the main entry point `index.ts`. All logic is decoupled into routes, controllers, services, and models.
4. **Structured Logging**: Automatic structured tracing of API calls, query runtime, success rates, and validation or database failures.

---

## Directory Structure
```
src/
  ├── index.ts               # Main Entry point (middleware, routes mount, error handler)
  ├── routes/
  │    ├── admin.ts          # /admin/create-schema handler (CREATE/ALTER only)
  │    └── query.ts          # /query handler (SELECT/WITH only)
  ├── services/
  │    ├── database.service.ts   # Neon serverless HTTP database connection client
  │    └── validator.service.ts  # Token-based SQL lexical validation logic
  ├── models/
  │    └── types.ts          # TypeScript strict interfaces & type definitions
  ├── utils/
  │    └── response.ts       # Structured JSON response helpers
  └── config/
       └── env.ts            # Runtime environment variable validation
```

---

## API Endpoints

### 1. Execute DDL / Schema Updates
* **Endpoint**: `POST /admin/create-schema`
* **Purpose**: Creates or modifies database schemas.
* **Allowed commands**: `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `CREATE SEQUENCE`, `CREATE VIEW`, `CREATE OR REPLACE VIEW`.
* **Rejected commands**: Any commands starting with or containing `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT`, `GRANT`, `REVOKE`, etc.
* **Example Request**:
```json
{
  "sql": "CREATE TABLE customers (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, created_at TIMESTAMP DEFAULT NOW());"
}
```
* **Example Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Schema operation executed successfully",
  "data": {
    "affectedRows": 0
  },
  "executionTimeMs": 142.35
}
```

### 2. Run SELECT Queries
* **Endpoint**: `POST /query`
* **Purpose**: Retrieves data from the database.
* **Allowed commands**: Only queries starting with `SELECT` or `WITH`.
* **Rejected commands**: Any modifying statements (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, etc.) anywhere in the statement tokens.
* **Example Request**:
```json
{
  "sql": "SELECT * FROM customers ORDER BY created_at DESC;"
}
```
* **Example Success Response (200 OK)**:
```json
{
  "success": true,
  "message": "Query executed successfully",
  "data": [
    {
      "id": 1,
      "name": "Jane Doe",
      "created_at": "2026-07-20T22:33:05.000Z"
    }
  ],
  "executionTimeMs": 48.12
}
```

---

## Neon PostgreSQL Configuration

### 1. Create a Neon Database
1. Go to [Neon Console](https://console.neon.tech/) and sign up or log in.
2. Click **Create Project**. Name your project (e.g. `ai-db`) and select your preferred PostgreSQL version and region.
3. Once the database is created, you will see a connection string in the dashboard under **Connection Details**.
4. Copy the connection string. It will look like this:
   `postgresql://[user]:[password]@[hostname]/[dbname]?sslmode=require`

### 2. Configure DATABASE_URL inside Cloudflare Workers
Cloudflare Workers use environment bindings to retrieve configurations.

#### Local Development Setup
Create a file named `.dev.vars` in the root of the project (`bold-union-e723/`) to store local secrets. Wrangler will automatically load these variables when running locally.

Add the following environment bindings:
```env
DATABASE_URL="postgresql://[user]:[password]@[hostname]/[dbname]?sslmode=require"
GEMINI_API_KEY="your-gemini-api-key"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

#### Production Secret Configuration
For production, sensitive environment variables like `DATABASE_URL` and `GEMINI_API_KEY` should be set as secrets in Cloudflare:
```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```
You will be prompted to enter the secret value for each.

---

## Local Development & Testing

### 1. Install Dependencies
Run the following command in the `bold-union-e723` directory to install dependencies:
```bash
npm install
```

### 2. Start Local Development Server
Launch the wrangler dev server locally:
```bash
npm run dev
```
The server will boot up and usually listen at [http://localhost:8787](http://localhost:8787).

### 3. Test Endpoints manually

#### Test /admin/create-schema:
```bash
curl -X POST http://localhost:8787/admin/create-schema \
  -H "Content-Type: application/json" \
  -d '{"sql": "CREATE TABLE test_table (id SERIAL PRIMARY KEY, value TEXT);"}'
```

#### Test /query:
```bash
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM test_table;"}'
```

#### Test Validator Blocking (Should fail):
```bash
curl -X POST http://localhost:8787/query \
  -H "Content-Type: application/json" \
  -d '{"sql": "DROP TABLE test_table;"}'
```

---

## Deployment
Deploy the worker to the Cloudflare global network using Wrangler:
```bash
npm run deploy
```
This runs `wrangler deploy` under the hood. No modifications to code or settings are required to deploy!
