import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import useChatFunctions from '~/hooks/Chat/useChatFunctions';
import store from '~/store';

// State debugging utility
const debugState = (context: string, data: any) => {
  console.group(`🏛️ STATE DEBUG [${context}]`);
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📊 Data:', data);
  console.groupEnd();
};

// Query key debugging
const debugQueryKeys = (queryClient: any, context: string) => {
  const allQueries = queryClient.getQueryCache().getAll();
  const messageQueries = allQueries.filter(query => query.queryKey[0] === 'messages');
  
  debugState(`QUERY_CACHE_${context}`, {
    totalQueries: allQueries.length,
    messageQueries: messageQueries.length,
    messageQueryKeys: messageQueries.map(q => ({
      key: q.queryKey,
      hasData: !!q.state.data,
      dataLength: Array.isArray(q.state.data) ? q.state.data.length : 'not-array',
      lastUpdate: q.state.dataUpdatedAt
    }))
  });
};

// Safe text extraction - simplified for debugging
const safeExtractText = (msg: any): string => {
  const candidates = [msg.text, msg.content, msg.response];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return '';
};

export default function useAddedHelpers({
  rootIndex = 0,
  currentIndex,
  paramId,
}: {
  rootIndex?: number;
  currentIndex: number;
  paramId?: string;
}) {
  // Track render count and initialization
  const renderCount = useRef(0);
  const initTime = useRef(Date.now());
  renderCount.current++;
  
  debugState('INITIALIZATION', {
    rootIndex,
    currentIndex,
    paramId,
    renderCount: renderCount.current,
    timeSinceInit: Date.now() - initTime.current
  });
  
  const queryClient = useQueryClient();
  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(rootIndex));
  
  const setLatestMultiMessage = useSetRecoilState(store.latestMessageFamily(currentIndex));
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(currentIndex);
  
  // Enhanced conversation debugging
  useEffect(() => {
    debugState('CONVERSATION_CHANGE', {
      currentIndex,
      conversation: {
        id: conversation?.conversationId,
        endpoint: conversation?.endpoint,
        model: conversation?.model,
        isComparison: conversation?.isComparison,
        _isAddedRequest: conversation?._isAddedRequest
      }
    });
  }, [conversation, currentIndex]);
  
  // Query parameter calculation with debugging
  const queryParam = paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? '';
  
  debugState('QUERY_PARAM_CALCULATION', {
    paramId,
    conversationId: conversation?.conversationId,
    finalQueryParam: queryParam,
    currentIndex
  });
  
  // Root messages with debugging
  const rootMessages = queryClient.getQueryData<TMessage[]>([
    QueryKeys.messages, 
    queryParam
  ]);
  
  useEffect(() => {
    debugState('ROOT_MESSAGES_CHANGE', {
      queryParam,
      rootMessagesCount: rootMessages?.length || 0,
      currentIndex,
      lastRootMessage: rootMessages?.[rootMessages.length - 1] ? {
        id: rootMessages[rootMessages.length - 1].messageId,
        text: rootMessages[rootMessages.length - 1].text?.substring(0, 50) + '...',
        endpoint: rootMessages[rootMessages.length - 1].endpoint
      } : null
    });
  }, [rootMessages, queryParam, currentIndex]);
  
  const actualLatestMessage = rootMessages?.[rootMessages.length - 1];
  
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(currentIndex));
  
  // State management debugging
  useEffect(() => {
    debugState('SUBMISSION_STATE_CHANGE', {
      currentIndex,
      isSubmitting,
      timestamp: Date.now()
    });
  }, [isSubmitting, currentIndex]);
  
  // Sibling management (disabled)
  const setSiblingIdx = useSetRecoilState(store.messagesSiblingIdxFamily(null));
  const parentMessageId = actualLatestMessage?.parentMessageId || null;
  const actualSiblingIdxSetter = useSetRecoilState(store.messagesSiblingIdxFamily(parentMessageId));
  
  const resetSiblingIndex = useCallback(() => {
    debugState('RESET_SIBLING_INDEX', { parentMessageId, currentIndex });
    if (parentMessageId) {
      actualSiblingIdxSetter(0);
    }
  }, [actualSiblingIdxSetter, parentMessageId, currentIndex]);

  const setMessages = useCallback(
    (messages: TMessage[]) => {
      const callTime = Date.now();
      
      debugState('SET_MESSAGES_START', {
        currentIndex,
        messagesCount: messages?.length || 0,
        queryParam,
        callTime,
        callerInfo: new Error().stack?.split('\n')[2]?.trim() || 'unknown'
      });
      
      if (!messages || messages.length === 0) {
        console.warn('⚠️ Attempted to set empty messages array');
        return;
      }
      
      // Calculate comparison key with detailed logging
      const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
      
      debugState('COMPARISON_KEY_CALCULATION', {
        queryParam,
        currentIndex,
        comparisonKey,
        isMainConvo: currentIndex === 0,
        isComparisonConvo: currentIndex > 0
      });
      
      // Check for key collisions
      debugQueryKeys(queryClient, `BEFORE_SET_${currentIndex}`);
      
      // Sanitize messages with minimal processing for debugging
      const sanitizedMessages = messages.map((msg, index) => ({
        ...msg,
        siblingCount: 1,
        siblingIndex: 0,
        children: [],
        text: safeExtractText(msg),
        isCompleted: true,
        finish_reason: 'stop',
      }));
      
      debugState('MESSAGES_SANITIZED', {
        currentIndex,
        comparisonKey,
        originalCount: messages.length,
        sanitizedCount: sanitizedMessages.length,
        textLengths: sanitizedMessages.map((m, i) => ({
          index: i,
          messageId: m.messageId,
          textLength: m.text?.length || 0,
          hasText: !!m.text
        }))
      });
      
      // Store with timestamp for debugging
      const timestampedMessages = sanitizedMessages.map(msg => ({
        ...msg,
        _debugStorageTime: callTime,
        _debugCurrentIndex: currentIndex,
        _debugComparisonKey: comparisonKey
      }));
      
      debugState('STORING_MESSAGES', {
        comparisonKey,
        currentIndex,
        messagesCount: timestampedMessages.length,
        storageTime: callTime
      });
      
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, comparisonKey],
        timestampedMessages,
      );
      
      // Immediate verification
      const verificationData = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
      
      debugState('STORAGE_VERIFICATION', {
        comparisonKey,
        currentIndex,
        wasSet: !!verificationData,
        verificationCount: verificationData?.length || 0,
        verificationTexts: verificationData?.map((m, i) => ({
          index: i,
          messageId: m.messageId,
          textLength: m.text?.length || 0,
          storageTime: m._debugStorageTime,
          storedIndex: m._debugCurrentIndex
        })) || []
      });
      
      // Check for overwrites
      setTimeout(() => {
        const delayedCheck = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
        debugState('DELAYED_VERIFICATION', {
          comparisonKey,
          currentIndex,
          stillExists: !!delayedCheck,
          countChanged: (delayedCheck?.length || 0) !== (verificationData?.length || 0),
          wasOverwritten: !delayedCheck || delayedCheck.length === 0
        });
      }, 100);
      
      // Set latest message
      const latestMultiMessage = timestampedMessages[timestampedMessages.length - 1];
      if (latestMultiMessage) {
        const finalTextLength = latestMultiMessage.text?.length || 0;
        
        debugState('LATEST_MESSAGE_UPDATE', {
          messageId: latestMultiMessage.messageId,
          textLength: finalTextLength,
          currentIndex,
          comparisonKey,
          hasText: !!latestMultiMessage.text
        });
        
        console.log(`📝 Latest message text length: ${finalTextLength}`);
        
        if (finalTextLength === 0) {
          console.error('🚨 ZERO LENGTH TEXT - STATE CORRUPTION DETECTED!', {
            currentIndex,
            comparisonKey,
            originalMessage: messages[messages.length - 1],
            processedMessage: latestMultiMessage
          });
        }
        
        setLatestMultiMessage({ ...latestMultiMessage, depth: -1 });
      }
      
      debugQueryKeys(queryClient, `AFTER_SET_${currentIndex}`);
      resetSiblingIndex();
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex],
  );

  const getMessages = useCallback(() => {
    const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
    
    debugState('GET_MESSAGES', {
      comparisonKey,
      currentIndex,
      messagesFound: !!messages,
      messagesCount: messages?.length || 0,
      retrievalTime: Date.now()
    });
    
    return messages || [];
  }, [queryParam, queryClient, currentIndex]);

  // Debug query cache changes
  useEffect(() => {
    const interval = setInterval(() => {
      debugQueryKeys(queryClient, `PERIODIC_${currentIndex}`);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [queryClient, currentIndex]);

  const setSubmission = useSetRecoilState(store.submissionByIndex(currentIndex));

  const { ask, regenerate } = useChatFunctions({
    index: currentIndex,
    files,
    setFiles,
    getMessages,
    setMessages,
    isSubmitting,
    conversation,
    setSubmission,
    latestMessage: actualLatestMessage,
  });

  const continueGeneration = () => {
    if (!actualLatestMessage) {
      console.error('❌ Failed to regenerate the message: latestMessage not found.');
      return;
    }

    const messages = getMessages();
    const parentMessage = messages?.find(
      (element) => element.messageId == actualLatestMessage.parentMessageId,
    );

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask({ ...parentMessage }, { isContinued: true, isRegenerate: true, isEdited: true });
    } else {
      console.error('❌ Failed to regenerate the message: parentMessage not found, or not created by user.');
    }
  };

  const stopGenerating = () => clearAllSubmissions();

  const handleStopGenerating = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    stopGenerating();
  };

  const handleRegenerate = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const parentMessageId = actualLatestMessage?.parentMessageId;
    if (!parentMessageId) {
      console.error('❌ Failed to regenerate the message: parentMessageId not found.');
      return;
    }
    regenerate({ parentMessageId });
  };

  const handleContinue = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    continueGeneration();
  };

  return {
    ask,
    regenerate,
    getMessages,
    setMessages,
    conversation,
    isSubmitting,
    setSiblingIdx,
    latestMessage: actualLatestMessage,
    stopGenerating,
    handleContinue,
    setConversation,
    setIsSubmitting,
    handleRegenerate,
    handleStopGenerating,
  };
}