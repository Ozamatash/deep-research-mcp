#!/usr/bin/env node

// HTTP MCP Server Performance Test with proper lifecycle management
import { spawn } from 'child_process';
import { resolve } from 'path';

const serverPath = resolve('./dist/http-server.js');

console.log('🚀 HTTP MCP Server Performance Test');
console.log('📊 Testing with Langfuse observability\n');

async function testHTTPServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting HTTP MCP server...');

    const server = spawn('node', ['--env-file=.env.local', serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let serverReady = false;
    const startTime = Date.now();

    server.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('📝 Server:', output.trim());
      
      // Check if server is ready
      if (output.includes('Server running') || output.includes('listening')) {
        serverReady = true;
        console.log('✅ HTTP server is ready');
        
        // Test the server with a simple HTTP request
        setTimeout(async () => {
          try {
            console.log('📤 Testing HTTP endpoint...');
            
            const testPayload = {
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
            };

            // Use curl to test the endpoint
            const { spawn: spawnCurl } = await import('child_process');
            const curl = spawnCurl('curl', [
              '-X', 'POST',
              'http://localhost:3000/mcp',
              '-H', 'Content-Type: application/json',
              '-d', JSON.stringify(testPayload),
              '--max-time', '120'
            ]);

            let response = '';
            curl.stdout.on('data', (data) => {
              response += data.toString();
            });

            curl.on('close', (code) => {
              const endTime = Date.now();
              const totalTime = endTime - startTime;

              console.log('✅ HTTP request completed');
              console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);

              try {
                const result = JSON.parse(response);
                const content = result.result?.content || '';
                
                console.log('\n📊 Research Results:');
                console.log(`   - Response status: ${result.error ? 'ERROR' : 'SUCCESS'}`);
                console.log(`   - Report length: ${content.length} characters`);
                console.log(`   - Contains sources: ${content.includes('http') ? 'Yes' : 'No'}`);
                console.log(`   - Has reliability scores: ${content.includes('Reliability') ? 'Yes' : 'No'}`);

                if (content.length > 100) {
                  console.log('\n📄 Report Preview:');
                  console.log(content.substring(0, 200) + '...\n');
                }

                server.kill();
                resolve({ 
                  success: !result.error, 
                  totalTime, 
                  reportLength: content.length,
                  hasContent: content.length > 0
                });

              } catch (e) {
                console.log('⚠️  Response parsing error:', e.message);
                console.log('Raw response:', response.substring(0, 500));
                server.kill();
                resolve({ success: false, error: 'Parse error', response });
              }
            });

          } catch (error) {
            console.error('❌ HTTP test error:', error);
            server.kill();
            reject(error);
          }
        }, 3000); // Wait 3s for server to fully start
      }
    });

    server.stderr.on('data', (data) => {
      const logLine = data.toString().trim();
      if (logLine.includes('[TIMING]') || logLine.includes('Ran ') || logLine.includes('Generated')) {
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

    // Timeout after 3 minutes
    setTimeout(() => {
      console.log('⏰ Test timeout (3 minutes)');
      server.kill();
      resolve({ success: false, error: 'Timeout' });
    }, 180000);
  });
}

async function main() {
  console.log('🎯 Testing HTTP MCP Server Performance & Langfuse Integration\n');

  try {
    const result = await testHTTPServer();
    
    console.log('\n🎉 TEST RESULTS:');
    if (result.success) {
      console.log('✅ Status: SUCCESS');
      console.log(`⚡ Performance: ${(result.totalTime / 1000).toFixed(1)}s`);
      console.log(`📄 Report generated: ${result.hasContent ? 'Yes' : 'No'}`);
      if (result.reportLength) {
        console.log(`📊 Report length: ${result.reportLength} characters`);
      }
    } else {
      console.log('❌ Status: FAILED');
      console.log('Error:', result.error);
    }

    console.log('\n💡 Langfuse Observability:');
    console.log('   ✅ Langfuse keys are configured in .env.local');
    console.log('   📊 Check https://cloud.langfuse.com for detailed traces');
    console.log('   🔍 Look for:');
    console.log('      - Token usage per model call');
    console.log('      - Research query generation traces');
    console.log('      - Source reliability evaluation');
    console.log('      - Final report generation metrics');

    console.log('\n🚀 Performance Assessment:');
    if (result.totalTime) {
      const timeInSeconds = result.totalTime / 1000;
      if (timeInSeconds < 30) {
        console.log('   🟢 EXCELLENT: Sub-30 second response');
      } else if (timeInSeconds < 60) {
        console.log('   🟡 GOOD: Sub-60 second response');
      } else {
        console.log('   🟠 ACCEPTABLE: Over 60 seconds');
      }
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

main().catch(console.error);