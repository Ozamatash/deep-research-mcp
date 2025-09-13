import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { xai} from '@ai-sdk/xai';
import { type LanguageModelV2 } from '@ai-sdk/provider';
import { getEncoding } from 'js-tiktoken';

import langfuse from './observability.js';
import { RecursiveCharacterTextSplitter } from './text-splitter.js';

function wrapWithLangfuse(model: any, modelName: string): LanguageModelV2 {
  // Temporarily disabled for debugging
  console.log(`[DEBUG] Langfuse disabled for model ${modelName}`);
  return model as LanguageModelV2;
}

// Get available API keys and determine best provider/model
export function getAvailableProviders(): { provider: string; model: string; intelligence: number }[] {
  const providers = [];
  
  // Check for available API keys and assign intelligence ratings
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim() !== '') {
    providers.push({ provider: 'google', model: 'gemini-2.5-pro', intelligence: 100 });
    providers.push({ provider: 'google', model: 'gemini-2.5-flash', intelligence: 95 });
    providers.push({ provider: 'google', model: 'gemini-2.0-flash', intelligence: 90 });
  }
  
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim() !== '') {
    providers.push({ provider: 'openai', model: 'o1', intelligence: 98 });
    providers.push({ provider: 'openai', model: 'gpt-4', intelligence: 85 });
    providers.push({ provider: 'openai', model: 'gpt-4-turbo', intelligence: 88 });
    providers.push({ provider: 'openai', model: 'gpt-3.5-turbo', intelligence: 70 });
  }
  
  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== '') {
    providers.push({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022', intelligence: 92 });
    providers.push({ provider: 'anthropic', model: 'claude-3-haiku-20240307', intelligence: 75 });
  }
  
  if (process.env.XAI_API_KEY && process.env.XAI_API_KEY.trim() !== '') {
    providers.push({ provider: 'xai', model: 'grok-2-latest', intelligence: 80 });
  }
  
  // Sort by intelligence (highest first)
  return providers.sort((a, b) => b.intelligence - a.intelligence);
}

export function getModel(modelSpecifier?: string): LanguageModelV2 {
  // Accept formats like "openai:o4-mini-2025-04-16", "openai/o4-mini-2025-04-16", or just model name (defaults to best available)
  const spec = (modelSpecifier || '').trim();
  
  if (spec === '') {
    // No model specified, use the most intelligent available model
    return getDefaultModel();
  }
  
  const hasProvider = spec.includes(':') || spec.includes('/');
  const [providerRaw, nameRaw] = hasProvider
    ? spec.split(/[:/]/, 2)
    : ['auto', spec];
  
  let provider = (providerRaw || 'auto').toLowerCase();
  
  // If provider is 'auto', find the best available provider
  if (provider === 'auto') {
    const available = getAvailableProviders();
    if (available.length === 0) {
      throw new Error('No API keys found. Please set at least one of: OPENAI_API_KEY, GOOGLE_API_KEY, ANTHROPIC_API_KEY, XAI_API_KEY');
    }
    const bestProvider = available[0];
    if (!bestProvider) {
      throw new Error('No available providers found');
    }
    provider = bestProvider.provider;
  }

  // Model name defaults based on provider
  const defaults = {
    openai: process.env.OPENAI_MODEL || 'o1',
    anthropic: 'claude-3-5-sonnet-20241022', 
    google: 'gemini-2.5-pro',
    xai: 'grok-2-latest',
  } as const;

  const modelName = nameRaw && nameRaw.length > 0 ? nameRaw : ((defaults as any)[provider] || defaults.openai);

  switch (provider) {
    case 'openai': {
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '') {
        throw new Error('OPENAI_API_KEY is required but not set');
      }
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
      });
      const model = openai(modelName as any);
      return wrapWithLangfuse(model, `openai/${modelName}`);
    }
    case 'xai': {
      if (!process.env.XAI_API_KEY || process.env.XAI_API_KEY.trim() === '') {
        throw new Error('XAI_API_KEY is required but not set');
      }
      const model = xai(modelName as any);
      return wrapWithLangfuse(model, `xai/${modelName}`);
    }
    case 'anthropic': {
      if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.trim() === '') {
        throw new Error('ANTHROPIC_API_KEY is required but not set');  
      }
      const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
      const model = anthropic(modelName as any);
      return wrapWithLangfuse(model, `anthropic/${modelName}`);
    }
    case 'google': {
      if (!process.env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY.trim() === '') {
        throw new Error('GOOGLE_API_KEY is required but not set');
      }
      const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY! });
      const model = google(modelName as any);
      return wrapWithLangfuse(model, `google/${modelName}`);
    }
    default:
      throw new Error(`Unsupported provider in model specifier: ${provider}. Supported providers: openai, google, anthropic, xai`);
  }
}

export function getDefaultModel(): LanguageModelV2 {
  const available = getAvailableProviders();
  
  if (available.length === 0) {
    throw new Error(`No API keys found. Please set at least one of the following environment variables:
- OPENAI_API_KEY (for OpenAI models)  
- GOOGLE_API_KEY (for Google Gemini models)
- ANTHROPIC_API_KEY (for Anthropic Claude models)
- XAI_API_KEY (for xAI Grok models)`);
  }
  
  const best = available[0];
  if (!best) {
    throw new Error('No available providers found');
  }
  
  console.log(`🤖 Using most intelligent available model: ${best.provider}/${best.model} (intelligence: ${best.intelligence})`);
  
  return getModel(`${best.provider}:${best.model}`);
}


const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  return trimPrompt(trimmedPrompt, contextSize);
}