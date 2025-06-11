import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import useChatFunctions from '~/hooks/Chat/useChatFunctions';
import store from '~/store';

export default function useAddedHelpers({
  rootIndex = 0,
  currentIndex,
  paramId,
}: {
  rootIndex?: number;
  currentIndex: number;
  paramId?: string;
}) {
  console.log('🔧 [useAddedHelpers] Initialized:', { 
    rootIndex, 
    currentIndex, 
    paramId,
    timestamp: new Date().toISOString()
  });
  
  const queryClient = useQueryClient();
  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(rootIndex));
  
  const setLatestMultiMessage = useSetRecoilState(store.latestMessageFamily(currentIndex));
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(currentIndex);
  
  // Get root messages for reference
  const rootMessages = queryClient.getQueryData<TMessage[]>([
    QueryKeys.messages, 
    paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? ''
  ]);
  
  const actualLatestMessage = rootMessages?.[rootMessages.length - 1];
  
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(currentIndex));
  
  // Disable sibling threading
  const setSiblingIdx = useSetRecoilState(store.messagesSiblingIdxFamily(null));
  
  const parentMessageId = actualLatestMessage?.parentMessageId || null;
  const actualSiblingIdxSetter = useSetRecoilState(
    store.messagesSiblingIdxFamily(parentMessageId)
  );
  
  const resetSiblingIndex = useCallback(() => {
    if (parentMessageId) {
      actualSiblingIdxSetter(0);
    }
  }, [actualSiblingIdxSetter, parentMessageId]);
  
  const queryParam = paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? '';

  // IMPROVED: Better text extraction with proper fallbacks
  const extractTextContent = useCallback((msg: any): string => {
    console.log('🔍 [extractTextContent] Analyzing message:', {
      hasText: !!msg.text,
      hasContent: !!msg.content,
      hasDelta: !!msg.delta,
      messageId: msg.messageId
    });
    
    // Direct text - most common case
    if (typeof msg.text === 'string' && msg.text.trim()) {
      console.log('✅ [extractTextContent] Found direct text:', msg.text.substring(0, 50) + '...');
      return msg.text.trim();
    }
    
    // Content as string
    if (typeof msg.content === 'string' && msg.content.trim()) {
      console.log('✅ [extractTextContent] Found string content:', msg.content.substring(0, 50) + '...');
      return msg.content.trim();
    }
    
    // Content as array (common in streaming responses)
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text.trim())
        .filter(Boolean);
      
      if (textParts.length > 0) {
        const combined = textParts.join(' ');
        console.log('✅ [extractTextContent] Found array content:', combined.substring(0, 50) + '...');
        return combined;
      }
    }
    
    // Delta content (streaming updates)
    if (msg.delta?.content && Array.isArray(msg.delta.content)) {
      const deltaText = msg.delta.content
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text.trim())
        .filter(Boolean);
      
      if (deltaText.length > 0) {
        const combined = deltaText.join(' ');
        console.log('✅ [extractTextContent] Found delta content:', combined.substring(0, 50) + '...');
        return combined;
      }
    }
    
    // Fallback: try to find ANY text-like property
    const possibleTextFields = ['text', 'content', 'message', 'response', 'body'];
    for (const field of possibleTextFields) {
      const value = msg[field];
      if (typeof value === 'string' && value.trim()) {
        console.log(`✅ [extractTextContent] Found fallback text in ${field}:`, value.substring(0, 50) + '...');
        return value.trim();
      }
    }
    
    // Final fallback - return placeholder instead of empty string
    const fallbackText = msg.role === 'user' 
      ? '[User message content not available]' 
      : '[Assistant response not available]';
    
    console.warn('⚠️ [extractTextContent] No text content found, using fallback:', fallbackText);
    return fallbackText;
  }, []);

  // SIMPLIFIED: Single cache strategy
  const setMessages = useCallback(
    (messages: TMessage[]) => {
      if (!messages || messages.length === 0) {
        console.warn('🔧 [setMessages] Empty messages array received');
        return;
      }
      
      console.log(`🔧 [setMessages] Processing ${messages.length} messages for currentIndex: ${currentIndex}`);
      
      // Process messages with robust text extraction
      const processedMessages = messages.map((msg, index) => {
        const extractedText = extractTextContent(msg);
        
        const processed = {
          ...msg,
          text: extractedText,
          // Ensure single response (no siblings)
          siblingCount: 1,
          siblingIndex: 0,
          children: [],
          isCompleted: true,
          finish_reason: msg.finish_reason || 'stop',
          // Preserve original data for debugging
          _originalText: msg.text,
          _originalContent: msg.content,
          _processedAt: new Date().toISOString()
        };
        
        console.log(`🔧 [setMessages] Processed message ${index}:`, {
          messageId: processed.messageId,
          role: processed.role,
          textLength: processed.text.length,
          hasText: processed.text !== '[User message content not available]' && processed.text !== '[Assistant response not available]'
        });
        
        return processed;
      });
      
      // Store in query cache with single key strategy
      const cacheKey = queryParam;
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, cacheKey], processedMessages);
      console.log(`✅ [setMessages] Stored ${processedMessages.length} messages in cache: ${cacheKey}`);
      
      // Update latest message
      const latestMessage = processedMessages[processedMessages.length - 1];
      if (latestMessage) {
        console.log('🔧 [setMessages] Setting latest message:', {
          messageId: latestMessage.messageId,
          role: latestMessage.role,
          textLength: latestMessage.text.length
        });
        
        setLatestMultiMessage({ 
          ...latestMessage, 
          depth: -1
        });
        
        console.log('✅ [setMessages] Latest message set successfully');
      }
      
      resetSiblingIndex();
      console.log('🎉 [setMessages] Processing complete!');
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex, extractTextContent],
  );

  // SIMPLIFIED: Single cache retrieval
  const getMessages = useCallback(() => {
    const cacheKey = queryParam;
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, cacheKey]);
    
    console.log('🔧 [getMessages] Retrieved messages:', {
      currentIndex,
      cacheKey,
      messageCount: messages?.length || 0,
      hasMessages: !!messages && messages.length > 0
    });
    
    // If no messages found, return empty array instead of undefined
    return messages || [];
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
    latestMessage: actualLatestMessage,
  });

  const continueGeneration = () => {
    if (!actualLatestMessage) {
      console.error('Failed to regenerate the message: latestMessage not found.');
      return;
    }

    const messages = getMessages();
    const parentMessage = messages?.find(
      (element) => element.messageId == actualLatestMessage.parentMessageId,
    );

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask({ ...parentMessage }, { isContinued: true, isRegenerate: true, isEdited: true });
    } else {
      console.error('Failed to regenerate the message: parentMessage not found, or not created by user.');
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
      console.error('Failed to regenerate the message: parentMessageId not found.');
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