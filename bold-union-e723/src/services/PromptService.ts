import databaseGenerationPrompt from '../prompts/database_generation.md';
import queryGenerationPrompt from '../prompts/query_generation.md';
import resultFormatterPrompt from '../prompts/result_formatter.md';
import sqlValidationPrompt from '../prompts/sql_validation.md';
import schemaContextPrompt from '../prompts/schema_context.md';
import diagramGenerationPrompt from '../prompts/diagram_generation.md';
import documentationGenerationPrompt from '../prompts/documentation_generation.md';
import tableDetailsGenerationPrompt from '../prompts/table_details_generation.md';
import relationshipExplanationsPrompt from '../prompts/relationship_explanations.md';
import walkthroughGenerationPrompt from '../prompts/walkthrough_generation.md';
import architectReviewPrompt from '../prompts/architect_review.md';

export enum PromptType {
  DATABASE_GENERATION = 'database_generation',
  QUERY_GENERATION = 'query_generation',
  RESULT_FORMATTER = 'result_formatter',
  SQL_VALIDATION = 'sql_validation',
  SCHEMA_CONTEXT = 'schema_context',
  DIAGRAM_GENERATION = 'diagram_generation',
  DOCUMENTATION_GENERATION = 'documentation_generation',
  TABLE_DETAILS_GENERATION = 'table_details_generation',
  RELATIONSHIP_EXPLANATIONS = 'relationship_explanations',
  WALKTHROUGH_GENERATION = 'walkthrough_generation',
  ARCHITECT_REVIEW = 'architect_review',
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
    this.cache.set(PromptType.DOCUMENTATION_GENERATION, documentationGenerationPrompt);
    this.cache.set(PromptType.TABLE_DETAILS_GENERATION, tableDetailsGenerationPrompt);
    this.cache.set(PromptType.RELATIONSHIP_EXPLANATIONS, relationshipExplanationsPrompt);
    this.cache.set(PromptType.WALKTHROUGH_GENERATION, walkthroughGenerationPrompt);
    this.cache.set(PromptType.ARCHITECT_REVIEW, architectReviewPrompt);
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

  public getDocumentationGenerationPrompt(): string {
    return this.getPrompt(PromptType.DOCUMENTATION_GENERATION);
  }

  public getTableDetailsGenerationPrompt(): string {
    return this.getPrompt(PromptType.TABLE_DETAILS_GENERATION);
  }

  public getRelationshipExplanationsPrompt(): string {
    return this.getPrompt(PromptType.RELATIONSHIP_EXPLANATIONS);
  }

  public getWalkthroughGenerationPrompt(): string {
    return this.getPrompt(PromptType.WALKTHROUGH_GENERATION);
  }

  public getArchitectReviewPrompt(): string {
    return this.getPrompt(PromptType.ARCHITECT_REVIEW);
  }
}

