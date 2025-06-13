import { memo, useCallback, useState, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { ChatFormValues } from '~/common';
import { ChatContext, AddedChatContext, useFileMapContext, ChatFormProvider } from '~/Providers';
import { useChatHelpers, useAddedResponse, useSSE } from '~/hooks';
import ConversationStarters from './Input/ConversationStarters';
import { useGetMessagesByConvoId } from '~/data-provider';
import MessagesView from './Messages/MessagesView';
import { Spinner } from '~/components/svg';
import Presentation from './Presentation';
import { buildTree, cn } from '~/utils';
import ChatForm from './Input/ChatForm';
import Landing from './Landing';
import Header from './Header';
import Footer from './Footer';
import store from '~/store';

function LoadingSpinner() {
  return (
    <div className="relative flex-1 overflow-hidden overflow-y-auto">
      <div className="relative flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    </div>
  );
}

function ChatView({ index = 0 }: { index?: number }) {
  const { conversationId } = useParams();
  const rootSubmission = useRecoilValue(store.submissionByIndex(index));
  const addedSubmission = useRecoilValue(store.submissionByIndex(index + 1));
  const centerFormOnLanding = useRecoilValue(store.centerFormOnLanding);

  // Add state to track which panels are active
  const [leftPanelActive, setLeftPanelActive] = useState(true);
  const [rightPanelActive, setRightPanelActive] = useState(true);
  const [isComparisonMode, setIsComparisonMode] = useState(false);

  const fileMap = useFileMapContext();

  const { data: messagesTree = null, isLoading } = useGetMessagesByConvoId(conversationId ?? '', {
    select: useCallback(
      (data: TMessage[]) => {
        const dataTree = buildTree({ messages: data, fileMap });
        return dataTree?.length === 0 ? null : (dataTree ?? null);
      },
      [fileMap],
    ),
    enabled: !!fileMap,
  });

  const chatHelpers = useChatHelpers(index, conversationId);
  const addedChatHelpers = useAddedResponse({ rootIndex: index });

  // Create panel-specific chat helpers with isolated state management
  const leftChatHelpers = {
    ...chatHelpers,
    setIsSubmitting: (value: boolean) => {
      if (!value) {
        setLeftPanelActive(false);
      }
      // Only set global isSubmitting false when both panels are done
      if (!value && !rightPanelActive) {
        chatHelpers.setIsSubmitting(false);
      } else if (value) {
        setLeftPanelActive(true);
        chatHelpers.setIsSubmitting(true);
      }
    }
  };

  const rightChatHelpers = {
    ...addedChatHelpers,
    setIsSubmitting: (value: boolean) => {
      if (!value) {
        setRightPanelActive(false);
      }
      // Only set global isSubmitting false when both panels are done
      if (!value && !leftPanelActive) {
        addedChatHelpers.setIsSubmitting(false);
      } else if (value) {
        setRightPanelActive(true);
        addedChatHelpers.setIsSubmitting(true);
      }
    }
  };

  // Detect comparison mode
  useEffect(() => {
    const hasComparison = !!(rootSubmission && addedSubmission);
    setIsComparisonMode(hasComparison);
    
    // Reset panel states when entering/exiting comparison mode
    if (!hasComparison) {
      setLeftPanelActive(true);
      setRightPanelActive(true);
    }
  }, [rootSubmission, addedSubmission]);

  // Use the modified helpers for SSE connections
  useSSE(rootSubmission, leftChatHelpers, false, index, isComparisonMode);
  useSSE(addedSubmission, rightChatHelpers, true, index + 1, isComparisonMode);

  const methods = useForm<ChatFormValues>({
    defaultValues: { text: '' },
  });

  let content: JSX.Element | null | undefined;
  const isLandingPage =
    (!messagesTree || messagesTree.length === 0) &&
    (conversationId === Constants.NEW_CONVO || !conversationId);
  const isNavigating = (!messagesTree || messagesTree.length === 0) && conversationId != null;

  if (isLoading && conversationId !== Constants.NEW_CONVO) {
    content = <LoadingSpinner />;
  } else if ((isLoading || isNavigating) && !isLandingPage) {
    content = <LoadingSpinner />;
  } else if (!isLandingPage) {
    content = <MessagesView messagesTree={messagesTree} />;
  } else {
    content = <Landing centerFormOnLanding={centerFormOnLanding} />;
  }

  return (
    <ChatFormProvider {...methods}>
      <ChatContext.Provider value={chatHelpers}>
        <AddedChatContext.Provider value={addedChatHelpers}>
          <Presentation>
            <div className="flex h-full w-full flex-col">
              {!isLoading && <Header />}
              <>
                <div
                  className={cn(
                    'flex flex-col',
                    isLandingPage
                      ? 'flex-1 items-center justify-end sm:justify-center'
                      : 'h-full overflow-y-auto',
                  )}
                >
                  {content}
                  <div
                    className={cn(
                      'w-full',
                      isLandingPage && 'max-w-3xl transition-all duration-200 xl:max-w-4xl',
                    )}
                  >
                    <ChatForm index={index} />
                    {isLandingPage ? <ConversationStarters /> : <Footer />}
                  </div>
                </div>
                {isLandingPage && <Footer />}
              </>
            </div>
          </Presentation>
        </AddedChatContext.Provider>
      </ChatContext.Provider>
    </ChatFormProvider>
  );
}

export default memo(ChatView);