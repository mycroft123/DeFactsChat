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

// Import utilities from separate files
import { REQUEST_TRACKER } from './requestTracker';
import { 
  createSSEDebugger, 
  debugDelta, 
  extractDeltaText, 
  hasTextContent, 
  debugComparison 
} from './useSSEDebug';

// Enhanced debugging interface
interface AICallDebugInfo {
  requestId: string;
  panel: 'LEFT' | 'RIGHT' | 'SINGLE';
  model: string;
  endpoint: string;
  timestamp: number;
  payload: any;
  response?: any;
  error?: any;
  duration?: number;
  sseEvents: Array<{
    type: string;
    data: any;
    timestamp: number;
  }>;
}

// Global debug storage
const AI_CALL_DEBUG_HISTORY: AICallDebugInfo[] = [];

// Debug function
const debugAICall = (info: Partial<AICallDebugInfo>) => {
  const debugEntry: AICallDebugInfo = {
    requestId: info.requestId || 'unknown',
    panel: info.panel || 'SINGLE',
    model: info.model || 'unknown',
    endpoint: info.endpoint || 'unknown',
    timestamp: Date.now(),
    payload: info.payload,
    response: info.response,
    error: info.error,
    duration: info.duration,
    sseEvents: info.sseEvents || [],
  };
  
  AI_CALL_DEBUG_HISTORY.push(debugEntry);
  
  // Keep only last 50 entries
  if (AI_CALL_DEBUG_HISTORY.length > 50) {
    AI_CALL_DEBUG_HISTORY.shift();
  }
  
  console.log('🔍 [AI_CALL_DEBUG]', debugEntry);
};

