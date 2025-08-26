/**
 * React Hook for RAG Integration
 * 
 * Manages RAG state and operations for the meeting agent components.
 * Provides easy integration with existing chat interfaces.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { ragService, type RAGResult } from '../services/RAGService';
import { vectorService } from '../services/VectorService';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  sources?: Array<{
    segmentId: string;
    meetingId: string;
    speaker: string;
    timestamp: number;
    text: string;
    similarity: number;
  }>;
  confidence?: number;
}

export interface RAGStatus {
  isLoading: boolean;
  vectorCount: number;
  isConfigured: boolean;
  lastError?: string;
  processingMeeting?: string;
}

export function useRAG() {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<RAGStatus>({
    isLoading: false,
    vectorCount: 0,
    isConfigured: false,
  });
  
  const currentMeetingId = useRef<string | null>(null);
  const messageIdCounter = useRef(0);

  // Check if RAG is configured on mount
  useEffect(() => {
    const apiKey = localStorage.getItem('openai_api_key');
    setStatus(prev => ({
      ...prev,
      isConfigured: !!apiKey,
      vectorCount: vectorService.getVectorCount(),
    }));
  }, []);

  /**
   * Configure RAG with API key
   */
  const configureRAG = useCallback(async (apiKey: string) => {
    try {
      setStatus(prev => ({ ...prev, isLoading: true, lastError: undefined }));
      
      ragService.setApiKey(apiKey);
      
      // Test the connection
      const testResult = await ragService.testConnection();
      
      if (testResult.success) {
        setStatus(prev => ({
          ...prev,
          isConfigured: true,
          isLoading: false,
        }));
        return { success: true };
      } else {
        setStatus(prev => ({
          ...prev,
          isConfigured: false,
          isLoading: false,
          lastError: testResult.error,
        }));
        return { success: false, error: testResult.error };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setStatus(prev => ({
        ...prev,
        isConfigured: false,
        isLoading: false,
        lastError: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, []);

  /**
   * Index meeting segments for RAG
   */
  const indexMeeting = useCallback(async (
    meetingId: string,
    segments: Array<{
      idx: number;
      t: number;
      speaker: string;
      text: string;
    }>
  ) => {
    try {
      setStatus(prev => ({ 
        ...prev, 
        isLoading: true, 
        processingMeeting: meetingId,
        lastError: undefined,
      }));

      await vectorService.addMeetingSegments(meetingId, segments);
      
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        processingMeeting: undefined,
        vectorCount: vectorService.getVectorCount(),
      }));

      console.log(`Indexed meeting ${meetingId} with ${segments.length} segments`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to index meeting';
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        processingMeeting: undefined,
        lastError: errorMessage,
      }));
      return { success: false, error: errorMessage };
    }
  }, []);

  /**
   * Set current meeting for context boosting
   */
  const setCurrentMeeting = useCallback((meetingId: string | null) => {
    currentMeetingId.current = meetingId;
  }, []);

  /**
   * Ask a question using RAG
   */
  const askQuestion = useCallback(async (question: string) => {
    if (!question.trim()) return;

    const questionId = `msg_${++messageIdCounter.current}`;
    const answerId = `msg_${++messageIdCounter.current}`;

    // Add user message
    const userMessage: ChatMessage = {
      id: questionId,
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    setChatMessages(prev => [...prev, userMessage]);

    try {
      setStatus(prev => ({ ...prev, isLoading: true, lastError: undefined }));

      // Get RAG response
      const ragResult = await ragService.query(question, currentMeetingId.current || undefined);

      // Add assistant response
      const assistantMessage: ChatMessage = {
        id: answerId,
        role: 'assistant',
        content: ragResult.answer,
        timestamp: new Date(),
        sources: ragResult.sources,
        confidence: ragResult.confidence,
      };

      setChatMessages(prev => [...prev, assistantMessage]);
      
      setStatus(prev => ({ ...prev, isLoading: false }));

      return ragResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
      
      // Add error message
      const errorResponse: ChatMessage = {
        id: answerId,
        role: 'assistant',
        content: `抱歉，处理您的问题时遇到了错误：${errorMessage}`,
        timestamp: new Date(),
        confidence: 0,
      };

      setChatMessages(prev => [...prev, errorResponse]);
      
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        lastError: errorMessage,
      }));

      return null;
    }
  }, []);

  /**
   * Clear chat history
   */
  const clearChat = useCallback(() => {
    setChatMessages([]);
  }, []);

  /**
   * Clear all vectors
   */
  const clearVectors = useCallback(() => {
    vectorService.clear();
    setStatus(prev => ({
      ...prev,
      vectorCount: 0,
    }));
  }, []);

  /**
   * Jump to a specific segment
   */
  const jumpToSegment = useCallback((segmentId: string, onJump?: (segmentIndex: number) => void) => {
    // Extract segment index from ID (format: meetingId_segmentIdx)
    const parts = segmentId.split('_');
    if (parts.length >= 2) {
      const segmentIndex = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(segmentIndex) && onJump) {
        onJump(segmentIndex);
      }
    }
  }, []);

  /**
   * Get chat statistics
   */
  const getChatStats = useCallback(() => {
    const totalMessages = chatMessages.length;
    const userMessages = chatMessages.filter(m => m.role === 'user').length;
    const assistantMessages = chatMessages.filter(m => m.role === 'assistant').length;
    const avgConfidence = assistantMessages > 0
      ? chatMessages
          .filter(m => m.role === 'assistant' && m.confidence !== undefined)
          .reduce((sum, m) => sum + (m.confidence || 0), 0) / assistantMessages
      : 0;

    return {
      totalMessages,
      userMessages,
      assistantMessages,
      avgConfidence,
    };
  }, [chatMessages]);

  /**
   * Export chat for persistence
   */
  const exportChat = useCallback(() => {
    return {
      messages: chatMessages,
      timestamp: new Date().toISOString(),
      vectorCount: status.vectorCount,
    };
  }, [chatMessages, status.vectorCount]);

  /**
   * Import chat from storage
   */
  const importChat = useCallback((chatData: { messages: ChatMessage[] }) => {
    setChatMessages(chatData.messages);
  }, []);

  return {
    // State
    chatMessages,
    status,
    
    // Actions
    configureRAG,
    indexMeeting,
    setCurrentMeeting,
    askQuestion,
    clearChat,
    clearVectors,
    jumpToSegment,
    
    // Utilities
    getChatStats,
    exportChat,
    importChat,
  };
}
