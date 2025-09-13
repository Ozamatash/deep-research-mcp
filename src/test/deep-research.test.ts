import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock Firecrawl
vi.mock('@mendable/firecrawl-js', () => ({
  FirecrawlApp: vi.fn(),
}));

// Mock AI SDK
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

// Mock providers
vi.mock('../ai/providers.js', () => ({
  getDefaultModel: vi.fn(),
  trimPrompt: vi.fn(),
}));

// Mock config
vi.mock('../config.js', () => ({
  firecrawl: {
    concurrency: 2,
  },
}));

// Mock output manager
vi.mock('../output-manager.js', () => ({
  OutputManager: vi.fn().mockImplementation(() => ({
    log: vi.fn(),
  })),
}));

// Mock prompt
vi.mock('../prompt.js', () => ({
  systemPrompt: vi.fn(),
}));

describe('Deep Research', () => {
  let mockFirecrawl: any;
  let mockGenerateObject: any;
  let mockModel: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mocks
    mockFirecrawl = {
      search: vi.fn(),
    };

    mockModel = {
      api: 'test',
    };

    mockGenerateObject = vi.fn();

    // Mock the FirecrawlApp constructor
    const FirecrawlApp = vi.mocked(require('@mendable/firecrawl-js').FirecrawlApp);
    FirecrawlApp.mockReturnValue(mockFirecrawl);

    // Mock generateObject
    const { generateObject } = require('ai');
    generateObject.mockImplementation(mockGenerateObject);

    // Mock getDefaultModel
    const { getDefaultModel } = require('../ai/providers.js');
    getDefaultModel.mockReturnValue(mockModel);

    // Mock trimPrompt
    const { trimPrompt } = require('../ai/providers.js');
    trimPrompt.mockImplementation((text: string) => text);

    // Mock systemPrompt
    const { systemPrompt } = require('../prompt.js');
    systemPrompt.mockReturnValue('Test system prompt');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('deepResearch integration', () => {
    it('should handle empty search results gracefully', async () => {
      const { deepResearch } = await import('../deep-research.js');

      mockFirecrawl.search.mockResolvedValue({
        data: [],
      });

      const result = await deepResearch({
        query: 'test topic with no results',
        breadth: 1,
        depth: 1,
        model: mockModel,
      });

      expect(result.learnings).toEqual([]);
      expect(result.visitedUrls).toEqual([]);
    });

    it('should handle Firecrawl errors gracefully', async () => {
      const { deepResearch } = await import('../deep-research.js');

      mockFirecrawl.search.mockRejectedValue(new Error('Firecrawl API error'));

      const result = await deepResearch({
        query: 'test topic',
        breadth: 1,
        depth: 1,
        model: mockModel,
      });

      expect(result.learnings).toEqual([]);
      expect(result.visitedUrls).toEqual([]);
    });
  });

  describe('deepResearch', () => {
    it('should perform iterative research', async () => {
      const { deepResearch } = await import('../deep-research.js');

      // Mock search results
      mockFirecrawl.search.mockResolvedValue({
        data: [
          {
            url: 'https://example.com',
            title: 'Test Result',
            markdown: 'Test content',
          },
        ],
      });

      // Mock query generation
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          queries: [
            {
              query: 'test search query',
              researchGoal: 'Test research goal',
              reliabilityThreshold: 0.5,
              isVerificationQuery: false,
              relatedDirection: null,
            },
          ],
        },
        usage: { totalTokens: 100 },
      });

      // Mock learning extraction
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          learnings: [
            {
              content: 'Test learning',
              confidence: 0.8,
              sources: ['example.com'],
            },
          ],
          followUpQuestions: [],
          followUpPriorities: [],
          sourceQuality: {
            mostReliableSources: ['example.com'],
            contentGaps: [],
            reliabilityAnalysis: 'Good',
          },
        },
        usage: { totalTokens: 200 },
      });

      const result = await deepResearch({
        query: 'test research topic',
        breadth: 1,
        depth: 1,
        model: mockModel,
      });

      expect(result.learnings).toContain('Test learning');
      expect(result.visitedUrls).toContain('https://example.com');
      expect(mockFirecrawl.search).toHaveBeenCalledWith('test search query', expect.any(Object));
    });

    it('should handle network failures gracefully', async () => {
      const { deepResearch } = await import('../deep-research.js');

      mockFirecrawl.search.mockRejectedValue(new Error('Network error'));

      const result = await deepResearch({
        query: 'test topic',
        breadth: 1,
        depth: 1,
        model: mockModel,
      });

      expect(result.learnings).toEqual([]);
      expect(result.visitedUrls).toEqual([]);
    });

    it('should respect token budget', async () => {
      const { deepResearch } = await import('../deep-research.js');

      mockGenerateObject.mockResolvedValue({
        object: {
          queries: [
            {
              query: 'test query',
              researchGoal: 'Test goal',
              reliabilityThreshold: 0.5,
              isVerificationQuery: false,
              relatedDirection: null,
            },
          ],
        },
        usage: { totalTokens: 1000 }, // Exceed budget
      });

      const result = await deepResearch({
        query: 'test topic',
        breadth: 1,
        depth: 1,
        tokenBudget: 500, // Low budget
        model: mockModel,
      });

      expect(result.budget?.reached).toBe(true);
    });
  });
});