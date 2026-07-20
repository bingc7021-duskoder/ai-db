import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { Env } from './models/types';
import adminRouter from './routes/admin';
import queryRouter from './routes/query';
import { sendError } from './utils/response';

const app = new Hono<{ Bindings: Env }>();

// Structured logging and JSON formatting middleware
app.use('*', logger());
app.use('*', prettyJSON());

// CORS configuration (crucial for API backend communicating with frontend app)
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// Mount modular sub-routers
app.route('/admin', adminRouter);
app.route('/query', queryRouter);

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
