import FirecrawlApp from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import type { LanguageModelV2 } from '@ai-sdk/provider';
import type { LimitFunction } from 'p-limit';
import { z } from 'zod';

import { systemPrompt } from './prompt.js';

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


export async function filterSearchResults({
  searchResults,
  query,
  sourcePreferences,
  model,
  budget,
  limiter,
}: {
  searchResults: Array<{ url: string; title?: string; description?: string }>;
  query: string;
  sourcePreferences?: string;
  model: LanguageModelV2;
  budget?: BudgetState;
  limiter: LimitFunction;
}): Promise<string[]> {
  if (searchResults.length === 0) return [];

  const evaluations = await Promise.all(
    searchResults.map((result) =>
      limiter(async () => {
        if (!result.url) return null;

        const evaluation = await generateObject({
        model,
        system: systemPrompt(),
        prompt: `Should we scrape this URL for: "${query}"?

URL: ${result.url}
Domain: ${new URL(result.url).hostname}
Title: ${result.title || 'N/A'}
Description: ${result.description || 'N/A'}

${sourcePreferences ? `User preferences to avoid:\n${sourcePreferences}\n` : ''}

ONLY filter out obvious junk:
- SEO spam / clickbait listicles
- Ad-heavy aggregator sites  
- Clearly irrelevant topics
- Violates user preferences

INCLUDE everything else - we'll evaluate properly after scraping.`,
        schema: z.object({
          shouldScrape: z.boolean(),
          reasoning: z.string(),
        }),
      });

        recordUsage(budget, (evaluation as any)?.usage);

        return evaluation.object.shouldScrape ? result.url : null;
      })
    )
  );

  return evaluations.filter((url): url is string => url !== null);
}


export async function scrapeUrls(
  firecrawl: FirecrawlApp,
  urls: string[]
): Promise<Array<{ url: string; title?: string; markdown?: string }>> {
  if (urls.length === 0) return [];

  const results = await firecrawl.batchScrapeUrls(urls, {
    formats: ['markdown'],
  } as any);

  if ('error' in results) {
    throw new Error(`Batch scrape failed: ${results.error}`);
  }

  return results.data.map((item: any) => ({
    url: item.metadata?.sourceURL || item.url || '',
    title: item.metadata?.title,
    markdown: item.markdown,
  }));
}


