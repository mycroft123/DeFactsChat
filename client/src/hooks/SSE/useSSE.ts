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
      
      // Special logging for DeFacts
      if (model === 'DeFacts' || model?.toLowerCase().includes('defacts')) {
        console.log(`🔴 [DEFACTS RAW ${eventType}]:`, data);
        
        // Log the structure deeply
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
          
          // Deep inspection of nested structures
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
  
  // Special handling for delta content
  if (data?.delta) {
    console.log('📝 Delta content detected:', {
      hasContent: !!data.delta.content,
      contentType: typeof data.delta.content,
      contentLength: typeof data.delta.content === 'string' ? data.delta.content.length : 0,
      contentPreview: typeof data.delta.content === 'string' ? data.delta.content.substring(0, 100) + '...' : `Type: ${typeof data.delta.content}`,
      deltaKeys: Object.keys(data.delta)
    });
  }
  
  // Track message building
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
  // Direct text in delta
  if (data?.delta?.text) {
    return data.delta.text;
  }
  
  // Content array format (DeFacts uses this)
  if (data?.delta?.content) {
    if (Array.isArray(data.delta.content)) {
      const textContent = data.delta.content.find((item: any) => item?.type === 'text');
      if (textContent?.text) {
        return textContent.text;
      }
    } else if (typeof data.delta.content === 'string') {
      // Sometimes content might be a direct string
      return data.delta.content;
    }
  }
  
  // Check nested data structure
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
  
  // Check for message_delta event structure
  if (data?.data?.delta?.text) {
    return data.data.delta.text;
  }
  
  // DeFacts might use different field names
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

type ChatHelpers = Pick <
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
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffFactor: 2,
  retryableStatuses: [0, 408, 429, 500, 502, 503, 504],
  connectionTimeoutMs: 30000, // 30 seconds
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
): UseSSEReturn {
  
  // Track connection instances and cache state
  const connectionId = useRef<string>('');
  const previousCacheState = useRef<any>({});
  
  // Log cache state changes
  const logCacheState = (context: string) => {
    // You'll need to adapt this based on your actual cache implementation
    // This is just an example - replace with your actual cache access
    const currentCache = {
      // Example: check Redux store
      // messages: store.getState().messages,
      // Or check local message map
      // messageMap: messageHandler.messageMap?.current,
      // Or check conversation state
      // conversation: getConversation(),
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
    hasSubmission: !!submission,
    submissionEndpoint: submission?.conversation?.endpoint,
    submissionModel: submission?.conversation?.model,
    previousConnectionId: connectionId.current
  });

  const genTitle = useGenTitleMutation();
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();
  const [completed, setCompleted] = useState(new Set());
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  // Add retry state - using any type for maximum compatibility
  const [retryCount, setRetryCount] = useState<number>(0);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const retryTimeoutRef = useRef<any>(null);
  const connectionTimeoutRef = useRef<any>(null);
  const currentSSERef = useRef<SSE | null>(null);

  // Track delta message accumulation for debugging
  const deltaAccumulator = useRef<{[messageId: string]: string}>({});
  const messageStartTime = useRef<{[messageId: string]: number}>({});
  const deltaCounter = useRef<{[messageId: string]: number}>({});

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

  // Handle retry logic - defined before createSSEConnection
  const handleRetry = (
    errorReason: string, 
    currentAttempt: number,
    payloadData: any,
    payload: TPayload,
    userMessage: TMessage
  ): void => {
    debugComparison('RETRY_HANDLER', {
      errorReason,
      currentAttempt,
      isAddedRequest,
      runIndex,
      endpoint: payload?.endpoint,
      model: payload?.model
    });
    
    if (currentAttempt >= RETRY_CONFIG.maxRetries) {
      console.error('❌ [useSSE] Max retries reached, giving up');
      setIsRetrying(false);
      setIsSubmitting(false);
      
      // Show user-friendly error message
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
    // Generate unique connection ID
    const newConnectionId = `${isAddedRequest ? 'COMP' : 'DEFACTS'}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    connectionId.current = newConnectionId;
    
    debugComparison('SSE_CONNECTION_CREATE', {
      attempt: attempt + 1,
      maxRetries: RETRY_CONFIG.maxRetries + 1,
      isAddedRequest,
      runIndex,
      endpoint: payload?.endpoint,
      model: payload?.model,
      serverUrl: payloadData?.server,
      connectionId: newConnectionId
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

    // Create debugger for this connection
    const sseDebugger = createSSEDebugger(
      payload?.model || submission?.conversation?.model || 'unknown',
      isAddedRequest
    );
    
    // Track all event types registered
    const allEventTypes: Set<string> = new Set();
    
    // Override addEventListener to capture all event types
    const originalAddEventListener = sse.addEventListener.bind(sse);
    sse.addEventListener = function(type: string, listener: any, options?: any) {
      if (!allEventTypes.has(type)) {
        allEventTypes.add(type);
        console.log('🔴 [DEFACTS EVENT TYPE REGISTERED]:', type);
      }
      return originalAddEventListener(type, listener, options);
    };
    
    // Log all registered events after 2 seconds
    setTimeout(() => {
      console.log('🔴 [DEFACTS ALL REGISTERED EVENT TYPES]:', Array.from(allEventTypes));
    }, 2000);

    currentSSERef.current = sse;
    let textIndex: number | null = null;
    let hasReceivedData = false;

    // Connection timeout
    connectionTimeoutRef.current = setTimeout(() => {
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

    // Handle successful connection
    sse.addEventListener('open', () => {
      debugComparison('SSE_CONNECTION_OPEN', {
        isAddedRequest,
        runIndex,
        readyState: sse.readyState,
        url: payloadData.server
      });
      
      clearTimeouts();
      setAbortScroll(false);
      setRetryCount(0);
      setIsRetrying(false);
      hasReceivedData = false;
    });

    // Enhanced error handling with retry logic
    sse.addEventListener('error', async (e: MessageEvent) => {
      debugComparison('SSE_ERROR', {
        isAddedRequest,
        runIndex,
        hasReceivedData,
        attempt: attempt + 1,
        /* @ts-ignore */
        responseCode: e.responseCode,
        /* @ts-ignore */
        statusCode: e.statusCode,
        data: e.data
      });

      clearTimeouts();

      /* @ts-ignore */
      const errorStatus = e.responseCode || e.statusCode || e.status;
      
      // Handle 401 errors (token refresh)
      /* @ts-ignore */
      if (e.responseCode === 401) {
        console.log('🔑 [useSSE] 401 error - attempting token refresh');
        try {
          const refreshResponse = await request.refreshToken();
          const newToken = refreshResponse?.token ?? '';
          if (!newToken) {
            throw new Error('Token refresh failed.');
          }
          
          // Update headers and retry
          sse.headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${newToken}`,
          };

          request.dispatchTokenUpdatedEvent(newToken);
          sse.stream();
          return;
        } catch (error) {
          console.error('❌ [useSSE] Token refresh failed:', error);
          // Fall through to normal error handling
        }
      }

      // Check if error is retryable
      if (!hasReceivedData && isRetryableError(e)) {
        console.log('🔄 [useSSE] Error is retryable, attempting retry');
        handleRetry(`Error ${errorStatus}`, attempt, payloadData, payload, userMessage);
        return;
      }

      // Non-retryable error or max retries reached
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
    });

    // All other event listeners with enhanced debugging
    sse.addEventListener('attachment', (e: MessageEvent) => {
      hasReceivedData = true;
      debugComparison('SSE_ATTACHMENT', {
        isAddedRequest,
        runIndex,
        dataLength: e.data?.length || 0
      });
      
      try {
        const data = JSON.parse(e.data);
        attachmentHandler({ data, submission: submission as EventSubmission });
      } catch (error) {
        console.error('❌ [useSSE] Error parsing attachment:', error);
      }
    });

    sse.addEventListener('message', (e: MessageEvent) => {
      hasReceivedData = true;
      
      // Enhanced DeFacts debugging
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
        
        // Try to handle as plain text for DeFacts
        if (payload?.model === 'DeFacts') {
          console.log('🔴 [DEFACTS] Attempting plain text handling');
          data = { text: e.data, type: 'text' };
        } else {
          return;
        }
      }

      // Deep DeFacts inspection
      if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
        sseDebugger.logRawEvent('parsed_message', data);
        
        // Check all possible text locations
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

      // Enhanced message debugging with better text detection
      debugDelta('SSE_MESSAGE_RECEIVED', data, {
        isAddedRequest,
        runIndex,
        connectionId: connectionId.current,
        messageType: data.final ? 'final' : 
                    data.created ? 'created' :
                    data.event ? 'step' :
                    data.sync ? 'sync' :
                    data.type ? 'content' : 'standard',
        hasText: hasTextContent(data),
        textLength: (data.text || data.response || extractDeltaText(data) || '').length
      });

      try {
        if (data.final != null) {
          // CRITICAL FIX: Check if we have accumulated text but final message is empty
          if (payload?.model === 'DeFacts' || !isAddedRequest && runIndex === 0) {
            const messageId = data.responseMessage?.messageId || data.messageId || 'unknown';
            const accumulatedText = deltaAccumulator.current[messageId] || '';
            
            console.log(`🔴 [DEFACTS FINAL CHECK]:`, {
              messageId,
              hasResponseMessage: !!data.responseMessage,
              responseTextLength: data.responseMessage?.text?.length || 0,
              accumulatedLength: accumulatedText.length,
              deltaCount: deltaCounter.current[messageId] || 0,
              responseMessageStructure: data.responseMessage ? Object.keys(data.responseMessage) : 'no response message',
            });
            
            // FIX: If we accumulated text but final message is empty, inject it
            if (accumulatedText && data.responseMessage && !data.responseMessage.text) {
              console.warn(`🔴 [DEFACTS FIX] Injecting accumulated text into empty final message`);
              data.responseMessage.text = accumulatedText;
              
              // Also ensure content array has the text
              if (!data.responseMessage.content || data.responseMessage.content.length === 0) {
                data.responseMessage.content = [{
                  type: 'text',
                  text: accumulatedText
                }];
              }
            }
            
            // Export full debug log for DeFacts
            if (payload?.model === 'DeFacts') {
              sseDebugger.exportLog();
            }
          }
          
          // Log cache state before processing final message
          logCacheState('BEFORE_FINAL');
          
          debugComparison('SSE_FINAL_MESSAGE', {
            isAddedRequest,
            runIndex,
            finalData: data
          });
          
          clearTimeouts();
          clearDraft(submission?.conversation?.conversationId);
          const { plugins } = data;
          finalHandler(data, { ...submission, plugins } as EventSubmission);
          (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
          
          // Log cache state after processing final message
          logCacheState('AFTER_FINAL');
          
          // Clear delta accumulator for this message
          if (data.messageId || data.responseMessage?.messageId) {
            const messageId = data.messageId || data.responseMessage?.messageId;
            delete deltaAccumulator.current[messageId];
            delete messageStartTime.current[messageId];
            delete deltaCounter.current[messageId];
          }
          
          return;
        } else if (data.created != null) {
          debugComparison('SSE_CREATED_EVENT', {
            isAddedRequest,
            runIndex,
            createdData: data
          });
          
          const runId = v4();
          setActiveRunId(runId);
          
          // Track message start time
          if (data.messageId) {
            messageStartTime.current[data.messageId] = Date.now();
            deltaAccumulator.current[data.messageId] = '';
          }
          
          // Don't mutate userMessage directly
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
            hasDeltaContent: !!(data.data?.delta?.content)
          });
          
          // Extract and track delta text for DeFacts messages
          if (data.event === 'on_message_delta' && !isAddedRequest) {
            const deltaText = extractDeltaText(data);
            const messageId = data.data?.id || 'unknown';
            
            // Initialize counter if needed
            if (!deltaCounter.current[messageId]) {
              deltaCounter.current[messageId] = 0;
              deltaAccumulator.current[messageId] = '';
              messageStartTime.current[messageId] = Date.now();
            }
            
            // Simple numbered logging
            if (deltaText) {
              deltaCounter.current[messageId]++;
              deltaAccumulator.current[messageId] += deltaText;
              console.log(`[DEFACTS DELTA] ${deltaCounter.current[messageId]}: "${deltaText}"`);
            } else {
              console.log(`[DEFACTS DELTA] ${deltaCounter.current[messageId] + 1}: NO TEXT FOUND`);
            }
          }
          
          stepHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.sync != null) {
          debugComparison('SSE_SYNC_EVENT', {
            isAddedRequest,
            runIndex,
            syncData: data
          });
          
          const runId = v4();
          setActiveRunId(runId);
          syncHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.type != null) {
          // This is likely a delta/streaming content message
          debugDelta('SSE_CONTENT_EVENT', data, {
            isAddedRequest,
            runIndex,
            contentType: data.type,
            index: data.index,
            hasText: !!data.text,
            textLength: data.text?.length || 0
          });
          
          const { text, index } = data;
          if (text != null && index !== textIndex) {
            textIndex = index;
          }

          // Track delta accumulation
          if (data.messageId && data.text) {
            const safeText = safeGetContent(data, 'text');
            deltaAccumulator.current[data.messageId] = 
              (deltaAccumulator.current[data.messageId] || '') + safeText;
            
            debugDelta('DELTA_ACCUMULATION', {
              messageId: data.messageId,
              newText: safePreview(safeText, 50),
              totalLength: deltaAccumulator.current[data.messageId].length,
              timeElapsed: messageStartTime.current[data.messageId] ? 
                Date.now() - messageStartTime.current[data.messageId] : 'unknown'
            });
          }

          contentHandler({ data, submission: submission as EventSubmission });
        } else {
          debugComparison('SSE_STANDARD_MESSAGE', {
            isAddedRequest,
            runIndex,
            standardData: data
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
          data: data
        });
      }
    });

    sse.addEventListener('cancel', async () => {
      debugComparison('SSE_CANCEL_EVENT', {
        isAddedRequest,
        runIndex
      });
      
      clearTimeouts();
      
      try {
        const streamKey = (submission as TSubmission | null)?.['initialResponse']?.messageId;
        if (completed.has(streamKey)) {
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

    // Catch-all listener for unknown events (especially for DeFacts)
    if (payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts')) {
      // Try common event names that DeFacts might use
      const possibleEventNames = [
        'data', 'update', 'chunk', 'stream', 'delta', 'text', 
        'content', 'response', 'completion', 'message_delta',
        'text_delta', 'assistant_message', 'ai_response'
      ];
      
      possibleEventNames.forEach(eventName => {
        sse.addEventListener(eventName, (e: any) => {
          console.log(`🔴 [DEFACTS CUSTOM EVENT: ${eventName}]:`, e.data || e);
          sseDebugger.logRawEvent(eventName, e.data || e);
          
          // Try to handle as message
          try {
            const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (data && (data.text || data.content || data.delta)) {
              console.log(`🔴 [DEFACTS] Processing ${eventName} as message`);
              // Process as a regular message
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

    // Add state change listener for debugging
    /* @ts-ignore */
    if (sse.addEventListener) {
      sse.addEventListener('readystatechange', () => {
        debugComparison('SSE_READYSTATE_CHANGE', {
          isAddedRequest,
          runIndex,
          /* @ts-ignore */
          readyState: sse.readyState
        });
      });
    }

    setIsSubmitting(true);
    
    debugComparison('SSE_STREAM_START', {
      isAddedRequest,
      runIndex,
      url: payloadData.server
    });
    
    try {
      sse.stream();
    } catch (error) {
      console.error('❌ [useSSE] Error starting stream:', error);
      handleRetry('Stream start failed', attempt, payloadData, payload, userMessage);
    }

    return sse;
  };

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      debugComparison('SSE_CLEANUP', {
        isAddedRequest,
        runIndex
      });
      
      clearTimeouts();
      if (currentSSERef.current) {
        try {
          currentSSERef.current.close();
        } catch (error) {
          console.error('❌ [useSSE] Error closing connection on unmount:', error);
        }
        currentSSERef.current = null;
      }
      
      // Clear delta accumulators
      deltaAccumulator.current = {};
      messageStartTime.current = {};
      deltaCounter.current = {};
    };
  }, []);

  useEffect(() => {
    if (submission == null || Object.keys(submission).length === 0) {
      return;
    }

    const { userMessage } = submission;

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

    // Enhanced debugging
    debugComparison('SSE_REQUEST_START', {
      model: payload?.model,
      endpoint: payload?.endpoint,
      isAddedRequest,
      runIndex,
      conversationId: submission?.conversation?.conversationId,
      userMessagePreview: userMessage?.text?.substring(0, 50) + '...',
      retryEnabled: true,
      maxRetries: RETRY_CONFIG.maxRetries,
      serverUrl: payloadData.server,
      payloadSize: JSON.stringify(payload).length,
      payloadStructure: Object.keys(payload),
      isDeFacts: payload?.model === 'DeFacts' || payload?.model?.toLowerCase().includes('defacts'),
    });

    // Reset retry state
    setRetryCount(0);
    setIsRetrying(false);

    // Create initial connection
    let sse: SSE;
    try {
      sse = createSSEConnection(payloadData, payload, userMessage, 0);
    } catch (error) {
      console.error('❌ [useSSE] Failed to create initial connection:', error);
      setIsSubmitting(false);
      return;
    }

    return () => {
      const isCancelled = sse.readyState <= 1;
      debugComparison('SSE_EFFECT_CLEANUP', {
        isAddedRequest,
        runIndex,
        readyState: sse.readyState,
        isCancelled,
        retryCount
      });
      
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

  // Return retry state and component for UI
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