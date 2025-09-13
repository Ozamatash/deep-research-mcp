import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dotenv
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

// Mock process.env for testing
const originalEnv = process.env;

describe('Config', () => {
  beforeEach(() => {
    // Reset process.env
    process.env = { ...originalEnv };

    // Clear require cache
    delete require.cache[require.resolve('../../dist/config.js')];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Environment Variable Parsing', () => {
    it('should parse valid environment variables', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.GOOGLE_API_KEY = 'test-google-key';
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      process.env.XAI_API_KEY = 'test-xai-key';
      process.env.FIRECRAWL_KEY = 'test-firecrawl-key';
      process.env.FIRECRAWL_CONCURRENCY = '3';

      const { Config } = require('../config.js');

      expect(Config.openai.apiKey).toBe('test-openai-key');
      expect(Config.google.apiKey).toBe('test-google-key');
      expect(Config.anthropic.apiKey).toBe('test-anthropic-key');
      expect(Config.xai.apiKey).toBe('test-xai-key');
      expect(Config.firecrawl.apiKey).toBe('test-firecrawl-key');
      expect(Config.firecrawl.concurrency).toBe(3);
    });

    it('should handle missing optional environment variables', () => {
      // Only set required variables
      process.env.FIRECRAWL_CONCURRENCY = '2';

      const { Config } = require('../../dist/config.js');

      expect(Config.openai.apiKey).toBeUndefined();
      expect(Config.google.apiKey).toBeUndefined();
      expect(Config.anthropic.apiKey).toBeUndefined();
      expect(Config.xai.apiKey).toBeUndefined();
      expect(Config.firecrawl.concurrency).toBe(2);
    });

    it('should handle local Firecrawl configuration', () => {
      process.env.FIRECRAWL_BASE_URL = 'http://localhost:3002';
      process.env.FIRECRAWL_CONCURRENCY = '1';

      const { Config } = require('../../dist/config.js');

      expect(Config.firecrawl.baseUrl).toBe('http://localhost:3002');
      expect(Config.firecrawl.apiKey).toBeNull(); // No key needed for local
      expect(Config.isLocalFirecrawl).toBe(true);
    });

    it('should parse FIRECRAWL_CONCURRENCY as number', () => {
      process.env.FIRECRAWL_CONCURRENCY = '5';

      const { Config } = require('../../dist/config.js');

      expect(Config.firecrawl.concurrency).toBe(5);
      expect(typeof Config.firecrawl.concurrency).toBe('number');
    });

    it('should use default concurrency when not set', () => {
      const { Config } = require('../config.js');

      expect(Config.firecrawl.concurrency).toBe(2); // Default value
    });
  });

  describe('Validation', () => {
    it('should validate FIRECRAWL_BASE_URL format', () => {
      process.env.FIRECRAWL_BASE_URL = 'invalid-url';

      expect(() => {
        require('../config.js');
      }).toThrow(); // Should throw due to invalid URL
    });

    it('should accept valid FIRECRAWL_BASE_URL', () => {
      process.env.FIRECRAWL_BASE_URL = 'http://localhost:3002';

      expect(() => {
        const { Config } = require('../config.js');
        expect(Config.firecrawl.baseUrl).toBe('http://localhost:3002');
      }).not.toThrow();
    });
  });

  describe('Convenience Exports', () => {
    it('should export individual config objects', () => {
      process.env.GOOGLE_API_KEY = 'test-key';

      const { Config, openai, google, anthropic, xai, firecrawl } = require('../../dist/config.js');

      expect(google).toBe(Config.google);
      expect(firecrawl).toBe(Config.firecrawl);
      expect(openai).toBe(Config.openai);
      expect(anthropic).toBe(Config.anthropic);
      expect(xai).toBe(Config.xai);
    });
  });
});