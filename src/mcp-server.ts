import crypto from 'crypto'; // Import crypto module
// Standard Node.js modules
import { exec as execCallback } from 'child_process';
import fs from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import util from 'util';

// Third-party libraries
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Local modules
import { Config } from './config.js';
import { deepResearch, writeFinalReport } from './deep-research.js';

// --- Setup ---

// Promisify exec
const exec = util.promisify(execCallback);

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to localfirecrawl directory (relative to the built dist/ directory)
const localFirecrawlPath = path.resolve(__dirname, '../../localfirecrawl');

// Helper function for timeout
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// File logging setup
const logFilePath = path.resolve(__dirname, '../deep-research-mcp.log'); // Log file in project root (dist/../)
const log = async (...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = args
    .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ');
  try {
    // Ensure the log directory exists (optional, fs.appendFile creates the file but not dirs)
    // Ensure the log directory exists (optional, fs.appendFile creates the file but not dirs)
    // await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.appendFile(logFilePath, `${timestamp} - ${message}\n`, 'utf-8');
  } catch (error) {
    console.error(`Failed to write to log file ${logFilePath}:`, error);
    console.error(`Original log message: ${timestamp} - ${message}`);
  }
};


// --- Docker Control Functions ---

// Docker 起動関数
async function startLocalFirecrawl(serverInstance: McpServer) {
  const progressToken = Date.now(); // Simple progress token
  try {
    await serverInstance.server.notification({
      method: 'notifications/progress',
      params: { progressToken, data: 'Starting local Firecrawl containers...' },
    });
    await log('Attempting to start local Firecrawl...');
    // Execute docker-compose up -d in the localfirecrawl directory
    const { stdout, stderr } = await exec('docker-compose up -d', { cwd: localFirecrawlPath });
    await log('docker-compose up stdout:', stdout);
    if (stderr) {
      await log('docker-compose up stderr:', stderr);
      // Potentially ignore certain stderr messages if they are not critical errors
    }
    await serverInstance.server.notification({
      method: 'notifications/progress',
      params: { progressToken, data: 'Waiting for Firecrawl API to be ready...' },
    });
    await log('[MCP Server] Waiting for Firecrawl API to become ready...');

    const healthCheckUrl = Config.firecrawl.baseUrl || 'http://localhost:3002'; // Use configured base URL or default
    const maxWaitTime = 90000; // Max wait 90 seconds
    const interval = 3000; // Check every 3 seconds
    const startTime = Date.now();
    let isReady = false;
    let attempt = 0;

    while (Date.now() - startTime < maxWaitTime) {
      attempt++;
      try {
        // Use fetch API for health check (available in Node.js 18+)
        const response = await fetch(healthCheckUrl, { method: 'GET', signal: AbortSignal.timeout(2000) }); // 2 sec timeout for check
        if (response.ok || response.status === 404) { // Consider 404 on base path as ready
          isReady = true;
          await log(`[MCP Server] Firecrawl API is ready after ${Date.now() - startTime}ms (Attempt ${attempt})`);
          await serverInstance.server.notification({
             method: 'notifications/progress',
             params: { progressToken, data: `Firecrawl API ready (Attempt ${attempt})` },
          });
          break;
        }
      } catch (error: any) {
        // Log connection errors, but continue retrying
        if (error.name === 'AbortError') {
           await log(`[MCP Server] Health check attempt ${attempt} timed out.`);
        } else {
           await log(`[MCP Server] Health check attempt ${attempt} failed: ${error.message}`);
        }
      }
       await serverInstance.server.notification({
         method: 'notifications/progress',
         params: { progressToken, data: `Waiting for Firecrawl API... (Attempt ${attempt})` },
       });
      await delay(interval);
    }

    if (!isReady) {
      throw new Error(`Firecrawl API did not become ready within ${maxWaitTime / 1000} seconds.`);
    }
    // Original log after successful check (or timeout)
    // await log('Local Firecrawl services should be up.'); // Removed as readiness is confirmed above
     await serverInstance.server.notification({
      method: 'notifications/progress',
      params: { progressToken, data: 'Local Firecrawl ready.' },
    });
  } catch (error: any) {
    await log('Error starting local Firecrawl:', error);
     await serverInstance.server.notification({
      method: 'notifications/progress',
      params: { progressToken, data: `Error starting local Firecrawl: ${error.message}` },
    });
    // Re-throw the error to stop the deep-research process
    throw new Error(`Failed to start local Firecrawl: ${error.message}`);
  }
}

