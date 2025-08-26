/**
 * RAG (Retrieval-Augmented Generation) Service for E-Meet
 * 
 * Orchestrates the complete RAG pipeline:
 * 1. Semantic retrieval using vector search
 * 2. Context preparation and prompt engineering
 * 3. LLM generation with retrieved context
 */

import { vectorService, type SimilarityResult } from './VectorService';

export interface RAGConfig {
  maxContextLength: number;
  temperature: number;
  maxTokens: number;
  retrievalLimit: number;
  similarityThreshold: number;
}

export interface RAGResult {
  answer: string;
  sources: Array<{
    segmentId: string;
    meetingId: string;
    speaker: string;
    timestamp: number;
    text: string;
    similarity: number;
  }>;
  usedContext: string;
  confidence: number;
}

export class RAGService {
  private apiKey: string = '';
  private apiUrl: string = 'https://api.openai.com/v1/chat/completions';
  private model: string = 'gpt-4o-mini';
  
  private config: RAGConfig = {
    maxContextLength: 4000,
    temperature: 0.7,
    maxTokens: 800,
    retrievalLimit: 6,
    similarityThreshold: 0.75,
  };

  constructor(apiKey?: string) {
    if (apiKey) {
      this.apiKey = apiKey;
    } else {
      // Try to get from localStorage
      this.apiKey = localStorage.getItem('openai_api_key') || '';
    }
  }

