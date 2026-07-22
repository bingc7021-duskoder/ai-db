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
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey.substring(0, 8)}...`;
    const fullEndpointUrl = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;
    const generationConfig = requestJson ? { responseMimeType: 'application/json' } : undefined;

    const payloadObj = {
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      generationConfig
    };
    const payloadStr = JSON.stringify(payloadObj);
    const requestTimestamp = new Date().toISOString();

    logger?.logGeminiRequest({
      modelName: this.modelName,
      endpoint,
      requestTimestamp,
      payloadSize: Buffer.byteLength(payloadStr, 'utf-8'),
      generationConfig
    });

    logger?.startTimer('Gemini API call');
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
      logger?.endTimer('Gemini API call');

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'No response body');
        console.error(`[GeminiService] HTTP Error from Gemini API: ${response.status} - ${errorBody}`);
        const httpErr = new Error(`Gemini API connection error: status ${response.status} - ${errorBody}`);
        logger?.logError(httpErr, { httpStatus: response.status, errorBody });
        throw httpErr;
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
        const emptyErr = new Error('Gemini API returned an empty response or missing text part.');
        logger?.logError(emptyErr, { responseData });
        throw emptyErr;
      }

      return contentText.trim();
    } catch (error: any) {
      console.error('[GeminiService] Exception during Gemini API call:', error);
      logger?.logError(error, { fullPromptLength: fullPrompt.length });
      throw new Error(`Failed to generate content via Gemini LLM: ${error.message || String(error)}`);
    }
  }
}