// Docker 停止関数
async function stopLocalFirecrawl(serverInstance: McpServer) {
   const progressToken = Date.now();
  // serverInstance is passed as an argument, no need to get from context here

  try {
    // Start local firecrawl if configured to use it
    if (Config.firecrawl.baseUrl?.includes('localhost')) {
      await startLocalFirecrawl(serverInstance);
    }
     await serverInstance.server.notification({
      method: 'notifications/progress',
      params: { progressToken, data: 'Stopping local Firecrawl containers...' },
    });
    await log('Attempting to stop local Firecrawl...');
    const { stdout, stderr } = await exec('docker-compose down', { cwd: localFirecrawlPath });
    await log('docker-compose down stdout:', stdout);
     if (stderr) {
      await log('docker-compose down stderr:', stderr);
    }
    await log('Local Firecrawl services stopped.');
     await serverInstance.server.notification({
      method: 'notifications/progress',
      params: { progressToken, data: 'Local Firecrawl stopped.' },
    });
  } catch (error: any) {
    await log('Error stopping local Firecrawl:', error);
     await serverInstance.server.notification({
      method: 'notifications/progress',
      params: { progressToken, data: `Error stopping local Firecrawl: ${error.message}` },
    });
    // Log the error but don't re-throw, allow the main process to finish
  }
}

// --- End Docker Control Functions ---

// Log environment check
log('Environment check:', {
  hasOpenAiKey: !!Config.openai.apiKey,
  hasFirecrawlKey: !!Config.firecrawl.apiKey,
  firecrawlBaseUrl: Config.firecrawl.baseUrl || '(using API)',
  firecrawlConcurrency: Config.firecrawl.concurrency,
});

const server = new McpServer({
  name: 'deep-research',
  version: '1.0.0',
});

