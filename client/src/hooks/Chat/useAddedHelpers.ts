import { useCallback, useRef, useEffect } from 'react';
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

// Enhanced text extraction to handle all message formats including Perplexity
const safeExtractText = (msg: any): string => {
  // First check if content is an array (Perplexity/structured format)
  if (Array.isArray(msg?.content)) {
    for (const item of msg.content) {
      if (item?.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0) {
        return item.text.trim();
      }
    }
  }
  
  // Then check standard text fields
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
  const queryClient = useQueryClient();
  
  // Track good messages to prevent regression
  const lastGoodMessages = useRef<TMessage[]>([]);
  const hasReceivedValidContent = useRef(false);

  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(rootIndex));
  const latestMessage = useRecoilValue(store.latestMessageFamily(rootIndex));
  const setLatestMultiMessage = useSetRecoilState(store.latestMessageFamily(currentIndex));

  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(currentIndex);
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(currentIndex));

  const setSiblingIdx = useSetRecoilState(
    store.messagesSiblingIdxFamily(latestMessage?.parentMessageId ?? null),
  );

  const queryParam = paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? '';

  // 🔧 FIXED: Move debug logging to useEffect with proper dependencies
  useEffect(() => {
    debugLog('useAddedHelpers INIT', { 
      rootIndex, 
      currentIndex, 
      paramId,
      queryParam,
      isMainConvo: currentIndex === 0,
      isComparisonConvo: currentIndex > 0
    });
    
    // Add comprehensive debugging immediately
    console.log('🔧 DEBUGGING - currentIndex:', currentIndex, 'queryParam:', queryParam);
  }, [rootIndex, currentIndex, paramId, queryParam]); // Proper dependencies

  // 🔧 FIXED: Move debug helper setup to useEffect
  useEffect(() => {
    // Try to expose debugging tools globally
    if (typeof window !== 'undefined') {
      if (!window.__LIBRECHAT_DEBUG__) {
        window.__LIBRECHAT_DEBUG__ = {};
      }
      window.__LIBRECHAT_DEBUG__[`helper_${currentIndex}`] = {
        queryClient,
        currentIndex,
        queryParam,
        getStoredMessages: () => {
          const results = {};
          results[`3-part-${currentIndex}`] = queryClient.getQueryData(['messages', queryParam, currentIndex]);
          results['cache-all'] = queryClient.getQueryCache().getAll()
            .filter(q => q.queryKey[0] === 'messages')
            .map(q => ({ key: q.queryKey, hasData: !!q.state.data }));
          return results;
        }
      };
      console.log(`🔧 Debug helper available at window.__LIBRECHAT_DEBUG__.helper_${currentIndex}`);
    }
  }, [currentIndex, queryParam, queryClient]); // Only when these change

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
      
      // Enhanced message processing
      const processedMessages = messages.map(msg => {
        const extractedText = safeExtractText(msg);
        // If text field is empty but we extracted text, use the extracted text
        if (!msg.text && extractedText) {
          return { ...msg, text: extractedText };
        }
        return msg;
      });
      
      // Check if messages contain actual content
      const hasValidContent = processedMessages.some(msg => {
        const text = msg.text || '';
        return text.length > 0;
      });
      
      debugLog('SET_MESSAGES_VALIDATION', {
        currentIndex,
        queryParam,
        messagesCount: messages.length,
        isFromStepHandler,
        isFromFinalHandler,
        hasValidContent,
        hasReceivedValidBefore: hasReceivedValidContent.current,
        lastGoodCount: lastGoodMessages.current.length,
        messagePreview: processedMessages.map(m => ({
          messageId: m.messageId,
          sender: m.sender,
          endpoint: m.endpoint,
          textLength: (m.text || '').length,
          hasText: !!m.text,
          textPreview: (m.text || '').substring(0, 50)
        }))
      });
      
      // Special logging for DeFacts messages to debug the issue
      if (currentIndex === 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && (lastMsg.endpoint === 'gptPlugins' || lastMsg.sender === 'DeFacts' || lastMsg.sender === 'DeFacts AI')) {
          console.log('🎯 DEFACTS MESSAGE STRUCTURE:', {
            fullMessage: JSON.stringify(lastMsg, null, 2),
            keys: Object.keys(lastMsg),
            text: lastMsg.text,
            content: lastMsg.content,
            response: lastMsg.response,
            extractedText: safeExtractText(lastMsg)
          });
        }
      }
      
      // Block empty step events that would overwrite good content
      if (isFromStepHandler && !hasValidContent && hasReceivedValidContent.current) {
        console.log('🚫 BLOCKING EMPTY STEP EVENT - Would overwrite good content');
        return;
      }
      
      // Block if this would be a regression
      if (!hasValidContent && 
          messages.length <= lastGoodMessages.current.length && 
          hasReceivedValidContent.current &&
          !isFromFinalHandler) {
        console.log('🚫 BLOCKING MESSAGE REGRESSION');
        return;
      }
      
      // Update tracking if this set has valid content
      if (hasValidContent) {
        lastGoodMessages.current = [...processedMessages];
        hasReceivedValidContent.current = true;
      }
      
      // Store messages using the original 3-part key structure
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, queryParam, currentIndex],
        processedMessages,
      );
      
      const latestMultiMessage = processedMessages[processedMessages.length - 1];
      if (latestMultiMessage) {
        setLatestMultiMessage({ ...latestMultiMessage, depth: -1 });
      }
    },
    [queryParam, queryClient, currentIndex, setLatestMultiMessage],
  );

  const getMessages = useCallback(() => {
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, queryParam, currentIndex]);
    
    debugLog('GET_MESSAGES', {
      queryParam,
      currentIndex,
      messagesFound: !!messages,
      messagesCount: messages?.length || 0
    });
    
    return messages;
  }, [queryParam, queryClient, currentIndex]);

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
    latestMessage,
  });

  const continueGeneration = () => {
    if (!latestMessage) {
      console.error('Failed to regenerate the message: latestMessage not found.');
      return;
    }

    const messages = getMessages();

    const parentMessage = messages?.find(
      (element) => element.messageId == latestMessage.parentMessageId,
    );

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask({ ...parentMessage }, { isContinued: true, isRegenerate: true, isEdited: true });
    } else {
      console.error(
        'Failed to regenerate the message: parentMessage not found, or not created by user.',
      );
    }
  };

  const stopGenerating = () => clearAllSubmissions();

  const handleStopGenerating = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    stopGenerating();
  };

  const handleRegenerate = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const parentMessageId = latestMessage?.parentMessageId;
    if (!parentMessageId) {
      console.error('Failed to regenerate the message: parentMessageId not found.');
      return;
    }
    regenerate({ parentMessageId });
  };

  const handleContinue = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    continueGeneration();
    setSiblingIdx(0);
  };

  return {
    ask,
    regenerate,
    getMessages,
    setMessages,
    conversation,
    isSubmitting,
    setSiblingIdx,
    latestMessage,
    stopGenerating,
    handleContinue,
    setConversation,
    setIsSubmitting,
    handleRegenerate,
    handleStopGenerating,
  };
}