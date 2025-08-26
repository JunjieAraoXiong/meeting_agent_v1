/**
 * RAG-Powered Chat Component for Meeting Agent
 * 
 * Replaces the basic chat functionality with full RAG capabilities including:
 * - Semantic search across meetings
 * - LLM-powered responses with citations
 * - API key configuration
 * - Confidence indicators
 */

import React, { useState, useRef, useEffect } from 'react';
import { useRAG, type ChatMessage } from '../hooks/useRAG';

interface RAGChatProps {
  currentMeetingId?: string;
  onJumpToSegment?: (segmentIndex: number) => void;
  className?: string;
}

export function RAGChat({ currentMeetingId, onJumpToSegment, className = "" }: RAGChatProps) {
  const [input, setInput] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const {
    chatMessages,
    status,
    configureRAG,
    askQuestion,
    clearChat,
    jumpToSegment,
    getChatStats,
  } = useRAG();

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Load existing API key on mount
  useEffect(() => {
    const existingKey = localStorage.getItem('openai_api_key');
    if (existingKey) {
      setApiKey(existingKey);
    }
  }, []);

  const handleSendMessage = async () => {
    if (!input.trim() || status.isLoading) return;
    
    const question = input.trim();
    setInput("");
    
    await askQuestion(question);
  };

  const handleConfigureAPI = async () => {
    if (!apiKey.trim()) return;
    
    const result = await configureRAG(apiKey);
    if (result.success) {
      setShowConfig(false);
    }
  };

  const handleJumpToSegment = (segmentId: string) => {
    jumpToSegment(segmentId, onJumpToSegment);
  };

  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const stats = getChatStats();

  return (
    <div className={`bg-white rounded-2xl shadow-sm border p-3 flex flex-col h-[26rem] ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">🤖 RAG Chat</span>
          {status.isConfigured && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              ✓ API
            </span>
          )}
          {status.vectorCount > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
              {status.vectorCount} vectors
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {!status.isConfigured && (
            <button
              onClick={() => setShowConfig(true)}
              className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
            >
              ⚙️ 配置
            </button>
          )}
          <button
            onClick={clearChat}
            disabled={chatMessages.length === 0}
            className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* API Configuration Modal */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md m-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">🔧 配置 RAG 系统</h3>
              <button
                onClick={() => setShowConfig(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">OpenAI API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
                <div className="text-xs text-gray-500 mt-1">
                  用于向量嵌入和智能回答生成。密钥将安全存储在本地。
                </div>
              </div>
              
              {status.lastError && (
                <div className="text-sm text-red-600 bg-red-50 rounded p-2">
                  错误：{status.lastError}
                </div>
              )}
              
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowConfig(false)}
                  className="px-4 py-2 text-gray-600 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleConfigureAPI}
                  disabled={!apiKey.trim() || status.isLoading}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
                >
                  {status.isLoading ? '测试中...' : '保存配置'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto space-y-3 pr-1">
        {chatMessages.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-sm text-gray-500 mb-2">
              {status.isConfigured 
                ? "RAG 系统已就绪，开始智能对话！" 
                : "配置 API Key 开启智能对话"
              }
            </div>
            <div className="text-xs text-gray-400">
              示例："会议讨论了什么项目？"、"有哪些技术难点？"
            </div>
          </div>
        ) : (
          <>
            {chatMessages.map((message) => (
              <div
                key={message.id}
                className={`rounded-xl p-3 ${
                  message.role === 'user' 
                    ? 'bg-blue-50 border border-blue-200' 
                    : 'bg-gray-50 border border-gray-200'
                }`}
              >
                {/* Message Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">
                      {message.role === 'user' ? '👤 您' : '🤖 助手'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatTimestamp(message.timestamp)}
                    </span>
                  </div>
                  
                  {message.role === 'assistant' && message.confidence !== undefined && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">置信度:</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          message.confidence > 0.8
                            ? 'bg-green-100 text-green-700'
                            : message.confidence > 0.6
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {Math.round(message.confidence * 100)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Message Content */}
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {message.content}
                </div>

                {/* Sources */}
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-gray-200">
                    <div className="text-xs text-gray-500 mb-1">
                      引用来源 ({message.sources.length}):
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {message.sources.map((source, index) => (
                        <button
                          key={`${source.segmentId}_${index}`}
                          onClick={() => handleJumpToSegment(source.segmentId)}
                          className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors border border-blue-200"
                          title={`${source.speaker}: ${source.text.substring(0, 100)}...`}
                        >
                          {formatTime(source.timestamp)} {source.speaker}
                          <span className="ml-1 opacity-60">
                            ({Math.round(source.similarity * 100)}%)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </>
        )}
      </div>

      {/* Status Indicators */}
      {(status.isLoading || status.processingMeeting) && (
        <div className="text-xs text-blue-600 px-2 py-1 bg-blue-50 rounded mb-2">
          {status.processingMeeting
            ? `🔄 正在处理会议 ${status.processingMeeting}...`
            : '🤔 正在思考...'
          }
        </div>
      )}

      {status.lastError && (
        <div className="text-xs text-red-600 px-2 py-1 bg-red-50 rounded mb-2">
          ⚠️ {status.lastError}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          placeholder={
            status.isConfigured
              ? "询问会议内容..."
              : "先配置 API Key 开启智能对话"
          }
          disabled={status.isLoading || !status.isConfigured}
          className="flex-1 border rounded-xl px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
        />
        <button
          onClick={handleSendMessage}
          disabled={!input.trim() || status.isLoading || !status.isConfigured}
          className="px-3 py-2 text-sm bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status.isLoading ? '⏳' : '发送'}
        </button>
      </div>

      {/* Chat Stats */}
      {stats.totalMessages > 0 && (
        <div className="text-xs text-gray-500 mt-1 text-center">
          {stats.userMessages} 问题 • {stats.assistantMessages} 回答
          {stats.avgConfidence > 0 && ` • 平均置信度 ${Math.round(stats.avgConfidence * 100)}%`}
        </div>
      )}
    </div>
  );
}
