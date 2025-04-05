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
      params: { progressToken, data: 'Waiting for Firecrawl API to be ready (60s)...' }, // Update message
    });
    await log('Waiting 60 seconds for services to start...'); // Update log
    await delay(60000); // Wait 60 seconds for services to potentially start
    // TODO: Add a proper health check here instead of fixed delay
    await log('Local Firecrawl services should be up.');
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

    let firecrawlStarted = false;
    try {
      // Start local firecrawl if configured to use it
      if (Config.firecrawl.baseUrl?.includes('localhost')) {
        await startLocalFirecrawl(serverInstance);
        firecrawlStarted = true; // Mark as started
      }

      // --- Original deep research logic starts here ---
      let currentProgress = '';

      const result = await deepResearch({
        query,
        depth,
        breadth,
        onProgress: progress => {
          const progressMsg = `Depth ${progress.currentDepth}/${progress.totalDepth}, Query ${progress.completedQueries}/${progress.totalQueries}: ${progress.currentQuery || ''}`;
          if (progressMsg !== currentProgress) {
            currentProgress = progressMsg;
            log(progressMsg); // await を削除 (fire-and-forget)

            server.server
              .notification({
                method: 'notifications/progress',
                params: {
                  progressToken: 0,
                  data: progressMsg,
                },
              })
              .catch(error => {
                log('Error sending progress notification:', error); // await を削除 (fire-and-forget)
              });
          }
        },
      });

      const report = await writeFinalReport({
        prompt: query,
        learnings: result.learnings,
        visitedUrls: result.visitedUrls,
        sourceMetadata: result.sourceMetadata,
        log: log // Pass the log function defined in this scope
      });

      // ▼▼▼ デバッグログを追加 ▼▼▼
      await log(`Report Length: ${report.length}`); // await を追加
      await log(`Report Tail (last 200 chars): ${report.slice(-200)}`); // await を追加
      // ▲▲▲ デバッグログを追加 ▲▲▲

      return {
        content: [
          {
            type: 'text',
            text: report,
          },
        ],
        metadata: {
          learnings: result.learnings,
          visitedUrls: result.visitedUrls,
          stats: {
            totalLearnings: result.learnings.length,
            totalSources: result.visitedUrls.length,
            averageReliability: result.weightedLearnings.reduce((acc, curr) => acc + curr.reliability, 0) / result.weightedLearnings.length
          },
        },
      };
    } catch (error) {
      await log( // Log error before stopping firecrawl
        'Error during deep research process:',
        error instanceof Error ? error.message : String(error),
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
         await stopLocalFirecrawl(serverInstance); // Pass the server instance
      }
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