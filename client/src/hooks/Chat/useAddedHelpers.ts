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
  // Debug logging
  console.log('useAddedHelpers initialized:', { rootIndex, currentIndex, paramId });
  
  const queryClient = useQueryClient();
  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(rootIndex));
  
  const setLatestMultiMessage = useSetRecoilState(store.latestMessageFamily(currentIndex));
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(currentIndex);
  
  // CRITICAL FIX: Use root messages to get the correct latest message
  const rootMessages = queryClient.getQueryData<TMessage[]>([
    QueryKeys.messages, 
    paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? ''
  ]);
  
  // Get the actual latest message from root context for correct parentMessageId
  const actualLatestMessage = rootMessages?.[rootMessages.length - 1];
  
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(currentIndex));
  
  // Force disable sibling threading completely - always use null to disable
  const setSiblingIdx = useSetRecoilState(
    store.messagesSiblingIdxFamily(null), // Always null to disable threading
  );
  
  // Always create a sibling setter, but use null as fallback to prevent errors
  const parentMessageId = actualLatestMessage?.parentMessageId || null;
  const actualSiblingIdxSetter = useSetRecoilState(
    store.messagesSiblingIdxFamily(parentMessageId)
  );
  
  // Override sibling index to always be 0 (first/only response)
  const resetSiblingIndex = useCallback(() => {
    if (parentMessageId) {
      actualSiblingIdxSetter(0);
    }
  }, [actualSiblingIdxSetter, parentMessageId]);
  const queryParam = paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? '';

  const setMessages = useCallback(
    (messages: TMessage[]) => {
      if (!messages || messages.length === 0) {
        console.warn('Attempted to set empty messages array');
        return;
      }
      
      console.log('Setting messages for currentIndex:', currentIndex, 'messages:', messages.length);
      
      // Ensure messages don't have sibling properties that cause threading
      const sanitizedMessages = messages.map((msg, index) => ({
        ...msg,
        // Force single response properties
        siblingCount: 1,
        siblingIndex: 0,
        children: [],
        // Enhanced text extraction for streaming messages
        text: (() => {
          // Direct text property (highest priority)
          if (typeof msg.text === 'string' && msg.text.length > 0) {
            return msg.text;
          }
          
          // Content as string (second priority)
          if (typeof msg.content === 'string' && msg.content.length > 0) {
            return msg.content;
          }
          
          // Content as array (streaming format - third priority)
          if (Array.isArray(msg.content)) {
            const textParts = msg.content
              .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
              .map(part => part.text)
              .join('');
            if (textParts.length > 0) {
              return textParts;
            }
          }
          
          // Delta content extraction (for streaming)
          if (msg.delta && Array.isArray(msg.delta.content)) {
            const deltaText = msg.delta.content
              .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
              .map(part => part.text)
              .join('');
            if (deltaText.length > 0) {
              return deltaText;
            }
          }
          
          // Fallback - but avoid converting objects to [object Object]
          const fallback = msg.text || msg.content || '';
          if (typeof fallback === 'string') {
            return fallback;
          }
          
          // If all else fails, return empty string to avoid [object Object]
          return '';
        })(),
        isCompleted: true,
        finish_reason: 'stop',
      }));
      
      // Store comparison messages with unique key and validation
      const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, comparisonKey],
        sanitizedMessages,
      );
      
      // 🔧 FIXED: Get the latest message from the sanitized array that was just processed
      const latestMultiMessage = sanitizedMessages[sanitizedMessages.length - 1];
      if (latestMultiMessage) {
        console.log('Latest message text length:', latestMultiMessage.text?.length || 0);
        
        // Enhanced preview that handles objects properly
        const preview = (() => {
          if (typeof latestMultiMessage.text === 'string' && latestMultiMessage.text.length > 0) {
            return latestMultiMessage.text.substring(0, 100) + '...';
          }
          return 'No text content';
        })();
        console.log('🔍 [DEBUG] Message content preview:', preview);
        
        // Ensure the message has content before setting it
        if (latestMultiMessage.text && latestMultiMessage.text.length > 0) {
          setLatestMultiMessage({ ...latestMultiMessage, depth: -1 });
          console.log('✅ [DEBUG] Latest message set successfully for currentIndex:', currentIndex);
        } else {
          console.warn('⚠️ [DEBUG] Message has no text content, not setting as latest');
          console.warn('⚠️ [DEBUG] Message object:', JSON.stringify(latestMultiMessage, null, 2));
          
          // Fallback: Try to get from comparison cache
          const cachedMessages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
          const cachedLatest = cachedMessages?.[cachedMessages.length - 1];
          if (cachedLatest && cachedLatest.text && cachedLatest.text.length > 0) {
            console.log('🔄 [DEBUG] Using cached message as fallback');
            setLatestMultiMessage({ ...cachedLatest, depth: -1 });
          }
        }
      } else {
        console.error('❌ [DEBUG] No latest message found in sanitizedMessages');
      }
      
      // Force reset sibling index
      resetSiblingIndex();
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex],
  );

  const getMessages = useCallback(() => {
    const comparisonKey = `${queryParam}_comparison_${currentIndex}`;
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, comparisonKey]);
    
    // Debug logging for messages retrieval
    console.log('🔍 [DEBUG] getMessages called for currentIndex:', currentIndex);
    console.log('🔍 [DEBUG] Retrieved messages count:', messages?.length || 0);
    if (messages && messages.length > 0) {
      console.log('🔍 [DEBUG] Latest message text length:', messages[messages.length - 1]?.text?.length || 0);
    }
    
    // Return empty array if no messages to prevent undefined errors
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
    latestMessage: actualLatestMessage, // Use the actual latest message from root
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
    // Don't reset sibling index to prevent threading issues
    // setSiblingIdx(0);
  };

  return {
    ask,
    regenerate,
    getMessages,
    setMessages,
    conversation,
    isSubmitting,
    setSiblingIdx,
    latestMessage: actualLatestMessage, // Return the correct latest message
    stopGenerating,
    handleContinue,
    setConversation,
    setIsSubmitting,
    handleRegenerate,
    handleStopGenerating,
  };
}