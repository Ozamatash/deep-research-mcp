#!/usr/bin/env node

// Simple test to verify the deep research functionality with minimal API calls
import { config } from 'dotenv';
import { resolve } from 'path';
import { getModel } from './dist/ai/providers.js';
import { generateObject } from 'ai';
import { z } from 'zod';

// Load environment variables
const __dirname = new URL('.', import.meta.url).pathname;
config({ path: resolve(__dirname, '.env.local') });

console.log('🔬 Testing Deep Research with Minimal API Calls\n');

async function testSimpleResearch() {
  try {
    console.log('📋 Environment Check:');
    console.log(`  GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Not set'}`);
    console.log(`  FIRECRAWL_KEY: ${process.env.FIRECRAWL_KEY ? '✅ Set' : '❌ Not set'}`);

    if (!process.env.GOOGLE_API_KEY) {
      console.error('❌ GOOGLE_API_KEY is not set');
      return;
    }

    console.log('\n🤖 Testing Model Selection...');
    const model = getModel('google:gemini-2.0-flash-exp');
    console.log('✅ Model created successfully');

    console.log('\n🔍 Testing Simple Query Generation...');

    // Test the same generateObject call that deep research uses
    const result = await generateObject({
      model,
      system: 'You are a helpful research assistant.',
      prompt: 'Generate 1 search query for the topic: benefits of renewable energy',
      schema: z.object({
        queries: z.array(z.object({
          query: z.string(),
          researchGoal: z.string(),
        })).max(1)
      }),
    });

    console.log('✅ Query generation successful!');
    console.log('📝 Generated query:', result.object.queries[0]?.query);

    console.log('\n🎉 All tests passed! The issue is likely with API rate limits in the full integration test.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n🔍 Full error details:');
    console.error(error);

    if (error.message.includes('quota')) {
      console.log('\n💡 This is a quota issue. The API key is working, but you\'ve exceeded the rate limit.');
      console.log('   Try again later or use a different model with higher limits.');
    }
  }
}

testSimpleResearch();