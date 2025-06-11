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
  // Debug logging with more detail
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

  // COMPLETELY REWRITTEN: Bypass broken comparison system
  const setMessages = useCallback(
    (messages: TMessage[]) => {
      if (!messages || messages.length === 0) {
        console.warn('🔧 [setMessages] Empty messages array received');
        return;
      }
      
      const timestamp = new Date().toISOString();
      console.log(`🔧 [setMessages] Processing ${messages.length} messages for currentIndex: ${currentIndex}`, {
        timestamp,
        messageCount: messages.length,
        currentIndex
      });
      
      // Extract actual text content with comprehensive fallback
      const extractTextContent = (msg: any): string => {
        console.log('🔍 [extractTextContent] Analyzing message:', {
          hasText: !!msg.text,
          hasContent: !!msg.content,
          hasDelta: !!msg.delta,
          textType: typeof msg.text,
          contentType: typeof msg.content
        });
        
        // Direct text
        if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
          console.log('✅ [extractTextContent] Found direct text:', msg.text.substring(0, 50) + '...');
          return msg.text;
        }
        
        // Content as string
        if (typeof msg.content === 'string' && msg.content.trim().length > 0) {
          console.log('✅ [extractTextContent] Found string content:', msg.content.substring(0, 50) + '...');
          return msg.content;
        }
        
        // Content as array
        if (Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
            .map(part => part.text)
            .filter(text => text && text.trim().length > 0);
          
          if (textParts.length > 0) {
            const combined = textParts.join('');
            console.log('✅ [extractTextContent] Found array content:', combined.substring(0, 50) + '...');
            return combined;
          }
        }
        
        // Delta content (streaming)
        if (msg.delta && Array.isArray(msg.delta.content)) {
          const deltaText = msg.delta.content
            .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
            .map(part => part.text)
            .filter(text => text && text.trim().length > 0);
          
          if (deltaText.length > 0) {
            const combined = deltaText.join('');
            console.log('✅ [extractTextContent] Found delta content:', combined.substring(0, 50) + '...');
            return combined;
          }
        }
        
        console.warn('❌ [extractTextContent] No text content found in message');
        return '';
      };
      
      // Process messages with proper text extraction
      const processedMessages = messages.map((msg, index) => {
        const extractedText = extractTextContent(msg);
        
        const processed = {
          ...msg,
          // Force single response properties
          siblingCount: 1,
          siblingIndex: 0,
          children: [],
          text: extractedText,
          isCompleted: true,
          finish_reason: 'stop',
          // Add metadata for debugging
          _debugInfo: {
            processedAt: timestamp,
            originalTextType: typeof msg.text,
            originalContentType: typeof msg.content,
            extractedLength: extractedText.length,
            currentIndex,
            messageIndex: index
          }
        };
        
        console.log(`🔧 [setMessages] Processed message ${index}:`, {
          messageId: processed.messageId,
          textLength: processed.text.length,
          preview: processed.text.substring(0, 100) + '...'
        });
        
        return processed;
      });
      
      // Store in BOTH comparison cache AND main cache to bypass broken system
      const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
      const mainKey = queryParam;
      
      // Store in comparison cache
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, comparisonKey], processedMessages);
      console.log(`✅ [setMessages] Stored ${processedMessages.length} messages in comparison cache:`, comparisonKey);
      
      // ALSO store in main cache to bypass comparison issues
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, mainKey], processedMessages);
      console.log(`✅ [setMessages] Stored ${processedMessages.length} messages in main cache:`, mainKey);
      
      // Force update the latest message display
      const latestMessage = processedMessages[processedMessages.length - 1];
      if (latestMessage) {
        console.log('🔧 [setMessages] Setting latest message:', {
          messageId: latestMessage.messageId,
          textLength: latestMessage.text.length,
          preview: latestMessage.text.substring(0, 100) + '...',
          currentIndex
        });
        
        // Force set the latest message
        setLatestMultiMessage({ 
          ...latestMessage, 
          depth: -1,
          _forceUpdate: timestamp // Force re-render
        });
        
        console.log('✅ [setMessages] Latest message set successfully for currentIndex:', currentIndex);
      }
      
      // Reset sibling index
      resetSiblingIndex();
      
      console.log('🎉 [setMessages] Complete! Messages processed and stored successfully');
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex],
  );

  // REWRITTEN: Get messages from BOTH caches
  const getMessages = useCallback(() => {
    const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
    const mainKey = queryParam;
    
    // Try comparison cache first
    let messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
    
    // Fallback to main cache
    if (!messages || messages.length === 0) {
      messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, mainKey]);
      console.log('🔧 [getMessages] Using main cache fallback');
    }
    
    console.log('🔧 [getMessages] Retrieved messages:', {
      currentIndex,
      comparisonKey,
      mainKey,
      messageCount: messages?.length || 0,
      latestTextLength: messages?.[messages.length - 1]?.text?.length || 0
    });
    
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