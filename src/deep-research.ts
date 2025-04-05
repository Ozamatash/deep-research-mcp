import fs from 'fs/promises';
import path, { dirname } from 'path';
// import { fileURLToPath } from 'url'; // Already imported below

// Get the directory name of the current module for logging
const __filename_log = fileURLToPath(import.meta.url);
const __dirname_log = dirname(__filename_log);

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { config } from 'dotenv';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { o3MiniModel, trimPrompt } from './ai/providers.js';
import { firecrawl as firecrawlConfig } from './config.js';
import { OutputManager } from './output-manager.js';
import { systemPrompt } from './prompt.js';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

// Initialize output manager for coordinated console/progress output
const output = new OutputManager();

// Original log function using OutputManager removed to avoid conflict
// function log(...args: any[]) {
//   output.log(...args);
// }

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  parentQuery?: string; // Track parent query for showing relationships
  totalQueries: number;
  completedQueries: number;
  learningsCount?: number; // Track learnings for this branch
  learnings?: string[]; // The actual learnings content
  followUpQuestions?: string[]; // Follow-up questions generated
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

type SourceMetadata = {
  url: string;
  title?: string;
  publishDate?: string;
  domain: string;
  relevanceScore?: number;
  reliabilityScore: number;
  reliabilityReasoning: string;
};

// Configurable concurrency limit
const ConcurrencyLimit = firecrawlConfig.concurrency;

// Initialize Firecrawl with config
const firecrawl = new FirecrawlApp({
  apiKey: firecrawlConfig.apiKey,
  apiUrl: firecrawlConfig.baseUrl,
});

type LearningWithReliability = {
  content: string;
  reliability: number;
};

export type ResearchDirection = {
  question: string;
  priority: number;
  parentGoal?: string;  // Track which research goal led to this question
};

