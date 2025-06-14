import React, { useEffect, useState, useRef } from 'react';
import { v4 } from 'uuid';
import { SSE } from 'sse.js';
import { useSetRecoilState } from 'recoil';
import {
  request,
  Constants,
  /* @ts-ignore */
  createPayload,
  isAgentsEndpoint,
  LocalStorageKeys,
  removeNullishValues,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TMessage, TPayload, TSubmission, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import type { TResData } from '~/common';
import { useGenTitleMutation, useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import store from '~/store';

// Enhanced tracking system with single/comparison mode support
interface TrackedRequest {
  id: string;
  questionNumber: number;
  question: string;
  model: string;
  isComparison: boolean;
  panel: 'LEFT' | 'RIGHT' | 'SINGLE';
  conversationId: string;
  startTime: number;
  messageId?: string;
  status: 'pending' | 'success' | 'failed';
  responseLength?: number;
  error?: string;
  duration?: number;
  mode: 'single' | 'comparison';
  relatedRequestId?: string;
}

const REQUEST_TRACKER = {
  activeRequests: new Map<string, TrackedRequest>(),
  completedRequests: new Map<string, TrackedRequest>(),
  questionCounter: new Map<string, number>(),
  comparisonPairs: new Map<string, string[]>(),
  
  startRequest(submission: any, isAddedRequest: boolean, runIndex: number, comparisonMode: boolean = false): string {
    const conversationId = submission.conversation?.conversationId || 'unknown';
    const isComparison = isAddedRequest && comparisonMode;
    
    const requestId = `${isComparison ? 'COMP' : (comparisonMode ? 'MAIN' : 'SINGLE')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    let panel: 'LEFT' | 'RIGHT' | 'SINGLE';
    if (!comparisonMode) {
      panel = 'SINGLE';
    } else {
      panel = isComparison ? 'RIGHT' : 'LEFT';
    }
    
    let questionNumber: number;
    if (!isAddedRequest || !comparisonMode) {
      const currentCount = this.questionCounter.get(conversationId) || 0;
      questionNumber = currentCount + 1;
      this.questionCounter.set(conversationId, questionNumber);
    } else {
      const lastMainRequest = Array.from(this.activeRequests.values())
        .concat(Array.from(this.completedRequests.values()))
        .filter(r => r.conversationId === conversationId && r.panel === 'LEFT')
        .sort((a, b) => b.startTime - a.startTime)[0];
      questionNumber = lastMainRequest?.questionNumber || 1;
    }
    
    const request: TrackedRequest = {
      id: requestId,
      questionNumber,
      question: submission.userMessage?.text || 'unknown',
      model: submission.conversation?.model || 'unknown',
      isComparison,
      panel,
      conversationId,
      startTime: Date.now(),
      messageId: submission.initialResponse?.messageId,
      status: 'pending',
      mode: comparisonMode ? 'comparison' : 'single'
    };
    
    this.activeRequests.set(requestId, request);
    
    if (comparisonMode) {
      const pairKey = `${conversationId}-Q${questionNumber}`;
      if (!this.comparisonPairs.has(pairKey)) {
        this.comparisonPairs.set(pairKey, []);
      }
      this.comparisonPairs.get(pairKey)!.push(requestId);
      
      const relatedRequests = this.comparisonPairs.get(pairKey)!;
      if (relatedRequests.length > 1) {
        request.relatedRequestId = relatedRequests[0];
        const firstRequest = this.activeRequests.get(relatedRequests[0]) || 
                           this.completedRequests.get(relatedRequests[0]);
        if (firstRequest) {
          firstRequest.relatedRequestId = requestId;
        }
      }
    }
    
    console.log(`🚀 [REQUEST START] #${questionNumber} - ${panel} ${comparisonMode ? 'Mode' : 'Panel'}`, {
      requestId,
      model: request.model,
      question: request.question,
      mode: request.mode,
      panel: request.panel,
      isComparison: request.isComparison,
      activeRequests: this.activeRequests.size,
      relatedRequestId: request.relatedRequestId
    });
    
    this.showCurrentState();
    
    return requestId;
  },
  
  updateRequest(requestId: string, updates: Partial<TrackedRequest>) {
    const request = this.activeRequests.get(requestId) || this.completedRequests.get(requestId);
    if (!request) {
      console.warn(`⚠️ [REQUEST TRACKER] Unknown request ID: ${requestId}`);
      return;
    }
    
    Object.assign(request, updates);
    
    console.log(`📝 [REQUEST UPDATE] #${request.questionNumber} - ${request.panel} ${request.mode === 'single' ? 'Mode' : 'Panel'}`, {
      requestId,
      updates,
      currentStatus: request.status,
      mode: request.mode
    });
  },
  
  completeRequest(requestId: string, success: boolean, responseLength: number = 0, error?: string) {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      console.warn(`⚠️ [REQUEST TRACKER] Cannot complete unknown request: ${requestId}`);
      return;
    }
    
    request.status = success ? 'success' : 'failed';
    request.responseLength = responseLength;
    request.error = error;
    request.duration = Date.now() - request.startTime;
    
    this.activeRequests.delete(requestId);
    this.completedRequests.set(requestId, request);
    
    const emoji = success ? '✅' : '❌';
    const modeText = request.mode === 'single' ? 'SINGLE MODE' : `${request.panel} Panel`;
    
    console.log(`${emoji} [REQUEST COMPLETE] #${request.questionNumber} - ${modeText}`, {
      requestId,
      model: request.model,
      question: request.question.substring(0, 50),
      success,
      responseLength,
      duration: `${request.duration}ms`,
      error,
      mode: request.mode,
      relatedRequestId: request.relatedRequestId
    });
    
    if (request.mode === 'comparison' && request.relatedRequestId) {
      const relatedRequest = this.completedRequests.get(request.relatedRequestId);
      if (relatedRequest) {
        this.logComparisonComplete(request, relatedRequest);
      }
    }
    
    this.showCurrentState();
    this.showSummary();
  },
  
  logComparisonComplete(req1: TrackedRequest, req2: TrackedRequest) {
    const leftReq = req1.panel === 'LEFT' ? req1 : req2;
    const rightReq = req1.panel === 'RIGHT' ? req1 : req2;
    
    console.log(`🔄 [COMPARISON COMPLETE] Question #${leftReq.questionNumber}`, {
      question: leftReq.question.substring(0, 50),
      LEFT: {
        model: leftReq.model,
        success: leftReq.status === 'success',
        responseLength: leftReq.responseLength,
        duration: leftReq.duration
      },
      RIGHT: {
        model: rightReq.model,
        success: rightReq.status === 'success',
        responseLength: rightReq.responseLength,
        duration: rightReq.duration
      }
    });
  },
  
  findRequestByMessageId(messageId: string): TrackedRequest | undefined {
    for (const [id, request] of this.activeRequests) {
      if (request.messageId === messageId) {
        return request;
      }
    }
    for (const [id, request] of this.completedRequests) {
      if (request.messageId === messageId) {
        return request;
      }
    }
    return undefined;
  },
  
  showCurrentState() {
    const active = Array.from(this.activeRequests.values());
    const singleMode = active.filter(r => r.mode === 'single');
    const comparisonMode = active.filter(r => r.mode === 'comparison');
    
    console.log('📊 [CURRENT STATE]', {
      totalActive: this.activeRequests.size,
      singleMode: singleMode.map(r => ({
        model: r.model,
        question: r.question.substring(0, 30),
        status: r.status
      })),
      comparisonMode: {
        left: comparisonMode.filter(r => r.panel === 'LEFT').map(r => ({
          model: r.model,
          question: r.question.substring(0, 30),
          status: r.status
        })),
        right: comparisonMode.filter(r => r.panel === 'RIGHT').map(r => ({
          model: r.model,
          question: r.question.substring(0, 30),
          status: r.status
        }))
      }
    });
  },
  
  showSummary() {
    const completed = Array.from(this.completedRequests.values());
    const singleRequests = completed.filter(r => r.mode === 'single');
    const comparisonRequests = completed.filter(r => r.mode === 'comparison');
    
    console.log('📈 [SESSION SUMMARY]', {
      totalQuestions: this.questionCounter.size > 0 ? 
        Math.max(...Array.from(this.questionCounter.values())) : 0,
      singleMode: {
        total: singleRequests.length,
        successful: singleRequests.filter(r => r.status === 'success').length,
        failed: singleRequests.filter(r => r.status === 'failed').length,
        models: [...new Set(singleRequests.map(r => r.model))]
      },
      comparisonMode: {
        totalPairs: this.comparisonPairs.size,
        LEFT: {
          total: comparisonRequests.filter(r => r.panel === 'LEFT').length,
          successful: comparisonRequests.filter(r => r.panel === 'LEFT' && r.status === 'success').length,
          failed: comparisonRequests.filter(r => r.panel === 'LEFT' && r.status === 'failed').length,
          models: [...new Set(comparisonRequests.filter(r => r.panel === 'LEFT').map(r => r.model))]
        },
        RIGHT: {
          total: comparisonRequests.filter(r => r.panel === 'RIGHT').length,
          successful: comparisonRequests.filter(r => r.panel === 'RIGHT' && r.status === 'success').length,
          failed: comparisonRequests.filter(r => r.panel === 'RIGHT' && r.status === 'failed').length,
          models: [...new Set(comparisonRequests.filter(r => r.panel === 'RIGHT').map(r => r.model))]
        }
      }
    });
    
    console.log('📜 [DETAILED HISTORY]');
    
    const byQuestion = new Map<number, TrackedRequest[]>();
    completed.forEach(req => {
      if (!byQuestion.has(req.questionNumber)) {
        byQuestion.set(req.questionNumber, []);
      }
      byQuestion.get(req.questionNumber)!.push(req);
    });
    
    Array.from(byQuestion.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([qNum, requests]) => {
        console.log(`\n  Question #${qNum}:`);
        requests.sort((a, b) => a.startTime - b.startTime).forEach(req => {
          const status = req.status === 'success' ? '✅' : '❌';
          const modeText = req.mode === 'single' ? 'SINGLE' : req.panel;
          console.log(`    ${status} [${modeText}] ${req.model}: "${req.question.substring(0, 30)}..." → ${req.responseLength || 0} chars (${req.duration}ms)`);
        });
      });
  },
  
  isInComparisonMode(): boolean {
    const activeRequests = Array.from(this.activeRequests.values());
    return activeRequests.some(r => r.mode === 'comparison');
  },
  
  getRelatedRequest(requestId: string): TrackedRequest | undefined {
    const request = this.activeRequests.get(requestId) || this.completedRequests.get(requestId);
    if (!request || !request.relatedRequestId) return undefined;
    
    return this.activeRequests.get(request.relatedRequestId) || 
           this.completedRequests.get(request.relatedRequestId);
  },
  
  clear() {
    this.activeRequests.clear();
    this.completedRequests.clear();
    this.questionCounter.clear();
    this.comparisonPairs.clear();
    console.log('🧹 [REQUEST TRACKER] All tracking data cleared');
  }
};

