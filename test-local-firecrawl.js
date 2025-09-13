#!/usr/bin/env node

// Test Deep Research with Local Firecrawl and Gemini 2.5 Models
import { deepResearch, writeFinalReport } from './dist/deep-research.js';
import { getModel } from './dist/ai/providers.js';
import { writeFileSync } from 'fs';

console.log('🚀 Testing Deep Research with Local Firecrawl');
console.log('📊 Using SearXNG backend + Gemini 2.5 Flash\n');

async function testLocalFirecrawl() {
  console.log('🎯 Testing local Firecrawl integration...');
  console.log('🔍 Query: "Benefits of renewable energy"');
  console.log('⚙️  Model: Gemini 2.5 Flash');
  console.log('🌐 Firecrawl: Local instance (http://localhost:3002)\n');

  const startTime = Date.now();
  
  try {
    const model = getModel('google:gemini-2.5-flash');
    console.log('✅ Model initialized: Gemini 2.5 Flash');

    let progressCount = 0;
    const result = await deepResearch({
      query: 'Benefits of renewable energy',
      depth: 1,
      breadth: 2,
      model,
      onProgress: (progress) => {
        progressCount++;
        console.log(`📈 Progress ${progressCount}: Depth ${progress.currentDepth}/${progress.totalDepth}, Query ${progress.completedQueries}/${progress.totalQueries}`);
        if (progress.currentQuery) {
          console.log(`   Current: ${progress.currentQuery}`);
        }
      }
    });

    const researchTime = Date.now() - startTime;
    console.log(`✅ Research completed in ${(researchTime / 1000).toFixed(1)}s`);

    console.log('\n📊 Research Results:');
    console.log(`   - Learnings found: ${result.learnings.length}`);
    console.log(`   - Sources visited: ${result.visitedUrls.length}`);
    console.log(`   - Source metadata: ${result.sourceMetadata.length}`);
    console.log(`   - Average reliability: ${result.weightedLearnings.length > 0 
      ? (result.weightedLearnings.reduce((sum, l) => sum + l.reliability, 0) / result.weightedLearnings.length).toFixed(2)
      : 'N/A'}`);

    if (result.learnings.length > 0) {
      console.log('\n📚 Sample Learnings:');
      result.learnings.slice(0, 3).forEach((learning, i) => {
        console.log(`   ${i + 1}. ${learning.substring(0, 100)}...`);
      });
    }

    if (result.visitedUrls.length > 0) {
      console.log('\n🔗 Sample Sources:');
      result.visitedUrls.slice(0, 3).forEach((url, i) => {
        console.log(`   ${i + 1}. ${url}`);
      });
    }

    // Generate final report
    console.log('\n📝 Generating final report...');
    const reportStartTime = Date.now();
    
    const report = await writeFinalReport({
      prompt: 'Benefits of renewable energy',
      learnings: result.learnings,
      visitedUrls: result.visitedUrls,
      sourceMetadata: result.sourceMetadata,
      model
    });

    const reportTime = Date.now() - reportStartTime;
    const totalTime = Date.now() - startTime;

    console.log(`✅ Report generated in ${(reportTime / 1000).toFixed(1)}s`);
    console.log(`🎉 Total time: ${(totalTime / 1000).toFixed(1)}s`);

    const analysis = {
      success: true,
      timing: {
        researchTime,
        reportTime,
        totalTime
      },
      research: {
        learningsCount: result.learnings.length,
        sourcesCount: result.visitedUrls.length,
        sourceMetadataCount: result.sourceMetadata.length,
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
      progressUpdates: progressCount,
      localFirecrawl: true
    };

    // Save results
    const results = {
      timestamp: new Date().toISOString(),
      testType: 'Local Firecrawl Integration Test',
      model: 'google:gemini-2.5-flash',
      firecrawlInstance: 'Local (http://localhost:3002)',
      searxngBackend: true,
      langfuseEnabled: true,
      analysis,
      sampleLearnings: result.learnings.slice(0, 3),
      sampleSources: result.visitedUrls.slice(0, 5),
      reportPreview: report.substring(0, 500)
    };

    writeFileSync('./local-firecrawl-test-results.json', JSON.stringify(results, null, 2));
    console.log('\n📄 Results saved to: local-firecrawl-test-results.json');

    // Save the full report
    writeFileSync('./local-firecrawl-report.md', report);
    console.log('📄 Full report saved to: local-firecrawl-report.md');

    return analysis;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return {
      success: false,
      error: error.message,
      totalTime: Date.now() - startTime
    };
  }
}

async function main() {
  console.log('🎯 Testing Deep Research with Local Firecrawl & SearXNG\n');

  try {
    const result = await testLocalFirecrawl();
    
    console.log('\n🎉 LOCAL FIRECRAWL TEST RESULTS:');
    
    if (result.success) {
      console.log('✅ Status: SUCCESS');
      console.log(`⚡ Speed: ${(result.timing.totalTime / 1000).toFixed(1)}s total`);
      console.log(`🔬 Research: ${(result.timing.researchTime / 1000).toFixed(1)}s`);
      console.log(`📝 Report: ${(result.timing.reportTime / 1000).toFixed(1)}s`);
      console.log(`📚 Data: ${result.research.learningsCount} learnings, ${result.research.sourcesCount} sources`);
      console.log(`📊 Quality: ${result.report.length} chars, ${result.report.sourcesInReport} sources in report`);
      
      if (result.research.averageReliability > 0) {
        console.log(`🎯 Reliability: ${result.research.averageReliability.toFixed(2)} average`);
      }
    } else {
      console.log('❌ Status: FAILED');
      console.log('Error:', result.error);
    }

    console.log('\n🌐 Local Firecrawl Benefits:');
    console.log('   ✅ No API costs or rate limits');
    console.log('   ✅ SearXNG backend for diverse search results');
    console.log('   ✅ Full control over search engines and privacy');
    console.log('   ✅ No external dependencies for web research');

    console.log('\n💡 Langfuse Observability:');
    console.log('   📊 Dashboard: https://cloud.langfuse.com');
    console.log('   🔍 Track local vs cloud performance');
    console.log('   📈 Monitor cost savings and reliability');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

main().catch(console.error);