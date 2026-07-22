import { PromptService, PromptType } from './PromptService';
import { PipelineLogger } from '../utils/logger';

export class GeminiService {
  private apiKey: string;
  private promptService: PromptService;
  private modelName = 'gemini-1.5-flash';

  constructor(apiKey: string, promptService: PromptService) {
    if (!apiKey) {
      throw new Error('[GeminiService] Initialization Error: GEMINI_API_KEY is missing.');
    }
    this.apiKey = apiKey;
    this.promptService = promptService;
  }

  /**
   * Generates content from Gemini by fetching the specified prompt file,
   * combining it with the runtime context and the user query, and posting it.
   */
  public async generate(
    type: PromptType,
    userRequest: string,
    additionalContext?: string,
    logger?: PipelineLogger
  ): Promise<string> {
    let systemPrompt = this.promptService.getPrompt(type);

    // If generating a query, prepend the schema_context prompt for better accuracy
    if (type === PromptType.QUERY_GENERATION) {
      const schemaContext = this.promptService.getPrompt(PromptType.SCHEMA_CONTEXT);
      if (schemaContext && schemaContext.trim()) {
        systemPrompt = `${schemaContext}\n\n${systemPrompt}`;
      }
    }

    // Assemble the payload components
    const contextSection = additionalContext ? `[RUNTIME CONTEXT]\n${additionalContext}\n\n` : '';
    const userSection = `[USER REQUEST / QUESTION]\n${userRequest}`;
    
    // Combine everything into a single prompt string sent to Gemini
    const fullPrompt = `${systemPrompt}\n\n${contextSection}${userSection}`;

    return this.generateDirect(fullPrompt, type !== PromptType.RESULT_FORMATTER, logger);
  }

  /**
   * Directly generates content from a pre-assembled, fully grounded prompt string.
   */
  public async generateDirect(
    fullPrompt: string,
    requestJson: boolean = false,
    logger?: PipelineLogger
  ): Promise<string> {
    const generationConfig = requestJson ? { responseMimeType: 'application/json' } : undefined;
    const payloadObj = {
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      generationConfig
    };
    const payloadStr = JSON.stringify(payloadObj);
    const candidateModels = [this.modelName, 'gemini-1.5-pro', 'gemini-2.0-flash'];
    let lastError: Error | null = null;

    for (const model of candidateModels) {
      const fullEndpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      logger?.startTimer(`Gemini API call (${model})`);
      const geminiCallStartTime = performance.now();

      try {
        const response = await fetch(
          fullEndpointUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadStr
          }
        );

        const geminiCallDuration = parseFloat((performance.now() - geminiCallStartTime).toFixed(2));
        logger?.endTimer(`Gemini API call (${model})`);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'No response body');
          console.warn(`[GeminiService] HTTP Error from Gemini API (${model}): ${response.status} - ${errorBody}`);
          lastError = new Error(`Gemini API connection error (${model}): status ${response.status} - ${errorBody}`);
          continue;
        }

        const responseData = await response.json() as any;
        const candidate = responseData.candidates?.[0];
        const contentText = candidate?.content?.parts?.[0]?.text;
        const finishReason = candidate?.finishReason;
        const tokenUsage = responseData.usageMetadata;
        const candidateCount = responseData.candidates?.length || 0;

        logger?.logGeminiResponse({
          responseTimeMs: geminiCallDuration,
          tokenUsage,
          finishReason,
          candidateCount,
          rawGeminiResponse: responseData,
          rawText: contentText || ''
        });

        if (!contentText) {
          lastError = new Error(`Gemini API (${model}) returned an empty response or missing text part.`);
          continue;
        }

        return contentText.trim();
      } catch (err: any) {
        lastError = err;
        console.warn(`[GeminiService] Exception calling ${model}:`, err.message);
      }
    }

    throw lastError || new Error('Failed to generate content via Gemini LLM across all candidate models.');
  }
}
