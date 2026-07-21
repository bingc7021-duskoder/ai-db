import { Hono } from 'hono';
import { AppContext } from '../types/auth';
import { requireAuth } from '../middleware/auth.middleware';
import { DatabaseService } from '../services/database.service';
import { KnowledgeService } from '../services/KnowledgeService';
import { GeminiService } from '../services/GeminiService';
import { PromptService, PromptType } from '../services/PromptService';
import { getAppConfig } from '../config/env';
import { sendSuccess, sendError } from '../utils/response';

const knowledgeRouter = new Hono<AppContext>();

// Require authentication for knowledge endpoints
knowledgeRouter.use('*', requireAuth);

/**
 * GET /knowledge/documentation
 * Returns generated/documentation.md content, database statistics, and parsed overview/purpose.
 */
knowledgeRouter.get('/documentation', async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);
    const schemaStructure = await dbService.getSchemaStructure();

    let cached = await KnowledgeService.readCacheFile(dbService, 'documentation.md');

    if (!cached || !cached.content) {
      console.log('[Knowledge API] Cache miss for documentation.md. Triggering generation...');
      await KnowledgeService.generateAllKnowledge(dbService, config.geminiApiKey);
      cached = await KnowledgeService.readCacheFile(dbService, 'documentation.md');
    }

    const docMarkdown = cached?.content || '';
    const generatedAt = cached?.generatedAt || new Date().toISOString();
    const { databaseName, businessOverview, purpose } = KnowledgeService.extractOverviewAndPurpose(docMarkdown);

    return c.json({
      success: true,
      data: {
        databaseName,
        businessOverview,
        purpose,
        generatedAt,
        markdown: docMarkdown,
        statistics: schemaStructure.metadata
      }
    });
  } catch (err: any) {
    console.error('[Knowledge API Error] GET /knowledge/documentation:', err);
    return sendError(c, 500, 'Failed to retrieve database documentation', err.message);
  }
});

/**
 * GET /knowledge/tables
 * Returns cached table business details for all tables.
 */
knowledgeRouter.get('/tables', async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);

    let cached = await KnowledgeService.readCacheFile(dbService, 'tables.json');
    if (!cached || !cached.content) {
      await KnowledgeService.generateAllKnowledge(dbService, config.geminiApiKey);
      cached = await KnowledgeService.readCacheFile(dbService, 'tables.json');
    }

    let tablesData = { tables: {} };
    try {
      tablesData = JSON.parse(cached?.content || '{}');
    } catch (e) {
      tablesData = { tables: {} };
    }

    return c.json({
      success: true,
      data: tablesData.tables || {}
    });
  } catch (err: any) {
    console.error('[Knowledge API Error] GET /knowledge/tables:', err);
    return sendError(c, 500, 'Failed to retrieve table details', err.message);
  }
});

/**
 * GET /knowledge/tables/:tableName
 * Returns cached business breakdown for a specific table.
 */
knowledgeRouter.get('/tables/:tableName', async (c) => {
  try {
    const tableName = c.req.param('tableName');
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);

    let cached = await KnowledgeService.readCacheFile(dbService, 'tables.json');
    if (!cached || !cached.content) {
      await KnowledgeService.generateAllKnowledge(dbService, config.geminiApiKey);
      cached = await KnowledgeService.readCacheFile(dbService, 'tables.json');
    }

    let tablesData: any = { tables: {} };
    try {
      tablesData = JSON.parse(cached?.content || '{}');
    } catch (e) {
      tablesData = { tables: {} };
    }

    const tableDetail = tablesData.tables?.[tableName] || null;
    if (!tableDetail) {
      return sendError(c, 404, `Table details not found for table '${tableName}'`);
    }

    return c.json({
      success: true,
      data: tableDetail
    });
  } catch (err: any) {
    console.error('[Knowledge API Error] GET /knowledge/tables/:tableName:', err);
    return sendError(c, 500, 'Failed to retrieve table details', err.message);
  }
});

/**
 * GET /knowledge/relationships
 * Returns foreign key business-friendly explanations.
 */
