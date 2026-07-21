import { PromptService, PromptType } from './PromptService';

export class GeminiService {
  private apiKey: string;
  private promptService: PromptService;

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
    additionalContext?: string
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

    console.log(`[GeminiService] Calling Gemini API for PromptType: ${type}...`);
    
    // We request JSON format for SQL/Schema generation and plain text for formatting responses
    const requestJson = type !== PromptType.RESULT_FORMATTER;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: fullPrompt }]
            }],
            generationConfig: requestJson ? { responseMimeType: 'application/json' } : undefined
          })
        }
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'No response body');
        console.error(`[GeminiService] HTTP Error from Gemini API: ${response.status} - ${errorBody}`);
        throw new Error(`Gemini API connection error: status ${response.status}`);
      }

      const responseData = await response.json() as any;
      const contentText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!contentText) {
        console.error('[GeminiService] Empty candidates or empty text response returned from Gemini API.');
        throw new Error('Gemini API returned an empty response.');
      }

      return contentText.trim();
    } catch (error: any) {
      console.error('[GeminiService] Exception during Gemini API call:', error);
      throw new Error(`Failed to generate content via Gemini LLM: ${error.message || String(error)}`);
    }
  }

  /**
   * Directly generates content from a pre-assembled, fully grounded prompt string.
   */
  public async generateDirect(fullPrompt: string, requestJson: boolean = false): Promise<string> {
    console.log('[GeminiService] Calling Gemini API with direct grounded context...');
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: fullPrompt }]
            }],
            generationConfig: requestJson ? { responseMimeType: 'application/json' } : undefined
          })
        }
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'No response body');
        console.error(`[GeminiService] HTTP Error from Gemini API: ${response.status} - ${errorBody}`);
        throw new Error(`Gemini API connection error: status ${response.status}`);
      }

      const responseData = await response.json() as any;
      const contentText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!contentText) {
        throw new Error('Gemini API returned an empty response.');
      }

      return contentText.trim();
    } catch (error: any) {
      console.error('[GeminiService] Exception during direct Gemini API call:', error);
      throw new Error(`Failed to generate content via Gemini LLM: ${error.message || String(error)}`);
    }
  }
}
