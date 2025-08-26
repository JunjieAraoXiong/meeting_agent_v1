/**
 * Vector Embedding Service for E-Meet RAG System
 * 
 * Provides text embedding capabilities for semantic search in meeting transcripts.
 * Supports both Chinese and English text with optimized chunking strategies.
 */

// Vector interface for type safety
export interface Vector {
  embedding: number[];
  metadata: {
    segmentId: string;
    meetingId: string;
    speaker: string;
    timestamp: number;
    text: string;
    chunkIndex?: number;
  };
}

export interface SimilarityResult {
  vector: Vector;
  similarity: number;
}

export class VectorService {
  private vectors: Vector[] = [];
  private apiKey: string = '';
  private apiUrl: string = 'https://api.openai.com/v1/embeddings';
  private model: string = 'text-embedding-ada-002';
  
  constructor(apiKey?: string) {
    if (apiKey) {
      this.apiKey = apiKey;
    } else {
      // Try to get from localStorage
      this.apiKey = localStorage.getItem('openai_api_key') || '';
    }
  }

  /**
   * Set API key for embedding service
   */
  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    localStorage.setItem('openai_api_key', apiKey);
  }

  /**
   * Get embedding for a text string
   */
  async getEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('API key not configured for embedding service');
    }

    // Clean and prepare text
    const cleanText = this.cleanText(text);
    
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: cleanText,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding API failed: ${response.status}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error) {
      console.error('Embedding generation failed:', error);
      
      // Fallback to local embedding (basic TF-IDF)
      return this.getFallbackEmbedding(cleanText);
    }
  }

  /**
   * Add vectors from meeting segments
   */
  async addMeetingSegments(
    meetingId: string, 
    segments: Array<{
      idx: number;
      t: number;
      speaker: string;
      text: string;
    }>
  ): Promise<void> {
    console.log(`Adding ${segments.length} segments from meeting ${meetingId}`);
    
    for (const segment of segments) {
      // Chunk long segments for better retrieval
      const chunks = this.chunkText(segment.text);
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.trim().length < 10) continue; // Skip very short chunks
        
        try {
          const embedding = await this.getEmbedding(chunk);
          
          const vector: Vector = {
            embedding,
            metadata: {
              segmentId: `${meetingId}_${segment.idx}`,
              meetingId,
              speaker: segment.speaker,
              timestamp: segment.t,
              text: chunk,
              chunkIndex: chunks.length > 1 ? i : undefined,
            },
          };
          
          this.vectors.push(vector);
          
          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Failed to embed segment ${segment.idx}:`, error);
        }
      }
    }
    
    console.log(`Total vectors: ${this.vectors.length}`);
  }

  /**
   * Search for similar vectors using semantic similarity
   */
  async semanticSearch(query: string, limit: number = 5): Promise<SimilarityResult[]> {
    if (this.vectors.length === 0) {
      return [];
    }

    try {
      const queryEmbedding = await this.getEmbedding(query);
      
      // Calculate cosine similarity with all vectors
      const similarities = this.vectors.map(vector => ({
        vector,
        similarity: this.cosineSimilarity(queryEmbedding, vector.embedding),
      }));

      // Sort by similarity and return top results
      return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .filter(result => result.similarity > 0.7); // Filter low similarity results
    } catch (error) {
      console.error('Semantic search failed:', error);
      return [];
    }
  }

  /**
   * Get vectors for a specific meeting
   */
  getMeetingVectors(meetingId: string): Vector[] {
    return this.vectors.filter(v => v.metadata.meetingId === meetingId);
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.vectors = [];
  }

  /**
   * Get vector count
   */
  getVectorCount(): number {
    return this.vectors.length;
  }

  /**
   * Export vectors for persistence
   */
  exportVectors(): Vector[] {
    return this.vectors;
  }

  /**
   * Import vectors from storage
   */
  importVectors(vectors: Vector[]): void {
    this.vectors = vectors;
  }

  // === Private Methods ===

  /**
   * Clean text for embedding
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s\u4e00-\u9fa5]/g, '') // Keep alphanumeric, spaces, and Chinese characters
      .trim()
      .substring(0, 8000); // Limit length for API
  }

  /**
   * Chunk text into smaller pieces for better retrieval
   */
  private chunkText(text: string, maxLength: number = 500): string[] {
    const sentences = text.split(/[。！？.!?]/).filter(s => s.trim());
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxLength && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? '。' : '') + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Fallback embedding using simple TF-IDF approach
   */
  private getFallbackEmbedding(text: string): number[] {
    // Simple word frequency based embedding (384 dimensions)
    const words = text.toLowerCase().match(/[\w\u4e00-\u9fa5]+/g) || [];
    const wordFreq = new Map<string, number>();
    
    words.forEach(word => {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    });

    // Create a simple hash-based embedding
    const embedding = new Array(384).fill(0);
    
    Array.from(wordFreq.entries()).forEach(([word, freq]) => {
      const hash = this.simpleHash(word);
      for (let i = 0; i < 5; i++) {
        const index = (hash + i) % 384;
        embedding[index] += freq * 0.1;
      }
    });

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return norm > 0 ? embedding.map(val => val / norm) : embedding;
  }

  /**
   * Simple hash function for words
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

// Create a singleton instance
export const vectorService = new VectorService();