knowledgeRouter.get('/relationships', async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);

    let cached = await KnowledgeService.readCacheFile(dbService, 'relationships.json');
    if (!cached || !cached.content) {
      await KnowledgeService.generateAllKnowledge(dbService, config.geminiApiKey);
      cached = await KnowledgeService.readCacheFile(dbService, 'relationships.json');
    }

    let relData: any = { relationships: {} };
    try {
      relData = JSON.parse(cached?.content || '{}');
    } catch (e) {
      relData = { relationships: {} };
    }

    return c.json({
      success: true,
      data: relData.relationships || {}
    });
  } catch (err: any) {
    console.error('[Knowledge API Error] GET /knowledge/relationships:', err);
    return sendError(c, 500, 'Failed to retrieve relationship explanations', err.message);
  }
});

/**
 * GET /knowledge/walkthrough
 * Returns ordered visual walkthrough learning sequence.
 */
knowledgeRouter.get('/walkthrough', async (c) => {
  try {
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);

    let cached = await KnowledgeService.readCacheFile(dbService, 'walkthrough.json');
    if (!cached || !cached.content) {
      await KnowledgeService.generateAllKnowledge(dbService, config.geminiApiKey);
      cached = await KnowledgeService.readCacheFile(dbService, 'walkthrough.json');
    }

    let walkData: any = { steps: [] };
    try {
      walkData = JSON.parse(cached?.content || '{}');
    } catch (e) {
      walkData = { steps: [] };
    }

    return c.json({
      success: true,
      data: walkData
    });
  } catch (err: any) {
    console.error('[Knowledge API Error] GET /knowledge/walkthrough:', err);
    return sendError(c, 500, 'Failed to retrieve walkthrough steps', err.message);
  }
});

/**
 * GET /knowledge/architect-review
 * Returns Senior DB Architect review evaluation. Pass ?refresh=true to force regeneration.
 */
knowledgeRouter.get('/architect-review', async (c) => {
  try {
    const refresh = c.req.query('refresh') === 'true';
    const config = getAppConfig(c.env);
    const dbService = new DatabaseService(config.databaseUrl);

    let cached = await KnowledgeService.readCacheFile(dbService, 'architect_review.json');

    if (refresh || !cached || !cached.content) {
      console.log(`[Knowledge API] ${refresh ? 'Forced refresh' : 'Cache miss'} requested for architect_review.json...`);
      const schemaSummary = await dbService.getSchemaSummary();
      const schemaStructure = await dbService.getSchemaStructure();

      const fullContext = `
${schemaSummary}

STRUCTURE METADATA:
Table Count: ${schemaStructure.metadata.tableCount}
Relationship Count: ${schemaStructure.metadata.relationshipCount}
      `.trim();

      const promptService = new PromptService();
      const geminiService = config.geminiApiKey ? new GeminiService(config.geminiApiKey, promptService) : null;

      let archJsonStr = '';
      if (geminiService) {
        archJsonStr = await geminiService.generate(
          PromptType.ARCHITECT_REVIEW,
          'Evaluate schema like a Senior Database Architect and return evaluation JSON.',
          fullContext
        );
      }

      let parsedArch = null;
      try {
        parsedArch = JSON.parse(archJsonStr);
      } catch (e) {
        parsedArch = null;
      }

      if (!parsedArch || !parsedArch.score) {
        parsedArch = (KnowledgeService as any).buildFallbackArchitectReview(schemaStructure);
      }

      await KnowledgeService.writeCacheFile(dbService, 'architect_review.json', JSON.stringify(parsedArch, null, 2));
      cached = await KnowledgeService.readCacheFile(dbService, 'architect_review.json');
    }

    let archData: any = {};
    try {
      archData = JSON.parse(cached?.content || '{}');
    } catch (e) {
      archData = {};
    }

    return c.json({
      success: true,
      data: archData
    });
  } catch (err: any) {
    console.error('[Knowledge API Error] GET /knowledge/architect-review:', err);
    return sendError(c, 500, 'Failed to retrieve architect review', err.message);
  }
});

export default knowledgeRouter;