  /**
   * Set API key for LLM service
   */
  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    localStorage.setItem('openai_api_key', apiKey);
    // Also set for vector service if it's the same provider
    vectorService.setApiKey(apiKey);
  }

  /**
   * Update RAG configuration
   */
  updateConfig(config: Partial<RAGConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Main RAG query method
   */
  async query(question: string, currentMeetingId?: string): Promise<RAGResult> {
    console.log('RAG Query:', question);
    
    // Step 1: Retrieve relevant context using semantic search
    const retrievalResults = await this.retrieveContext(question, currentMeetingId);
    
    if (retrievalResults.length === 0) {
      return {
        answer: '抱歉，我没有找到相关的会议内容来回答您的问题。请尝试使用不同的关键词或确保已加载相关的会议记录。',
        sources: [],
        usedContext: '',
        confidence: 0,
      };
    }

    // Step 2: Prepare context for LLM
    const contextData = this.prepareContext(retrievalResults);
    
    // Step 3: Generate answer using LLM
    const answer = await this.generateAnswer(question, contextData.context, currentMeetingId);
    
    // Step 4: Calculate confidence score
    const confidence = this.calculateConfidence(retrievalResults, answer);

    return {
      answer,
      sources: retrievalResults.map(result => ({
        segmentId: result.vector.metadata.segmentId,
        meetingId: result.vector.metadata.meetingId,
        speaker: result.vector.metadata.speaker,
        timestamp: result.vector.metadata.timestamp,
        text: result.vector.metadata.text,
        similarity: result.similarity,
      })),
      usedContext: contextData.context,
      confidence,
    };
  }

  /**
   * Retrieve relevant context using semantic search
   */
  private async retrieveContext(
    question: string, 
    currentMeetingId?: string
  ): Promise<SimilarityResult[]> {
    // Perform semantic search
    let results = await vectorService.semanticSearch(question, this.config.retrievalLimit);
    
    // Filter by similarity threshold
    results = results.filter(r => r.similarity >= this.config.similarityThreshold);
    
    // If we have a current meeting, boost results from that meeting
    if (currentMeetingId) {
      results = this.boostCurrentMeeting(results, currentMeetingId);
    }

    // Deduplicate by segment ID (keep highest similarity)
    const deduped = this.deduplicateResults(results);
    
    console.log(`Retrieved ${deduped.length} relevant segments`);
    return deduped;
  }

  /**
   * Boost results from current meeting
   */
  private boostCurrentMeeting(
    results: SimilarityResult[], 
    currentMeetingId: string
  ): SimilarityResult[] {
    return results.map(result => ({
      ...result,
      similarity: result.vector.metadata.meetingId === currentMeetingId 
        ? result.similarity * 1.2 // 20% boost for current meeting
        : result.similarity,
    })).sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Remove duplicate segments, keeping highest similarity
   */
  private deduplicateResults(results: SimilarityResult[]): SimilarityResult[] {
    const segmentMap = new Map<string, SimilarityResult>();
    
    results.forEach(result => {
      const segmentId = result.vector.metadata.segmentId;
      const existing = segmentMap.get(segmentId);
      
      if (!existing || result.similarity > existing.similarity) {
        segmentMap.set(segmentId, result);
      }
    });

    return Array.from(segmentMap.values())
      .sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Prepare context for LLM
   */
  private prepareContext(results: SimilarityResult[]): { context: string; truncated: boolean } {
    let context = '';
    let truncated = false;
    
    for (const result of results) {
      const { metadata } = result.vector;
      const timestamp = this.formatTime(metadata.timestamp);
      const segmentText = `[${timestamp}] ${metadata.speaker}: ${metadata.text}`;
      
      // Check if adding this segment would exceed max length
      if ((context + segmentText).length > this.config.maxContextLength) {
        truncated = true;
        break;
      }
      
      context += (context ? '\n\n' : '') + segmentText;
    }

    return { context, truncated };
  }

  /**
   * Generate answer using LLM
   */
  private async generateAnswer(
    question: string, 
    context: string, 
    currentMeetingId?: string
  ): Promise<string> {
    if (!this.apiKey) {
      return this.generateFallbackAnswer(question, context);
    }

    const systemPrompt = this.createSystemPrompt(currentMeetingId);
    const userPrompt = this.createUserPrompt(question, context);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API failed: ${response.status}`);
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('LLM generation failed:', error);
      return this.generateFallbackAnswer(question, context);
    }
  }

  /**
   * Create system prompt for LLM
   */
  private createSystemPrompt(currentMeetingId?: string): string {
    return `你是一个智能会议助手，专门分析和回答关于会议内容的问题。

职责：
- 基于提供的会议记录内容，准确回答用户的问题
- 总是引用具体的发言人和时间点来支持你的回答
- 如果信息不足，诚实说明并建议用户提供更多上下文
- 保持回答简洁但详细，重点突出关键信息

回答原则：
1. 准确性：只基于提供的会议内容回答，不要编造信息
2. 引用性：总是包含发言人和时间信息
3. 结构性：使用清晰的格式组织答案
4. 中文回答：使用专业但易懂的中文${currentMeetingId ? `\n5. 当前会议：重点关注当前会议 ${currentMeetingId} 的内容` : ''}

如果问题涉及多个会议，请明确标明哪些信息来自哪次会议。`;
  }

  /**
   * Create user prompt with context
   */
  private createUserPrompt(question: string, context: string): string {
    return `基于以下会议记录内容，请回答我的问题：

会议记录：
${context}

用户问题：${question}

请提供详细回答，并明确引用相关的发言人和时间点。`;
  }

  /**
   * Generate fallback answer without LLM
   */
  private generateFallbackAnswer(question: string, context: string): string {
    const contextLines = context.split('\n\n');
    
    return `根据会议记录，我找到了以下相关信息：

${contextLines.slice(0, 3).map((line, index) => `${index + 1}. ${line}`).join('\n\n')}

${contextLines.length > 3 ? `\n（还有 ${contextLines.length - 3} 条相关记录）` : ''}

注意：当前使用基础检索模式。配置 OpenAI API Key 可获得更智能的回答。`;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(results: SimilarityResult[], answer: string): number {
    if (results.length === 0) return 0;

    // Base confidence on average similarity
    const avgSimilarity = results.reduce((sum, r) => sum + r.similarity, 0) / results.length;
    
    // Boost if we have multiple relevant sources
    const sourceBoost = Math.min(results.length / 3, 1);
    
    // Reduce if answer seems uncertain (contains uncertainty phrases)
    const uncertaintyPenalty = this.containsUncertainty(answer) ? 0.8 : 1;
    
    return Math.min(avgSimilarity * sourceBoost * uncertaintyPenalty, 1);
  }

  /**
   * Check if answer contains uncertainty phrases
   */
  private containsUncertainty(answer: string): boolean {
    const uncertaintyPhrases = [
      '可能', '大概', '似乎', '不确定', '没有找到', '信息不足', '建议', '或许'
    ];
    
    return uncertaintyPhrases.some(phrase => answer.includes(phrase));
  }

  /**
   * Format timestamp for display
   */
  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    if (!this.apiKey) {
      return { success: false, error: 'No API key configured' };
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: '测试连接' }],
          max_tokens: 10,
        }),
      });

      if (response.ok) {
        return { success: true };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}

// Create a singleton instance
export const ragService = new RAGService();
