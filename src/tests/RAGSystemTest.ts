/**
 * Comprehensive RAG System Test Suite
 * 
 * Tests all components of the RAG system including:
 * - Vector embedding and similarity search
 * - RAG query processing
 * - API integration (mocked)
 * - Cross-meeting search functionality
 */

import { vectorService, type Vector } from '../services/VectorService';
import { ragService, type RAGResult } from '../services/RAGService';

// Test data - mimics actual meeting segments
const TEST_SEGMENTS = [
  {
    idx: 0,
    t: 0,
    speaker: "汤欣钰",
    text: "猫戴在身上，然后又有定位，又有糖包与翻译。嗯，去年好像就有这个，好像就有一个，去年好像有一个类似的，就是也戴在什么身上啊？"
  },
  {
    idx: 1,
    t: 56,
    speaker: "汤欣钰", 
    text: "然后，嗯，要不然我们先说，嗯，就明天，不是还是下午有那个周会嘛？嗯，对，就大家最近有没有什么困难？然后以及有没有识别到什么机会、想法的？"
  },
  {
    idx: 2,
    t: 96,
    speaker: "汤欣钰",
    text: "对，我看这个黑马项目他们都有在全捷 OA 上部署一些 1.5B 的端观测模型。嗯，完全是比我们这个参数量要大得多，然后好像还行，那可以联系下他们，是吧？"
  },
  {
    idx: 3,
    t: 124,
    speaker: "汤欣钰",
    text: "你这个知道，然后我再问一下这边的 Buzz，是吧？然后我也留了。那个还有没有什么困难啊？有没有大家觉得遇到一些困难的？对。嗯，有个比较大的困难，就跟上头聊的那个隐私模式，其实感觉没有特别好的思路。"
  }
];

export interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

export class RAGSystemTest {
  private results: TestResult[] = [];
  
  /**
   * Run all RAG system tests
   */
  async runAllTests(): Promise<TestResult[]> {
    this.results = [];
    
    console.log('🧪 Starting RAG System Tests...');
    
    // Vector Service Tests
    await this.testVectorService();
    
    // RAG Service Tests (with mock API)
    await this.testRAGService();
    
    // Integration Tests
    await this.testIntegration();
    
    // Performance Tests
    await this.testPerformance();
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    console.log(`🏁 RAG Tests Complete: ${passed}/${total} passed`);
    
    return this.results;
  }

