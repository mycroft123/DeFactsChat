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
  const queryClient = useQueryClient();
  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(rootIndex));
  
  // CRITICAL FIX: Use root messages to get the correct latest message
  const rootMessages = queryClient.getQueryData<TMessage[]>([
    QueryKeys.messages, 
    paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? ''
  ]);
  
  // Get the actual latest message from root context for correct parentMessageId
  const actualLatestMessage = rootMessages?.[rootMessages.length - 1];
  
  const setLatestMultiMessage = useSetRecoilState(store.latestMessageFamily(currentIndex));
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(currentIndex);
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(currentIndex));
  const setSiblingIdx = useSetRecoilState(
    store.messagesSiblingIdxFamily(actualLatestMessage?.parentMessageId ?? null),
  );
  const queryParam = paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? '';

  const setMessages = useCallback(
    (messages: TMessage[]) => {
      // Store comparison messages with special key
      queryClient.setQueryData<TMessage[]>(
        [QueryKeys.messages, `${queryParam}_comparison`],
        messages,
      );
      const latestMultiMessage = messages[messages.length - 1];
      if (latestMultiMessage) {
        setLatestMultiMessage({ ...latestMultiMessage, depth: -1 });
      }
    },
    [queryParam, queryClient, setLatestMultiMessage],
  );

  const getMessages = useCallback(() => {
    // Get comparison messages from special key
    return queryClient.getQueryData<TMessage[]>([QueryKeys.messages, `${queryParam}_comparison`]);
  }, [queryParam, queryClient]);

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
    latestMessage: actualLatestMessage, // Return the correct latest message
    stopGenerating,
    handleContinue,
    setConversation,
    setIsSubmitting,
    handleRegenerate,
    handleStopGenerating,
  };
}