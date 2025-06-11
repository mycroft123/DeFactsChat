import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import useChatFunctions from '~/hooks/Chat/useChatFunctions';
import store from '~/store';

// Debug utility
const debugLog = (context: string, data: any) => {
  console.group(`🔧 DEBUG [${context}]`);
  console.log('Timestamp:', new Date().toISOString());
  console.log('Data:', data);
  console.groupEnd();
};

// Safe text extraction
const safeExtractText = (msg: any): string => {
  const candidates = [
    msg?.text, 
    msg?.content, 
    msg?.response,
    msg?.message?.text,
    msg?.message?.content
  ];
  
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
  // Track good messages to prevent regression
  const lastGoodMessages = useRef<TMessage[]>([]);
  const hasReceivedValidContent = useRef(false);
  
  debugLog('useAddedHelpers INIT', { 
    rootIndex, 
    currentIndex, 
    paramId,
    isMainConvo: currentIndex === 0,
    isComparisonConvo: currentIndex > 0
  });
  
  const queryClient = useQueryClient();
  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(rootIndex));
  
  const setLatestMultiMessage = useSetRecoilState(store.latestMessageFamily(currentIndex));
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(currentIndex);
  
  const queryParam = paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? '';
  const rootMessages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, queryParam]);
  const actualLatestMessage = rootMessages?.[rootMessages.length - 1];
  
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(currentIndex));
  
  // Sibling management
  const setSiblingIdx = useSetRecoilState(store.messagesSiblingIdxFamily(null));
  const parentMessageId = actualLatestMessage?.parentMessageId || null;
  const actualSiblingIdxSetter = useSetRecoilState(store.messagesSiblingIdxFamily(parentMessageId));
  
  const resetSiblingIndex = useCallback(() => {
    if (parentMessageId) {
      actualSiblingIdxSetter(0);
    }
  }, [actualSiblingIdxSetter, parentMessageId]);

  const setMessages = useCallback(
    (messages: TMessage[]) => {
      if (!messages || messages.length === 0) {
        console.warn('⚠️ Attempted to set empty messages array');
        return;
      }
      
      // Get caller info
      const callerStack = new Error().stack;
      const isFromStepHandler = callerStack?.includes('stepHandler') || callerStack?.includes('Step');
      const isFromFinalHandler = callerStack?.includes('finalHandler') || callerStack?.includes('Final');
      
      // Check if messages contain actual content
      const hasValidContent = messages.some(msg => {
        const text = safeExtractText(msg);
        return text.length > 0;
      });
      
      // CRITICAL: Determine correct storage key based on conversation type
      let comparisonKey: string;
      
      if (currentIndex === 0) {
        // Main conversation (DeFacts) - store in main messages
        comparisonKey = queryParam;
        debugLog('MAIN_CONVERSATION_STORAGE', {
          currentIndex,
          queryParam,
          comparisonKey,
          conversationEndpoint: conversation?.endpoint
        });
      } else {
        // Comparison conversation - use specific comparison key
        comparisonKey = `${queryParam}_comparison_${currentIndex}`;
        debugLog('COMPARISON_CONVERSATION_STORAGE', {
          currentIndex,
          queryParam,
          comparisonKey,
          conversationEndpoint: conversation?.endpoint
        });
      }
      
      debugLog('SET_MESSAGES_VALIDATION', {
        currentIndex,
        comparisonKey,
        messagesCount: messages.length,
        isFromStepHandler,
        isFromFinalHandler,
        hasValidContent,
        hasReceivedValidBefore: hasReceivedValidContent.current,
        lastGoodCount: lastGoodMessages.current.length,
        messagePreview: messages.map(m => ({
          messageId: m.messageId,
          sender: m.sender,
          textLength: (m.text || '').length,
          hasText: !!m.text,
          textPreview: (m.text || '').substring(0, 50)
        }))
      });
      
      // CRITICAL FIX: Block empty step events that would overwrite good content
      if (isFromStepHandler && !hasValidContent && hasReceivedValidContent.current) {
        console.log('🚫 BLOCKING EMPTY STEP EVENT - Would overwrite good content:', {
          currentIndex,
          comparisonKey,
          messagesCount: messages.length,
          reason: 'Step event with empty text trying to overwrite valid content'
        });
        return; // Block the corruption
      }
      
      // ALSO Block if this would be a regression (fewer messages with no new content)
      if (!hasValidContent && 
          messages.length <= lastGoodMessages.current.length && 
          hasReceivedValidContent.current) {
        console.log('🚫 BLOCKING MESSAGE REGRESSION:', {
          currentIndex,
          comparisonKey,
          newCount: messages.length,
          lastGoodCount: lastGoodMessages.current.length,
          reason: 'Would reduce message count without adding content'
        });
        return; // Block the regression
      }
      
      // Sanitize messages
      const sanitizedMessages = messages.map((msg, index) => ({
        ...msg,
        siblingCount: 1,
        siblingIndex: 0,
        children: [],
        text: safeExtractText(msg),
        isCompleted: isFromFinalHandler,
        finish_reason: isFromFinalHandler ? 'stop' : null,
        // Add conversation tracking
        _conversationIndex: currentIndex,
        _storageKey: comparisonKey,
        _timestamp: Date.now()
      }));
      
      // Update tracking if this set has valid content
      if (hasValidContent) {
        lastGoodMessages.current = [...sanitizedMessages];
        hasReceivedValidContent.current = true;
        console.log('✅ UPDATED GOOD MESSAGE CACHE:', {
          currentIndex,
          comparisonKey,
          messageCount: sanitizedMessages.length,
          totalTextLength: sanitizedMessages.reduce((sum, m) => sum + (m.text?.length || 0), 0)
        });
      }
      
      debugLog('FINAL_SANITIZED_MESSAGES', {
        currentIndex,
        comparisonKey,
        originalCount: messages.length,
        sanitizedCount: sanitizedMessages.length,
        textLengths: sanitizedMessages.map(m => m.text?.length || 0),
        hasAnyText: sanitizedMessages.some(m => m.text && m.text.length > 0),
        storageStrategy: currentIndex === 0 ? 'main-messages' : 'comparison-cache'
      });
      
      // Store messages with proper key
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, comparisonKey],
        sanitizedMessages,
      );
      
      // CRITICAL: For main conversation, also update root messages
      if (currentIndex === 0) {
        queryClient.setQueryData<TMessage[]>(
          [QueryKeys.messages, queryParam],
          sanitizedMessages,
        );
        console.log('📝 MAIN CONVERSATION: Updated root messages cache');
      }
      
      // Immediate verification
      setTimeout(() => {
        const verifyMessages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
        debugLog('STORAGE_VERIFICATION', {
          comparisonKey,
          currentIndex,
          messagesStored: !!verifyMessages,
          storedCount: verifyMessages?.length || 0,
          expectedCount: sanitizedMessages.length
        });
        
        if (!verifyMessages || verifyMessages.length === 0) {
          console.error('🚨 MESSAGES DISAPPEARED AFTER STORAGE!', {
            comparisonKey,
            currentIndex,
            hadMessages: sanitizedMessages.length
          });
        }
      }, 100);
      
      // Set latest message
      const latestMultiMessage = sanitizedMessages[sanitizedMessages.length - 1];
      if (latestMultiMessage) {
        const finalTextLength = latestMultiMessage.text?.length || 0;
        
        console.log(`📝 Latest message text length: ${finalTextLength}`);
        
        if (finalTextLength === 0) {
          console.error('🚨 STILL ZERO LENGTH - INVESTIGATION NEEDED:', {
            currentIndex,
            comparisonKey,
            messageId: latestMultiMessage.messageId,
            sender: latestMultiMessage.sender,
            endpoint: latestMultiMessage.endpoint,
            originalText: messages[messages.length - 1]?.text,
            allKeys: Object.keys(latestMultiMessage),
            fullMessage: JSON.stringify(latestMultiMessage, null, 2)
          });
        } else {
          console.log('✅ SUCCESS - Text extracted:', finalTextLength, 'characters');
        }
        
        setLatestMultiMessage({ ...latestMultiMessage, depth: -1 });
      }
      
      resetSiblingIndex();
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex, conversation],
  );

  const getMessages = useCallback(() => {
    // CRITICAL: Use same key logic as setMessages
    let comparisonKey: string;
    
    if (currentIndex === 0) {
      // Main conversation - get from main messages
      comparisonKey = queryParam;
    } else {
      // Comparison conversation - get from comparison cache
      comparisonKey = `${queryParam}_comparison_${currentIndex}`;
    }
    
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
    
    debugLog('GET_MESSAGES', {
      comparisonKey,
      currentIndex,
      messagesFound: !!messages,
      messagesCount: messages?.length || 0,
      storageStrategy: currentIndex === 0 ? 'main-messages' : 'comparison-cache'
    });
    
    return messages || [];
  }, [queryParam, queryClient, currentIndex]);

  // Monitor all query cache changes for debugging
  useEffect(() => {
    const interval = setInterval(() => {
      const mainKey = queryParam;
      const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
      
      const mainMessages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, mainKey]);
      const comparisonMessages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
      
      debugLog('PERIODIC_CACHE_CHECK', {
        currentIndex,
        mainKey,
        comparisonKey,
        mainMessagesCount: mainMessages?.length || 0,
        comparisonMessagesCount: comparisonMessages?.length || 0,
        mainHasContent: mainMessages?.some(m => m.text?.length > 0) || false,
        comparisonHasContent: comparisonMessages?.some(m => m.text?.length > 0) || false
      });
    }, 5000);
    
    return () => clearInterval(interval);
  }, [queryClient, queryParam, currentIndex]);

  // Reset tracking when conversation changes
  useEffect(() => {
    lastGoodMessages.current = [];
    hasReceivedValidContent.current = false;
    debugLog('CONVERSATION_RESET', {
      currentIndex,
      conversationId: conversation?.conversationId,
      endpoint: conversation?.endpoint
    });
  }, [conversation?.conversationId, currentIndex]);

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