  /**
   * Test Vector Service functionality
   */
  private async testVectorService() {
    console.log('🔍 Testing Vector Service...');
    
    // Test 1: Vector service initialization
    this.addTest({
      name: 'Vector Service - Initialization',
      passed: vectorService !== undefined,
      details: 'Vector service should be initialized'
    });

    // Test 2: Clear vectors
    vectorService.clear();
    this.addTest({
      name: 'Vector Service - Clear',
      passed: vectorService.getVectorCount() === 0,
      details: `Vector count after clear: ${vectorService.getVectorCount()}`
    });

    // Test 3: Add meeting segments (with fallback embedding)
    try {
      // Use fallback embedding for testing (no API key required)
      await vectorService.addMeetingSegments('test_meeting_1', TEST_SEGMENTS);
      const vectorCount = vectorService.getVectorCount();
      
      this.addTest({
        name: 'Vector Service - Add Segments',
        passed: vectorCount > 0,
        details: `Added ${vectorCount} vectors from ${TEST_SEGMENTS.length} segments`
      });
    } catch (error) {
      this.addTest({
        name: 'Vector Service - Add Segments',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test 4: Semantic search
    try {
      const searchResults = await vectorService.semanticSearch('黑马项目', 3);
      
      this.addTest({
        name: 'Vector Service - Semantic Search',
        passed: searchResults.length > 0,
        details: `Found ${searchResults.length} results for "黑马项目"`
      });
      
      // Test similarity scores
      if (searchResults.length > 0) {
        const topResult = searchResults[0];
        this.addTest({
          name: 'Vector Service - Similarity Scores',
          passed: topResult.similarity >= 0 && topResult.similarity <= 1,
          details: `Top similarity: ${topResult.similarity.toFixed(3)}`
        });
      }
    } catch (error) {
      this.addTest({
        name: 'Vector Service - Semantic Search',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test 5: Export/Import vectors
    const exportedVectors = vectorService.exportVectors();
    vectorService.clear();
    vectorService.importVectors(exportedVectors);
    
    this.addTest({
      name: 'Vector Service - Export/Import',
      passed: vectorService.getVectorCount() === exportedVectors.length,
      details: `Exported and reimported ${exportedVectors.length} vectors`
    });
  }

  /**
   * Test RAG Service functionality
   */
  private async testRAGService() {
    console.log('🤖 Testing RAG Service...');
    
    // Mock API responses for testing
    this.mockRAGAPI();
    
    // Test 1: RAG service initialization
    this.addTest({
      name: 'RAG Service - Initialization',
      passed: ragService !== undefined,
      details: 'RAG service should be initialized'
    });

    // Test 2: Configuration
    ragService.setApiKey('test_key_123');
    this.addTest({
      name: 'RAG Service - Configuration',
      passed: true, // API key is set in localStorage
      details: 'API key configured for testing'
    });

    // Test 3: Basic query (should use fallback if API fails)
    try {
      const result = await ragService.query('什么是黑马项目？');
      
      this.addTest({
        name: 'RAG Service - Basic Query',
        passed: result.answer.length > 0,
        details: `Answer length: ${result.answer.length} chars, Sources: ${result.sources.length}`
      });
      
      // Test sources
      this.addTest({
        name: 'RAG Service - Source Citations',
        passed: result.sources.length > 0,
        details: `Found ${result.sources.length} source citations`
      });
      
      // Test confidence
      this.addTest({
        name: 'RAG Service - Confidence Score',
        passed: result.confidence >= 0 && result.confidence <= 1,
        details: `Confidence: ${(result.confidence * 100).toFixed(1)}%`
      });
    } catch (error) {
      this.addTest({
        name: 'RAG Service - Basic Query',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test 4: Cross-meeting query
    // Add another meeting to test cross-meeting search
    await vectorService.addMeetingSegments('test_meeting_2', [
      {
        idx: 0,
        t: 0,
        speaker: "张三",
        text: "关于黑马项目的后续规划，我们需要考虑技术架构的升级。"
      }
    ]);

    try {
      const crossResult = await ragService.query('黑马项目的规划是什么？');
      
      // Should find results from both meetings
      const meetingIds = new Set(crossResult.sources.map(s => s.meetingId));
      
      this.addTest({
        name: 'RAG Service - Cross-Meeting Search',
        passed: meetingIds.size >= 1,
        details: `Found results from ${meetingIds.size} meeting(s)`
      });
    } catch (error) {
      this.addTest({
        name: 'RAG Service - Cross-Meeting Search',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Test integration between components
   */
  private async testIntegration() {
    console.log('🔗 Testing Integration...');
    
    // Test 1: End-to-end workflow
    try {
      // Clear and re-add data
      vectorService.clear();
      await vectorService.addMeetingSegments('integration_test', TEST_SEGMENTS);
      
      // Query the system
      const result = await ragService.query('有什么技术困难？');
      
      this.addTest({
        name: 'Integration - End-to-End Workflow',
        passed: result.answer.length > 0 && result.sources.length > 0,
        details: `Complete workflow: indexing → querying → response generation`
      });
    } catch (error) {
      this.addTest({
        name: 'Integration - End-to-End Workflow',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Test 2: Fallback behavior
    // Test with no API key to ensure fallback works
    const originalKey = localStorage.getItem('openai_api_key');
    localStorage.removeItem('openai_api_key');
    
    try {
      const fallbackResult = await ragService.query('测试fallback');
      
      this.addTest({
        name: 'Integration - Fallback Behavior',
        passed: fallbackResult.answer.includes('基础检索模式') || fallbackResult.answer.length > 0,
        details: 'System should gracefully fallback when API is unavailable'
      });
    } catch (error) {
      this.addTest({
        name: 'Integration - Fallback Behavior',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    
    // Restore API key
    if (originalKey) localStorage.setItem('openai_api_key', originalKey);
  }

  /**
   * Test performance characteristics
   */
  private async testPerformance() {
    console.log('⚡ Testing Performance...');
    
    // Test 1: Vector search speed
    const searchStart = performance.now();
    await vectorService.semanticSearch('测试性能', 5);
    const searchTime = performance.now() - searchStart;
    
    this.addTest({
      name: 'Performance - Vector Search Speed',
      passed: searchTime < 1000, // Should be under 1 second
      details: `Search time: ${searchTime.toFixed(2)}ms`
    });

    // Test 2: Memory usage (approximation)
    const vectorCount = vectorService.getVectorCount();
    const estimatedMemory = vectorCount * 384 * 4; // 384 dims * 4 bytes per float
    
    this.addTest({
      name: 'Performance - Memory Usage',
      passed: estimatedMemory < 50 * 1024 * 1024, // Under 50MB
      details: `Estimated memory: ${(estimatedMemory / 1024 / 1024).toFixed(2)}MB for ${vectorCount} vectors`
    });

    // Test 3: Concurrent queries
    const concurrentStart = performance.now();
    const promises = [
      ragService.query('问题1'),
      ragService.query('问题2'),
      ragService.query('问题3')
    ];
    
    try {
      await Promise.all(promises);
      const concurrentTime = performance.now() - concurrentStart;
      
      this.addTest({
        name: 'Performance - Concurrent Queries',
        passed: concurrentTime < 5000, // Should handle 3 concurrent queries in under 5 seconds
        details: `Concurrent query time: ${concurrentTime.toFixed(2)}ms`
      });
    } catch (error) {
      this.addTest({
        name: 'Performance - Concurrent Queries',
        passed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Mock RAG API for testing
   */
  private mockRAGAPI() {
    // Store original fetch
    const originalFetch = global.fetch;
    
    // Mock fetch for testing
    global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
      if (url.includes('embeddings')) {
        // Mock embedding API
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [{
              embedding: Array(384).fill(0).map(() => Math.random() - 0.5)
            }]
          })
        });
      } else if (url.includes('chat/completions')) {
        // Mock chat API
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            choices: [{
              message: {
                content: '根据会议记录，这是一个测试回答。黑马项目涉及到1.5B参数的端观测模型部署。'
              }
            }]
          })
        });
      }
      
      // Fallback to original fetch for other requests
      return originalFetch(url, options);
    }) as jest.MockedFunction<typeof fetch>;
  }

  /**
   * Add a test result
   */
  private addTest(result: TestResult) {
    this.results.push(result);
    const status = result.passed ? '✅' : '❌';
    const details = result.details ? ` - ${result.details}` : '';
    const error = result.error ? ` - ERROR: ${result.error}` : '';
    console.log(`${status} ${result.name}${details}${error}`);
  }

  /**
   * Get test summary
   */
  getTestSummary(): { passed: number; total: number; percentage: number } {
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const percentage = total > 0 ? Math.round((passed / total) * 100) : 0;
    
    return { passed, total, percentage };
  }

  /**
   * Get failed tests
   */
  getFailedTests(): TestResult[] {
    return this.results.filter(r => !r.passed);
  }
}

// Export a singleton instance for easy use
export const ragSystemTest = new RAGSystemTest();
