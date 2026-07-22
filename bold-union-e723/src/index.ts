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

// Schema diagram cache endpoint
app.get('/schema/diagram', requireAuth, async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const cachedDiagram = await dbService.getCachedDiagramData();
    if (!cachedDiagram) {
      // If no cached diagram is found, return empty cached structure rather than failing
      return c.json({
        success: true,
        message: 'No cached schema diagram found.',
        generatedAt: null,
        mermaid: '',
        tables: [],
        relationships: [],
        layoutHints: {},
        labels: [],
        groups: []
      });
    }
    return c.json({
      success: true,
      message: 'Schema diagram retrieved successfully',
      generatedAt: cachedDiagram.generatedAt,
      mermaid: cachedDiagram.mermaid,
      tables: cachedDiagram.tables,
      relationships: cachedDiagram.relationships,
      layoutHints: cachedDiagram.layoutHints,
      labels: cachedDiagram.labels,
      groups: cachedDiagram.groups
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
