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
  debugComparison,
  debugAICall,
  performPreflightCheck,
  installDebugGlobals
} from './useSSEDebug';

// Install global debug functions
installDebugGlobals();

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
  
  // Auto-detect comparison mode if not explicitly passed
  const detectedComparisonMode = isComparisonMode || 
    (typeof document !== 'undefined' && document.querySelectorAll('[data-panel]').length > 1);
  
  // Track connection instances and cache state
  const connectionId = useRef<string>('');
  const previousCacheState = useRef<any>({});
  const currentRequestId = useRef<string>('');
  
  // ===== ENHANCED PANEL ISOLATION FIXES =====
  // Add panel-specific state management with unique IDs
  const panelId = useRef(`${isAddedRequest ? 'RIGHT' : 'LEFT'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  
  // FIXED: Panel-specific timeout management (no more shared refs)
  const retryTimeoutRef = useRef<{[panelId: string]: any}>({});
  const connectionTimeoutRef = useRef<{[panelId: string]: any}>({});
  
  // FIXED: Panel-specific connection references
  const currentSSERef = useRef<{[panelId: string]: SSE | null}>({});
  
  // FIXED: Panel-specific active state with cross-contamination protection
  const isPanelActive = useRef<{[panelId: string]: boolean}>({});
  
  // NEW: Panel-specific message isolation
  const panelMessageBuffer = useRef<{[panelId: string]: string}>({});
  const panelLastUpdate = useRef<{[panelId: string]: number}>({});
  
  // Initialize this panel as active with protective measures
  isPanelActive.current[panelId.current] = true;
  panelMessageBuffer.current[panelId.current] = '';
  panelLastUpdate.current[panelId.current] = Date.now();
  
  // CRITICAL: Panel isolation guardian - prevents cross-panel interference
  const guardPanelIntegrity = (context: string) => {
    const thisPanel = panelId.current;
    const now = Date.now();
    
    if (!isPanelActive.current[thisPanel]) {
      console.warn(`🚨 [PANEL GUARD] ${context}: Panel ${thisPanel} is not active but trying to process!`);
      return false;
    }
    
    // Check for rapid state changes that might indicate cross-contamination
    const lastUpdate = panelLastUpdate.current[thisPanel] || 0;
    if (now - lastUpdate < 50) { // Less than 50ms since last update
      console.warn(`🚨 [PANEL GUARD] ${context}: Rapid updates detected on ${thisPanel} - possible contamination`);
    }
    
    panelLastUpdate.current[thisPanel] = now;
    return true;
  };

  // 🎯 CLEAN INTERFERENCE MONITOR - Watch for the disappearing text issue
  useEffect(() => {
    let monitorInterval: NodeJS.Timeout;
    
    if (detectedComparisonMode) {
      monitorInterval = setInterval(() => {
        const leftPanel = document.querySelector('[data-panel="0"]') || document.querySelector('[data-panel="left"]');
        const rightPanel = document.querySelector('[data-panel="1"]') || document.querySelector('[data-panel="right"]');
        
        const leftLength = leftPanel?.textContent?.length || 0;
        const rightLength = rightPanel?.textContent?.length || 0;
        
        // Only log significant changes or when text disappears
        const leftChanged = Math.abs(leftLength - (window.lastLeftLength || 0)) > 10;
        const rightChanged = Math.abs(rightLength - (window.lastRightLength || 0)) > 10;
        const textDisappeared = (window.lastRightLength || 0) > 100 && rightLength < 50;
        
        if (leftChanged || rightChanged || textDisappeared) {
          console.log(`🎯 [PANEL MONITOR] ${new Date().toLocaleTimeString()}`, {
            LEFT: `${leftLength} chars`,
            RIGHT: `${rightLength} chars`,
            textDisappeared: textDisappeared ? '⚠️ RIGHT PANEL TEXT DISAPPEARED!' : false
          });
          
          if (textDisappeared) {
            console.error(`🚨 [INTERFERENCE DETECTED] Right panel text vanished! Was ${window.lastRightLength}, now ${rightLength}`);
          }
        }
        
        window.lastLeftLength = leftLength;
        window.lastRightLength = rightLength;
      }, 500); // Check every 500ms
    }
    
    return () => {
      if (monitorInterval) clearInterval(monitorInterval);
    };
  }, [detectedComparisonMode]);
  
  // FIXED: Panel-specific timeout clearing
  const clearPanelTimeouts = (targetPanelId: string): void => {
    if (retryTimeoutRef.current[targetPanelId]) {
      clearTimeout(retryTimeoutRef.current[targetPanelId]);
      delete retryTimeoutRef.current[targetPanelId];
    }
    if (connectionTimeoutRef.current[targetPanelId]) {
      clearTimeout(connectionTimeoutRef.current[targetPanelId]);
      delete connectionTimeoutRef.current[targetPanelId];
    }
  };
  // ===== END PANEL ISOLATION FIXES =====
  
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

  // FIXED: Move initialization logging to useEffect to prevent re-renders
  useEffect(() => {
    // PANEL ISOLATION SUMMARY - Clean logging
    console.log(`🎯 [PANEL INIT] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'} Panel`, {
      model: submission?.conversation?.model,
      panelId: panelId.current.split('-')[0], // Just LEFT/RIGHT
      hasSubmission: !!submission,
    });
  }, []); // Only run once on mount

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

  // FIXED: Move submission change logging to prevent excessive logging
  useEffect(() => {
    // Only log if there's actually a meaningful change
    const hasRealSubmission = submission && Object.keys(submission).length > 0;
    if (hasRealSubmission) {
      console.log(`🎯 [SUBMISSION] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'}`, {
        model: submission?.conversation?.model,
        endpoint: submission?.conversation?.endpoint,
      });
    }
  }, [submission?.conversation?.conversationId, submission?.conversation?.model]); // Only trigger on meaningful changes

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

  // FIXED: Handle retry logic with panel isolation
  const handleRetry = (
    errorReason: string, 
    currentAttempt: number,
    payloadData: any,
    payload: TPayload,
    userMessage: TMessage
  ): void => {
    const thisPanel = panelId.current;
    
    if (!isPanelActive.current[thisPanel]) {
      console.log(`[useSSE] Panel ${thisPanel} is inactive, skipping retry`);
      return;
    }
    
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
    
    // FIXED: Panel-specific retry timeout
    retryTimeoutRef.current[thisPanel] = setTimeout(() => {
      if (!isPanelActive.current[thisPanel]) {
        console.log(`[useSSE] Panel ${thisPanel} became inactive during retry delay`);
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

  // Enhanced SSE creation with retry logic and panel isolation
  const createSSEConnection = (
    payloadData: any,
    payload: TPayload,
    userMessage: TMessage,
    attempt: number = 0
  ): SSE => {
    const thisPanel = panelId.current;
    
    if (!isPanelActive.current[thisPanel]) {
      console.log(`[useSSE] Panel ${thisPanel} is inactive, not creating connection`);
      throw new Error('Panel is inactive');
    }
    
    const newConnectionId = `${isAddedRequest ? 'COMP' : 'DEFACTS'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    connectionId.current = newConnectionId;
    
    console.log(`🔌 [CONNECTION] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'} Panel`, {
      model: payload?.model,
      connectionId: newConnectionId.split('-')[0], // Short ID
    });
    
    // Create debug info for this connection
    const debugInfo = {
      requestId: currentRequestId.current || newConnectionId,
      panel: isAddedRequest ? 'RIGHT' : 'LEFT',
      model: payload?.model || 'unknown',
      endpoint: payload?.endpoint || 'unknown',
      timestamp: Date.now(),
      payload: payload,
      sseEvents: [],
    } as const;
    
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
    
    // FIXED: Clear only this panel's timeouts
    clearPanelTimeouts(thisPanel);
    
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
    
    // FIXED: Store connection in panel-specific ref
    currentSSERef.current[thisPanel] = sse;
    let textIndex: number | null = null;
    let hasReceivedData = false;

    // FIXED: Set panel-specific connection timeout
    connectionTimeoutRef.current[thisPanel] = setTimeout(() => {
      if (!isPanelActive.current[thisPanel]) {
        console.log(`[useSSE] Panel ${thisPanel} inactive, skipping timeout`);
        return;
      }
      
      console.warn(`⏰ [useSSE] Connection timeout reached for panel ${thisPanel}`);
      addSSEEvent('timeout', { readyState: sse.readyState });
      
      if (sse.readyState === 0 || sse.readyState === 1) {
        try {
          sse.close();
        } catch (error) {
          console.error(`❌ [useSSE] Error closing timed out connection for ${thisPanel}:`, error);
        }
        handleRetry('Connection timeout', attempt, payloadData, payload, userMessage);
      }
    }, RETRY_CONFIG.connectionTimeoutMs);

    // Set up SSE event listeners
    sse.addEventListener('open', () => {
      addSSEEvent('open', { readyState: sse.readyState });
      console.log(`✅ [CONNECTED] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'} Panel`);
      
      // FIXED: Clear only this panel's timeouts
      clearPanelTimeouts(thisPanel);
      setAbortScroll(false);
      setRetryCount(0);
      setIsRetrying(false);
      hasReceivedData = false;
    });

    sse.addEventListener('error', async (e: SSEErrorEvent) => {
      if (!isPanelActive.current[thisPanel]) {
        console.log(`[useSSE] Panel ${thisPanel} was cancelled, ignoring error`);
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
      
      console.error(`❌ [ERROR] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'} Panel`, {
        status: e.responseCode || e.statusCode,
        hasData: hasReceivedData
      });

      // FIXED: Clear only this panel's timeouts
      clearPanelTimeouts(thisPanel);

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
      if (!isPanelActive.current[thisPanel]) {
        console.log(`[useSSE] Panel ${thisPanel} inactive, ignoring attachment`);
        return;
      }
      
      hasReceivedData = true;
      addSSEEvent('attachment', { dataLength: e.data?.length || 0 });
      
      try {
        const data = JSON.parse(e.data);
        attachmentHandler({ data, submission: submission as EventSubmission });
      } catch (error) {
        console.error('❌ [useSSE] Error parsing attachment:', error);
      }
    });

    sse.addEventListener('message', (e: MessageEvent) => {
      const thisPanel = panelId.current;
      
      if (!isPanelActive.current[thisPanel]) {
        console.log(`[useSSE] Panel ${thisPanel} inactive, ignoring message`);
        return;
      }
      
      // CRITICAL: Guard against cross-panel interference
      if (!guardPanelIntegrity('MESSAGE_HANDLER')) {
        console.error(`🚨 [CROSS-PANEL BLOCK] Blocked message processing for ${thisPanel}`);
        return;
      }
      
      hasReceivedData = true;
      addSSEEvent('message', { 
        dataLength: e.data?.length,
        dataPreview: e.data?.substring(0, 100),
      });
      
      // Enhanced panel-specific logging
      console.log(`📨 [${thisPanel}] MESSAGE RECEIVED:`, {
        panel: isAddedRequest ? 'RIGHT' : 'LEFT',
        model: payload?.model,
        dataLength: e.data?.length,
        connectionId: connectionId.current,
        timestamp: Date.now(),
        preview: e.data?.substring(0, 100)
      });
      
      // CAPTURE RAW CHATGPT RESPONSES
      if (payload?.model === 'gpt-4o' || payload?.model?.includes('gpt')) {
        // Store EVERYTHING
        if (!window.CHATGPT_RAW_STREAM) {
          window.CHATGPT_RAW_STREAM = [];
        }
        
        const rawEntry = {
          timestamp: Date.now(),
          connectionId: connectionId.current,
          panelId: thisPanel,
          model: payload.model,
          raw: e.data,
          length: e.data?.length || 0,
          type: e.type,
          origin: e.origin,
          lastEventId: e.lastEventId,
        };
        
        window.CHATGPT_RAW_STREAM.push(rawEntry);
        
        // Log immediately for real-time debugging
        console.log('🤖 [CHATGPT RAW]:', {
          ...rawEntry,
          preview: e.data?.substring(0, 200),
        });
        
        // Keep only last 500 messages to avoid memory issues
        if (window.CHATGPT_RAW_STREAM.length > 500) {
          window.CHATGPT_RAW_STREAM = window.CHATGPT_RAW_STREAM.slice(-500);
        }
      }
      
      // Real-time monitoring
      if (window.CHATGPT_MONITOR_ENABLED && (payload?.model === 'gpt-4o' || payload?.model?.includes('gpt'))) {
        console.log(`🤖 [GPT LIVE ${new Date().toLocaleTimeString()}]:`, {
          dataLength: e.data?.length,
          preview: e.data?.substring(0, 150),
          hasData: e.data?.startsWith('data:'),
          isDone: e.data?.includes('[DONE]'),
        });
      }
      
      // Enhanced message debug for DeFacts
      if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
        console.log(`🔍 [DeFacts RAW MESSAGE]:`, {
          connectionId: connectionId.current,
          panelId: thisPanel,
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
      let isOpenAIFormat = false;
      let isCustomFormat = false;
      
      try {
        // First, check if it's standard OpenAI SSE format (data: {...})
        if (e.data.startsWith('data: ')) {
          const jsonStr = e.data.substring(6).trim();
          
          if (jsonStr === '[DONE]') {
            // OpenAI completion signal
            console.log('🤖 [GPT] Received [DONE] signal');
            return;
          }
          
          data = JSON.parse(jsonStr);
          isOpenAIFormat = true;
          
          // Log format detection
          console.log('🤖 [GPT FORMAT] Standard OpenAI format detected', {
            hasChoices: !!data.choices,
            hasDelta: !!data.choices?.[0]?.delta,
          });
          
        } else {
          // Try parsing as custom format
          data = JSON.parse(e.data);
          
          // Check if it's the custom event format
          if (data.event || data.message || data.final) {
            isCustomFormat = true;
            console.log('🤖 [GPT FORMAT] Custom event format detected', {
              event: data.event,
              hasMessage: !!data.message,
              isFinal: !!data.final,
            });
          }
        }
        
        // HANDLE STANDARD OPENAI FORMAT
        if (isOpenAIFormat && data.choices?.[0]) {
          const choice = data.choices[0];
          
          // Delta content (streaming)
          if (choice.delta?.content) {
            // Transform to your expected format
            data = {
              event: 'on_message_delta',
              data: {
                delta: {
                  content: [{
                    type: 'text',
                    text: choice.delta.content
                  }]
                }
              }
            };
            
            console.log('🤖 [GPT OPENAI DELTA]:', {
              text: choice.delta.content,
              length: choice.delta.content.length,
            });
          }
          
          // Completion
          if (choice.finish_reason) {
            console.log('🤖 [GPT OPENAI COMPLETE]:', {
              finishReason: choice.finish_reason,
              hasMessage: !!choice.message,
            });
          }
        }
        
        // HANDLE CUSTOM EVENT FORMAT
        else if (isCustomFormat) {
          // Already in the format we expect, but let's ensure consistency
          if (data.event === 'on_message_delta' && data.data) {
            // Format is already correct
            console.log('🤖 [GPT CUSTOM DELTA]:', {
              hasDelta: !!data.data.delta,
              deltaKeys: data.data.delta ? Object.keys(data.data.delta) : [],
            });
          } else if (data.message) {
            // Initial message creation
            data = {
              created: true,
              message: data.message
            };
          } else if (data.event === 'on_run_step') {
            // Pass through run step events
            data = {
              event: 'on_run_step',
              data: data.data
            };
          }
          // Keep final messages as-is
          else if (data.final) {
            // This is already in the correct format
            console.log('🤖 [GPT FINAL]:', {
              hasResponseMessage: !!data.responseMessage,
              responseLength: data.responseMessage?.text?.length || 0,
            });
          }
        }
        
        // Log unrecognized formats for debugging
        if (!isOpenAIFormat && !isCustomFormat) {
          console.warn('⚠️ [GPT] Unrecognized message format:', {
            dataKeys: Object.keys(data),
            preview: JSON.stringify(data).substring(0, 200),
          });
        }
        
        // Enhanced parsed message debug for DeFacts
        if (payload?.model === 'DeFacts') {
          console.log(`🔍 [DeFacts PARSED MESSAGE]:`, {
            connectionId: connectionId.current,
            panelId: thisPanel,
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
        panelId: thisPanel
      });

      try {
        if (data.final != null) {
          if (!guardPanelIntegrity('FINAL_MESSAGE')) return;
          console.log(`🏁 [${thisPanel}] FINAL MESSAGE - ${payload?.model}`);
          handleFinalMessage(data);
        } else if (data.created != null) {
          if (!guardPanelIntegrity('CREATED_MESSAGE')) return;
          console.log(`🆕 [${thisPanel}] CREATED MESSAGE - ${payload?.model}`);
          handleCreatedMessage(data);
        } else if (data.event != null) {
          if (!guardPanelIntegrity('EVENT_MESSAGE')) return;
          console.log(`📡 [${thisPanel}] EVENT MESSAGE - ${data.event} - ${payload?.model}`);
          handleEventMessage(data);
        } else if (data.sync != null) {
          if (!guardPanelIntegrity('SYNC_MESSAGE')) return;
          console.log(`🔄 [${thisPanel}] SYNC MESSAGE - ${payload?.model}`);
          handleSyncMessage(data);
        } else if (data.type != null) {
          if (!guardPanelIntegrity('CONTENT_MESSAGE')) return;
          console.log(`📝 [${thisPanel}] CONTENT MESSAGE - ${payload?.model}`);
          handleContentMessage(data, textIndex);
        } else {
          if (!guardPanelIntegrity('STANDARD_MESSAGE')) return;
          console.log(`📄 [${thisPanel}] STANDARD MESSAGE - ${payload?.model}`);
          handleStandardMessage(data);
        }
      } catch (error) {
        console.error('❌ [useSSE] Error processing message event:', error);
        debugComparison('SSE_MESSAGE_PROCESSING_ERROR', {
          isAddedRequest,
          runIndex,
          error: (error as Error).message,
          data: data,
          panelId: thisPanel
        });
      }
    });

    sse.addEventListener('cancel', async () => {
      addSSEEvent('cancel', {});
      
      // FIXED: Set only this panel as inactive
      isPanelActive.current[thisPanel] = false;
      clearPanelTimeouts(thisPanel);
      
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
      registerDeFactsEventHandlers(sse, sseDebugger, thisPanel);
    }

    // Start the stream
    setIsSubmitting(true);
    setIsSubmittingLocal(true);
    
    try {
      sse.stream();
      console.log(`🚀 [STREAM START] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'} Panel`);
      
      // Check readyState after 1 second
      setTimeout(() => {
        console.log(`[SSE DEBUG] ReadyState after 1s for ${thisPanel}:`, {
          readyState: currentSSERef.current[thisPanel]?.readyState,
          model: payload?.model,
          isActive: isPanelActive.current[thisPanel]
        });
      }, 1000);
    } catch (error) {
      console.error('❌ [useSSE] Error starting stream:', error);
      handleRetry('Stream start failed', attempt, payloadData, payload, userMessage);
    }

    return sse;

    // Helper functions for message handling
    function handleFinalMessage(data: any) {
      const thisPanel = panelId.current;
      const currentConnectionId = connectionId.current;
      const modelNeedsFix = payload?.model === 'DeFacts' || 
                          payload?.model === 'DeNews' || 
                          payload?.model === 'DeResearch';
      
      // 🎯 CLEAN SUMMARY - Key panel events only
      const panelType = payload?.model?.toLowerCase().includes('perplexity') ? '🟣 PERPLEXITY' : '🔴 DEFACTS';
      const side = isAddedRequest ? 'RIGHT' : 'LEFT';
      
      console.log(`${panelType} FINAL - ${side}`, {
        hasText: !!(data.responseMessage?.text),
        textLength: data.responseMessage?.text?.length || 0,
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Store the final message in panel buffer to prevent cross-contamination
      if (data.responseMessage?.text) {
        panelMessageBuffer.current[thisPanel] = data.responseMessage.text;
        console.log(`💾 [${side}] STORED MESSAGE: "${data.responseMessage.text.substring(0, 50)}..." (${data.responseMessage.text.length} chars)`);
      } else {
        console.warn(`⚠️ [${side}] NO TEXT IN FINAL MESSAGE!`);
      }
      
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
        
        // Create responseMessage if it doesn't exist
        if (!data.responseMessage && accumulatedText) {
          data.responseMessage = {
            messageId: data.messageId || `msg-${currentConnectionId}`,
            conversationId: data.conversationId || submission?.conversation?.conversationId,
            text: '',
            content: []
          };
        }
        
        // Enhanced response fixing logic
        if (data.responseMessage) {
          // Check if we need to fix empty response
          const hasEmptyText = !data.responseMessage.text || data.responseMessage.text.trim() === '';
          
          if (hasEmptyText && !accumulatedText) {
            // No text at all - check if there's content elsewhere
            let alternativeText = '';
            
            // Try to find text in alternative locations
            if (data.title && data.title !== 'Understanding The Concept Of Beta') {
              alternativeText = data.title;
              console.log('🔧 [DEFACTS FIX] Using title as response text:', alternativeText);
            } else if (data.content) {
              alternativeText = typeof data.content === 'string' ? data.content : JSON.stringify(data.content);
              console.log('🔧 [DEFACTS FIX] Using content field as response text');
            } else if (data.response) {
              alternativeText = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);
              console.log('🔧 [DEFACTS FIX] Using response field as response text');
            }
            
            if (alternativeText) {
              console.warn(`✅ [ALTERNATIVE TEXT FOUND] ${currentConnectionId}: Using alternative text (${alternativeText.length} chars)`);
              data.responseMessage.text = alternativeText;
              data.responseMessage.content = [{
                type: 'text',
                text: alternativeText
              }];
            } else {
              // Still no text - add error message but indicate it's a DeFacts API issue
              console.error(`❌ [DEFACTS API ISSUE] ${currentConnectionId}: DeFacts API returned empty response`);
              data.responseMessage.text = '[Error: DeFacts API returned empty response. This may be a service configuration issue.]';
              data.responseMessage.error = true;
              data.responseMessage.content = [{
                type: 'text',
                text: '[Error: DeFacts API returned empty response. This may be a service configuration issue.]'
              }];
            }
          } else if (accumulatedText && hasEmptyText) {
            // We have accumulated text but responseMessage.text is empty
            console.warn(`✅ [FIX APPLIED] ${currentConnectionId}: Injecting ${accumulatedText.length} chars from accumulated deltas`);
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
          } else if (!hasEmptyText) {
            console.log(`✅ [DEFACTS SUCCESS] ${currentConnectionId}: Response text found (${data.responseMessage.text.length} chars)`);
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
      
      // Try multiple ways to find the request
      let request = REQUEST_TRACKER.findRequestByMessageId(messageId);
      
      if (!request && currentRequestId.current) {
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
      }
      
      if (request) {
        REQUEST_TRACKER.completeRequest(
          request.id,
          hasText,
          responseLength,
          !hasText ? 'DeFacts API returned empty response' : undefined
        );
      }
      
      logCacheState('BEFORE_FINAL');
      
      // FIXED: Clear only this panel's timeouts
      clearPanelTimeouts(thisPanel);
      clearDraft(submission?.conversation?.conversationId);
      const { plugins } = data;
      
      // FIXED: Increased delay for DeFacts to prevent race conditions
      const cleanupDelay = payload?.model === 'DeFacts' ? 5000 : 
                          isAddedRequest ? 0 : 500; // DeFacts gets 5 seconds buffer
      
      setTimeout(() => {
        // Extra safety check for DeFacts
        if (payload?.model === 'DeFacts') {
          console.log(`🛡️ [DEFACTS PROTECTION] Waited ${cleanupDelay}ms before final processing`);
        }
        
        if (isPanelActive.current[thisPanel]) {
          finalHandler(data, { ...submission, plugins } as EventSubmission);
          (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
        } else {
          console.log(`[useSSE] Panel ${thisPanel} became inactive, skipping final handler`);
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
          panelId: thisPanel
        });
      }
      
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
    }

    function handleSyncMessage(data: any) {
      const runId = v4();
      setActiveRunId(runId);
      syncHandler(data, { ...submission, userMessage } as EventSubmission);
    }

    function handleContentMessage(data: any, textIndex: number | null) {
      const { text, index } = data;
      if (text != null && index !== textIndex) {
        textIndex = index;
      }

      contentHandler({ data, submission: submission as EventSubmission });
    }

    function handleStandardMessage(data: any) {
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

    // FIXED: Panel isolation in custom event handlers
    function registerDeFactsEventHandlers(sse: SSE, sseDebugger: any, panelId: string) {
      const possibleEventNames = [
        'data', 'update', 'chunk', 'stream', 'delta', 'text', 
        'content', 'response', 'completion', 'message_delta',
        'text_delta', 'assistant_message', 'ai_response'
      ];
      
      possibleEventNames.forEach(eventName => {
        sse.addEventListener(eventName, (e: any) => {
          if (!isPanelActive.current[panelId]) {
            return;
          }
          
          console.log(`🔴 [DEFACTS CUSTOM EVENT: ${eventName}] Panel ${panelId}:`, e.data || e);
          sseDebugger.logRawEvent(eventName, e.data || e);
          
          try {
            const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (data && (data.text || data.content || data.delta)) {
              console.log(`🔴 [DEFACTS] Processing ${eventName} as message on panel ${panelId}`);
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
        setIsSubmitting(false);
        setIsSubmittingLocal(false);
        setShowStopButton(false);
      }, 30000); // 30 second timeout
      
      return () => clearTimeout(failsafeTimeout);
    }
  }, [isSubmittingLocal, setIsSubmitting, setShowStopButton]);

  // FIXED: Panel-specific cleanup effect
  useEffect(() => {
    const thisPanel = panelId.current;
    
    return () => {
      // FIXED: Mark only this panel as inactive
      isPanelActive.current[thisPanel] = false;
      
      // FIXED: Clear only this panel's timeouts
      clearPanelTimeouts(thisPanel);
      
      // FIXED: Close only this panel's connection
      const thisPanelSSE = currentSSERef.current[thisPanel];
      if (thisPanelSSE) {
        try {
          thisPanelSSE.close();
        } catch (error) {
          console.error(`❌ [useSSE] Error closing connection for ${thisPanel}:`, error);
        }
        delete currentSSERef.current[thisPanel];
      }
      
      // Clean up connection-specific data
      const currentConnectionId = connectionId.current;
      if (currentConnectionId) {
        console.log(`🔚 [UNMOUNT CLEANUP] Removing connection: ${currentConnectionId} from panel: ${thisPanel}`);
        delete deltaAccumulator.current[currentConnectionId];
        delete deltaCounter.current[currentConnectionId];
        delete messageStartTime.current[currentConnectionId];
      }
    };
  }, []);

  // Effect for handling submissions
  useEffect(() => {
    const thisPanel = panelId.current;
    
    if (submission == null || Object.keys(submission).length === 0) {
      console.log(`[useSSE EFFECT] No submission for panel ${thisPanel}`);
      return;
    }

    console.log(`🎯 [REQUEST START] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'} Panel`, {
      model: submission?.conversation?.model,
      endpoint: submission?.conversation?.endpoint,
    });

    const { userMessage } = submission;
    if (!userMessage) {
      console.error(`No userMessage in submission for panel ${thisPanel}`);
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
      console.error(`❌ [useSSE] Error creating payload for panel ${thisPanel}:`, error);
      setIsSubmitting(false);
      setIsSubmittingLocal(false);
      return;
    }

    // FIXED: Reset only this panel's active state
    isPanelActive.current[thisPanel] = true;
    setRetryCount(0);
    setIsRetrying(false);

    let sse: SSE;
    try {
      sse = createSSEConnection(payloadData, payload, userMessage, 0);
    } catch (error) {
      console.error(`❌ [useSSE] Failed to create initial connection for panel ${thisPanel}:`, error);
      setIsSubmitting(false);
      setIsSubmittingLocal(false);
      return;
    }

    // Cleanup function
    return () => {
      const isCancelled = sse.readyState <= 1;
      
      // FIXED: Mark only this panel as inactive
      isPanelActive.current[thisPanel] = false;
      
      // FIXED: Clear only this panel's timeouts
      clearPanelTimeouts(thisPanel);
      
      // FIXED: Remove only this panel's connection reference
      if (currentSSERef.current[thisPanel]) {
        delete currentSSERef.current[thisPanel];
      }
      
      try {
        sse.close();
      } catch (error) {
        console.error(`❌ [useSSE] Error closing connection in cleanup for panel ${thisPanel}:`, error);
      }
      
      if (isCancelled) {
        try {
          const e = new Event('cancel');
          /* @ts-ignore */
          sse.dispatchEvent(e);
        } catch (error) {
          console.error(`❌ [useSSE] Error dispatching cancel event for panel ${thisPanel}:`, error);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);

  // FIXED: Reduce lifecycle logging verbosity
  useEffect(() => {
    const thisPanel = panelId.current;
    
    // Only log mount, not every render
    console.log(`🎯 [PANEL MOUNT] ${isAddedRequest ? '🟣 RIGHT' : '🔴 LEFT'}`, {
      panelId: thisPanel.split('-')[0], // Just LEFT/RIGHT
      model: submission?.conversation?.model,
    });
    
    // Install clean monitoring functions
    if (typeof window !== 'undefined' && !window.PANEL_MONITOR_INSTALLED) {
      window.PANEL_MONITOR_INSTALLED = true;
      
      // 🎯 CLEAN SUMMARY COMMAND
      window.watchInterference = () => {
        console.log('\n🎯 INTERFERENCE MONITOR ACTIVE - Watching for text disappearing...');
        window.INTERFERENCE_WATCH = setInterval(() => {
          const left = document.querySelector('[data-panel="0"]')?.textContent?.length || 0;
          const right = document.querySelector('[data-panel="1"]')?.textContent?.length || 0;
          
          const leftText = document.querySelector('[data-panel="0"]')?.textContent?.substring(0, 50) || '';
          const rightText = document.querySelector('[data-panel="1"]')?.textContent?.substring(0, 50) || '';
          
          // Detect significant changes
          const leftDelta = left - (window.lastLeft || 0);
          const rightDelta = right - (window.lastRight || 0);
          
          if (Math.abs(leftDelta) > 10 || Math.abs(rightDelta) > 10) {
            console.log(`📊 [${new Date().toLocaleTimeString()}]`, {
              '🔴 LEFT': `${left} chars (${leftDelta > 0 ? '+' : ''}${leftDelta})`,
              '🟣 RIGHT': `${right} chars (${rightDelta > 0 ? '+' : ''}${rightDelta})`,
              leftPreview: leftText.includes('galaxy') ? leftText : '[other content]',
              rightPreview: rightText.includes('galaxy') ? rightText : '[other content]'
            });
            
            // Alert on text disappearing
            if (window.lastRight > 100 && right < 50) {
              console.error('🚨 RIGHT PANEL TEXT DISAPPEARED!', {
                was: window.lastRight,
                now: right,
                likely: 'Cross-panel interference detected'
              });
            }
          }
          
          window.lastLeft = left;
          window.lastRight = right;
        }, 300);
        
        console.log('Use: clearInterval(window.INTERFERENCE_WATCH) to stop');
      };
      
      console.log('\n🎯 CLEAN MONITOR COMMANDS:');
      console.log('- watchInterference()  // Start monitoring text changes');
      console.log('- clearInterval(window.INTERFERENCE_WATCH)  // Stop monitoring');