// Make it globally accessible for debugging
if (typeof window !== 'undefined') {
  (window as any).REQUEST_TRACKER = REQUEST_TRACKER;
}

// Create SSE debugger for deep inspection
const createSSEDebugger = (model: string, isComparison: boolean) => {
  const eventLog: any[] = [];
  
  return {
    logRawEvent: (eventType: string, data: any) => {
      const entry = {
        timestamp: new Date().toISOString(),
        model,
        isComparison,
        eventType,
        data,
        dataString: typeof data === 'string' ? data : JSON.stringify(data),
      };
      
      eventLog.push(entry);
      
      if (model === 'DeFacts' || model?.toLowerCase().includes('defacts')) {
        console.log(`🔴 [DEFACTS RAW ${eventType}]:`, data);
        
        if (data && typeof data === 'object') {
          console.log('🔴 [DEFACTS STRUCTURE]:', {
            keys: Object.keys(data),
            hasText: 'text' in data,
            hasContent: 'content' in data,
            hasResponse: 'response' in data,
            hasDelta: 'delta' in data,
            hasMessage: 'message' in data,
            hasResponseMessage: 'responseMessage' in data,
            dataPreview: JSON.stringify(data).substring(0, 200),
          });
          
          if (data.delta) {
            console.log('🔴 [DEFACTS DELTA STRUCTURE]:', {
              deltaKeys: Object.keys(data.delta),
              deltaContent: data.delta.content,
              deltaContentType: typeof data.delta.content,
            });
          }
          
          if (data.responseMessage) {
            console.log('🔴 [DEFACTS RESPONSE MESSAGE]:', {
              hasText: !!data.responseMessage.text,
              textLength: data.responseMessage.text?.length || 0,
              hasContent: !!data.responseMessage.content,
              contentLength: data.responseMessage.content?.length || 0,
            });
          }
        }
      }
    },
    
    exportLog: () => {
      console.log('📋 FULL DEFACTS EVENT LOG:', JSON.stringify(eventLog, null, 2));
      return eventLog;
    }
  };
};

