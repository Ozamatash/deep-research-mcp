import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { z } from 'zod';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

// Define and validate the environment schema
const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_ENDPOINT: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  FIRECRAWL_BASE_URL: z.string().url().optional(),
  FIRECRAWL_KEY: z.string().optional(),
  FIRECRAWL_CONCURRENCY: z.string().transform(Number).default('2'),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
});

// Parse and validate environment variables
const env = envSchema.parse(process.env);

// Export the validated config
export const Config = {
  openai: {
    apiKey: env.OPENAI_API_KEY,
    endpoint: env.OPENAI_ENDPOINT,
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
  },
  google: {
    apiKey: env.GOOGLE_API_KEY,
  },
  xai: {
    apiKey: env.XAI_API_KEY,
  },
  firecrawl: {
    baseUrl: env.FIRECRAWL_BASE_URL,
    apiKey: env.FIRECRAWL_BASE_URL ? null : env.FIRECRAWL_KEY, // No key needed for local instance
    concurrency: env.FIRECRAWL_CONCURRENCY,
  },
  langfuse: {
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
  },
  isLocalFirecrawl: !!env.FIRECRAWL_BASE_URL,
} as const;

// Export individual configs for convenience
export const { openai, firecrawl, langfuse } = Config;
