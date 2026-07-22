import { DatabaseService } from './database.service';
import { GeminiService } from './GeminiService';
import { PromptService, PromptType } from './PromptService';
import { computeSchemaHash } from '../utils/hash';
import { computeBackendGraphLayout, BackendRenderGraph } from '../utils/backendLayout';

export interface ERPResponsePayload {
  success: boolean;
  message: string;
  schemaHash: string;
  cached: boolean;
  cacheLevel: 'memory' | 'database' | 'miss';
  generatedAt: string;
  layoutVersion: number;
  graph: BackendRenderGraph;
  statistics: {
    tableCount: number;
    relationshipCount: number;
    indexCount: number;
    viewCount: number;
    rowCount: number;
    summary: string;
  };
}

export class ERPService {
  // Level 1 In-Memory Session Cache (Isolate Memory Map)
  private static memoryCache = new Map<string, ERPResponsePayload>();

  private dbService: DatabaseService;
  private geminiApiKey?: string;

  constructor(dbService: DatabaseService, geminiApiKey?: string) {
    this.dbService = dbService;
    this.geminiApiKey = geminiApiKey;
  }

  /**
   * Main ERP Pipeline Controller:
   * Step 1: Discover Schema Metadata
   * Step 2: Compute SHA-256 schemaHash
   * Step 3: Check Level 1 In-Memory Session Cache
   * Step 4: Check Level 2 PostgreSQL Persistent Cache
   * Step 5: Cache Miss -> Call Gemini AI (Database Architect Role)
   * Step 6: Backend Layout Engine -> Compute node coordinates & dimensions
   * Step 7: Store in Level 2 & Level 1 Cache
   * Step 8: Return Ready-To-Render Graph JSON
   */
  public async getERP(): Promise<ERPResponsePayload> {
    const overallStartTime = performance.now();

    // Step 1: Discover live PostgreSQL schema structure
    const schemaData = await this.dbService.getSchemaStructure();
    const tables = schemaData.tables || [];
    const metadata = schemaData.metadata || {
      tableCount: 0,
      relationshipCount: 0,
      indexCount: 0,
      viewCount: 0,
      rowCount: 0,
      summary: 'No tables found'
    };

    // Handle Empty Database Schema immediately
    if (tables.length === 0) {
      return {
        success: true,
        message: 'No active user tables found in database schema',
        schemaHash: 'empty_schema',
        cached: false,
        cacheLevel: 'miss',
        generatedAt: new Date().toISOString(),
        layoutVersion: 1,
        graph: {
          nodes: [],
          edges: [],
          groups: [],
          labels: []
        },
        statistics: metadata
      };
    }

    // Step 2: Compute SHA-256 schemaHash
    const schemaHash = await computeSchemaHash(tables);
    console.log(`[ERP Pipeline] Schema hash calculated: ${schemaHash}`);

    // Step 3: Check Level 1 In-Memory Session Cache (< 10ms)
    if (ERPService.memoryCache.has(schemaHash)) {
      const memoryHits = ERPService.memoryCache.get(schemaHash)!;
      console.log(`[ERP Pipeline] Level 1 Memory Cache HIT for hash ${schemaHash} in ${(performance.now() - overallStartTime).toFixed(2)} ms`);
      return {
        ...memoryHits,
        cached: true,
        cacheLevel: 'memory'
      };
    }

    // Step 4: Check Level 2 PostgreSQL Persistent Cache (< 100ms)
    try {
      const dbCached = await this.dbService.getERPCacheByHash(schemaHash);
      if (dbCached && dbCached.erpJson) {
        console.log(`[ERP Pipeline] Level 2 Database Cache HIT for hash ${schemaHash} in ${(performance.now() - overallStartTime).toFixed(2)} ms`);
        
        const payload: ERPResponsePayload = {
          success: true,
          message: 'ERP graph retrieved from persistent cache',
          schemaHash,
          cached: true,
          cacheLevel: 'database',
          generatedAt: dbCached.generatedAt,
          layoutVersion: 1,
          graph: dbCached.erpJson.graph,
          statistics: dbCached.erpJson.statistics || metadata
        };

        // Populate Level 1 Memory Cache for subsequent requests
        ERPService.memoryCache.set(schemaHash, payload);
        return payload;
      }
    } catch (cacheErr) {
      console.warn('[ERP Pipeline] Level 2 Cache lookup warning:', cacheErr);
    }

    // Step 5: Cache Miss -> Call Gemini AI Database Architect to generate Domain Architecture
    console.log(`[ERP Pipeline] Cache MISS for hash ${schemaHash}. Initiating Gemini AI Architectural Domain Grouping...`);
    let domainStructure: any = { domains: [], tableMetadata: {}, annotations: [] };

    if (this.geminiApiKey) {
      try {
        const promptService = new PromptService();
        const geminiService = new GeminiService(this.geminiApiKey, promptService);
        const schemaSummary = await this.dbService.getSchemaSummary();

        const llmResponse = await geminiService.generate(
          PromptType.DIAGRAM_GENERATION,
          `Analyze the following database schema and produce logical business domain groupings:`,
          schemaSummary
        );

        const cleanJsonText = llmResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
        domainStructure = JSON.parse(cleanJsonText);
        console.log('[ERP Pipeline] Gemini AI domain architect response parsed successfully.');
      } catch (geminiErr: any) {
        console.warn('[ERP Pipeline] Gemini domain grouping fallback:', geminiErr.message);
      }
    }

    // Step 6: Backend Layout Engine -> Compute exact grid coordinates and node dimensions
    const graph = computeBackendGraphLayout(tables, domainStructure);

    const resultPayload: ERPResponsePayload = {
      success: true,
      message: 'ERP graph generated and cached successfully',
      schemaHash,
      cached: false,
      cacheLevel: 'miss',
      generatedAt: new Date().toISOString(),
      layoutVersion: 1,
      graph,
      statistics: metadata
    };

    // Step 7: Store in Level 1 (Memory) and Level 2 (PostgreSQL) Cache
    ERPService.memoryCache.set(schemaHash, resultPayload);
    this.dbService
      .saveERPCache(schemaHash, resultPayload, domainStructure, metadata.summary)
      .catch((saveErr) => console.warn('[ERP Pipeline] Level 2 Cache save warning:', saveErr));

    console.log(`[ERP Pipeline] Complete generation & caching finished in ${(performance.now() - overallStartTime).toFixed(2)} ms`);

    return resultPayload;
  }
}
