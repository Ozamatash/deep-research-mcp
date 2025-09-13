#!/usr/bin/env node

// Direct test of the deep research functionality with our modifications
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load environment variables
const __dirname = fileURLToPath(new URL('.', import.meta.url));
config({ path: resolve(__dirname, '../.env.local') });

// Import the research function and model provider
import { deepResearch, writeFinalReport } from '../dist/deep-research.js';
import { getDefaultModel } from '../dist/ai/providers.js';

console.log('\n🔬 Testing Deep Research with Google Gemini API...\n');

async function testDeepResearch() {
  try {
    console.log('🤖 Getting best available model...');
    const model = getDefaultModel();
    
    console.log('🔍 Starting deep research on quantum computing...');
    const result = await deepResearch({
      query: 'quantum computing error correction 2024 breakthroughs',
      breadth: 2,  // Keep small for testing
      depth: 1,    // Keep shallow for testing
      model: model,
      onProgress: (progress) => {
        console.log(`📊 Progress: Depth ${progress.currentDepth}/${progress.totalDepth}, Breadth ${progress.currentBreadth}/${progress.totalBreadth}`);
        if (progress.currentQuery) {
          console.log(`   Current query: ${progress.currentQuery}`);
        }
        if (progress.learnings && progress.learnings.length > 0) {
          console.log(`   Found ${progress.learnings.length} new learnings`);
        }
      },
      sourcePreferences: 'avoid SEO listicles and general overviews, prefer technical and research publications'
    });
    
    console.log('\n✅ Research completed successfully!');
    console.log(`📚 Total learnings found: ${result.learnings.length}`);
    console.log(`🌐 URLs visited: ${result.visitedUrls.length}`);
    console.log(`📄 Sources analyzed: ${result.sourceMetadata.length}`);
    
    if (result.learnings.length > 0) {
      console.log('\n📋 Sample learnings:');
      result.learnings.slice(0, 3).forEach((learning, i) => {
        console.log(`${i + 1}. ${learning.substring(0, 150)}...`);
      });
    }
    
    console.log('\n🎉 Test completed successfully! Google API integration works!');
    
  } catch (error) {
    console.error('❌ Error during deep research:', error.message);
    console.log('\nStacktrace for debugging:');
    console.error(error);
  }
}

// Run the test
testDeepResearch();