#!/usr/bin/env node

// Comprehensive MCP Server Performance Test with Langfuse Observability
// Tests speed, reliability, and quality across different models and configurations

import { spawn } from 'child_process';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

const serverPath = resolve('./dist/mcp-server.js');

console.log('🚀 Deep Research MCP Server Performance Test');
console.log('📊 Testing with Langfuse observability enabled\n');

// Performance test cases with different complexity levels
const testCases = [
  {
    name: 'Fast Query - Simple Topic',
    request: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'deep-research',
        arguments: {
          query: 'Benefits of solar energy',
          depth: 1,
          breadth: 2,
          model: 'google:gemini-2.0-flash-exp'
        }
      }
    },
    expectedTime: 30000, // 30 seconds
    complexity: 'low'
  },
  {
    name: 'Medium Query - Technical Topic',
    request: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'deep-research',
        arguments: {
          query: 'Latest developments in quantum computing error correction 2024',
          depth: 2,
          breadth: 3,
          model: 'google:gemini-2.0-flash-exp',
          sourcePreferences: 'prefer academic papers and technical publications, avoid general news'
        }
      }
    },
    expectedTime: 60000, // 60 seconds
    complexity: 'medium'
  },
  {
    name: 'Complex Query - Multi-faceted Research',
    request: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'deep-research',
        arguments: {
          query: 'Impact of AI on healthcare diagnostics: current applications, regulatory challenges, and future prospects',
          depth: 3,
          breadth: 4,
          model: 'google:gemini-2.0-flash-exp',
          sourcePreferences: 'prioritize peer-reviewed research, medical journals, and regulatory documents'
        }
      }
    },
    expectedTime: 120000, // 2 minutes
    complexity: 'high'
  }
];

// Performance metrics tracking
const metrics = {
  totalTests: testCases.length,
  passed: 0,
  failed: 0,
  results: []
};

async function runPerformanceTest(testCase) {
  return new Promise((resolve, reject) => {
    console.log(`\n🧪 Running: ${testCase.name}`);
    console.log(`📋 Complexity: ${testCase.complexity.toUpperCase()}`);
    console.log(`⏱️  Expected time: ${testCase.expectedTime / 1000}s`);

    const startTime = Date.now();
    const server = spawn('node', ['--env-file=.env.local', serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let responseData = '';
    let errorData = '';
    let initialized = false;
    let testStartTime = null;

    // Handle server output
    server.stdout.on('data', (data) => {
      const chunk = data.toString();
      responseData += chunk;

      // Check for initialization
      if (!initialized && chunk.includes('"result"')) {
        initialized = true;
        testStartTime = Date.now();

        // Send the test request after initialization
        setTimeout(() => {
          console.log('📤 Sending research request...');
          server.stdin.write(JSON.stringify(testCase.request) + '\n');
        }, 1000);
      }

      // Check for test response
      if (chunk.includes(`"id":${testCase.request.id}`)) {
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        const researchTime = testStartTime ? endTime - testStartTime : totalTime;

        console.log('✅ Research completed');
        console.log(`⏱️  Total time: ${totalTime}ms`);
        console.log(`🔬 Research time: ${researchTime}ms`);

        // Parse response to extract quality metrics
        try {
          const response = JSON.parse(chunk);
          const result = response.result;
          
          const qualityMetrics = {
            reportLength: result?.content?.length || 0,
            sourcesCount: (result?.content?.match(/https?:\/\/[^\s\)]+/g) || []).length,
            hasReliabilityScores: result?.content?.includes('Reliability:') || false,
            hasStructuredSections: (result?.content?.match(/^##/gm) || []).length
          };

          const testResult = {
            name: testCase.name,
            complexity: testCase.complexity,
            success: true,
            totalTime,
            researchTime,
            expectedTime: testCase.expectedTime,
            performanceRatio: researchTime / testCase.expectedTime,
            qualityMetrics,
            withinExpectedTime: researchTime <= testCase.expectedTime
          };

          metrics.results.push(testResult);
          metrics.passed++;

          console.log(`📊 Quality metrics:`);
          console.log(`   - Report length: ${qualityMetrics.reportLength} chars`);
          console.log(`   - Sources found: ${qualityMetrics.sourcesCount}`);
          console.log(`   - Has reliability scores: ${qualityMetrics.hasReliabilityScores}`);
          console.log(`   - Structured sections: ${qualityMetrics.hasStructuredSections}`);
          console.log(`🎯 Performance: ${testResult.withinExpectedTime ? 'WITHIN' : 'EXCEEDED'} expected time`);

        } catch (parseError) {
          console.log('⚠️  Could not parse response for quality analysis');
        }

        server.kill();
        resolve({ success: true, totalTime, researchTime });
      }
    });

    server.stderr.on('data', (data) => {
      errorData += data.toString();
      const logLine = data.toString().trim();
      if (logLine.includes('[TIMING]') || logLine.includes('Ran ') || logLine.includes('Generated')) {
        console.log(`📝 ${logLine}`);
      }
    });

    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      metrics.failed++;
      reject(error);
    });

    server.on('close', (code) => {
      if (code !== 0) {
        console.log(`⚠️ Server exited with code ${code}`);
        metrics.failed++;
      }
      resolve({ success: false, code, error: errorData });
    });

    // Send initialize request first
    setTimeout(() => {
      const initRequest = {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'performance-test-client',
            version: '1.0.0'
          }
        }
      };

      console.log('🔧 Initializing MCP connection...');
      server.stdin.write(JSON.stringify(initRequest) + '\n');
    }, 1000);

    // Timeout with buffer beyond expected time
    setTimeout(() => {
      console.log('⏰ Test timeout');
      server.kill();
      metrics.failed++;
      resolve({ success: false, error: 'Timeout' });
    }, testCase.expectedTime + 60000); // Add 60s buffer
  });
}