// Get panel name for logging
const getPanelName = (isAddedRequest: boolean, runIndex: number): string => {
  if (!isAddedRequest && runIndex === 0) return 'DEFACTS';
  if (isAddedRequest && runIndex === 1) return 'COMPARISON';
  return `PANEL_${runIndex}`;
};

// Enhanced debug utility for delta messages
const debugDelta = (context: string, data: any, metadata?: any) => {
  const panelName = metadata?.isAddedRequest !== undefined ? 
    getPanelName(metadata.isAddedRequest, metadata.runIndex || 0) : 'UNKNOWN';
  
  console.group(`🔄 [${panelName}] DELTA DEBUG [${context}]`);
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📊 Data:', data);
  if (metadata) {
    console.log('🔍 Metadata:', metadata);
  }
  
  if (data?.delta) {
    console.log('📝 Delta content detected:', {
      hasContent: !!data.delta.content,
      contentType: typeof data.delta.content,
      contentLength: typeof data.delta.content === 'string' ? data.delta.content.length : 0,
      contentPreview: typeof data.delta.content === 'string' ? data.delta.content.substring(0, 100) + '...' : `Type: ${typeof data.delta.content}`,
      deltaKeys: Object.keys(data.delta)
    });
  }
  
  if (data?.text || data?.content) {
    console.log('📝 Message content:', {
      textType: typeof data.text,
      contentType: typeof data.content,
      textLength: typeof data.text === 'string' ? data.text.length : 0,
      contentLength: typeof data.content === 'string' ? data.content.length : 0,
      preview: typeof data.text === 'string' ? data.text.substring(0, 100) + '...' : 
               typeof data.content === 'string' ? data.content.substring(0, 100) + '...' : 
               `Text: ${typeof data.text}, Content: ${typeof data.content}`
    });
  }
  
  console.groupEnd();
};

// Safe content extraction utility
const safeGetContent = (obj: any, field: string = 'content'): string => {
  const value = obj?.[field];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (value && typeof value === 'object' && value.toString) return value.toString();
  return '';
};

// Enhanced text extraction that handles more formats
const extractDeltaText = (data: any): string => {
  if (data?.delta?.text) {
    return data.delta.text;
  }
  
  if (data?.delta?.content) {
    if (Array.isArray(data.delta.content)) {
      const textContent = data.delta.content.find((item: any) => item?.type === 'text');
      if (textContent?.text) {
        return textContent.text;
      }
    } else if (typeof data.delta.content === 'string') {
      return data.delta.content;
    }
  }
  
  if (data?.data?.delta?.content) {
    if (Array.isArray(data.data.delta.content)) {
      const textContent = data.data.delta.content.find((item: any) => item?.type === 'text');
      if (textContent?.text) {
        return textContent.text;
      }
    } else if (typeof data.data.delta.content === 'string') {
      return data.data.delta.content;
    }
  }
  
  if (data?.data?.delta?.text) {
    return data.data.delta.text;
  }
  
  if (data?.content && typeof data.content === 'string') {
    return data.content;
  }
  
  if (data?.message && typeof data.message === 'string') {
    return data.message;
  }
  
  return '';
};

// Check if data contains text (handles multiple formats)
const hasTextContent = (data: any): boolean => {
  return !!(
    data?.text || 
    data?.response || 
    data?.delta?.text || 
    extractDeltaText(data)
  );
};

// Safe preview utility
const safePreview = (content: any, length: number = 100): string => {
  if (typeof content === 'string') {
    return content.substring(0, length) + (content.length > length ? '...' : '');
  }
  if (typeof content === 'number') {
    return content.toString();
  }
  if (content === null) return 'null';
  if (content === undefined) return 'undefined';
  return `Type: ${typeof content}`;
};

// Side-by-side comparison debug
const debugComparison = (context: string, data: any) => {
  const panelName = data?.isAddedRequest !== undefined ? 
    getPanelName(data.isAddedRequest, data.runIndex || 0) : 'UNKNOWN';
  
  console.group(`🔗 [${panelName}] DEBUG [${context}]`);
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📊 Data:', data);
  
  if (data?.isAddedRequest !== undefined) {
    console.log('🎯 Panel:', panelName);
    console.log('📍 Is comparison request:', data.isAddedRequest);
  }
  
  if (data?.runIndex !== undefined) {
    console.log('🏃 Run index:', data.runIndex);
  }
  
  console.groupEnd();
};

// Retry Status Component - safe JSX-free version
const RetryStatusDisplay: React.FC<{
  isRetrying: boolean;
  retryCount: number;
  maxRetries: number;
}> = ({ isRetrying, retryCount, maxRetries }) => {
  if (!isRetrying || retryCount === 0) {
    return null;
  }

  return React.createElement(
    'div',
    {
      className: 'flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg mb-4 mx-4',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '12px',
        backgroundColor: '#fefce8',
        border: '1px solid #facc15',
        borderRadius: '8px',
        margin: '0 16px 16px 16px'
      }
    },
    React.createElement('div', {
      className: 'animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600',
      style: {
        animation: 'spin 1s linear infinite',
        borderRadius: '50%',
        width: '16px',
        height: '16px',
        border: '2px solid transparent',
        borderBottomColor: '#ca8a04'
      }
    }),
    React.createElement('span', {
      className: 'text-sm text-yellow-800',
      style: {
        fontSize: '14px',
        color: '#92400e'
      }
    }, `Connection interrupted. Retrying... (${retryCount}/${maxRetries})`)
  );
};

