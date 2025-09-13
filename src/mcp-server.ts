import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { Config } from './config.js';
import { deepResearch, writeFinalReport } from './deep-research.js';
import { getModel } from './ai/providers.js';

// Helper function to log to stderr
const log = (...args: any[]) => {
  process.stderr.write(
    args
      .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ') + '\n',
  );
};

// Log environment check
log('Environment check:', {
  hasOpenAiKey: !!Config.openai.apiKey,
  hasGoogleKey: !!Config.google.apiKey,
  hasAnthropicKey: !!Config.anthropic.apiKey,
  hasXaiKey: !!Config.xai.apiKey,
  hasFirecrawlKey: !!Config.firecrawl.apiKey,
  firecrawlBaseUrl: Config.firecrawl.baseUrl || '(using API)',
  firecrawlConcurrency: Config.firecrawl.concurrency,
});

const server = new McpServer({
  name: 'deep-research',
  version: '1.0.0',
}, { capabilities: { logging: {} } });

// List available models tool
server.tool(
  'list-models',
  'List all available AI models with their capabilities and intelligence ratings',
  {},
  async () => {
    try {
      const { getAvailableProviders } = await import('./ai/providers.js');
      const providers = getAvailableProviders();
      
      if (providers.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No models available. Please set at least one API key: OPENAI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY'
          }]
        };
      }
      
      const modelList = providers.map(p => 
        `${p.provider}:${p.model} (Intelligence: ${p.intelligence}/100)`
      ).join('\n');
      
      return {
        content: [{
          type: 'text', 
          text: `Available Models:\n${modelList}\n\nUsage: Use format "provider:model" (e.g., "google:gemini-2.5-pro") or leave empty for best available model.`
        }],
        metadata: { providers }
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Error listing models: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// Define the deep research tool
server.tool(
  'deep-research',
  'Perform deep research on a topic using AI-powered web search',
  {
    query: z.string().min(1).describe("The research query to investigate"),
    depth: z.number().min(1).max(5).describe("How deep to go in the research tree (1-5)"),
    breadth: z.number().min(1).max(5).describe("How broad to make each research level (1-5)"),
    model: z.string().optional().describe('Model specifier (use list-models tool to see options). Format: "provider:model" (e.g. "google:gemini-2.5-pro", "openai:o1", "anthropic:claude-3-5-sonnet-20241022"). Leave empty for best available model.'),
    tokenBudget: z.number().optional().describe('Optional soft cap for total research-phase tokens; final report not counted'),
    sourcePreferences: z.string().optional().describe('Natural-language preferences for sources to avoid (e.g., "avoid SEO top 10 listicles, forums, affiliate reviews")'),
  },
  async ({ query, depth, breadth, model: modelSpec, tokenBudget, sourcePreferences }, { sendNotification }) => {
    try {
      let currentProgress = '';

      const model = getModel(modelSpec);
      log(`Using model: ${modelSpec || 'auto (best available)'}`);
      const result = await deepResearch({
        query,
        depth,
        breadth,
        model,
        tokenBudget,
        sourcePreferences,
        onProgress: async progress => {
          const progressMsg = `Depth ${progress.currentDepth}/${progress.totalDepth}, Query ${progress.completedQueries}/${progress.totalQueries}: ${progress.currentQuery || ''}`;
          if (progressMsg !== currentProgress) {
            currentProgress = progressMsg;
            log(progressMsg);

            try {
              await sendNotification({
                method: 'notifications/message',
                params: {
                  level: 'info',
                  data: progressMsg,
                },
              });
            } catch (error) {
              log('Error sending progress notification:', error);
            }
          }
        },
      });

      const report = await writeFinalReport({
        prompt: query,
        learnings: result.learnings,
        visitedUrls: result.visitedUrls,
        sourceMetadata: result.sourceMetadata,
        model
      });

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
      log(
        'Error in deep research:',
        error instanceof Error ? error.message : String(error),
      );
      return {
        content: [
          {
            type: 'text',
            text: `Error performing research: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('Deep Research MCP Server running on stdio');
  } catch (error) {
    log('Error starting server:', error);
    process.exit(1);
  }
}

// Handle server shutdown
process.on('SIGINT', async () => {
  log('Shutting down server...');
  await server.close();
  process.exit(0);
});

main().catch(error => {
  log('Fatal error in main():', error);
  process.exit(1);
});