// Enhanced pre-flight check function
const performPreflightCheck = async (
  server: string,
  payload: any,
  token: string,
  model: string
): Promise<{ success: boolean; error?: any; details?: any }> => {
  console.log(`🛫 [PREFLIGHT CHECK] Starting for ${model}...`);
  
  try {
    // First, try OPTIONS request to check CORS
    try {
      const optionsResponse = await fetch(server, {
        method: 'OPTIONS',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      
      console.log(`🛫 [PREFLIGHT OPTIONS]`, {
        status: optionsResponse.status,
        headers: Object.fromEntries(optionsResponse.headers.entries()),
      });
    } catch (optionsError) {
      console.warn(`⚠️ [PREFLIGHT OPTIONS] Failed:`, optionsError);
    }
    
    // Then try actual POST request
    const response = await fetch(server, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    
    const responseHeaders = Object.fromEntries(response.headers.entries());
    let responseData = null;
    
    try {
      const responseText = await response.text();
      if (responseText) {
        responseData = JSON.parse(responseText);
      }
    } catch (e) {
      // Response might not be JSON
    }
    
    const result = {
      success: response.ok,
      details: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: responseData,
        hasSSEHeaders: responseHeaders['content-type']?.includes('text/event-stream'),
      },
    };
    
    console.log(`🛫 [PREFLIGHT RESULT]`, result);
    
    return result;
  } catch (error) {
    console.error(`❌ [PREFLIGHT ERROR]`, error);
    return {
      success: false,
      error: error,
      details: {
        errorType: (error as Error).constructor.name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    };
  }
};

// Diagnostic function
const diagnoseRightPanelFailure = () => {
  console.log('🔍 DIAGNOSING RIGHT PANEL FAILURE...');
  console.log('=====================================');
  
  // 1. Check active requests
  const activeRequests = Array.from(REQUEST_TRACKER.activeRequests.values());
  const rightPanelRequests = activeRequests.filter(r => r.panel === 'RIGHT');
  
  console.log('1️⃣ Active RIGHT Panel Requests:', rightPanelRequests.length);
  rightPanelRequests.forEach(req => {
    console.log('  - Request:', {
      id: req.id,
      model: req.model,
      status: req.status,
      duration: Date.now() - req.startTime,
      messageId: req.messageId,
    });
  });
  
  // 2. Check comparison mode detection
  const panels = document.querySelectorAll('[data-panel]');
  console.log('2️⃣ Panel Detection:', {
    panelCount: panels.length,
    isComparisonMode: panels.length > 1,
    panelAttributes: Array.from(panels).map(p => p.getAttribute('data-panel')),
  });
  
  // 3. Check for stuck requests
  const stuckRequests = activeRequests.filter(r => 
    r.status === 'pending' && 
    Date.now() - r.startTime > 5000 // More than 5 seconds
  );
  
  if (stuckRequests.length > 0) {
    console.log('3️⃣ ⚠️  STUCK REQUESTS FOUND:', stuckRequests.length);
    stuckRequests.forEach(req => {
      console.log('  - Stuck Request:', {
        panel: req.panel,
        model: req.model,
        duration: `${Math.round((Date.now() - req.startTime) / 1000)}s`,
        question: req.question.substring(0, 50),
      });
    });
  } else {
    console.log('3️⃣ ✅ No stuck requests');
  }
  
  // 4. Check AI call history
  const pendingAICalls = AI_CALL_DEBUG_HISTORY.filter(call => !call.duration);
  const failedAICalls = AI_CALL_DEBUG_HISTORY.filter(call => call.error);
  
  console.log('4️⃣ AI Call Status:', {
    total: AI_CALL_DEBUG_HISTORY.length,
    pending: pendingAICalls.length,
    failed: failedAICalls.length,
  });
  
  if (failedAICalls.length > 0) {
    console.log('  ❌ Failed AI Calls:');
    failedAICalls.forEach(call => {
      console.log('    -', {
        panel: call.panel,
        model: call.model,
        error: call.error,
      });
    });
  }
  
  // 5. Provide recommendations
  console.log('\n📋 DIAGNOSTIC SUMMARY:');
  
  if (rightPanelRequests.length === 0) {
    console.log('❌ No RIGHT panel requests found - The request may not be starting');
    console.log('   → Check if submission is being passed to the RIGHT panel');
    console.log('   → Verify isAddedRequest=true for RIGHT panel');
  } else if (stuckRequests.some(r => r.panel === 'RIGHT')) {
    console.log('❌ RIGHT panel request is stuck in pending state');
    console.log('   → Check SSE connection establishment');
    console.log('   → Verify server endpoint is responding');
    console.log('   → Check for CORS or authentication issues');
  } else {
    console.log('⚠️  Unable to determine specific failure reason');
    console.log('   → Enable more verbose logging');
    console.log('   → Check browser DevTools Network tab');
    console.log('   → Verify model availability');
  }
  
  return {
    rightPanelRequests,
    stuckRequests: stuckRequests.filter(r => r.panel === 'RIGHT'),
    isComparisonMode: panels.length > 1,
  };
};

// Add debug functions to window
if (typeof window !== 'undefined') {
  (window as any).AI_DEBUG = {
    showHistory: () => {
      console.table(AI_CALL_DEBUG_HISTORY.map(entry => ({
        requestId: entry.requestId.substring(0, 8),
        panel: entry.panel,
        model: entry.model,
        endpoint: entry.endpoint,
        timestamp: new Date(entry.timestamp).toLocaleTimeString(),
        hasError: !!entry.error,
        duration: entry.duration ? `${entry.duration}ms` : 'pending',
        eventCount: entry.sseEvents.length,
      })));
    },
    showRequest: (requestId: string) => {
      const entry = AI_CALL_DEBUG_HISTORY.find(e => 
        e.requestId.includes(requestId) || e.requestId === requestId
      );
      if (entry) {
        console.log('📋 AI Call Details:', entry);
      } else {
        console.log('Request not found');
      }
    },
    showFailures: () => {
      const failures = AI_CALL_DEBUG_HISTORY.filter(e => e.error);
      console.log(`❌ Failed AI Calls (${failures.length}):`, failures);
    },
    showPending: () => {
      const pending = AI_CALL_DEBUG_HISTORY.filter(e => !e.duration);
      console.log(`⏳ Pending AI Calls (${pending.length}):`, pending);
      return pending;
    },
    clear: () => {
      AI_CALL_DEBUG_HISTORY.length = 0;
      console.log('🧹 AI debug history cleared');
    },
  };
  
  (window as any).diagnoseRight = diagnoseRightPanelFailure;
  
  (window as any).forceCompleteStuck = () => {
    const activeRequests = Array.from(REQUEST_TRACKER.activeRequests.entries());
    let completed = 0;
    
    activeRequests.forEach(([id, req]) => {
      if (req.status === 'pending' && Date.now() - req.startTime > 5000) {
        console.log(`Force completing stuck request: ${req.panel} - ${req.model}`);
        REQUEST_TRACKER.completeRequest(id, false, 0, 'Force completed - was stuck');
        completed++;
      }
    });
    
    console.log(`✅ Force completed ${completed} stuck requests`);
  };
}

// Retry Status Component
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

type ChatHelpers = Pick<
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'newConversation'
  | 'resetLatestMessage'
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

// Enhanced SSE error event interface
interface SSEErrorEvent extends MessageEvent {
  responseCode?: number;
  statusCode?: number;
  status?: number;
}

export default function useSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
  isComparisonMode = false,
): UseSSEReturn {
  
  // Initial logging
  console.log(`[useSSE INITIAL] Panel ${isAddedRequest ? 'RIGHT' : 'LEFT'}`, {
    hasSubmission: !!submission,
    submissionKeys: submission ? Object.keys(submission) : [],
    model: submission?.conversation?.model,
    endpoint: submission?.conversation?.endpoint,
    isAddedRequest,
    timestamp: Date.now()
  });
  
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
  
  // Log submission changes
  useEffect(() => {
    console.log(`[useSSE SUBMISSION CHANGE] Panel ${isAddedRequest ? 'RIGHT' : 'LEFT'}`, {
      hasSubmission: !!submission,
      model: submission?.conversation?.model,
      isEmpty: !submission || Object.keys(submission).length === 0,
      timestamp: Date.now()
    });
  }, [submission, isAddedRequest]);
  
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
  const [isSubmittingLocal, setIsSubmittingLocal] = useState<boolean>(false);
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
      setIsSubmittingLocal(false);
      
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
        setIsSubmittingLocal(false);
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
    if (!isPanelActive.current) {
      console.log(`[useSSE] Panel ${panelId.current} is inactive, not creating connection`);
      throw new Error('Panel is inactive');
    }
    
    const newConnectionId = `${isAddedRequest ? 'COMP' : 'DEFACTS'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    connectionId.current = newConnectionId;
    
    console.log(`🔌 [CONNECTION] New connection created: ${newConnectionId}`, {
      panel: isAddedRequest ? 'RIGHT' : 'LEFT',
      model: payload?.model,
      conversationId: submission?.conversation?.conversationId,
      userMessage: userMessage?.text?.substring(0, 50) + '...'
    });
    
    // Create debug info for this connection
    const debugInfo: AICallDebugInfo = {
      requestId: currentRequestId.current || newConnectionId,
      panel: isAddedRequest ? 'RIGHT' : 'LEFT',
      model: payload?.model || 'unknown',
      endpoint: payload?.endpoint || 'unknown',
      timestamp: Date.now(),
      payload: payload,
      sseEvents: [],
    };
    
    const addSSEEvent = (type: string, data: any) => {
      debugInfo.sseEvents.push({
        type,
        data,
        timestamp: Date.now(),
      });
    };
    
    // Perform preflight check
    if (payload?.model && attempt === 0) {
      performPreflightCheck(payloadData.server, payload, token, payload.model)
        .then(result => {
          debugInfo.response = result;
          if (!result.success) {
            console.error(`❌ [PREFLIGHT FAILED] ${payload.model}:`, result);
          }
        });
    }
    
    // DeFacts-specific debugging
    if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
      console.log(`🔍 [DeFacts DEBUG START]`, {
        connectionId: newConnectionId,
        endpoint: payload.endpoint,
        server: payloadData.server,
        payload: payload,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer [REDACTED]'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    debugComparison('SSE_CONNECTION_CREATE', {
      attempt: attempt + 1,
      maxRetries: RETRY_CONFIG.maxRetries + 1,
      isAddedRequest,
      runIndex,
      endpoint: payload?.endpoint,
      model: payload?.model,
      serverUrl: payloadData.server,
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
      debugInfo.error = error;
      debugInfo.duration = Date.now() - debugInfo.timestamp;
      debugAICall(debugInfo);
      handleRetry('SSE creation failed', attempt, payloadData, payload, userMessage);
      throw error;
    }

    const sseDebugger = createSSEDebugger(
      payload?.model || submission?.conversation?.model || 'unknown',
      isAddedRequest
    );
    
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
      addSSEEvent('timeout', { readyState: sse.readyState });
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
      addSSEEvent('open', { readyState: sse.readyState });
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

    sse.addEventListener('error', async (e: SSEErrorEvent) => {
      if (!isPanelActive.current) {
        console.log(`[useSSE] Panel ${panelId.current} was cancelled, ignoring error`);
        return;
      }
      
      addSSEEvent('error', {
        responseCode: e.responseCode,
        statusCode: e.statusCode,
        data: e.data,
        readyState: sse.readyState,
      });
      
      // Complete the debug info on error
      debugInfo.error = {
        responseCode: e.responseCode || e.statusCode || e.status,
        data: e.data,
        readyState: sse.readyState,
        hasReceivedData: hasReceivedData,
      };
      debugInfo.duration = Date.now() - debugInfo.timestamp;
      debugAICall(debugInfo);
      
      // Enhanced error debug for DeFacts
      if (payload?.model === 'DeFacts') {
        console.log(`🔍 [DeFacts ERROR]:`, {
          connectionId: connectionId.current,
          errorData: e.data,
          errorType: e.type,
          readyState: sse.readyState,
          responseCode: e.responseCode,
          statusCode: e.statusCode,
          hasReceivedData: hasReceivedData,
          timestamp: new Date().toISOString()
        });
      }
      
      debugComparison('SSE_ERROR', {
        isAddedRequest,
        runIndex,
        hasReceivedData,
        attempt: attempt + 1,
        responseCode: e.responseCode,
        statusCode: e.statusCode,
        data: e.data,
        panelId: panelId.current
      });

      clearTimeouts();

      const errorStatus = e.responseCode || e.statusCode || e.status;
      
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
        setIsSubmittingLocal(false);
      }

      try {
        errorHandler({ data, submission: { ...submission, userMessage } as EventSubmission });
      } catch (handlerError) {
        console.error('❌ [useSSE] Error in error handler:', handlerError);
        setIsSubmitting(false);
        setIsSubmittingLocal(false);
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
      addSSEEvent('attachment', { dataLength: e.data?.length || 0 });
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
      addSSEEvent('message', { 
        dataLength: e.data?.length,
        dataPreview: e.data?.substring(0, 100),
      });
      
      // Enhanced message debug for DeFacts
      if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
        console.log(`🔍 [DeFacts RAW MESSAGE]:`, {
          connectionId: connectionId.current,
          rawData: e.data,
          dataType: typeof e.data,
          dataLength: e.data?.length,
          isEmpty: !e.data || e.data.trim() === '',
          isJSON: (() => {
            try {
              JSON.parse(e.data);
              return true;
            } catch {
              return false;
            }
          })(),
          preview: e.data?.substring(0, 200),
          timestamp: new Date().toISOString()
        });
        
        sseDebugger.logRawEvent('message', e.data);
      }
      
      let data: any;
      try {
        data = JSON.parse(e.data);
        
        // Enhanced parsed message debug for DeFacts
        if (payload?.model === 'DeFacts') {
          console.log(`🔍 [DeFacts PARSED MESSAGE]:`, {
            connectionId: connectionId.current,
            hasData: !!data,
            dataKeys: data ? Object.keys(data) : [],
            hasFinal: data?.final !== undefined,
            hasCreated: data?.created !== undefined,
            hasEvent: data?.event !== undefined,
            hasText: !!(data?.text || data?.response),
            hasDelta: !!data?.delta,
            deltaContent: data?.delta?.content,
            messageType: data?.type,
            timestamp: new Date().toISOString()
          });
          
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
          handleFinalMessage(data);
        } else if (data.created != null) {
          handleCreatedMessage(data);
        } else if (data.event != null) {
          handleEventMessage(data);
        } else if (data.sync != null) {
          handleSyncMessage(data);
        } else if (data.type != null) {
          handleContentMessage(data, textIndex);
        } else {
          handleStandardMessage(data);
        }
      } catch (error) {
        console.error('❌ [useSSE] Error processing message event:', error);
        debugComparison('SSE_MESSAGE_PROCESSING_ERROR', {
          isAddedRequest,
          runIndex,
          error: (error as Error).message,
          data: data,
          panelId: panelId.current
        });
      }
    });

    sse.addEventListener('cancel', async () => {
      addSSEEvent('cancel', {});
      debugComparison('SSE_CANCEL_EVENT', {
        isAddedRequest,
        runIndex,
        panelId: panelId.current
      });
      
      isPanelActive.current = false;
      clearTimeouts();
      
      const currentConnectionId = connectionId.current;
      if (currentConnectionId) {
        console.log(`🚫 [CANCEL CLEANUP] Removing cancelled connection: ${currentConnectionId}`);
        delete deltaAccumulator.current[currentConnectionId];
        delete deltaCounter.current[currentConnectionId];
        delete messageStartTime.current[currentConnectionId];
      }
      
      try {
        const streamKey = (submission as TSubmission | null)?.['initialResponse']?.messageId;
        if (completed.has(streamKey)) {
          setIsSubmitting(false);
          setIsSubmittingLocal(false);
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

    // Register custom event handlers for DeFacts
    if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
      registerDeFactsEventHandlers(sse, sseDebugger);
    }

    // Start the stream
    setIsSubmitting(true);
    setIsSubmittingLocal(true);
    
    debugComparison('SSE_STREAM_START', {
      isAddedRequest,
      runIndex,
      url: payloadData.server,
      panelId: panelId.current
    });
    
    try {
      sse.stream();
      console.log(`[SSE DEBUG] Stream started for ${panelId.current}`, {
        readyState: sse.readyState,
        url: payloadData.server,
        model: payload?.model
      });
      
      // Check readyState after 1 second
      setTimeout(() => {
        console.log(`[SSE DEBUG] ReadyState after 1s for ${panelId.current}:`, {
          readyState: currentSSERef.current?.readyState,
          model: payload?.model,
          isActive: isPanelActive.current
        });
      }, 1000);
    } catch (error) {
      console.error('❌ [useSSE] Error starting stream:', error);
      handleRetry('Stream start failed', attempt, payloadData, payload, userMessage);
    }

    return sse;

    // Helper functions for message handling
    function handleFinalMessage(data: any) {
      const currentConnectionId = connectionId.current;
      const modelNeedsFix = payload?.model === 'DeFacts' || 
                           payload?.model === 'DeNews' || 
                           payload?.model === 'DeResearch';
      
      // Complete the debug info
      debugInfo.duration = Date.now() - debugInfo.timestamp;
      debugInfo.response = {
        final: true,
        hasText: !!(data.responseMessage?.text),
        responseLength: data.responseMessage?.text?.length || 0,
      };
      debugAICall(debugInfo);
      
      if (modelNeedsFix) {
        const accumulatedText = deltaAccumulator.current[currentConnectionId] || '';
        
        // Comprehensive final message debug
        console.log(`🔍 [DeFacts FINAL MESSAGE DEBUG]:`, {
          connectionId: currentConnectionId,
          hasResponseMessage: !!data.responseMessage,
          responseMessageKeys: data.responseMessage ? Object.keys(data.responseMessage) : [],
          responseText: data.responseMessage?.text,
          responseTextLength: data.responseMessage?.text?.length || 0,
          responseContent: data.responseMessage?.content,
          accumulatedText: accumulatedText.substring(0, 100) + '...',
          accumulatedLength: accumulatedText.length,
          deltaCount: deltaCounter.current[currentConnectionId] || 0,
          allDataKeys: Object.keys(data),
          fullData: data,
          timestamp: new Date().toISOString()
        });
        
        // Log the exact structure
        console.log(`🔍 [DeFacts RESPONSE STRUCTURE]:`, JSON.stringify(data, null, 2));
        
        // Create responseMessage if it doesn't exist
        if (!data.responseMessage && accumulatedText) {
          data.responseMessage = {
            messageId: data.messageId || `msg-${currentConnectionId}`,
            conversationId: data.conversationId || submission?.conversation?.conversationId,
            text: '',
            content: []
          };
        }
        
        // Fix empty response with accumulated text OR add error message
        if (data.responseMessage) {
          if (!data.responseMessage.text && !accumulatedText) {
            // No text at all - add error message
            console.error(`❌ [EMPTY RESPONSE] ${currentConnectionId}: No content received`);
            data.responseMessage.text = '[Error: No response received from the model]';
            data.responseMessage.error = true;
            data.responseMessage.content = [{
              type: 'text',
              text: '[Error: No response received from the model]'
            }];
          } else if (accumulatedText && !data.responseMessage.text) {
            // We have accumulated text but responseMessage.text is empty
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
        }
        
        // Clean up this connection's data
        cleanupConnectionData(currentConnectionId);
        
        if (payload?.model === 'DeFacts') {
          sseDebugger.exportLog();
        }
      }
      
      // Track request completion
      const messageId = data.responseMessage?.messageId || data.messageId;
      const hasText = !!(data.responseMessage?.text);
      const responseLength = data.responseMessage?.text?.length || 0;
      
      // ENHANCED DEBUGGING FOR REQUEST TRACKING
      console.log("🔍 [COMPLETE REQUEST] Looking for request:", {
        messageId,
        currentRequestId: currentRequestId.current,
        activeRequestIds: Array.from(REQUEST_TRACKER.activeRequests.keys()),
        model: payload?.model,
        panel: isAddedRequest ? 'RIGHT' : 'LEFT'
      });
      
      // Try multiple ways to find the request
      let request = REQUEST_TRACKER.findRequestByMessageId(messageId);
      
      if (!request && currentRequestId.current) {
        console.log("🔍 [COMPLETE REQUEST] Trying currentRequestId:", currentRequestId.current);
        request = REQUEST_TRACKER.activeRequests.get(currentRequestId.current);
      }
      
      if (!request) {
        // Try to find by matching model and status
        const activeRequests = Array.from(REQUEST_TRACKER.activeRequests.values());
        request = activeRequests.find(r => 
          r.model === payload?.model && 
          r.status === 'pending' &&
          r.panel === (isAddedRequest ? 'RIGHT' : 'LEFT')
        );
        
        if (request) {
          console.log("🔍 [COMPLETE REQUEST] Found request by model/panel match:", request);
        }
      }
      
      // Log the result of our search
      if (!request) {
        console.error("❌ [COMPLETE REQUEST] Could not find request to complete!", {
          triedMessageId: messageId,
          triedRequestId: currentRequestId.current,
          model: payload?.model,
          panel: isAddedRequest ? 'RIGHT' : 'LEFT',
          allActiveRequests: Array.from(REQUEST_TRACKER.activeRequests.entries()).map(([id, req]) => ({
            id,
            model: req.model,
            panel: req.panel,
            messageId: req.messageId,
            status: req.status
          }))
        });
        
        // Force complete any matching pending request as a fallback
        const pendingRequest = Array.from(REQUEST_TRACKER.activeRequests.values()).find(r => 
          r.model === payload?.model && 
          r.status === 'pending' &&
          r.panel === (isAddedRequest ? 'RIGHT' : 'LEFT')
        );
        
        if (pendingRequest) {
          console.warn("⚠️ [COMPLETE REQUEST] Force completing pending request:", pendingRequest);
          REQUEST_TRACKER.completeRequest(
            pendingRequest.id,
            hasText,
            responseLength,
            !hasText ? 'Empty response from backend' : undefined
          );
        }
      } else {
        console.log("✅ [COMPLETE REQUEST] Found request to complete:", {
          requestId: request.id,
          model: request.model,
          panel: request.panel,
          questionNumber: request.questionNumber
        });
        
        REQUEST_TRACKER.completeRequest(
          request.id,
          hasText,
          responseLength,
          !hasText ? 'Empty response from backend' : undefined
        );
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
    }
    
    function handleCreatedMessage(data: any) {
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
    }

    function handleEventMessage(data: any) {
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
        
        // Enhanced delta debug for DeFacts
        if (payload?.model === 'DeFacts') {
          console.log(`🔍 [DeFacts DELTA]:`, {
            connectionId: currentConnectionId,
            deltaText: deltaText,
            deltaLength: deltaText.length,
            eventData: data,
            currentAccumulated: deltaAccumulator.current[currentConnectionId]?.length || 0,
            deltaCount: deltaCounter.current[currentConnectionId] || 0
          });
        }
        
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
    }

    function handleSyncMessage(data: any) {
      debugComparison('SSE_SYNC_EVENT', {
        isAddedRequest,
        runIndex,
        syncData: data,
        panelId: panelId.current
      });
      
      const runId = v4();
      setActiveRunId(runId);
      syncHandler(data, { ...submission, userMessage } as EventSubmission);
    }

    function handleContentMessage(data: any, textIndex: number | null) {
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
    }

    function handleStandardMessage(data: any) {
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

    function cleanupConnectionData(currentConnectionId: string) {
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
    }

    function registerDeFactsEventHandlers(sse: SSE, sseDebugger: any) {
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
  };

  // Add failsafe timeout for stuck states
  useEffect(() => {
    if (isSubmittingLocal) {
      const failsafeTimeout = setTimeout(() => {
        console.warn('⚠️ [FAILSAFE] Submission stuck for 30s, forcing completion');
        setIsSubmitting(false);
        setIsSubmittingLocal(false);
        setShowStopButton(false);
      }, 30000); // 30 second timeout
      
      return () => clearTimeout(failsafeTimeout);
    }
  }, [isSubmittingLocal, setIsSubmitting, setShowStopButton]);

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
      console.log(`[useSSE EFFECT] No submission for panel ${panelId.current}`);
      return;
    }

    console.log(`[useSSE EFFECT] Processing submission for panel ${panelId.current}:`, {
      isAddedRequest,
      model: submission?.conversation?.model,
      endpoint: submission?.conversation?.endpoint,
      hasUserMessage: !!submission?.userMessage
    });

    const { userMessage } = submission;
    if (!userMessage) {
      console.error('No userMessage in submission');
      return;
    }

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
      setIsSubmittingLocal(false);
      return;
    }

    // DEBUG: Log DeFacts request details
    if (payload?.model === 'DeFacts') {
      console.log(`🔍 [DeFacts REQUEST]:`, {
        url: payloadData.server,
        method: 'POST',
        payload: JSON.stringify(payload, null, 2),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer [REDACTED]'
        }
      });
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
      setIsSubmittingLocal(false);
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

  // Log mount/unmount lifecycle
  useEffect(() => {
    console.log(`[useSSE LIFECYCLE] ${isAddedRequest ? 'RIGHT' : 'LEFT'} panel`, {
      mounted: true,
      submission: !!submission,
      model: submission?.conversation?.model,
      timestamp: Date.now()
    });
    
    return () => {
      console.log(`[useSSE LIFECYCLE] ${isAddedRequest ? 'RIGHT' : 'LEFT'} panel`, {
        unmounted: true,
        timestamp: Date.now()
      });
    };
  }, []);

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

// Log debug commands on load
console.log(`
🔍 AI Debugging Commands:
- AI_DEBUG.showHistory()     // Show all AI calls
- AI_DEBUG.showRequest('id') // Show specific request details
- AI_DEBUG.showFailures()    // Show only failed calls
- AI_DEBUG.showPending()     // Show active/pending calls
- AI_DEBUG.clear()           // Clear history

🔧 Request Tracker Commands:
- REQUEST_TRACKER.showCurrentState()
- REQUEST_TRACKER.showSummary()
- window.debugDeFacts()

🔍 Diagnostic Commands:
- diagnoseRight()        // Diagnose RIGHT panel failures
- forceCompleteStuck()   // Force complete stuck requests
`);