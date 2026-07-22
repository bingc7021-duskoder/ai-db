import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Env } from './models/types';
import adminRouter from './routes/admin';
import queryRouter from './routes/query';
import authRouter from './routes/auth.routes';
import userRouter from './routes/user.routes';
import { sendError } from './utils/response';
import { AppContext } from './types/auth';
import { requireAuth } from './middleware/auth.middleware';
import { DatabaseService } from './services/database.service';
import { getAppConfig } from './config/env';

const app = new Hono<AppContext>();

import { cors } from 'hono/cors';

// Structured logging, CORS, and JSON formatting middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS', 'PATCH', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

// Mount modular sub-routers
app.route('/admin', adminRouter);
app.route('/query', queryRouter);
app.route('/auth', authRouter);
app.route('/users', userRouter);

// Schema structure endpoint
app.get('/schema', requireAuth, async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const schemaData = await dbService.getSchemaStructure();
    return c.json({
      success: true,
      message: 'Schema retrieved successfully',
      ...schemaData
    });
  } catch (err: any) {
    console.error('[Schema Route Error]', err);
    return sendError(c, 500, 'Failed to retrieve database schema', err.message);
  }
});

import { ERPService } from './services/erpService';

// Primary High-Performance ERP Endpoint (Level 1 + Level 2 Cache + Backend Layout Engine)
app.get('/erp', requireAuth, async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const erpService = new ERPService(dbService, config.geminiApiKey);

    const erpResponse = await erpService.getERP();
    return c.json(erpResponse);
  } catch (err: any) {
    console.error('[ERP Endpoint Error]', err);
    return sendError(c, 500, 'Failed to retrieve ERP representation', err.message);
  }
});

// Backward-Compatible Schema Diagram Alias -> Routes directly to ERP Engine
app.get('/schema/diagram', requireAuth, async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const erpService = new ERPService(dbService, config.geminiApiKey);

    const erpResponse = await erpService.getERP();
    return c.json({
      success: true,
      message: 'Schema diagram retrieved successfully',
      generatedAt: erpResponse.generatedAt,
      mermaid: '',
      tables: erpResponse.graph.nodes.map((n) => ({
        name: n.data.tableName,
        label: n.data.label,
        columns: n.data.columns
      })),
      relationships: erpResponse.graph.edges.map((e) => ({
        sourceTable: e.source,
        sourceColumn: e.id.split('-')[3] || '',
        targetTable: e.target,
        targetColumn: '',
        label: e.label
      })),
      layoutHints: {},
      labels: erpResponse.graph.labels,
      groups: erpResponse.graph.groups,
      graph: erpResponse.graph,
      statistics: erpResponse.statistics
    });
  } catch (err: any) {
    console.error('[Schema Diagram Route Error]', err);
    return sendError(c, 500, 'Failed to retrieve database schema diagram', err.message);
  }
});

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    success: true,
    message: 'AI Database Platform Backend running successfully.',
    endpoints: {
      adminCreateSchema: 'POST /admin/create-schema',
      adminInsertData: 'POST /admin/insert-data',
      userQuery: 'POST /query'
    }
  });
});

// Global Error Handler (SOLID - structured exception tracking)
app.onError((err, c) => {
  console.error(`[GLOBAL ERROR] Caught unhandled exception:`, err);
  return sendError(
    c,
    500,
    'Internal Server Error: An unexpected error occurred on the server',
    err.message || String(err)
  );
});

// 404 handler for unmatched routes
app.notFound((c) => {
  return sendError(c, 404, `Route not found: ${c.req.path}`);
});

export default app;
