#!/usr/bin/env node

// Simple MCP Server Test to verify functionality and Langfuse integration
import { spawn } from 'child_process';
import { resolve } from 'path';

const serverPath = resolve('./dist/mcp-server.js');

console.log('🧪 Simple MCP Server Test with Langfuse Observability\n');

async function testMCPServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting MCP server...');

    const server = spawn('node', ['--env-file=.env.local', serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let responseData = '';
    let initialized = false;
    const startTime = Date.now();

    server.stdout.on('data', (data) => {
      const chunk = data.toString();
      responseData += chunk;

      // Check for initialization
      if (!initialized && chunk.includes('"result"')) {
        initialized = true;
        console.log('✅ MCP server initialized');

        // Send a simple research request
        setTimeout(() => {
          const request = {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'deep-research',
              arguments: {
                query: 'What are the main benefits of renewable energy?',
                depth: 1,
                breadth: 2,
                model: 'google:gemini-2.0-flash-exp'
              }
            }
          };

          console.log('📤 Sending research request...');
          console.log('🔍 Query: "What are the main benefits of renewable energy?"');
          console.log('⚙️  Config: depth=1, breadth=2, model=gemini-2.0-flash-exp');
          server.stdin.write(JSON.stringify(request) + '\n');
        }, 1000);
      }

      // Check for research completion
      if (chunk.includes('"id":1') && chunk.includes('"result"')) {
        const endTime = Date.now();
        const totalTime = endTime - startTime;

        console.log('✅ Research completed!');
        console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);

        // Try to extract some basic info from the response
        try {
          const lines = chunk.split('\n');
          const responseLine = lines.find(line => line.includes('"id":1'));
          if (responseLine) {
            const response = JSON.parse(responseLine);
            const content = response.result?.content || '';
            
            console.log('\n📊 Research Results:');
            console.log(`   - Report length: ${content.length} characters`);
            console.log(`   - Contains sources: ${content.includes('http') ? 'Yes' : 'No'}`);
            console.log(`   - Has reliability scores: ${content.includes('Reliability') ? 'Yes' : 'No'}`);
            console.log(`   - Structured format: ${content.includes('##') ? 'Yes' : 'No'}`);

            // Show first few lines of the report
            const firstLines = content.split('\n').slice(0, 5).join('\n');
            console.log('\n📄 Report Preview:');
            console.log(firstLines + '...\n');
          }
        } catch (e) {
          console.log('⚠️  Could not parse response details');
        }

        server.kill();
        resolve({ success: true, totalTime });
      }
    });

    server.stderr.on('data', (data) => {
      const logLine = data.toString().trim();
      if (logLine.includes('Ran ') || logLine.includes('Generated') || logLine.includes('[TIMING]')) {
        console.log(`📝 ${logLine}`);
      }
    });

    server.on('error', (error) => {
      console.error('❌ Server error:', error);
      reject(error);
    });

    server.on('close', (code) => {
      console.log(`🔚 Server closed with code: ${code}`);
    });

    // Initialize the MCP connection
    setTimeout(() => {
      const initRequest = {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'simple-test-client',
            version: '1.0.0'
          }
        }
      };

      console.log('🔧 Initializing MCP connection...');
      server.stdin.write(JSON.stringify(initRequest) + '\n');
    }, 1000);

    // Timeout after 2 minutes
    setTimeout(() => {
      console.log('⏰ Test timeout (2 minutes)');
      server.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 120000);
  });
}

async function main() {
  console.log('🎯 Testing MCP Server Performance & Langfuse Integration');
  console.log('📊 Langfuse observability should be active with the configured keys\n');

  try {
    const result = await testMCPServer();
    
    if (result.success) {
      console.log('🎉 MCP Server Test: SUCCESS');
      console.log(`⚡ Performance: ${(result.totalTime / 1000).toFixed(1)}s for simple research`);
    } else {
      console.log('❌ MCP Server Test: FAILED');
      console.log('Error:', result.error);
    }

    console.log('\n💡 Langfuse Dashboard Notes:');
    console.log('   - Check https://cloud.langfuse.com for detailed traces');
    console.log('   - Look for token usage, model performance, and research flows');
    console.log('   - Reliability scoring and source evaluation should be tracked');
    console.log('   - Each research query generates multiple LLM calls for observability');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

main().catch(console.error);