// Define the deep research tool
server.tool(
  'deep-research',
  'Perform deep research on a topic using AI-powered web search',
  {
    query: z.string().min(1).describe("The research query to investigate"),
    depth: z.number().min(1).max(5).describe("How deep to go in the research tree (1-5)"),
    breadth: z.number().min(1).max(5).describe("How broad to make each research level (1-5)")
  },
  async ({ query, depth, breadth }, context) => { // Add context
    // Use the 'server' instance defined in the outer scope
    const serverInstance = server; // Use the outer 'server' variable

    const executionStartTime = Date.now(); // Record start time
    await log(`[MCP Server] Starting deep research for query: "${query}" (Depth: ${depth}, Breadth: ${breadth})`);
    let firecrawlStarted = false;
    try {
      // Start local firecrawl if configured to use it
      if (Config.firecrawl.baseUrl?.includes('localhost')) {
        await startLocalFirecrawl(serverInstance);
        firecrawlStarted = true; // Mark as started
      }

      // --- Original deep research logic starts here ---
      const researchStartTime = Date.now();
      await log('[MCP Server] Calling deepResearch function...');
      let currentProgress = '';

      const result = await deepResearch({
        query,
        depth,
        breadth,
        onProgress: progress => {
          const progressMsg = `Depth ${progress.currentDepth}/${progress.totalDepth}, Query ${progress.completedQueries}/${progress.totalQueries}: ${progress.currentQuery || ''}`;
          if (progressMsg !== currentProgress) {
            currentProgress = progressMsg;
            log(progressMsg); // Fire-and-forget log

            serverInstance.server // Use serverInstance here
              .notification({
                method: 'notifications/progress',
                params: {
                  progressToken: 0, // Consider using a unique token if needed
                  data: progressMsg,
                },
              })
              .catch(error => {
                log('Error sending progress notification:', error); // Fire-and-forget log
              });
          }
        },
      });
      const researchEndTime = Date.now();
      await log(`[MCP Server] deepResearch function completed. Duration: ${researchEndTime - researchStartTime}ms`);

      const reportGenStartTime = Date.now();
      await log('[MCP Server] Calling writeFinalReport function...');
      const report = await writeFinalReport({
        prompt: query,
        learnings: result.learnings,
        visitedUrls: result.visitedUrls,
        sourceMetadata: result.sourceMetadata,
        log: log // Pass the log function defined in this scope
      });
      const reportGenEndTime = Date.now();
      await log(`[MCP Server] writeFinalReport completed. Duration: ${reportGenEndTime - reportGenStartTime}ms`);

      // ▼▼▼ デバッグログ (Keep for now) ▼▼▼
      await log(`[MCP Server] Final Report Length: ${report.length}`);
      await log(`[MCP Server] Final Report Tail (last 200 chars): ${report.slice(-200)}`);
      // ▲▲▲ デバッグログを追加 ▲▲▲

      // --- Save sources to JSON file ---
      let sourceFilePath = null;
      if (result.sourceMetadata && result.sourceMetadata.length > 0) {
        try {
          const reportSourceDir = path.resolve(__dirname, '../report_source');
          await fs.mkdir(reportSourceDir, { recursive: true }); // Ensure directory exists
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // Keep timestamp
          // Create a SHA1 hash of the query for a safe and unique filename part
          const queryHash = crypto.createHash('sha1').update(query).digest('hex').substring(0, 10); // Use first 10 chars of hash
          const filename = `sources_${timestamp}_${queryHash}.json`;
          sourceFilePath = path.join(reportSourceDir, filename);
          const sourceJson = JSON.stringify(result.sourceMetadata, null, 2);
          await fs.writeFile(sourceFilePath, sourceJson, 'utf-8');
          await log(`[MCP Server] Source metadata saved to: ${sourceFilePath}`);
        } catch (writeError) {
          await log('[MCP Server] Error saving source metadata to file:', writeError);
          // Continue without saving if there's an error, but log it
        }
      }
      // --- End Save sources ---

      const finalReturnTime = Date.now();
      await log(`[MCP Server] Total execution time (before finally): ${finalReturnTime - executionStartTime}ms`);

      return {
        content: [
          {
            type: 'text',
            text: report, // Report content without sources appended
          },
        ],
        metadata: {
          learnings: result.learnings,
          visitedUrls: result.visitedUrls,
          sources: result.sourceMetadata, // Keep sources in metadata for now
          sourceFilePath: sourceFilePath, // Add the path to the saved file
          stats: {
            totalLearnings: result.learnings.length,
            totalSources: result.sourceMetadata.length, // Use sourceMetadata length for total sources
            averageReliability: result.weightedLearnings.length > 0
              ? result.weightedLearnings.reduce((acc, curr) => acc + curr.reliability, 0) / result.weightedLearnings.length
              : 0 // Avoid division by zero if no weighted learnings
          },
        },
      };
    } catch (error) {
      const errorTime = Date.now();
      await log( // Log error before stopping firecrawl
        `[MCP Server] Error during deep research process. Duration: ${errorTime - executionStartTime}ms`,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : '' // Log stack trace if available
      );
      // Return error, finally block will handle stopping firecrawl
      return {
        content: [
          {
            type: 'text',
            text: `Error performing research: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    } finally {
       // Stop local firecrawl if it was started
      if (firecrawlStarted) {
         const stopStartTime = Date.now();
         await log('[MCP Server] Stopping local Firecrawl in finally block...');
         await stopLocalFirecrawl(serverInstance); // Pass the server instance
         const stopEndTime = Date.now();
         await log(`[MCP Server] Local Firecrawl stopped. Duration: ${stopEndTime - stopStartTime}ms`);
      }
      const totalEndTime = Date.now();
      await log(`[MCP Server] Total handler execution time (including finally): ${totalEndTime - executionStartTime}ms`);
    }
  },
);

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await log('Deep Research MCP Server running on stdio'); // await を追加
  } catch (error) {
    await log('Error starting server:', error); // await を追加
    process.exit(1);
  }
}

main().catch(error => {
  log('Fatal error in main():', error); // await を削除 (fire-and-forget)
  process.exit(1);
});