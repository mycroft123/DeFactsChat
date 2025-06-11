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
    msg.text, 
    msg.content, 
    msg.response,
    msg.message?.text,
    msg.message?.content
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
  // Track state to detect corruption patterns
  const finalMessageReceived = useRef(false);
  const lastGoodMessageCount = useRef(0);
  
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
      
      // Get caller info to identify source
      const callerStack = new Error().stack;
      const isFromStepHandler = callerStack?.includes('stepHandler') || callerStack?.includes('Step');
      const isFromFinalHandler = callerStack?.includes('finalHandler') || callerStack?.includes('Final');
      
      debugLog('SET_MESSAGES_CALL_INFO', {
        currentIndex,
        messagesCount: messages.length,
        isFromStepHandler,
        isFromFinalHandler,
        finalMessageReceived: finalMessageReceived.current,
        lastGoodCount: lastGoodMessageCount.current
      });
      
      // Check if this is a step event corruption pattern
      const hasValidContent = messages.some(msg => {
        const text = safeExtractText(msg);
        return text.length > 5; // Must have some real content
      });
      
      // TARGETED BLOCKING: Only block step events after final message with no valid content
      if (isFromStepHandler && 
          finalMessageReceived.current && 
          !hasValidContent && 
          messages.length <= lastGoodMessageCount.current) {
        
        console.error('🚫 BLOCKING STEP EVENT CORRUPTION:', {
          currentIndex,
          messagesCount: messages.length,
          lastGoodCount: lastGoodMessageCount.current,
          hasValidContent,
          reason: 'Step event trying to overwrite good final response'
        });
        return; // Block this specific corruption pattern
      }
      
      // Mark final message received
      if (isFromFinalHandler) {
        finalMessageReceived.current = true;
        console.log('✅ Final message received for currentIndex:', currentIndex);
      }
      
      const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
      
      // Sanitize messages
      const sanitizedMessages = messages.map((msg, index) => ({
        ...msg,
        siblingCount: 1,
        siblingIndex: 0,
        children: [],
        text: safeExtractText(msg),
        isCompleted: true,
        finish_reason: 'stop',
      }));
      
      debugLog('SANITIZED_MESSAGES', {
        currentIndex,
        comparisonKey,
        originalCount: messages.length,
        sanitizedCount: sanitizedMessages.length,
        textLengths: sanitizedMessages.map(m => m.text?.length || 0),
        validTexts: sanitizedMessages.map(m => !!m.text && m.text.length > 0)
      });
      
      // Store messages
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, comparisonKey],
        sanitizedMessages,
      );
      
      // Update good message count if this set has valid content
      if (hasValidContent) {
        lastGoodMessageCount.current = Math.max(lastGoodMessageCount.current, sanitizedMessages.length);
      }
      
      // Set latest message
      const latestMultiMessage = sanitizedMessages[sanitizedMessages.length - 1];
      if (latestMultiMessage) {
        const finalTextLength = latestMultiMessage.text?.length || 0;
        
        console.log(`📝 Latest message text length: ${finalTextLength}`);
        
        if (finalTextLength === 0) {
          console.error('🚨 ZERO LENGTH TEXT DETECTED:', {
            currentIndex,
            messageId: latestMultiMessage.messageId,
            originalMessage: messages[messages.length - 1],
            sanitizedMessage: latestMultiMessage
          });
        }
        
        setLatestMultiMessage({ ...latestMultiMessage, depth: -1 });
      }
      
      resetSiblingIndex();
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex],
  );

  const getMessages = useCallback(() => {
    const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
    
    debugLog('GET_MESSAGES', {
      comparisonKey,
      currentIndex,
      messagesFound: !!messages,
      messagesCount: messages?.length || 0
    });
    
    return messages || [];
  }, [queryParam, queryClient, currentIndex]);

  // Reset state when conversation changes
  useEffect(() => {
    finalMessageReceived.current = false;
    lastGoodMessageCount.current = 0;
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