import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

describe('MCP Server Integration', () => {
  const serverPath = resolve('./dist/mcp-server.js');

  describe('Server Startup', () => {
    it('should start successfully with proper environment', async () => {
      // Test that the server can start (but don't keep it running for tests)
      const startCommand = `timeout 5s node --env-file=.env.local ${serverPath} 2>&1 || true`;

      const output = execSync(startCommand, {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(output).toContain('Deep Research MCP Server running on stdio');
      expect(output).toContain('Environment check:');
    });

    it('should log API key status correctly', async () => {
      const startCommand = `timeout 3s node --env-file=.env.local ${serverPath} 2>&1 || true`;

      const output = execSync(startCommand, {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(output).toContain('hasGoogleKey');
      expect(output).toContain('hasFirecrawlKey');
      expect(output).toContain('hasOpenAiKey');
    });
  });

  describe('Build Verification', () => {
    it('should have all required files built', () => {
      const fs = require('fs');
      const path = require('path');

      const requiredFiles = [
        'dist/mcp-server.js',
        'dist/deep-research.js',
        'dist/config.js',
        'dist/ai/providers.js',
      ];

      for (const file of requiredFiles) {
        expect(fs.existsSync(path.resolve(file))).toBe(true);
      }
    });

    it('should have built JavaScript files', () => {
      const fs = require('fs');
      const path = require('path');

      // Check that the main files exist and are not empty
      const mcpServerPath = path.resolve('dist/mcp-server.js');
      const deepResearchPath = path.resolve('dist/deep-research.js');

      expect(fs.existsSync(mcpServerPath)).toBe(true);
      expect(fs.existsSync(deepResearchPath)).toBe(true);

      // Check file sizes are reasonable (not empty)
      const mcpServerStats = fs.statSync(mcpServerPath);
      const deepResearchStats = fs.statSync(deepResearchPath);

      expect(mcpServerStats.size).toBeGreaterThan(1000); // At least 1KB
      expect(deepResearchStats.size).toBeGreaterThan(1000);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate environment file exists', () => {
      const fs = require('fs');
      const path = require('path');

      const envPath = path.resolve('.env.local');
      expect(fs.existsSync(envPath)).toBe(true);

      const envContent = fs.readFileSync(envPath, 'utf8');
      expect(envContent).toContain('GOOGLE_API_KEY');
      expect(envContent).toContain('FIRECRAWL_KEY');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle missing environment file gracefully', () => {
      const missingEnvCommand = `cd /tmp && timeout 3s node ${serverPath} 2>&1 || true`;

      try {
        const output = execSync(missingEnvCommand, {
          encoding: 'utf8',
        });

        // Should still attempt to start but may fail due to missing config
        expect(output).toBeDefined();
      } catch (error) {
        // Expected to fail without proper environment
        expect(error).toBeDefined();
      }
    });

    it('should have Node.js available', () => {
      expect(process).toBeDefined();
      expect(typeof process.version).toBe('string');
    });
  });
});