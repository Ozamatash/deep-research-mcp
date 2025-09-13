#!/usr/bin/env node

// Integration test script for actual research queries
// This script tests the MCP server with real API calls

import { spawn } from 'child_process';
import { resolve } from 'path';

const serverPath = resolve('./dist/mcp-server.js');

console.log('🧪 Testing MCP Server with Gemini 2.5 Pro and Flash Models\n');

// Test cases with Gemini 2.5 Pro and Flash models
const testCases = [
  {
    name: 'Fast Query - Gemini 2.5 Flash',
    request: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'deep-research',
        arguments: {
          query: 'Benefits of renewable energy sources',
          depth: 1,
          breadth: 2,
          model: 'google:gemini-2.5-flash'
        }
      }
    }
  },
  {
    name: 'Complex Query - Gemini 2.5 Pro',
    request: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'deep-research',
        arguments: {
          query: 'Latest quantum computing breakthroughs and their commercial applications',
          depth: 2,
          breadth: 3,
          model: 'google:gemini-2.5-pro',
          sourcePreferences: 'prefer academic papers and technical publications, avoid general news'
        }
      }
    }
  },
  {
    name: 'Speed Test - Gemini 2.5 Flash-Lite',
    request: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'deep-research',
        arguments: {
          query: 'AI impact on healthcare diagnostics',
          depth: 1,
          breadth: 2,
          model: 'google:gemini-2.5-flash-lite'
        }
      }
    }
  }
];

async function runTest(testCase) {
  return new Promise((resolve, reject) => {
    console.log(`\n📋 Running test: ${testCase.name}`);

    const server = spawn('node', ['--env-file=.env.local', serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let responseData = '';
    let errorData = '';
    let initialized = false;

    // Handle server output
    server.stdout.on('data', (data) => {
      const chunk = data.toString();
      responseData += chunk;

      // Check for initialization
      if (!initialized && chunk.includes('"result"')) {
        initialized = true;

        // Send the test request after initialization
        setTimeout(() => {
          console.log('📤 Sending research request...');
          server.stdin.write(JSON.stringify(testCase.request) + '\n');
        }, 1000);
      }

      // Check for test response
      if (chunk.includes(`"id":${testCase.request.id}`)) {
        console.log('✅ Received response');
        server.kill();
        resolve({ success: true, response: responseData });
      }
    });

    server.stderr.on('data', (data) => {
      errorData += data.toString();
      console.log('📝 Server log:', data.toString().trim());
    });

    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      reject(error);
    });

    server.on('close', (code) => {
      if (code !== 0) {
        console.log(`⚠️ Server exited with code ${code}`);
        console.log('Error output:', errorData);
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
            name: 'test-client',
            version: '1.0.0'
          }
        }
      };

      console.log('🔧 Initializing MCP connection...');
      server.stdin.write(JSON.stringify(initRequest) + '\n');
    }, 1000);

    // Timeout after 300 seconds
    setTimeout(() => {
      console.log('⏰ Test timeout');
      server.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 300000);
  });
}

async function main() {
  console.log('🚀 Starting MCP Server Integration Tests\n');

  for (const testCase of testCases) {
    try {
      const result = await runTest(testCase);

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

    // Wait between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n🎉 Integration tests completed!');
  console.log('\n💡 Note: These tests make real API calls and may incur costs.');
  console.log('   Make sure your API keys have sufficient credits.');
}

main().catch(console.error);