async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  learningReliabilities,
  researchDirections = [],
  log, // Add log parameter
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  learningReliabilities?: number[];
  researchDirections?: ResearchDirection[];
  log: (...args: any[]) => Promise<void>; // Add log type
}) {
  // Convert to properly typed weighted learnings
  const weightedLearnings: LearningWithReliability[] = learnings && learningReliabilities 
    ? learnings.map((content, i) => ({
        content,
        reliability: learningReliabilities[i] || 0.5
      }))
    : [];

  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other.

${weightedLearnings.length > 0 
  ? `Here are previous learnings with their reliability scores (higher score means more reliable):
${weightedLearnings.map(l => `[Reliability: ${l.reliability.toFixed(2)}] ${l.content}`).join('\n')}

When generating new queries:
- Follow up on promising leads from reliable sources (reliability >= 0.7)
- For less reliable information (reliability < 0.7), consider generating verification queries that are likely to find authoritative sources
- Make each query specific and targeted to advance the research in a clear direction`
  : ''}

${researchDirections.length > 0 
  ? `\nPrioritized research directions to explore (higher priority = more important):
${researchDirections
  .sort((a, b) => b.priority - a.priority)
  .map(d => `[Priority: ${d.priority}] ${d.question}${d.parentGoal ? `\n  (From previous goal: ${d.parentGoal})` : ''}`)
  .join('\n')}

Focus on generating queries that address these research directions, especially the higher priority ones.`
  : ''}

<prompt>${query}</prompt>`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions. Be as specific as possible, especially for additional research directions.',
              ),
            reliabilityThreshold: z
              .number()
              .describe('Minimum reliability score (between 0 and 1) needed for sources to be considered trustworthy for this query. Higher values (e.g. 0.7+) for verification queries, lower values (e.g. 0.3) for exploratory queries.'),
            isVerificationQuery: z
              .boolean()
              .describe('Whether this query is specifically trying to verify information from less reliable sources'),
            relatedDirection: z
              .string()
              .nullable()
              .describe('If this query addresses a specific research direction from the input, specify which one. Set to null if not applicable.')
          })
        )
        .describe(`List of SERP queries. Generate at most ${numQueries} queries, but feel free to return less if the original prompt is clear. Each query should be unique and advance the research in a meaningful way.`),
    }),
  });

  // Ensure reliability thresholds are within valid range
  const validatedQueries = res.object.queries.map(query => ({
    ...query,
    reliabilityThreshold: Math.max(0, Math.min(1, query.reliabilityThreshold))
  }));

  // Log more detailed information about query generation
  const verificationQueries = validatedQueries.filter(q => q.isVerificationQuery);
  if (verificationQueries.length > 0) {
    // Log query generation details only if needed for deeper debugging
    // await log(`Generated ${verificationQueries.length} verification queries...`);
  }

  // Log which research directions are being addressed
  const queriesWithDirections = validatedQueries.filter(q => q.relatedDirection !== null);
  if (queriesWithDirections.length > 0) {
    // Log query generation details only if needed for deeper debugging
    // await log(`Queries addressing research directions:\n${queriesWithDirections...}`);
  }

  return validatedQueries;
}

async function evaluateSourceReliability(domain: string, context: string): Promise<{
  score: number;
  reasoning: string;
}> {
  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Evaluate the reliability of the following source domain for research about: "${context}"

Domain: ${domain}

Consider factors like:
1. Editorial standards and fact-checking processes
2. Domain expertise in the subject matter
3. Reputation for accuracy and objectivity
4. Transparency about sources and methodology
5. Professional vs user-generated content
6. Commercial biases or conflicts of interest
7. Academic or professional credentials
8. Track record in the field

Return a reliability score between 0 and 1, where:
- 0.9-1.0: Highest reliability (e.g. peer-reviewed journals, primary sources)
- 0.7-0.89: Very reliable (e.g. respected news organizations)
- 0.5-0.69: Moderately reliable (e.g. industry blogs with editorial oversight)
- 0.3-0.49: Limited reliability (e.g. personal blogs, commercial sites)
- 0-0.29: Low reliability (e.g. known misinformation sources)`,
    schema: z.object({
      score: z.number().describe('Reliability score between 0 and 1'),
      reasoning: z.string().describe('Brief explanation of the reliability assessment, one or two sentences'),
      domainExpertise: z.string().describe('Assessment of domain expertise in this specific topic')
    })
  });

  return {
    score: res.object.score,
    reasoning: res.object.reasoning
  };
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  reliabilityThreshold = 0.3,
  researchGoal = '',
  logToFile, // Rename parameter to logToFile
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
  reliabilityThreshold?: number;
  researchGoal?: string;
  logToFile: (...args: any[]) => Promise<void>; // Rename type definition parameter
}): Promise<{
  learnings: string[];
  learningConfidences: number[];
  followUpQuestions: string[];
  followUpPriorities: number[];
  sourceMetadata: SourceMetadata[];
  weightedLearnings: LearningWithReliability[];
}> {
  const contents = compact(result.data.map(item => item.markdown)).map(
    content => trimPrompt(content, 25_000),
  );

  // Evaluate source reliability for each domain
  const sourceMetadataPromises = compact(result.data.map(async item => {
    if (!item.url) return null;
    try {
      const domain = new URL(item.url).hostname;
      const reliability = await evaluateSourceReliability(domain, query);
      return {
        url: item.url,
        title: item.title || undefined,
        publishDate: undefined,
        domain,
        relevanceScore: undefined,
        reliabilityScore: reliability.score,
        reliabilityReasoning: reliability.reasoning
      } as SourceMetadata;
    } catch (e) {
      return null;
    }
  }));

  const sourceMetadata = compact(await Promise.all(sourceMetadataPromises));
  // Keep this log for now, as it shows what metadata was actually generated
  await logToFile('[processSerpResult] Generated sourceMetadata:', sourceMetadata);

  // Sort and filter contents by reliability
  const contentWithMetadata = contents
    .map((content, i) => ({
      content,
      metadata: sourceMetadata[i]
    }))
    .filter((item): item is { content: string; metadata: SourceMetadata } => !!item.metadata);

  // Sort by reliability and filter using the provided threshold
  const sortedContents = contentWithMetadata
    .sort((a, b) => b.metadata.reliabilityScore - a.metadata.reliabilityScore)
    .filter(item => item.metadata.reliabilityScore >= reliabilityThreshold)
    .map(item => item.content);

  // Removed the synchronous log call that might have caused type issues
  // logToFile(`Ran ${query}, found ${contents.length} contents (${sourceMetadata.filter(m => m.reliabilityScore >= reliabilityThreshold).length} above reliability threshold ${reliabilityThreshold})`); // Use logToFile and add await

  const res = await generateObject({
    model: o3MiniModel,
    abortSignal: AbortSignal.timeout(60_000),
    system: systemPrompt(),
    prompt: `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates.

${researchGoal ? `Research Goal: ${researchGoal}
This research is specifically aimed at: ${researchGoal}. Focus on findings that contribute to this goal.

` : ''}Weight information by source reliability - be more confident in information from highly reliable sources and more cautious about information from less reliable sources. If possible, try to verify information from less reliable sources against more reliable ones.

Also generate up to ${numFollowUpQuestions} follow-up questions, prioritized by reliability gaps and research needs${researchGoal ? ', keeping in mind the research goal' : ''}.

<contents>${contentWithMetadata
      .map(({ content, metadata }) => 
        `<content reliability="${metadata.reliabilityScore.toFixed(2)}" reasoning="${metadata.reliabilityReasoning}" source="${metadata.domain}">\n${content}\n</content>`
      )
      .join('\n')}</contents>`,
    schema: z.object({
      learnings: z
        .array(z.object({
          content: z.string(),
          confidence: z.number().describe('Confidence in this learning based on source reliability (between 0 and 1)'),
          sources: z.array(z.string()).describe('List of source domains that support this learning')
        }))
        .describe(`List of learnings, max of ${numLearnings}`),
      followUpQuestions: z
        .array(z.object({
          question: z.string(),
          priority: z.number().describe('Priority of this question (1-5) based on current source reliability gaps'),
          reason: z.string().describe('Why this follow-up is needed, especially regarding source reliability')
        }))
        .describe(`Follow-up questions to research, max of ${numFollowUpQuestions}, prioritized by reliability gaps`),
      sourceQuality: z.object({
        mostReliableSources: z.array(z.string()),
        contentGaps: z.array(z.string()),
        reliabilityAnalysis: z.string()
      })
    }),
  });

  // Create properly typed weighted learnings
  const weightedLearnings: LearningWithReliability[] = res.object.learnings.map(l => ({
    content: l.content,
    reliability: l.confidence
  }));

  // Ensure we don't exceed the numFollowUpQuestions limit
  const limitedFollowUpQuestions = res.object.followUpQuestions.slice(0, numFollowUpQuestions);

  return {
    ...res.object,
    sourceMetadata,
    learnings: weightedLearnings.map(l => l.content),
    learningConfidences: weightedLearnings.map(l => l.reliability),
    followUpQuestions: limitedFollowUpQuestions.map(q => q.question),
    followUpPriorities: limitedFollowUpQuestions.map(q => q.priority),
    weightedLearnings
  };
  // Remove redundant log before return
  // await logToFile('[processSerpResult] Returning sourceMetadata:', sourceMetadata);
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls, // Keep visitedUrls if needed elsewhere, but log needs sourceMetadata
  sourceMetadata,
  log, // Add log function parameter
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[]; // Keep type
  sourceMetadata: SourceMetadata[];
  log: (...args: any[]) => Promise<void>; // Add log type definition
}) {
  // Use the passed-in log function
  // Keep this log to confirm data is passed
  await log('[writeFinalReport] Received sourceMetadata:', sourceMetadata);


  // Quick reliability analysis
  const reliabilityGroups = {
    high: sourceMetadata.filter(m => m.reliabilityScore >= 0.8),
    medium: sourceMetadata.filter(m => m.reliabilityScore >= 0.5 && m.reliabilityScore < 0.8),
    low: sourceMetadata.filter(m => m.reliabilityScore < 0.5)
  };

  const learningsString = trimPrompt(
    learnings
      .map(learning => `<learning>\n${learning}\n</learning>`)
      .join('\n'),
    150_000,
  );

  const res = await generateObject({
    model: o3MiniModel,
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as detailed as possible, aim for 3 or more pages, include ALL the learnings from research. Consider source reliability when drawing conclusions.

<prompt>${prompt}</prompt>

Here are all the learnings from previous research:

<learnings>\n${learningsString}\n</learnings>`,
    schema: z.object({
      reportMarkdown: z.string().describe('Final report on the topic in Markdown'),
    }),
  });

  // Source section generation is removed from here.
  // It will be handled by the MCP server using metadata.
  // const sourcesSection = ... (removed)

  // Log the source metadata received, but don't generate the section string here
  // Remove redundant log
  // await log('[writeFinalReport] Received sourceMetadata (will be returned in metadata):', sourceMetadata);

  // Return only the main report content generated by the AI
  return res.object.reportMarkdown;
}

// Define log function within deepResearch scope for passing down
const logToFile = async (...args: any[]) => { // Rename to logToFile
  const logFilePath = path.resolve(__dirname_log, '../deep-research-mcp.log');
  const timestamp = new Date().toISOString();
  const message = args
    .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ');
  try {
    await fs.appendFile(logFilePath, `${timestamp} - [deepResearch] ${message}\n`, 'utf-8');
  } catch (error) {
    console.error(`Failed to write to log file ${logFilePath}:`, error);
    console.error(`Original log message: ${timestamp} - [deepResearch] ${message}`);
  }
};

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  learningReliabilities = [],
  visitedUrls = [],
  weightedLearnings = [],
  researchDirections = [],  // Add structured research directions
  sourceMetadata = [], // Add sourceMetadata parameter with default empty array
  onProgress,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  learningReliabilities?: number[];
  visitedUrls?: string[];
  weightedLearnings?: LearningWithReliability[];
  researchDirections?: ResearchDirection[];  // New parameter
  sourceMetadata?: SourceMetadata[]; // Add sourceMetadata to type definition
  onProgress?: (progress: ResearchProgress) => void;
}): Promise<{
  learnings: string[];
  learningReliabilities: number[];
  visitedUrls: string[];
  sourceMetadata: SourceMetadata[];
  weightedLearnings: LearningWithReliability[];
}> {
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    learningReliabilities,
    numQueries: breadth,
    researchDirections,  // Pass research directions to influence query generation
    log: logToFile, // Pass logToFile
  });

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(ConcurrencyLimit);

  const results = await Promise.all(
    serpQueries.map((serpQuery, serpIndex) => // Use map's index here
      limit(async () => { // Remove serpIndex from limit callback
        const currentQueryIndexStr = `${serpIndex + 1}/${serpQueries.length}`; // Use index from map
        try {
          const firecrawlStartTime = Date.now();
          await logToFile(`[Deep Research] Running Firecrawl search for query ${currentQueryIndexStr}: "${serpQuery.query}"`);
          const result = await firecrawl.search(serpQuery.query, {
            timeout: 15000, // Consider increasing timeout if needed
            limit: serpQuery.isVerificationQuery ? 8 : 5,
            scrapeOptions: {
              formats: ['markdown']
            },
          });
          const firecrawlEndTime = Date.now();
          // Log completion of search and duration
          await logToFile(`[Deep Research] Firecrawl search completed for query ${currentQueryIndexStr}. Duration: ${firecrawlEndTime - firecrawlStartTime}ms. Found ${result.data?.length || 0} results.`);

          const processResultStartTime = Date.now(); // Start timing processSerpResult
          // Define newBreadth and newDepth before calling processSerpResult
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;
          const processedResult = await processSerpResult({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth, // Pass newBreadth here
            reliabilityThreshold: serpQuery.reliabilityThreshold,
            researchGoal: serpQuery.researchGoal,
            logToFile, // Pass logToFile function
          });
          const processResultEndTime = Date.now();
          await logToFile(`[Deep Research] processSerpResult completed for query ${currentQueryIndexStr}. Duration: ${processResultEndTime - processResultStartTime}ms`);

          // Aggregate results correctly
          const currentLearnings = [...learnings, ...processedResult.learnings];
          const newUrls = compact(result.data.map(item => item.url)); // Define newUrls here
          const currentUrls = [...visitedUrls, ...newUrls];
          const currentSourceMetadata = [...sourceMetadata, ...(processedResult.sourceMetadata || [])];
          const currentWeightedLearnings = [...weightedLearnings, ...processedResult.weightedLearnings];

          // newDepth and newBreadth are already defined above

          if (newDepth > 0) {
            const recursionStartTime = Date.now();
            // Log start of recursion
            await logToFile(
              `[Deep Research] Researching deeper for query ${currentQueryIndexStr}. New Depth: ${newDepth}, New Breadth: ${newBreadth}`
            );

            reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              // completedQueries: progress.completedQueries + 1, // Increment after recursion returns
              currentQuery: serpQuery.query,
              parentQuery: query,
              learningsCount: processedResult.learnings.length,
              learnings: processedResult.learnings,
              followUpQuestions: processedResult.followUpQuestions,
            });

            const nextQuery = `
Previous research goal: ${serpQuery.researchGoal}
Follow-up research directions: ${processedResult.followUpQuestions.map(q => `\n${q}`).join('')}
`.trim();

            // Ensure recursive call returns the correct type
            const recursiveResult: {
              learnings: string[];
              learningReliabilities: number[];
              visitedUrls: string[];
              sourceMetadata: SourceMetadata[];
              weightedLearnings: LearningWithReliability[];
            } = await deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: currentLearnings, // Pass aggregated learnings
              learningReliabilities: processedResult.learningConfidences, // Pass confidences from this level
              visitedUrls: currentUrls, // Pass aggregated URLs
              weightedLearnings: currentWeightedLearnings, // Pass aggregated weighted learnings
              sourceMetadata: currentSourceMetadata, // Pass aggregated sourceMetadata
              researchDirections: processedResult.followUpQuestions.map((q, i) => ({
                question: q,
                priority: processedResult.followUpPriorities[i] || 3, // Default priority if undefined
                parentGoal: serpQuery.researchGoal
              })),
              onProgress,
            });
            const recursionEndTime = Date.now();
            // Log completion of recursion
            await logToFile(`[Deep Research] Recursive call completed for query ${currentQueryIndexStr}. Duration: ${recursionEndTime - recursionStartTime}ms`);
            reportProgress({ completedQueries: progress.completedQueries + 1 }); // Increment completed count after recursion returns
            return recursiveResult; // Return the result from the recursive call

          } else {
            reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });
            // Base case: return aggregated results from this branch
            return {
              learnings: currentLearnings,
              learningReliabilities: processedResult.learningConfidences, // Return confidences from this level
              visitedUrls: currentUrls,
              sourceMetadata: currentSourceMetadata,
              weightedLearnings: currentWeightedLearnings
            };
          }
        } catch (e: any) {
          // Use serpIndex from the outer map scope for error logging
          const errorQueryIndexStr = `${serpIndex + 1}`;
          if (e.message && e.message.includes('Timeout')) {
            // Log specific errors
            await logToFile(`[Deep Research] Timeout error running Firecrawl search for query ${errorQueryIndexStr}: "${serpQuery.query}"`, e.message); // Log only message
          } else {
            await logToFile(`[Deep Research] Error running Firecrawl search or processing for query ${errorQueryIndexStr}: "${serpQuery.query}"`, e.message, e.stack); // Log message and stack
          }
          // Return empty results for this branch on error, matching the expected return type
          return {
            learnings: [],
            learningReliabilities: [],
            visitedUrls: [],
            sourceMetadata: [],
            weightedLearnings: []
          };
        }
      }),
    ),
  );

  // Combine results from all parallel branches, ensuring correct typing
  type BranchResult = {
    learnings: string[];
    learningReliabilities: number[];
    visitedUrls: string[];
    sourceMetadata: SourceMetadata[];
    weightedLearnings: LearningWithReliability[];
  };

  // Filter out potential undefined/null results and assert type
  const validResults = results.filter((r): r is BranchResult => r !== undefined && r !== null);

  const combinedResults: BranchResult = {
    learnings: [...new Set(validResults.flatMap(r => r.learnings || []))],
    learningReliabilities: [...new Set(validResults.flatMap(r => r.learningReliabilities || []))],
    visitedUrls: [...new Set(validResults.flatMap(r => r.visitedUrls || []))],
    // Deduplicate sourceMetadata based on URL using a Map
    sourceMetadata: Array.from(
      validResults
        .flatMap(r => r.sourceMetadata || []) // Ensure sourceMetadata exists and flatten
        .reduce((map, meta) => {
          if (meta?.url) { // Check if meta and meta.url exist
            map.set(meta.url, meta); // Use URL as key, overwriting duplicates (keeps the last seen)
          }
          return map;
        }, new Map<string, SourceMetadata>())
        .values()
    ),
    weightedLearnings: [...new Set(validResults.flatMap(r => r.weightedLearnings || []))]
  };

  const finalEndTime = Date.now(); // End timing for the entire function if needed, though maybe less useful here
  // Log completion of the research level
  await logToFile(`[Deep Research] Completed research level. Depth: ${depth}, Breadth: ${breadth}`);

  // Ensure the final return matches the Promise type
  return combinedResults as {
    learnings: string[];
    learningReliabilities: number[];
    visitedUrls: string[];
    sourceMetadata: SourceMetadata[];
    weightedLearnings: LearningWithReliability[];
  };
}