const clearDraft = (conversationId?: string | null): void => {
  if (conversationId) {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${conversationId}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${conversationId}`);
  } else {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${Constants.NEW_CONVO}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`);
  }
};

type ChatHelpers = Pick<    // <-- Add the missing "<"
  EventHandlerParams,
  'setMessages' |           // <-- Also remove leading "|"
  'getMessages' |
  'setConversation' |
  'setIsSubmitting' |
  'newConversation' |
  'setShowStopButton' |
  'resetLatestMessage'
>;

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffFactor: 2,
  retryableStatuses: [0, 408, 429, 500, 502, 503, 504],
  connectionTimeoutMs: 30000,
};

// Return type interface for better TypeScript support
interface UseSSEReturn {
  isRetrying: boolean;
  retryCount: number;
  maxRetries: number;
  RetryStatusComponent: () => React.ReactElement | null;
}

export default function useSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
  isComparisonMode = false,
): UseSSEReturn {
  
  // Auto-detect comparison mode if not explicitly passed
  const detectedComparisonMode = isComparisonMode || 
    (typeof document !== 'undefined' && document.querySelectorAll('[data-panel]').length > 1);
  
  // Track connection instances and cache state
  const connectionId = useRef<string>('');
  const previousCacheState = useRef<any>({});
  const currentRequestId = useRef<string>('');
  
  // Add panel-specific state management
  const isPanelActive = useRef(true);
  const panelId = useRef(`${isAddedRequest ? 'RIGHT' : 'LEFT'}-${Date.now()}`);
  
  // Track delta message accumulation for debugging - CONNECTION SCOPED
  const deltaAccumulator = useRef<{[connectionId: string]: string}>({});
  const messageStartTime = useRef<{[connectionId: string]: number}>({});
  const deltaCounter = useRef<{[connectionId: string]: number}>({});
  
  // Log cache state changes
  const logCacheState = (context: string) => {
    const currentCache = {
      timestamp: Date.now()
    };
    
    console.log(`[CACHE STATE - ${context}]`, {
      previous: previousCacheState.current,
      current: currentCache,
      changed: JSON.stringify(previousCacheState.current) !== JSON.stringify(currentCache)
    });
    
    previousCacheState.current = currentCache;
  };
  
  // Enhanced initialization logging
  debugComparison('useSSE INIT', {
    isAddedRequest,
    runIndex,
    isComparisonMode,
    detectedComparisonMode,
    hasSubmission: !!submission,
    submissionEndpoint: submission?.conversation?.endpoint,
    submissionModel: submission?.conversation?.model,
    previousConnectionId: connectionId.current,
    panelId: panelId.current
  });

  const genTitle = useGenTitleMutation();
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();
  const [completed, setCompleted] = useState(new Set());
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  // Add retry state
  const [retryCount, setRetryCount] = useState<number>(0);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const retryTimeoutRef = useRef<any>(null);
  const connectionTimeoutRef = useRef<any>(null);
  const currentSSERef = useRef<SSE | null>(null);

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;

  const {
    stepHandler,
    syncHandler,
    finalHandler,
    errorHandler,
    messageHandler,
    contentHandler,
    createdHandler,
    attachmentHandler,
    abortConversation,
  } = useEventHandlers({
    genTitle,
    setMessages,
    getMessages,
    setCompleted,
    isAddedRequest,
    setConversation,
    setIsSubmitting,
    newConversation,
    setShowStopButton,
    resetLatestMessage,
  });

  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });

  // Helper function to check if error is retryable
  const isRetryableError = (error: any): boolean => {
    const status = error?.responseCode || error?.status || error?.statusCode;
    return RETRY_CONFIG.retryableStatuses.includes(status) || status === undefined;
  };

  // Calculate retry delay with exponential backoff
  const getRetryDelay = (attempt: number): number => {
    const delay = RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffFactor, attempt);
    return Math.min(delay, RETRY_CONFIG.maxDelay);
  };

  // Clean up timeouts
  const clearTimeouts = (): void => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
  };

  // Handle retry logic
  const handleRetry = (
    errorReason: string, 
    currentAttempt: number,
    payloadData: any,
    payload: TPayload,
    userMessage: TMessage
  ): void => {
    // Check if panel is still active before retrying
    if (!isPanelActive.current) {
      console.log(`[useSSE] Panel ${panelId.current} is inactive, skipping retry`);
      return;
    }
    
    debugComparison('RETRY_HANDLER', {
      errorReason,
      currentAttempt,
      isAddedRequest,
      runIndex,
      endpoint: payload?.endpoint,
      model: payload?.model,
      panelId: panelId.current
    });
    
    if (currentAttempt >= RETRY_CONFIG.maxRetries) {
      console.error('❌ [useSSE] Max retries reached, giving up');
      setIsRetrying(false);
      setIsSubmitting(false);
      
      const errorData = {
        message: 'Connection failed after multiple attempts. Please try again.',
        type: 'connection_error',
      };
      
      try {
        errorHandler({ 
          data: errorData, 
          submission: { ...submission, userMessage } as EventSubmission 
        });
      } catch (error) {
        console.error('❌ [useSSE] Error in error handler:', error);
      }
      return;
    }

    setIsRetrying(true);
    setRetryCount(currentAttempt + 1);
    
    const delay = getRetryDelay(currentAttempt);
    console.log(`⏳ [useSSE] Retrying in ${delay}ms (attempt ${currentAttempt + 2})`);
    
    retryTimeoutRef.current = setTimeout(() => {
      if (!isPanelActive.current) {
        console.log(`[useSSE] Panel ${panelId.current} became inactive during retry delay`);
        return;
      }
      
      try {
        createSSEConnection(payloadData, payload, userMessage, currentAttempt + 1);
      } catch (error) {
        console.error('❌ [useSSE] Error creating retry connection:', error);
        setIsRetrying(false);
        setIsSubmitting(false);
      }
    }, delay);
  };

  // Enhanced SSE creation with retry logic
  const createSSEConnection = (
    payloadData: any,
    payload: TPayload,
    userMessage: TMessage,
    attempt: number = 0
  ): SSE => {
    // Before creating new SSE, check if panel is still active
    if (!isPanelActive.current) {
      console.log(`[useSSE] Panel ${panelId.current} is inactive, not creating connection`);
      throw new Error('Panel is inactive');
    }
    
    // Create unique connection ID for this specific request
    const newConnectionId = `${isAddedRequest ? 'COMP' : 'DEFACTS'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    connectionId.current = newConnectionId;
    
    console.log(`🔌 [CONNECTION] New connection created: ${newConnectionId}`, {
      panel: isAddedRequest ? 'RIGHT' : 'LEFT',
      model: payload?.model,
      conversationId: submission?.conversation?.conversationId,
      userMessage: userMessage?.text?.substring(0, 50) + '...'
    });
    
    debugComparison('SSE_CONNECTION_CREATE', {
      attempt: attempt + 1,
      maxRetries: RETRY_CONFIG.maxRetries + 1,
      isAddedRequest,
      runIndex,
      endpoint: payload?.endpoint,
      model: payload?.model,
      serverUrl: payloadData?.server,
      connectionId: newConnectionId,
      requestId: currentRequestId.current,
      panelId: panelId.current,
      isPanelActive: isPanelActive.current
    });
    
    clearTimeouts();
    
    let sse: SSE;
    
    try {
      sse = new SSE(payloadData.server, {
        payload: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.error('❌ [useSSE] Error creating SSE instance:', error);
      handleRetry('SSE creation failed', attempt, payloadData, payload, userMessage);
      throw error;
    }

    const sseDebugger = createSSEDebugger(
      payload?.model || submission?.conversation?.model || 'unknown',
      isAddedRequest
    );
    
    const allEventTypes: Set<string> = new Set();
    
    const originalAddEventListener = sse.addEventListener.bind(sse);
    sse.addEventListener = function(type: string, listener: any, options?: any) {
      if (!allEventTypes.has(type)) {
        allEventTypes.add(type);
        console.log('🔴 [DEFACTS EVENT TYPE REGISTERED]:', type);
      }
      return originalAddEventListener(type, listener, options);
    };
    
    setTimeout(() => {
      console.log('🔴 [DEFACTS ALL REGISTERED EVENT TYPES]:', Array.from(allEventTypes));
    }, 2000);

    currentSSERef.current = sse;
    let textIndex: number | null = null;
    let hasReceivedData = false;

    // Set connection timeout
    connectionTimeoutRef.current = setTimeout(() => {
      if (!isPanelActive.current) {
        console.log(`[useSSE] Panel ${panelId.current} inactive, skipping timeout`);
        return;
      }
      
      console.warn('⏰ [useSSE] Connection timeout reached');
      if (sse.readyState === 0 || sse.readyState === 1) {
        try {
          sse.close();
        } catch (error) {
          console.error('❌ [useSSE] Error closing timed out connection:', error);
        }
        handleRetry('Connection timeout', attempt, payloadData, payload, userMessage);
      }
    }, RETRY_CONFIG.connectionTimeoutMs);

    // Set up SSE event listeners
    sse.addEventListener('open', () => {
      debugComparison('SSE_CONNECTION_OPEN', {
        isAddedRequest,
        runIndex,
        readyState: sse.readyState,
        url: payloadData.server,
        panelId: panelId.current
      });
      
      clearTimeouts();
      setAbortScroll(false);
      setRetryCount(0);
      setIsRetrying(false);
      hasReceivedData = false;
    });

    sse.addEventListener('error', async (e: MessageEvent) => {
      // Check if this panel was cancelled
      if (!isPanelActive.current) {
        console.log(`[useSSE] Panel ${panelId.current} was cancelled, ignoring error`);
        return;
      }
      
      debugComparison('SSE_ERROR', {
        isAddedRequest,
        runIndex,
        hasReceivedData,
        attempt: attempt + 1,
        /* @ts-ignore */
        responseCode: e.responseCode,
        /* @ts-ignore */
        statusCode: e.statusCode,
        data: e.data,
        panelId: panelId.current
      });

      clearTimeouts();

      /* @ts-ignore */
      const errorStatus = e.responseCode || e.statusCode || e.status;
      
      /* @ts-ignore */
      if (e.responseCode === 401) {
        console.log('🔑 [useSSE] 401 error - attempting token refresh');
        try {
          const refreshResponse = await request.refreshToken();
          const newToken = refreshResponse?.token ?? '';
          if (!newToken) {
            throw new Error('Token refresh failed.');
          }
          
          sse.headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          };

          request.dispatchTokenUpdatedEvent(newToken);
          sse.stream();
          return;
        } catch (error) {
          console.error('❌ [useSSE] Token refresh failed:', error);
        }
      }

      if (!hasReceivedData && isRetryableError(e)) {
        console.log('🔄 [useSSE] Error is retryable, attempting retry');
        handleRetry(`Error ${errorStatus}`, attempt, payloadData, payload, userMessage);
        return;
      }

      console.error('❌ [useSSE] Non-retryable error or max retries reached');
      setIsRetrying(false);
      (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();

      let data: TResData | undefined = undefined;
      try {
        data = JSON.parse(e.data) as TResData;
        console.error('🔍 [useSSE] Parsed error data:', data);
      } catch (error) {
        console.error('❌ [useSSE] Could not parse error data:', error);
        console.error('Raw error data:', e.data);
        setIsSubmitting(false);
      }

      try {
        errorHandler({ data, submission: { ...submission, userMessage } as EventSubmission });
      } catch (handlerError) {
        console.error('❌ [useSSE] Error in error handler:', handlerError);
        setIsSubmitting(false);
      }
      
      // Clean up this connection on error
      const currentConnectionId = connectionId.current;
      if (currentConnectionId) {
        console.log(`❌ [ERROR CLEANUP] Removing failed connection: ${currentConnectionId}`);
        delete deltaAccumulator.current[currentConnectionId];
        delete deltaCounter.current[currentConnectionId];
        delete messageStartTime.current[currentConnectionId];
      }
    });

    sse.addEventListener('attachment', (e: MessageEvent) => {
      if (!isPanelActive.current) {
        console.log(`[useSSE] Panel ${panelId.current} inactive, ignoring attachment`);
        return;
      }
      
      hasReceivedData = true;
      debugComparison('SSE_ATTACHMENT', {
        isAddedRequest,
        runIndex,
        dataLength: e.data?.length || 0,
        panelId: panelId.current
      });
      
      try {
        const data = JSON.parse(e.data);
        attachmentHandler({ data, submission: submission as EventSubmission });
      } catch (error) {
        console.error('❌ [useSSE] Error parsing attachment:', error);
      }
    });

    sse.addEventListener('message', (e: MessageEvent) => {
      if (!isPanelActive.current) {
        console.log(`[useSSE] Panel ${panelId.current} inactive, ignoring message`);
        return;
      }
      
      hasReceivedData = true;
      
      if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
        console.log(`🔴 [DEFACTS] Raw SSE Event:`, e.data);
        sseDebugger.logRawEvent('message', e.data);
      }
      
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch (error) {
        console.error('❌ [useSSE] Error parsing message:', error);
        console.error('Raw message data:', e.data);
        
        if (payload?.model === 'DeFacts') {
          console.log('🔴 [DEFACTS] Attempting plain text handling');
          data = { text: e.data, type: 'text' };
        } else {
          return;
        }
      }

      if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
        sseDebugger.logRawEvent('parsed_message', data);
        
        const textLocations = {
          'data.text': data?.text,
          'data.content': data?.content,
          'data.response': data?.response,
          'data.message': data?.message,
          'data.responseMessage.text': data?.responseMessage?.text,
          'data.responseMessage.content': data?.responseMessage?.content,
          'data.delta.text': data?.delta?.text,
          'data.delta.content': data?.delta?.content,
          'data.choices[0].message.content': data?.choices?.[0]?.message?.content,
          'data.choices[0].text': data?.choices?.[0]?.text,
          'data.result': data?.result,
          'data.output': data?.output,
        };
        
        console.log('🔴 [DEFACTS TEXT SEARCH]:', Object.entries(textLocations).map(([path, value]) => ({
          path,
          hasValue: !!value,
          type: typeof value,
          length: typeof value === 'string' ? value.length : 0,
          preview: typeof value === 'string' ? value.substring(0, 50) : null,
        })));
      }

      debugDelta('SSE_MESSAGE_RECEIVED', data, {
        isAddedRequest,
        runIndex,
        connectionId: connectionId.current,
        messageType: data.final != null ? 'final' : 
                    data.created ? 'created' :
                    data.event ? 'step' :
                    data.sync ? 'sync' :
                    data.type ? 'content' : 'standard',
        hasText: hasTextContent(data),
        textLength: (data.text || data.response || extractDeltaText(data) || '').length,
        panelId: panelId.current
      });

      try {
        if (data.final != null) {
          const currentConnectionId = connectionId.current;
          const modelNeedsFix = payload?.model === 'DeFacts' || 
                               payload?.model === 'DeNews' || 
                               payload?.model === 'DeResearch';
          
          if (modelNeedsFix) {
            const accumulatedText = deltaAccumulator.current[currentConnectionId] || '';
            
            console.log(`🏁 [FINAL MESSAGE] ${currentConnectionId}:`, {
              model: payload?.model,
              hasResponseMessage: !!data.responseMessage,
              responseTextLength: data.responseMessage?.text?.length || 0,
              accumulatedLength: accumulatedText.length,
              deltaCount: deltaCounter.current[currentConnectionId] || 0,
              activeConnections: Object.keys(deltaAccumulator.current).length
            });
            
            // Create responseMessage if it doesn't exist
            if (!data.responseMessage && accumulatedText) {
              data.responseMessage = {
                messageId: data.messageId || `msg-${currentConnectionId}`,
                conversationId: data.conversationId || submission?.conversation?.conversationId,
                text: '',
                content: []
              };
            }
            
            // Fix empty response with accumulated text
            if (accumulatedText && data.responseMessage && !data.responseMessage.text) {
              console.warn(`✅ [FIX APPLIED] ${currentConnectionId}: Injecting ${accumulatedText.length} chars`);
              data.responseMessage.text = accumulatedText;
              
              // Also ensure content array is populated
              if (!data.responseMessage.content || data.responseMessage.content.length === 0) {
                data.responseMessage.content = [{
                  type: 'text',
                  text: accumulatedText
                }];
              } else if (data.responseMessage.content[0] && !data.responseMessage.content[0].text) {
                data.responseMessage.content[0].text = accumulatedText;
              }
            }
            
            // Clean up this connection's data
            console.log(`🧹 [CLEANUP] Removing data for connection: ${currentConnectionId}`);
            delete deltaAccumulator.current[currentConnectionId];
            delete deltaCounter.current[currentConnectionId];
            delete messageStartTime.current[currentConnectionId];
            
            // Periodic cleanup of old connections (older than 10 minutes)
            const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
            let cleanedCount = 0;
            
            Object.keys(messageStartTime.current).forEach(connId => {
              if (messageStartTime.current[connId] < tenMinutesAgo) {
                delete deltaAccumulator.current[connId];
                delete deltaCounter.current[connId];
                delete messageStartTime.current[connId];
                cleanedCount++;
              }
            });
            
            if (cleanedCount > 0) {
              console.log(`🧹 [CLEANUP] Removed ${cleanedCount} old connections`);
            }
            
            // Debug: Show current state
            console.log(`📦 [STATE] Active connections: ${Object.keys(deltaAccumulator.current).length}`, 
              Object.keys(deltaAccumulator.current)
            );
            
            if (payload?.model === 'DeFacts') {
              sseDebugger.exportLog();
            }
          }
          
          // Track request completion
          const messageId = data.responseMessage?.messageId || data.messageId;
          const hasText = !!(data.responseMessage?.text);
          const responseLength = data.responseMessage?.text?.length || 0;
          
          const request = REQUEST_TRACKER.findRequestByMessageId(messageId) || 
                          (currentRequestId.current ? REQUEST_TRACKER.activeRequests.get(currentRequestId.current) : null);
          
          if (request) {
            REQUEST_TRACKER.completeRequest(
              request.id,
              hasText,
              responseLength,
              !hasText ? 'Empty response from backend' : undefined
            );
          } else {
            console.warn('⚠️ [REQUEST TRACKER] Could not find request for final message', {
              messageId,
              currentRequestId: currentRequestId.current
            });
          }
          
          if (payload?.model === 'DeFacts' && !hasText) {
            console.error(`🔴 [DEFACTS FAILURE]`, {
              request: request ? {
                questionNumber: request.questionNumber,
                panel: request.panel,
                question: request.question
              } : 'Request not found',
              messageId,
              responseMessage: data.responseMessage
            });
          }
          
          logCacheState('BEFORE_FINAL');
          
          debugComparison('SSE_FINAL_MESSAGE', {
            isAddedRequest,
            runIndex,
            finalData: data,
            panelId: panelId.current
          });
          
          clearTimeouts();
          clearDraft(submission?.conversation?.conversationId);
          const { plugins } = data;
          
          // Add a small delay before processing final message to prevent race conditions
          const cleanupDelay = isAddedRequest ? 0 : 500; // Give DeFacts more time
          
          setTimeout(() => {
            if (isPanelActive.current) {
              finalHandler(data, { ...submission, plugins } as EventSubmission);
              (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
            }
          }, cleanupDelay);
          
          logCacheState('AFTER_FINAL');
          
          return;
        } else if (data.created != null) {
          // Track message creation
          const messageId = data.message?.messageId;
          
          if (currentRequestId.current && messageId) {
            REQUEST_TRACKER.updateRequest(currentRequestId.current, {
              messageId: messageId,
              status: 'pending'
            });
            
            console.log('🏁 [MESSAGE CREATED]', {
              requestId: currentRequestId.current,
              messageId,
              panel: !detectedComparisonMode ? 'SINGLE' : (isAddedRequest ? 'RIGHT' : 'LEFT'),
              mode: detectedComparisonMode ? 'comparison' : 'single',
              panelId: panelId.current
            });
          }
          
          debugComparison('SSE_CREATED_EVENT', {
            isAddedRequest,
            runIndex,
            createdData: data,
            panelId: panelId.current
          });
          
          const runId = v4();
          setActiveRunId(runId);
          
          const updatedUserMessage = {
            ...userMessage,
            ...data.message,
            overrideParentMessageId: userMessage.overrideParentMessageId,
          };

          createdHandler(data, { ...submission, userMessage: updatedUserMessage } as EventSubmission);
        } else if (data.event != null) {
          debugComparison('SSE_STEP_EVENT', {
            isAddedRequest,
            runIndex,
            stepData: data,
            eventType: data.event,
            hasDeltaContent: !!(data.data?.delta?.content),
            panelId: panelId.current
          });
          
          if (data.event === 'on_message_delta') {
            const deltaText = extractDeltaText(data);
            const currentConnectionId = connectionId.current;
            
            // Initialize if needed
            if (!deltaCounter.current[currentConnectionId]) {
              deltaCounter.current[currentConnectionId] = 0;
              deltaAccumulator.current[currentConnectionId] = '';
              messageStartTime.current[currentConnectionId] = Date.now();
              console.log(`🔵 [DELTA INIT] Connection ${currentConnectionId} initialized`);
            }
            
            if (deltaText) {
              deltaCounter.current[currentConnectionId]++;
              deltaAccumulator.current[currentConnectionId] += deltaText;
              
              // Log progress every 10 deltas
              if (deltaCounter.current[currentConnectionId] % 10 === 0) {
                console.log(`📊 [DELTA PROGRESS] ${currentConnectionId}:`, {
                  deltas: deltaCounter.current[currentConnectionId],
                  accumulated: deltaAccumulator.current[currentConnectionId].length + ' chars',
                  preview: deltaAccumulator.current[currentConnectionId].substring(0, 50) + '...'
                });
              }
            }
          }
          
          stepHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.sync != null) {
          debugComparison('SSE_SYNC_EVENT', {
            isAddedRequest,
            runIndex,
            syncData: data,
            panelId: panelId.current
          });
          
          const runId = v4();
          setActiveRunId(runId);
          syncHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.type != null) {
          debugDelta('SSE_CONTENT_EVENT', data, {
            isAddedRequest,
            runIndex,
            contentType: data.type,
            index: data.index,
            hasText: !!data.text,
            textLength: data.text?.length || 0,
            panelId: panelId.current
          });
          
          const { text, index } = data;
          if (text != null && index !== textIndex) {
            textIndex = index;
          }

          contentHandler({ data, submission: submission as EventSubmission });
        } else {
          debugComparison('SSE_STANDARD_MESSAGE', {
            isAddedRequest,
            runIndex,
            standardData: data,
            panelId: panelId.current
          });
          
          const text = data.text ?? data.response;
          const { plugin, plugins } = data;

          const initialResponse = {
            ...(submission?.initialResponse as TMessage),
            parentMessageId: data.parentMessageId,
            messageId: data.messageId,
          };

          if (data.message != null) {
            messageHandler(text, { ...submission, plugin, plugins, userMessage, initialResponse });
          }
        }
      } catch (error) {
        console.error('❌ [useSSE] Error processing message event:', error);
        debugComparison('SSE_MESSAGE_PROCESSING_ERROR', {
          isAddedRequest,
          runIndex,
          error: error.message,
          data: data,
          panelId: panelId.current
        });
      }
    });

    sse.addEventListener('cancel', async () => {
      debugComparison('SSE_CANCEL_EVENT', {
        isAddedRequest,
        runIndex,
        panelId: panelId.current
      });
      
      // Mark this panel as inactive
      isPanelActive.current = false;
      
      clearTimeouts();
      
      // Clean up connection data on cancel
      const currentConnectionId = connectionId.current;
      if (currentConnectionId) {
        console.log(`🚫 [CANCEL CLEANUP] Removing cancelled connection: ${currentConnectionId}`);
        delete deltaAccumulator.current[currentConnectionId];
        delete deltaCounter.current[currentConnectionId];
        delete messageStartTime.current[currentConnectionId];
      }
      
      // Only handle cancellation for this specific panel
      try {
        const streamKey = (submission as TSubmission | null)?.['initialResponse']?.messageId;
        if (completed.has(streamKey)) {
          // Only set isSubmitting false if both panels are done
          // This should be handled by parent component
          setIsSubmitting(false);
          setCompleted((prev) => {
            prev.delete(streamKey);
            return new Set(prev);
          });
          return;
        }

        setCompleted((prev) => new Set(prev.add(streamKey)));
        const latestMessages = getMessages();
        const conversationId = latestMessages?.[latestMessages.length - 1]?.conversationId;
        return await abortConversation(
          conversationId ??
            userMessage.conversationId ??
            submission?.conversation?.conversationId ??
            '',
          submission as EventSubmission,
          latestMessages,
        );
      } catch (error) {
        console.error('❌ [useSSE] Error in cancel handler:', error);
      }
    });

    if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
      const possibleEventNames = [
        'data', 'update', 'chunk', 'stream', 'delta', 'text', 
        'content', 'response', 'completion', 'message_delta',
        'text_delta', 'assistant_message', 'ai_response'
      ];
      
      possibleEventNames.forEach(eventName => {
        sse.addEventListener(eventName, (e: any) => {
          if (!isPanelActive.current) {
            return;
          }
          
          console.log(`🔴 [DEFACTS CUSTOM EVENT: ${eventName}]:`, e.data || e);
          sseDebugger.logRawEvent(eventName, e.data || e);
          
          try {
            const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (data && (data.text || data.content || data.delta)) {
              console.log(`🔴 [DEFACTS] Processing ${eventName} as message`);
              messageHandler(data.text || data.content || '', { 
                ...submission, 
                userMessage,
                initialResponse: submission?.initialResponse as TMessage
              } as EventSubmission);
            }
          } catch (err) {
            console.log(`🔴 [DEFACTS] Could not process ${eventName} event:`, err);
          }
        });
      });
    }

    /* @ts-ignore */
    if (sse.addEventListener) {
      sse.addEventListener('readystatechange', () => {
        debugComparison('SSE_READYSTATE_CHANGE', {
          isAddedRequest,
          runIndex,
          /* @ts-ignore */
          readyState: sse.readyState,
          panelId: panelId.current
        });
      });
    }

    // Start the stream
    setIsSubmitting(true);
    
    debugComparison('SSE_STREAM_START', {
      isAddedRequest,
      runIndex,
      url: payloadData.server,
      panelId: panelId.current
    });
    
    try {
      sse.stream();
    } catch (error) {
      console.error('❌ [useSSE] Error starting stream:', error);
      handleRetry('Stream start failed', attempt, payloadData, payload, userMessage);
    }

    return sse;
  };

  // Cleanup effect for component unmount
  useEffect(() => {
    return () => {
      debugComparison('SSE_CLEANUP', {
        isAddedRequest,
        runIndex,
        panelId: panelId.current
      });
      
      // Mark panel as inactive on cleanup
      isPanelActive.current = false;
      
      clearTimeouts();
      if (currentSSERef.current) {
        try {
          currentSSERef.current.close();
        } catch (error) {
          console.error('❌ [useSSE] Error closing connection on unmount:', error);
        }
        currentSSERef.current = null;
      }
      
      // Clean up connection-specific data
      const currentConnectionId = connectionId.current;
      if (currentConnectionId) {
        console.log(`🔚 [UNMOUNT CLEANUP] Removing connection: ${currentConnectionId}`);
        delete deltaAccumulator.current[currentConnectionId];
        delete deltaCounter.current[currentConnectionId];
        delete messageStartTime.current[currentConnectionId];
      }
    };
  }, []);

  // Effect for handling submissions
  useEffect(() => {
    if (submission == null || Object.keys(submission).length === 0) {
      return;
    }

    const { userMessage } = submission;

    // Start tracking this request
    const requestId = REQUEST_TRACKER.startRequest(
      submission, 
      isAddedRequest, 
      runIndex,
      detectedComparisonMode
    );
    currentRequestId.current = requestId;

    let payloadData: any;
    let payload: TPayload;

    try {
      payloadData = createPayload(submission);
      payload = payloadData.payload;
      
      if (isAssistantsEndpoint(payload.endpoint) || isAgentsEndpoint(payload.endpoint)) {
        payload = removeNullishValues(payload) as TPayload;
      }
    } catch (error) {
      console.error('❌ [useSSE] Error creating payload:', error);
      setIsSubmitting(false);
      return;
    }

    debugComparison('SSE_REQUEST_START', {
      requestId,
      model: payload?.model,
      endpoint: payload?.endpoint,
      isAddedRequest,
      runIndex,
      panel: !detectedComparisonMode ? 'SINGLE' : (isAddedRequest ? 'RIGHT' : 'LEFT'),
      mode: detectedComparisonMode ? 'comparison' : 'single',
      conversationId: submission?.conversation?.conversationId,
      userMessage: userMessage?.text,
      retryEnabled: true,
      maxRetries: RETRY_CONFIG.maxRetries,
      serverUrl: payloadData.server,
      payloadSize: JSON.stringify(payload).length,
      payloadStructure: Object.keys(payload),
      isDeFacts: payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts'),
      comparisonModeDetected: detectedComparisonMode,
      originalComparisonMode: isComparisonMode,
      panelId: panelId.current
    });

    // Reset panel active state when new submission comes in
    isPanelActive.current = true;
    setRetryCount(0);
    setIsRetrying(false);

    let sse: SSE;
    try {
      sse = createSSEConnection(payloadData, payload, userMessage, 0);
    } catch (error) {
      console.error('❌ [useSSE] Failed to create initial connection:', error);
      setIsSubmitting(false);
      return;
    }

    // Cleanup function
    return () => {
      const isCancelled = sse.readyState <= 1;
      debugComparison('SSE_EFFECT_CLEANUP', {
        isAddedRequest,
        runIndex,
        readyState: sse.readyState,
        isCancelled,
        retryCount,
        panelId: panelId.current
      });
      
      // Mark panel as inactive
      isPanelActive.current = false;
      
      clearTimeouts();
      currentSSERef.current = null;
      
      try {
        sse.close();
      } catch (error) {
        console.error('❌ [useSSE] Error closing connection in cleanup:', error);
      }
      
      if (isCancelled) {
        try {
          const e = new Event('cancel');
          /* @ts-ignore */
          sse.dispatchEvent(e);
        } catch (error) {
          console.error('❌ [useSSE] Error dispatching cancel event:', error);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);

  return {
    isRetrying,
    retryCount,
    maxRetries: RETRY_CONFIG.maxRetries,
    RetryStatusComponent: () => React.createElement(RetryStatusDisplay, {
      isRetrying,
      retryCount,
      maxRetries: RETRY_CONFIG.maxRetries,
    }),
  };
}