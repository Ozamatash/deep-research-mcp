import { resolve } from 'path';
import { fileURLToPath } from 'url';
import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { config } from 'dotenv';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { getDefaultModel, trimPrompt } from './ai/providers.js';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import { firecrawl as firecrawlConfig } from './config.js';
import { OutputManager } from './output-manager.js';
import { systemPrompt } from './prompt.js';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

// Initialize output manager for coordinated console/progress output
const output = new OutputManager();

// Replace console.log with output.log
function log(...args: any[]) {
  output.log(...args);
}

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

// Natural-language source preference rules parsed from user input
type SuitabilityDecision = {
  use: boolean;
  reason: string;
};

// Optional token budget tracking for the research phase
type BudgetState = {
  tokenBudget?: number;
  usedTokens: number;
  reached: boolean;
};

function recordUsage(budget: BudgetState | undefined, usage: any) {
  if (!budget || !usage) return;
  const total =
    (typeof usage.totalTokens === 'number' && usage.totalTokens) ||
    ((usage.inputTokens || 0) + (usage.outputTokens || 0));
  if (typeof total === 'number' && total > 0) {
    budget.usedTokens += total;
    if (
      typeof budget.tokenBudget === 'number' &&
      budget.tokenBudget > 0 &&
      budget.usedTokens >= budget.tokenBudget
    ) {
      budget.reached = true;
    }
  }
}

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
  sourcePreferences,
  model,
  budget,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  learningReliabilities?: number[];
  researchDirections?: ResearchDirection[];
  sourcePreferences?: string;
  model: LanguageModelV2;
  budget?: BudgetState;
}) {
  // Convert to properly typed weighted learnings
  const weightedLearnings: LearningWithReliability[] = learnings && learningReliabilities 
    ? learnings.map((content, i) => ({
        content,
        reliability: learningReliabilities[i] || 0.5
      }))
    : [];

  const res = await generateObject({
    model,
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

${sourcePreferences && sourcePreferences.trim().length > 0
  ? `\nUser source preferences to avoid during research:
${sourcePreferences}

Prefer authoritative, primary, and technical sources; avoid queries that are likely to surface excluded sources (e.g., thin SEO listicles, affiliate reviews) when possible.`
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

  // Count usage for this research-phase call
  recordUsage(budget, (res as any)?.usage);

  // Ensure reliability thresholds are within valid range
  const validatedQueries = res.object.queries.map(query => ({
    ...query,
    reliabilityThreshold: Math.max(0, Math.min(1, query.reliabilityThreshold))
  }));

  // Log more detailed information about query generation
  const verificationQueries = validatedQueries.filter(q => q.isVerificationQuery);
  if (verificationQueries.length > 0) {
    log(`Generated ${verificationQueries.length} verification queries to check information from less reliable sources`);
  }

  // Log which research directions are being addressed
  const queriesWithDirections = validatedQueries.filter(q => q.relatedDirection !== null);
  if (queriesWithDirections.length > 0) {
    log(`Queries addressing research directions:\n${queriesWithDirections
      .map(q => `- "${q.query}" addresses: ${q.relatedDirection}`)
      .join('\n')}`);
  }

  return validatedQueries;
}

async function evaluateSourceReliability({
  item,
  query,
  sourcePreferences,
  model,
  budget,
}: {
  item: { url?: string | null; title?: string | null; markdown?: string | null };
  query: string;
  sourcePreferences?: string;
  model: LanguageModelV2;
  budget?: BudgetState;
}): Promise<{ score: number; reasoning: string; use: boolean; preferenceReason?: string; domain: string }> {
  const url = item.url || '';
  const title = item.title || '';
  let domain = '';
  try {
    domain = url ? new URL(url).hostname : '';
  } catch {
    domain = '';
  }
  const contentSnippet = trimPrompt(item.markdown || '', 4000);

  const prefBlock = sourcePreferences && sourcePreferences.trim().length > 0
    ? `User preferences to avoid (apply holistically, not via keywords):\n<preferences>${sourcePreferences}</preferences>\n\nAlso return whether this source should be USED given these preferences.`
    : 'No special user preferences provided.';

  const res = await generateObject({
    model,
    system: systemPrompt(),
    prompt: `Evaluate the reliability and suitability of this source for the research query. Provide a reliability score and a brief reasoning. If user preferences are provided, judge suitability holistically against them.

${prefBlock}

Research query:\n<query>${query}</query>

Source:\n- URL: ${url}\n- Domain: ${domain}\n- Title: ${title}\n- Content (truncated):\n"""\n${contentSnippet}\n"""

Return JSON: { "score": number (0..1), "reasoning": string, "use": boolean, "preferenceReason"?: string }`,
    schema: z.object({
      score: z.number(),
      reasoning: z.string(),
      use: z.boolean(),
      preferenceReason: z.string().optional(),
    }),
  });

  recordUsage(budget, (res as any)?.usage);

  return { score: res.object.score, reasoning: res.object.reasoning, use: res.object.use, preferenceReason: res.object.preferenceReason, domain };
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  reliabilityThreshold = 0.3,
  researchGoal = '',
  sourcePreferences,
  model,
  budget,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
  reliabilityThreshold?: number;
  researchGoal?: string;
  sourcePreferences?: string;
  model: LanguageModelV2;
  budget?: BudgetState;
}): Promise<{
  learnings: string[];
  learningConfidences: number[];
  followUpQuestions: string[];
  followUpPriorities: number[];
  sourceMetadata: SourceMetadata[];
  weightedLearnings: LearningWithReliability[];
}> {
  // Evaluate reliability and suitability per item; exclude any with use=false
  const evaluations = await Promise.all(
    compact(result.data).map(async item => {
      if (!item.url) return null;
      try {
        const ev = await evaluateSourceReliability({ item, query, sourcePreferences, model, budget });
        if (ev.use === false) return { excluded: true, item } as const;
        return { excluded: false, item, ev } as const;
      } catch {
        // On error, keep the item to avoid over-filtering
        return { excluded: false, item } as const;
      }
    }),
  );

  const kept = evaluations.filter((r): r is { excluded: false; item: any; ev?: any } => !!r && r.excluded === false);
  const excludedCount = evaluations.filter(r => r && (r as any).excluded === true).length;

  const contents = kept
    .map(r => r.item.markdown)
    .filter(Boolean)
    .map(content => trimPrompt(content as string, 25_000));

  const sourceMetadata = kept
    .map(r => {
      const ev = (r as any).ev as { score?: number; reasoning?: string; domain?: string } | undefined;
      return {
        url: r.item.url as string,
        title: r.item.title || undefined,
        publishDate: undefined,
        domain: (ev && ev.domain) || (r.item.url ? new URL(r.item.url).hostname : ''),
        relevanceScore: undefined,
        reliabilityScore: (ev && typeof ev.score === 'number') ? ev.score : 0.5,
        reliabilityReasoning: (ev && ev.reasoning) || 'No reasoning provided',
      } as SourceMetadata;
    });

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

  log(`Ran ${query}, found ${contents.length} contents (${sourceMetadata.filter(m => m.reliabilityScore >= reliabilityThreshold).length} above reliability threshold ${reliabilityThreshold}${excludedCount > 0 ? `; ${excludedCount} excluded by preferences in reliability stage` : ''})`);

  if (contents.length === 0) {
    return {
      learnings: [],
      learningConfidences: [],
      followUpQuestions: [],
      followUpPriorities: [],
      sourceMetadata,
      weightedLearnings: [],
    };
  }

  const res = await generateObject({
    model,
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

  // Count usage for this research-phase call
  recordUsage(budget, (res as any)?.usage);

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
}

export async function writeFinalReport({
  prompt,
  learnings,
  sourceMetadata,
  model,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  sourceMetadata: SourceMetadata[];
  model: LanguageModelV2;
}) {
  const reportStart = Date.now();
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
    model,
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as detailed as possible, aim for 3 or more pages, include ALL the learnings from research. Consider source reliability when drawing conclusions.

<prompt>${prompt}</prompt>

Here are all the learnings from previous research:

<learnings>\n${learningsString}\n</learnings>`,
    schema: z.object({
      reportMarkdown: z.string().describe('Final report on the topic in Markdown'),
    }),
  });

  // Add a simple sources section with reliability scores
  const sourcesSection = '\n\n## Sources\n\n' + sourceMetadata
    .sort((a, b) => b.reliabilityScore - a.reliabilityScore)
    .map(metadata => {
      const parts = [
        `- ${metadata.url}`,
        `  - Reliability: ${metadata.reliabilityScore.toFixed(2)} - ${metadata.reliabilityReasoning}`,
      ];
      if (metadata.title) {
        parts.push(`  - Title: ${metadata.title}`);
      }
      if (metadata.publishDate) {
        parts.push(`  - Published: ${metadata.publishDate}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');

  const reportEnd = Date.now();
  log(`[TIMING] Final report generation took ${reportEnd - reportStart}ms`);
  return res.object.reportMarkdown + sourcesSection;
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  learningReliabilities = [],
  visitedUrls = [],
  weightedLearnings = [],
  researchDirections = [],  // Add structured research directions
  onProgress,
  model: providedModel,
  tokenBudget,
  budgetState,
  sourcePreferences,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  learningReliabilities?: number[];
  visitedUrls?: string[];
  weightedLearnings?: LearningWithReliability[];
  researchDirections?: ResearchDirection[];  // New parameter
  onProgress?: (progress: ResearchProgress) => void;
  model?: LanguageModelV2;
  tokenBudget?: number; // Optional soft cap for research-phase tokens
  budgetState?: BudgetState; // internal shared state for recursion
  sourcePreferences?: string; // natural-language preferences to avoid certain sources
}): Promise<{
  learnings: string[];
  learningReliabilities: number[];
  visitedUrls: string[];
  sourceMetadata: SourceMetadata[];
  weightedLearnings: LearningWithReliability[];
  budget?: { usedTokens: number; tokenBudget?: number; reached: boolean };
}> {
  const researchStart = Date.now();
  const model = providedModel ?? getDefaultModel();
  // initialize/reuse token budget for this research session
  const budget: BudgetState | undefined =
    typeof tokenBudget === 'number' || budgetState
      ? budgetState ?? { tokenBudget, usedTokens: 0, reached: false }
      : undefined;

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
    sourcePreferences,
    model,
    budget,
  });

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(ConcurrencyLimit);

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        if (budget?.reached) {
          return {
            learnings: [],
            learningReliabilities: [],
            visitedUrls: [],
            sourceMetadata: [],
            weightedLearnings: []
          };
        }
        try {
          const searchStart = Date.now();
          const result = await firecrawl.search(serpQuery.query, {
            timeout: 15000,
            limit: serpQuery.isVerificationQuery ? 8 : 5,
            scrapeOptions: {
              formats: ['markdown']
            },
          });
          const searchEnd = Date.now();
          log(`[TIMING] Firecrawl search for "${serpQuery.query}" took ${searchEnd - searchStart}ms`);

          // Collect URLs from this search
          const newUrls = compact(result.data.map(item => item.url));
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          const processStart = Date.now();
          const processedResult = await processSerpResult({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth,
            reliabilityThreshold: serpQuery.reliabilityThreshold,
            researchGoal: serpQuery.researchGoal,
            sourcePreferences,
            model,
            budget,
          });
          const processEnd = Date.now();
          log(`[TIMING] Processing SERP for "${serpQuery.query}" took ${processEnd - processStart}ms`);
          
          const allLearnings = [...learnings, ...processedResult.learnings];
          const allUrls = [...visitedUrls, ...newUrls];
          const allSourceMetadata = [...(processedResult.sourceMetadata || [])];
          const allWeightedLearnings = [...weightedLearnings, ...processedResult.weightedLearnings];

          if (budget?.reached) {
            reportProgress({
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
              parentQuery: query,
              learningsCount: processedResult.learnings.length,
              learnings: processedResult.learnings,
              followUpQuestions: processedResult.followUpQuestions,
            });
            return {
              learnings: allLearnings,
              learningReliabilities: processedResult.learningConfidences,
              visitedUrls: allUrls,
              sourceMetadata: allSourceMetadata,
              weightedLearnings: allWeightedLearnings
            };
          }

          if (newDepth > 0) {
            log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );

            reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              completedQueries: progress.completedQueries + 1,
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

            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: allLearnings,
              learningReliabilities: processedResult.learningConfidences,
              visitedUrls: allUrls,
              weightedLearnings: allWeightedLearnings,
              researchDirections: processedResult.followUpQuestions.map((q, i) => ({
                question: q,
                priority: processedResult.followUpPriorities[i] || 3, // Default priority if undefined
                parentGoal: serpQuery.researchGoal
              })),
              onProgress,
              model,
              tokenBudget,
              budgetState: budget,
              sourcePreferences,
            });
          } else {
            reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });
            return {
              learnings: allLearnings,
              learningReliabilities: processedResult.learningConfidences,
              visitedUrls: allUrls,
              sourceMetadata: allSourceMetadata,
              weightedLearnings: allWeightedLearnings
            };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log(`Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }
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

  const combinedResults = {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    learningReliabilities: [...new Set(results.flatMap(r => r.learningReliabilities))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
    sourceMetadata: [...new Set(results.flatMap(r => r.sourceMetadata))],
    weightedLearnings: [...new Set(results.flatMap(r => r.weightedLearnings))],
    budget: budget
  };

  const researchEnd = Date.now();
  log(`[TIMING] Overall deepResearch took ${researchEnd - researchStart}ms`);
  return combinedResults;
}