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
    console.log(`🔄 [useSSE] Handling retry for: ${errorReason}`);
    
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
    console.log(`🔄 [useSSE] Creating connection (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1})`);
    
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
      console.log('✅ [useSSE] Connection opened successfully');
      clearTimeouts();
      setAbortScroll(false);
      setRetryCount(0);
      setIsRetrying(false);
      hasReceivedData = false;
      
      console.log('📡 [useSSE] Connection details:', {
        url: payloadData.server,
        readyState: sse.readyState,
        attempt: attempt + 1,
      });
    });

    // Enhanced error handling with retry logic
    sse.addEventListener('error', async (e: MessageEvent) => {
      console.error('❌ [useSSE] Error in server stream');
      console.error('🔍 [useSSE] Error event details:', {
        data: e.data,
        type: e.type,
        hasReceivedData,
        attempt: attempt + 1,
        /* @ts-ignore */
        responseCode: e.responseCode,
        /* @ts-ignore */
        statusCode: e.statusCode,
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

    // All other event listeners with error handling
    sse.addEventListener('attachment', (e: MessageEvent) => {
      hasReceivedData = true;
      console.log('📎 [useSSE] Attachment event received:', e.data);
      try {
        const data = JSON.parse(e.data);
        attachmentHandler({ data, submission: submission as EventSubmission });
      } catch (error) {
        console.error('❌ [useSSE] Error parsing attachment:', error);
      }
    });

    sse.addEventListener('message', (e: MessageEvent) => {
      hasReceivedData = true;
      console.log('💬 [useSSE] Message event received:', e.data?.substring(0, 100) + '...');
      
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch (error) {
        console.error('❌ [useSSE] Error parsing message:', error);
        console.error('Raw message data:', e.data);
        return;
      }

      try {
        if (data.final != null) {
          console.log('✅ [useSSE] Final message received:', data);
          clearTimeouts();
          clearDraft(submission?.conversation?.conversationId);
          const { plugins } = data;
          finalHandler(data, { ...submission, plugins } as EventSubmission);
          (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
          console.log('final', data);
          return;
        } else if (data.created != null) {
          console.log('🆕 [useSSE] Created event:', data);
          const runId = v4();
          setActiveRunId(runId);
          
          // Don't mutate userMessage directly
          const updatedUserMessage = {
            ...userMessage,
            ...data.message,
            overrideParentMessageId: userMessage.overrideParentMessageId,
          };

          createdHandler(data, { ...submission, userMessage: updatedUserMessage } as EventSubmission);
        } else if (data.event != null) {
          console.log('📊 [useSSE] Step event:', data);
          stepHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.sync != null) {
          console.log('🔄 [useSSE] Sync event:', data);
          const runId = v4();
          setActiveRunId(runId);
          syncHandler(data, { ...submission, userMessage } as EventSubmission);
        } else if (data.type != null) {
          console.log('📝 [useSSE] Content event:', { type: data.type, index: data.index });
          const { text, index } = data;
          if (text != null && index !== textIndex) {
            textIndex = index;
          }

          contentHandler({ data, submission: submission as EventSubmission });
        } else {
          console.log('📨 [useSSE] Standard message:', data);
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
      }
    });

    sse.addEventListener('cancel', async () => {
      console.log('🚫 [useSSE] Cancel event received');
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

    // Add state change listener for debugging
    /* @ts-ignore */
    if (sse.addEventListener) {
      sse.addEventListener('readystatechange', () => {
        /* @ts-ignore */
        console.log('🔄 [useSSE] ReadyState changed:', sse.readyState);
      });
    }

    setIsSubmitting(true);
    console.log('🚀 [useSSE] Starting stream...');
    
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
      clearTimeouts();
      if (currentSSERef.current) {
        try {
          currentSSERef.current.close();
        } catch (error) {
          console.error('❌ [useSSE] Error closing connection on unmount:', error);
        }
        currentSSERef.current = null;
      }
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
    console.log('🚀 [useSSE] Sending request:', {
      model: payload?.model,
      endpoint: payload?.endpoint,
      isAddedRequest,
      conversationId: submission?.conversation?.conversationId,
      userMessage: userMessage?.text?.substring(0, 50) + '...',
      retryEnabled: true,
      maxRetries: RETRY_CONFIG.maxRetries,
    });
    
    console.log('📦 [useSSE] Full payload:', JSON.stringify(payload, null, 2));
    console.log('🔗 [useSSE] Server URL:', payloadData.server);

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
      console.log('🛑 [useSSE] Cleanup - closing connection', { 
        readyState: sse.readyState, 
        isCancelled,
        retryCount,
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