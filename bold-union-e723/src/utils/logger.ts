import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RequestLogContext {
  requestId: string;
  endpoint: string;
  timestamp: string;
  userRole?: string;
  userEmail?: string;
  question?: string;
  historyLength?: number;
}

export class PipelineLogger {
  private context: RequestLogContext;
  private timings: Map<string, number> = new Map();
  private timers: Map<string, number> = new Map();
  private logsDir: string;

  constructor(context: Partial<RequestLogContext> = {}) {
    const now = new Date();
    this.context = {
      requestId: context.requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      endpoint: context.endpoint || '/query',
      timestamp: context.timestamp || now.toISOString(),
      userRole: context.userRole || 'anonymous',
      userEmail: context.userEmail || 'unknown',
      question: context.question || '',
      historyLength: context.historyLength || 0,
    };

    // Set logs directory to host workspace path
    this.logsDir = '/home/prajyotg/all data/cloudflare/ai-db/bold-union-e723/logs';
    this.ensureLogsDirectoryExists();
  }

  private ensureLogsDirectoryExists(): void {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
        console.log(`[PipelineLogger] Created logs directory at: ${this.logsDir}`);
      }
    } catch (err: any) {
      // Worker sandbox environment may restrict filesystem writes
    }
  }

  public getRequestId(): string {
    return this.context.requestId;
  }

  public startTimer(label: string): void {
    this.timers.set(label, performance.now());
  }

  public endTimer(label: string): number {
    const startTime = this.timers.get(label);
    if (startTime === undefined) return 0;
    const duration = parseFloat((performance.now() - startTime).toFixed(2));
    this.timings.set(label, duration);
    this.timers.delete(label);
    return duration;
  }

  public getTimings(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, val] of this.timings.entries()) {
      result[key] = val;
    }
    return result;
  }

  /**
   * Helper to write string/json content to a file in the logs/ directory.
   */
  public writeDebugFile(filename: string, content: string): string | null {
    try {
      this.ensureLogsDirectoryExists();
      const filePath = path.join(this.logsDir, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`[PipelineLogger] Saved debug file: ${filePath} (${content.length} bytes)`);
      return filePath;
    } catch (err) {
      console.log(`\n=================== [DEBUG FILE: ${filename}] ===================`);
      console.log(content);
      console.log(`=================== [END DEBUG FILE: ${filename}] ===================\n`);
      return null;
    }
  }

  // ==========================================
  // STAGE LOGGERS
  // ==========================================

  public logIncomingRequest(details: Partial<RequestLogContext>): void {
    this.context = { ...this.context, ...details };
    console.log('\n==========================================================');
    console.log('1. INCOMING API REQUEST');
    console.log('==========================================================');
    console.log(`Request ID:           ${this.context.requestId}`);
    console.log(`Endpoint:             ${this.context.endpoint}`);
    console.log(`Timestamp:            ${this.context.timestamp}`);
    console.log(`User Role:            ${this.context.userRole}`);
    console.log(`User Email:           ${this.context.userEmail}`);
    console.log(`User Question:        ${this.context.question}`);
    console.log(`Conversation History: ${this.context.historyLength} messages`);
  }

  public logSchemaContext(info: {
    loaded: boolean;
    filePath: string;
    fileSize: number;
    firstFewLines: string;
  }): void {
    console.log('\n----------------------------------------------------------');
    console.log('2. SCHEMA CONTEXT LOG');
    console.log('----------------------------------------------------------');
    console.log(`Loaded:               ${info.loaded ? 'YES' : 'NO'}`);
    console.log(`File Path:            ${info.filePath}`);
    console.log(`File Size:            ${info.fileSize} bytes`);
    console.log(`First Few Lines:\n${info.firstFewLines}`);
  }

  public logDocumentationContext(prompts: Array<{
    name: string;
    filePath: string;
    loaded: boolean;
    fileSize: number;
    firstFewLines: string;
  }>): void {
    console.log('\n----------------------------------------------------------');
    console.log('3. DOCUMENTATION / PROMPT CONTEXT LOG');
    console.log('----------------------------------------------------------');
    for (const p of prompts) {
      console.log(`- Prompt Name: ${p.name}`);
      console.log(`  Loaded:     ${p.loaded ? 'YES' : 'NO'}`);
      console.log(`  File Path:  ${p.filePath}`);
      console.log(`  File Size:  ${p.fileSize} bytes`);
      console.log(`  Preview:    ${p.firstFewLines.replace(/\n/g, ' ')}`);
    }
  }

  public logDatabaseMetadata(details: {
    fetchStarted: string;
    fetchCompleted: string;
    executionTimeMs: number;
    totalTables: number;
    totalColumns: number;
    totalForeignKeys: number;
    totalIndexes: number;
    totalFunctions: number;
    totalProcedures: number;
    totalTriggers: number;
    totalViews: number;
    rawMetadataObj: any;
    summaryString: string;
  }): void {
    console.log('\n----------------------------------------------------------');
    console.log('4. DATABASE METADATA LOG');
    console.log('----------------------------------------------------------');
    console.log(`Fetch Started:        ${details.fetchStarted}`);
    console.log(`Fetch Completed:      ${details.fetchCompleted}`);
    console.log(`Execution Time:       ${details.executionTimeMs} ms`);
    console.log(`Number of Tables:     ${details.totalTables}`);
    console.log(`Number of Columns:    ${details.totalColumns}`);
    console.log(`Number of Foreign Keys: ${details.totalForeignKeys}`);
    console.log(`Number of Indexes:    ${details.totalIndexes}`);
    console.log(`Number of Functions:  ${details.totalFunctions}`);
    console.log(`Number of Stored Procs: ${details.totalProcedures}`);
    console.log(`Number of Triggers:   ${details.totalTriggers}`);
    console.log(`Number of Views:      ${details.totalViews}`);

    const timestamp = Date.now();
    this.writeDebugFile(`metadata_${timestamp}.json`, JSON.stringify(details.rawMetadataObj, null, 2));
    this.writeDebugFile(`schema_summary_${timestamp}.txt`, details.summaryString);
  }

  public logFinalPromptPrep(details: {
    totalPromptLength: number;
    systemPromptLength: number;
    markdownContextLength: number;
    schemaSummaryLength: number;
    userQuestion: string;
    finalCombinedPrompt: string;
  }): void {
    console.log('\n----------------------------------------------------------');
    console.log('5. FINAL PROMPT PREPARATION LOG');
    console.log('----------------------------------------------------------');
    console.log(`System Prompt Length:    ${details.systemPromptLength} chars`);
    console.log(`Markdown Context Length: ${details.markdownContextLength} chars`);
    console.log(`Schema Summary Length:   ${details.schemaSummaryLength} chars`);
    console.log(`User Question:           "${details.userQuestion}"`);
    console.log(`Total Prompt Size:       ${details.totalPromptLength} chars`);

    const timestamp = Date.now();
    this.writeDebugFile(`gemini_request_${timestamp}.txt`, details.finalCombinedPrompt);
  }

  public logGeminiRequest(details: {
    modelName: string;
    endpoint: string;
    requestTimestamp: string;
    payloadSize: number;
    generationConfig: any;
  }): void {
    console.log('\n----------------------------------------------------------');
    console.log('6. GEMINI REQUEST LOG');
    console.log('----------------------------------------------------------');
    console.log(`Model Name:            ${details.modelName}`);
    console.log(`Endpoint:              ${details.endpoint}`);
    console.log(`Request Timestamp:     ${details.requestTimestamp}`);
    console.log(`Payload Size:          ${details.payloadSize} bytes`);
    console.log(`Generation Config:     ${JSON.stringify(details.generationConfig || {})}`);
    console.log(`Temperature:           ${details.generationConfig?.temperature ?? 'default'}`);
    console.log(`TopP:                  ${details.generationConfig?.topP ?? 'default'}`);
    console.log(`TopK:                  ${details.generationConfig?.topK ?? 'default'}`);
    console.log(`Max Output Tokens:     ${details.generationConfig?.maxOutputTokens ?? 'default'}`);
  }

  public logGeminiResponse(details: {
    responseTimeMs: number;
    tokenUsage?: any;
    finishReason?: string;
    candidateCount: number;
    rawGeminiResponse: any;
    rawText: string;
  }): void {
    console.log('\n----------------------------------------------------------');
    console.log('7. GEMINI RESPONSE LOG');
    console.log('----------------------------------------------------------');
    console.log(`Response Received:     YES`);
    console.log(`Response Time:         ${details.responseTimeMs} ms`);
    console.log(`Candidate Count:       ${details.candidateCount}`);
    console.log(`Finish Reason:         ${details.finishReason || 'N/A'}`);
    console.log(`Token Usage:           ${JSON.stringify(details.tokenUsage || {})}`);
    console.log(`Raw Gemini Text:\n${details.rawText}`);

    const timestamp = Date.now();
    this.writeDebugFile(
      `gemini_response_${timestamp}.txt`,
      typeof details.rawGeminiResponse === 'string'
        ? details.rawGeminiResponse
        : JSON.stringify(details.rawGeminiResponse, null, 2)
    );
  }

  public logResponseParsing(details: {
    rawText: string;
    parsedText: string;
    jsonParsingStatus: string;
    formattingCleanup: string[];
  }): void {
    console.log('\n----------------------------------------------------------');
    console.log('8. RESPONSE PARSING LOG');
    console.log('----------------------------------------------------------');
    console.log(`Raw Text Length:        ${details.rawText.length} chars`);
    console.log(`Parsed Text Preview:    ${details.parsedText.substring(0, 150)}...`);
    console.log(`JSON Parsing Status:    ${details.jsonParsingStatus}`);
    console.log(`Formatting Cleanup:     ${details.formattingCleanup.join(', ') || 'None'}`);
  }

  public logFinalApiResponse(details: {
    responseSize: number;
    totalExecutionTimeMs: number;
    payloadPreview: any;
  }): void {
    console.log('\n----------------------------------------------------------');
    console.log('9. FINAL API RESPONSE LOG');
    console.log('----------------------------------------------------------');
    console.log(`Response Size:          ${details.responseSize} bytes`);
    console.log(`Total Execution Time:   ${details.totalExecutionTimeMs} ms`);
    console.log(`Timings Breakdown:      ${JSON.stringify(this.getTimings())}`);
    console.log('==========================================================\n');
  }

  public logError(error: any, snapshotContext: any = {}): void {
    const timestamp = Date.now();
    console.log('\n==========================================================');
    console.log('ERROR LOGGED IN PIPELINE');
    console.log('==========================================================');
    console.error(`Request ID:           ${this.context.requestId}`);
    console.error(`Endpoint:             ${this.context.endpoint}`);
    console.error(`User Question:        ${this.context.question}`);
    console.error(`Error Message:        ${error?.message || String(error)}`);
    console.error(`Full Stack Trace:\n${error?.stack || 'No stack trace available'}`);

    const errorDetails = {
      timestamp: new Date().toISOString(),
      requestId: this.context.requestId,
      endpoint: this.context.endpoint,
      userQuestion: this.context.question,
      userEmail: this.context.userEmail,
      userRole: this.context.userRole,
      errorMessage: error?.message || String(error),
      errorStack: error?.stack,
      rawErrorObj: error,
      snapshotContext,
      timings: this.getTimings()
    };

    const logStr = JSON.stringify(errorDetails, Object.getOwnPropertyNames(error).concat(['timestamp', 'requestId', 'endpoint', 'userQuestion', 'errorMessage', 'errorStack', 'snapshotContext', 'timings']), 2);
    this.writeDebugFile(`error_${timestamp}.log`, logStr);
  }
}