function generatePerformanceReport() {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalTests: metrics.totalTests,
      passed: metrics.passed,
      failed: metrics.failed,
      successRate: (metrics.passed / metrics.totalTests * 100).toFixed(1)
    },
    langfuseEnabled: true,
    results: metrics.results,
    analysis: {
      averagePerformanceRatio: metrics.results.length > 0 
        ? (metrics.results.reduce((sum, r) => sum + r.performanceRatio, 0) / metrics.results.length).toFixed(2)
        : 0,
      testsWithinExpectedTime: metrics.results.filter(r => r.withinExpectedTime).length,
      averageSourcesPerTest: metrics.results.length > 0
        ? (metrics.results.reduce((sum, r) => sum + r.qualityMetrics.sourcesCount, 0) / metrics.results.length).toFixed(1)
        : 0,
      averageReportLength: metrics.results.length > 0
        ? Math.round(metrics.results.reduce((sum, r) => sum + r.qualityMetrics.reportLength, 0) / metrics.results.length)
        : 0
    }
  };

  return report;
}

async function main() {
  console.log('🚀 Starting Deep Research MCP Performance Tests');
  console.log('📊 Langfuse observability: ENABLED');
  console.log('🎯 Testing for speed, reliability, and quality\n');

  for (const testCase of testCases) {
    try {
      const result = await runPerformanceTest(testCase);

      if (result.success) {
        console.log(`✅ ${testCase.name}: PASSED`);
      } else {
        console.log(`❌ ${testCase.name}: FAILED`);
        console.log('Details:', result.error || result.code);
      }
    } catch (error) {
      console.log(`❌ ${testCase.name}: ERROR`);
      console.error(error);
    }

    // Wait between tests to avoid rate limits
    console.log('⏳ Waiting 10s before next test...');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  // Generate and save performance report
  const report = generatePerformanceReport();
  const reportPath = './performance-report.json';
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n🎉 Performance Testing Completed!');
  console.log('\n📊 PERFORMANCE SUMMARY:');
  console.log(`   Tests passed: ${report.summary.passed}/${report.summary.totalTests} (${report.summary.successRate}%)`);
  console.log(`   Average performance ratio: ${report.analysis.averagePerformanceRatio} (lower is faster)`);
  console.log(`   Tests within expected time: ${report.analysis.testsWithinExpectedTime}/${report.summary.totalTests}`);
  console.log(`   Average sources per test: ${report.analysis.averageSourcesPerTest}`);
  console.log(`   Average report length: ${report.analysis.averageReportLength} characters`);
  console.log(`\n📄 Detailed report saved to: ${reportPath}`);
  console.log('\n💡 Langfuse Dashboard: Check your Langfuse dashboard for detailed observability data');
  console.log('   - Token usage tracking');
  console.log('   - Model performance metrics');
  console.log('   - Research flow tracing');
  console.log('   - Quality and reliability analysis');
}

main().catch(console.error);