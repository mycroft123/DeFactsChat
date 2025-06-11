import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import useChatFunctions from '~/hooks/Chat/useChatFunctions';
import store from '~/store';

// Enhanced debug utility
const debugLog = (context: string, data: any) => {
  console.group(`🔧 DEBUG [${context}]`);
  console.log('Timestamp:', new Date().toISOString());
  console.log('Data:', data);
  console.groupEnd();
};

// Safe text extraction
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
  // Track initialization and prevent cross-contamination
  const initTime = useRef(Date.now());
  const instanceId = useRef(`${currentIndex}_${initTime.current}`);
  const lastValidMessageCount = useRef(0);
  
  debugLog('useAddedHelpers ISOLATED INIT', {
    rootIndex,
    currentIndex,
    paramId,
    instanceId: instanceId.current,
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
      // CRITICAL: Prevent cross-contamination
      if (!messages || messages.length === 0) {
        console.warn(`⚠️ [${instanceId.current}] Attempted to set empty messages array - BLOCKED`);
        return;
      }
      
      // CRITICAL: Validate message quality before processing
      const hasValidText = messages.some(msg => {
        const text = safeExtractText(msg);
        return text.length > 10; // At least 10 characters of real content
      });
      
      if (!hasValidText && messages.length < lastValidMessageCount.current + 1) {
        console.error(`🚫 [${instanceId.current}] BLOCKING CORRUPT MESSAGE SET:`, {
          messagesCount: messages.length,
          lastValidCount: lastValidMessageCount.current,
          hasValidText,
          currentIndex,
          reason: 'Step event with incomplete messages'
        });
        return; // BLOCK THE CORRUPT UPDATE
      }
      
      debugLog(`ISOLATED_SET_MESSAGES [${instanceId.current}]`, {
        currentIndex,
        messagesCount: messages.length,
        hasValidText,
        lastValidCount: lastValidMessageCount.current,
        queryParam,
        conversationEndpoint: conversation?.endpoint,
        conversationModel: conversation?.model
      });
      
      // Calculate isolated comparison key
      const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
      
      // Verify this is the right conversation context
      if (currentIndex === 0 && conversation?.endpoint !== 'gptPlugins') {
        console.warn(`⚠️ Main conversation endpoint mismatch: ${conversation?.endpoint} (expected: gptPlugins)`);
      }
      
      if (currentIndex === 1 && !['openAI', 'Perplexity'].includes(conversation?.endpoint || '')) {
        console.warn(`⚠️ Comparison conversation endpoint mismatch: ${conversation?.endpoint}`);
      }
      
      // Sanitize messages with validation
      const sanitizedMessages = messages.map((msg, index) => {
        const extractedText = safeExtractText(msg);
        
        return {
          ...msg,
          siblingCount: 1,
          siblingIndex: 0,
          children: [],
          text: extractedText,
          isCompleted: true,
          finish_reason: 'stop',
          // Add isolation markers
          _debugInstanceId: instanceId.current,
          _debugCurrentIndex: currentIndex,
          _debugTimestamp: Date.now()
        };
      });
      
      // Validate sanitized messages
      const validMessages = sanitizedMessages.filter(msg => msg.text.length > 0);
      if (validMessages.length === 0) {
        console.error(`❌ [${instanceId.current}] All messages have empty text - BLOCKED`);
        return;
      }
      
      debugLog(`ISOLATED_STORING [${instanceId.current}]`, {
        comparisonKey,
        originalCount: messages.length,
        sanitizedCount: sanitizedMessages.length,
        validCount: validMessages.length,
        textLengths: sanitizedMessages.map(m => m.text.length)
      });
      
      // Store with isolation verification
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, comparisonKey],
        sanitizedMessages,
      );
      
      // Update valid message count
      lastValidMessageCount.current = Math.max(lastValidMessageCount.current, sanitizedMessages.length);
      
      // Immediate verification
      const verificationData = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
      if (!verificationData || verificationData.length === 0) {
        console.error(`❌ [${instanceId.current}] Storage failed - data not found after set`);
        return;
      }
      
      // Set latest message with validation
      const latestMultiMessage = sanitizedMessages[sanitizedMessages.length - 1];
      if (latestMultiMessage && latestMultiMessage.text.length > 0) {
        const finalTextLength = latestMultiMessage.text.length;
        
        console.log(`✅ [${instanceId.current}] Latest message text length: ${finalTextLength}`);
        
        setLatestMultiMessage({ ...latestMultiMessage, depth: -1 });
      } else {
        console.error(`❌ [${instanceId.current}] Latest message has no text - corruption detected`);
      }
      
      resetSiblingIndex();
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex, conversation, instanceId],
  );

  const getMessages = useCallback(() => {
    const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
    
    debugLog(`ISOLATED_GET_MESSAGES [${instanceId.current}]`, {
      comparisonKey,
      messagesFound: !!messages,
      messagesCount: messages?.length || 0,
      hasValidMessages: messages ? messages.some(m => m.text?.length > 0) : false
    });
    
    return messages || [];
  }, [queryParam, queryClient, currentIndex, instanceId]);

  // Monitor for cross-contamination
  useEffect(() => {
    const interval = setInterval(() => {
      const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
      const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
      
      if (messages && messages.length > 0) {
        const corruptedMessages = messages.filter(msg => 
          msg._debugCurrentIndex !== undefined && 
          msg._debugCurrentIndex !== currentIndex
        );
        
        if (corruptedMessages.length > 0) {
          console.error(`🚨 [${instanceId.current}] CROSS-CONTAMINATION DETECTED:`, {
            currentIndex,
            corruptedMessages: corruptedMessages.map(msg => ({
              storedIndex: msg._debugCurrentIndex,
              instanceId: msg._debugInstanceId
            }))
          });
        }
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [queryClient, queryParam, currentIndex, instanceId]);

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

  const handleContinue = (e: React.MouseEvent<HTMLButtonButton>) => {
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