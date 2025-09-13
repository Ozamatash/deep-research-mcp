#!/usr/bin/env node

// Simple test script to verify API key detection and model selection
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { config } from 'dotenv';

// Get the directory name of the current module
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') });

// Import our modified providers from the compiled dist folder
import { getDefaultModel, getModel } from '../dist/ai/providers.js';

console.log('\n🧪 Testing Modified MCP Server API Detection...\n');

// Check environment variables
console.log('📋 Environment Variables:');
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`  GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`  XAI_API_KEY: ${process.env.XAI_API_KEY ? '✅ Set' : '❌ Not set'}`);

console.log('\n🤖 Testing Model Selection...\n');

try {
  console.log('Attempting to get default model...');
  const defaultModel = getDefaultModel();
  console.log(`✅ Success! Default model selected.`);
  console.log(`   Model info available in console logs above.`);
  
  console.log('\n🎯 Testing explicit Google model selection...');
  const googleModel = getModel('google:gemini-2.5-pro');
  console.log(`✅ Success! Google Gemini 2.5 Pro model created.`);
  
} catch (error) {
  console.error('❌ Error:', error.message);
  
  // If no API keys are set, show instructions
  if (error.message.includes('No API keys found')) {
    console.log('\n📝 To fix this issue:');
    console.log('1. Add your Google API key to .env.local:');
    console.log('   GOOGLE_API_KEY=your_actual_google_api_key_here');
    console.log('2. Or add any other supported API key');
  }
}

console.log('\n✨ Test completed!\n');