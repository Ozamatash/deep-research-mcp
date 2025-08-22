import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { type LanguageModelV2 } from '@ai-sdk/provider';
import { xai } from '@ai-sdk/xai';
import { getEncoding } from 'js-tiktoken';

import langfuse from './observability.js';
import { RecursiveCharacterTextSplitter } from './text-splitter.js';

function wrapWithLangfuse(model: any, modelName: string): LanguageModelV2 {
  // Preserve original methods and metadata
  const originalDoGenerate = model.doGenerate?.bind(model);
  (model as any).defaultObjectGenerationMode = 'json';
  (model as any).doGenerate = async (options: any) => {
    const generation = langfuse.generation({
      name: 'LLM Generation',
      model: modelName,
      input: options,
      modelParameters: (options as any)?.providerMetadata ?? {},
    });

    try {
      const result = await originalDoGenerate(options);
      generation.end({ output: result });
      return result;
    } catch (error) {
      generation.end({ metadata: { error: String(error) } });
      throw error;
    }
  };
  return model as LanguageModelV2;
}

export function getModel(modelSpecifier?: string): LanguageModelV2 {
  // Accept formats like "openai:o4-mini-2025-04-16", "openai/o4-mini-2025-04-16", or just model name (defaults to openai)
  const spec = (modelSpecifier || '').trim();
  const hasProvider = spec.includes(':') || spec.includes('/');
  const [providerRaw, nameRaw] = hasProvider
    ? spec.split(/[:/]/, 2)
    : ['openai', spec];
  const provider = (providerRaw || 'openai').toLowerCase();

  // default names
  const defaults = {
    openai: process.env.OPENAI_MODEL || 'gpt-5',
    anthropic: 'claude-3-haiku-20240307',
    google: 'gemini-1.5-flash',
    xai: 'grok-2-latest',
  } as const;

  const modelName =
    nameRaw && nameRaw.length > 0
      ? nameRaw
      : (defaults as any)[provider] || defaults.openai;

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        baseURL: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1',
      });
      const model = openai(modelName as any);
      return wrapWithLangfuse(model, `openai/${modelName}`);
    }
    case 'xai': {
      const model = xai(modelName as any);
      return wrapWithLangfuse(model, `xai/${modelName}`);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      });
      const model = anthropic(modelName as any);
      return wrapWithLangfuse(model, `anthropic/${modelName}`);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY!,
      });
      const model = google(modelName as any);
      return wrapWithLangfuse(model, `google/${modelName}`);
    }
    default:
      throw new Error(`Unsupported provider in model specifier: ${provider}`);
  }
}

export function getDefaultModel(): LanguageModelV2 {
  return getModel(`openai:${process.env.OPENAI_MODEL || 'gpt-5'}`);
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
