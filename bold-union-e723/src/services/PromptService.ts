import databaseGenerationPrompt from '../prompts/database_generation.md';
import queryGenerationPrompt from '../prompts/query_generation.md';
import resultFormatterPrompt from '../prompts/result_formatter.md';
import sqlValidationPrompt from '../prompts/sql_validation.md';
import schemaContextPrompt from '../prompts/schema_context.md';
import diagramGenerationPrompt from '../prompts/diagram_generation.md';
import documentationPrompt from '../prompts/documentation.md';
import backendPrompt from '../prompts/backend_prompt.md';
import frontendPrompt from '../prompts/frontend_prompt.md';

export enum PromptType {
  DATABASE_GENERATION = 'database_generation',
  QUERY_GENERATION = 'query_generation',
  RESULT_FORMATTER = 'result_formatter',
  SQL_VALIDATION = 'sql_validation',
  SCHEMA_CONTEXT = 'schema_context',
  DIAGRAM_GENERATION = 'diagram_generation',
  DOCUMENTATION = 'documentation',
  BACKEND_PROMPT = 'backend_prompt',
  FRONTEND_PROMPT = 'frontend_prompt',
}

export class PromptService {
  private cache: Map<PromptType, string> = new Map();

  constructor() {
    this.loadPrompts();
  }

  /**
   * Loads all prompt files into the in-memory cache.
   */
  private loadPrompts(): void {
    this.cache.set(PromptType.DATABASE_GENERATION, databaseGenerationPrompt);
    this.cache.set(PromptType.QUERY_GENERATION, queryGenerationPrompt);
    this.cache.set(PromptType.RESULT_FORMATTER, resultFormatterPrompt);
    this.cache.set(PromptType.SQL_VALIDATION, sqlValidationPrompt);
    this.cache.set(PromptType.SCHEMA_CONTEXT, schemaContextPrompt);
    this.cache.set(PromptType.DIAGRAM_GENERATION, diagramGenerationPrompt);
    this.cache.set(PromptType.DOCUMENTATION, documentationPrompt);
    this.cache.set(PromptType.BACKEND_PROMPT, backendPrompt);
    this.cache.set(PromptType.FRONTEND_PROMPT, frontendPrompt);
    console.log('[PromptService] Prompts loaded and cached in memory successfully.');
  }

  /**
   * Retrieves prompt content from cache by its type.
   */
  public getPrompt(type: PromptType): string {
    const prompt = this.cache.get(type);
    if (prompt === undefined) {
      throw new Error(`[PromptService] Error: Prompt of type '${type}' is missing from cache.`);
    }
    return prompt;
  }

  /**
   * Manually refreshes the in-memory prompt cache.
   */
  public refreshCache(): void {
    console.log('[PromptService] Manually refreshing prompt cache...');
    this.loadPrompts();
  }

  public getPromptInfo(type: PromptType): {
    name: string;
    filePath: string;
    loaded: boolean;
    fileSize: number;
    firstFewLines: string;
  } {
    const filePath = `src/prompts/${type}.md`;
    const content = this.cache.get(type);
    if (content === undefined || content === null) {
      return {
        name: type,
        filePath,
        loaded: false,
        fileSize: 0,
        firstFewLines: '',
      };
    }
    const lines = content.split('\n').slice(0, 5).join('\n');
    return {
      name: type,
      filePath,
      loaded: content.length > 0,
      fileSize: Buffer.byteLength(content, 'utf-8'),
      firstFewLines: lines,
    };
  }

  public getAllPromptsInfo(): Array<{
    name: string;
    filePath: string;
    loaded: boolean;
    fileSize: number;
    firstFewLines: string;
  }> {
    return Object.values(PromptType).map(type => this.getPromptInfo(type));
  }

  public getDatabaseGenerationPrompt(): string {
    return this.getPrompt(PromptType.DATABASE_GENERATION);
  }

  public getQueryGenerationPrompt(): string {
    return this.getPrompt(PromptType.QUERY_GENERATION);
  }

  public getResultFormatterPrompt(): string {
    return this.getPrompt(PromptType.RESULT_FORMATTER);
  }

  public getSQLValidationPrompt(): string {
    return this.getPrompt(PromptType.SQL_VALIDATION);
  }

  public getSchemaContextPrompt(): string {
    return this.getPrompt(PromptType.SCHEMA_CONTEXT);
  }

  public getDiagramGenerationPrompt(): string {
    return this.getPrompt(PromptType.DIAGRAM_GENERATION);
  }

  public getDocumentationPrompt(): string {
    return this.getPrompt(PromptType.DOCUMENTATION);
  }

  public getBackendPrompt(): string {
    return this.getPrompt(PromptType.BACKEND_PROMPT);
  }

  public getFrontendPrompt(): string {
    return this.getPrompt(PromptType.FRONTEND_PROMPT);
  }
}
