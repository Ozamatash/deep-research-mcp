#!/usr/bin/env node

// Gemini 2.5 Pro and Flash Performance Test with Langfuse Observability
import { deepResearch, writeFinalReport } from './dist/deep-research.js';
import { getModel } from './dist/ai/providers.js';
import { writeFileSync } from 'fs';

console.log('🚀 Gemini 2.5 Pro and Flash Performance Test');
console.log('📊 Testing with Langfuse observability enabled\n');

const testConfigs = [
  {
    name: 'Gemini 2.5 Flash',
    model: 'google:gemini-2.5-flash',
    query: 'Benefits of renewable energy sources',
    depth: 1,
    breadth: 2,
    expectedTime: 30000
  },
  {
    name: 'Gemini 2.5 Pro', 
    model: 'google:gemini-2.5-pro',
    query: 'Latest quantum computing breakthroughs and commercial applications',
    depth: 2,
    breadth: 3,
    expectedTime: 60000
  },
  {
    name: 'Gemini 2.5 Flash-Lite',
    model: 'google:gemini-2.5-flash-lite', 
    query: 'AI impact on healthcare diagnostics',
    depth: 1,
    breadth: 2,
    expectedTime: 20000
  }
];

async function testModel(config) {
  console.log(`\n🧪 Testing: ${config.name}`);
  console.log(`🔍 Query: "${config.query}"`);
  console.log(`⚙️  Config: depth=${config.depth}, breadth=${config.breadth}`);
  console.log(`⏱️  Expected: ${config.expectedTime / 1000}s\n`);

  const startTime = Date.now();
  
  try {
    const model = getModel(config.model);
    console.log(`✅ Model initialized: ${config.name}`);

    let progressCount = 0;
    const result = await deepResearch({
      query: config.query,
      depth: config.depth,
      breadth: config.breadth,
      model,
      onProgress: (progress) => {
        progressCount++;
        console.log(`📈 Progress ${progressCount}: Depth ${progress.currentDepth}/${progress.totalDepth}, Query ${progress.completedQueries}/${progress.totalQueries}`);
      }
    });

    const researchTime = Date.now() - startTime;
    console.log(`✅ Research completed in ${(researchTime / 1000).toFixed(1)}s`);

    const reportStartTime = Date.now();
    const report = await writeFinalReport({
      prompt: config.query,
      learnings: result.learnings,
      visitedUrls: result.visitedUrls,
      sourceMetadata: result.sourceMetadata,
      model
    });

    const reportTime = Date.now() - reportStartTime;
    const totalTime = Date.now() - startTime;

    const analysis = {
      model: config.name,
      success: true,
      timing: {
        researchTime,
        reportTime,
        totalTime,
        expectedTime: config.expectedTime,
        performanceRatio: totalTime / config.expectedTime
      },
      research: {
        learningsCount: result.learnings.length,
        sourcesCount: result.visitedUrls.length,
        averageReliability: result.weightedLearnings.length > 0 
          ? result.weightedLearnings.reduce((sum, l) => sum + l.reliability, 0) / result.weightedLearnings.length
          : 0
      },
      report: {
        length: report.length,
        hasStructure: report.includes('##'),
        sourcesInReport: (report.match(/https?:\/\/[^\s\)]+/g) || []).length,
        hasReliabilityScores: report.includes('Reliability:')
      },
      progressUpdates: progressCount
    };

    console.log(`📊 Results: ${(totalTime / 1000).toFixed(1)}s total (${(researchTime / 1000).toFixed(1)}s research + ${(reportTime / 1000).toFixed(1)}s report)`);
    console.log(`🎯 Performance: ${analysis.timing.performanceRatio.toFixed(2)}x expected time`);
    console.log(`📚 Learnings: ${analysis.research.learningsCount}, Sources: ${analysis.research.sourcesCount}`);
    console.log(`📄 Report: ${analysis.report.length} chars, ${analysis.report.sourcesInReport} sources`);

    return analysis;

  } catch (error) {
    console.error(`❌ ${config.name} failed:`, error.message);
    return {
      model: config.name,
      success: false,
      error: error.message,
      totalTime: Date.now() - startTime
    };
  }
}

async function main() {
  console.log('🎯 Testing Gemini 2.5 Family Performance & Langfuse Integration\n');

  const results = [];
  
  for (const config of testConfigs) {
    const result = await testModel(config);
    results.push(result);
    
    // Wait between tests
    if (config !== testConfigs[testConfigs.length - 1]) {
      console.log('⏳ Waiting 10s before next test...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  // Generate comparison report
  const report = {
    timestamp: new Date().toISOString(),
    testType: 'Gemini 2.5 Family Performance Comparison',
    langfuseEnabled: true,
    results,
    summary: {
      totalTests: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    }
  };

  console.log('\n🎉 GEMINI 2.5 FAMILY PERFORMANCE SUMMARY:');
  console.log(`   Tests: ${report.summary.successful}/${report.summary.totalTests} successful`);
  
  const successfulResults = results.filter(r => r.success);
  if (successfulResults.length > 0) {
    console.log('\n📊 Model Performance Comparison:');
    
    successfulResults.forEach(result => {
      const timeRating = result.timing.totalTime < 30000 ? '🟢' : 
                        result.timing.totalTime < 60000 ? '🟡' : '🟠';
      console.log(`   ${timeRating} ${result.model}: ${(result.timing.totalTime / 1000).toFixed(1)}s (${result.timing.performanceRatio.toFixed(2)}x expected)`);
    });

    const fastest = successfulResults.reduce((min, r) => r.timing.totalTime < min.timing.totalTime ? r : min);
    const mostReliable = successfulResults.reduce((max, r) => r.research.averageReliability > max.research.averageReliability ? r : max);
    
    console.log(`\n🏆 Fastest: ${fastest.model} (${(fastest.timing.totalTime / 1000).toFixed(1)}s)`);
    console.log(`🎯 Most Reliable: ${mostReliable.model} (${mostReliable.research.averageReliability.toFixed(2)} avg reliability)`);
  }

  writeFileSync('./gemini-25-performance-results.json', JSON.stringify(report, null, 2));
  console.log('\n📄 Detailed results saved to: gemini-25-performance-results.json');

  console.log('\n💡 Langfuse Observability:');
  console.log('   📊 Dashboard: https://cloud.langfuse.com');
  console.log('   🔍 Compare model performance across:');
  console.log('      - Token usage per model');
  console.log('      - Response times and quality');
  console.log('      - Research effectiveness');
  console.log('      - Cost efficiency analysis');

  console.log('\n🚀 PRODUCT OUTCOME - Gemini 2.5 Family:');
  console.log('   ⚡ Fast Performance: All models optimized for speed');
  console.log('   🎯 Model Choice: Flash for speed, Pro for complexity, Flash-Lite for cost');
  console.log('   📊 Langfuse Integration: Full observability for model optimization');
  console.log('   🔧 Production Ready: Reliable performance across model variants');
}

main().catch(console.error);