#!/usr/bin/env node

// Simple test to verify Google Gemini API connection
import { config } from 'dotenv';
import { resolve } from 'path';
import { getModel } from './dist/ai/providers.js';

// Load environment variables
const __dirname = new URL('.', import.meta.url).pathname;
config({ path: resolve(__dirname, '.env.local') });

console.log('🔧 Testing Google Gemini API Connection\n');

async function testModelConnection() {
  try {
    console.log('📋 Environment Check:');
    console.log(`  GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? '✅ Set' : '❌ Not set'}`);
    console.log(`  Key Length: ${process.env.GOOGLE_API_KEY?.length || 0} characters`);

    if (!process.env.GOOGLE_API_KEY) {
      console.error('❌ GOOGLE_API_KEY is not set in .env.local');
      return;
    }

    console.log('\n🤖 Testing Model Selection...');

    // Test getting the model
    const model = getModel('google:gemini-2.0-flash-exp');
    console.log('✅ Model created successfully');

    // Test a simple API call using generateText
    console.log('\n📤 Testing API Call...');
    const { generateText } = await import('ai');

    const result = await generateText({
      model: model,
      prompt: 'Say "Hello, World!" in exactly 3 words.',
    });

    console.log('✅ API call successful!');
    console.log('📝 Response:', result.text);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\n🔍 Full error details:');
    console.error(error);

    if (error.message.includes('quota')) {
      console.log('\n💡 This appears to be a quota issue. Try:');
      console.log('1. Check your Google AI Studio dashboard for quota usage');
      console.log('2. Wait for quota reset (usually daily)');
      console.log('3. Upgrade your Google AI plan if needed');
    }
  }
}

testModelConnection();