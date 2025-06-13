import { memo, useCallback, useState, useEffect, useRef } from 'react';
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

  // Track active submissions instead of permanent panel states
  const activeSubmissions = useRef<Set<string>>(new Set());
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

  // Create unique submission IDs
  const getSubmissionId = (submission: any, isAdded: boolean) => {
    if (!submission) return null;
    const timestamp = submission.timestamp || Date.now();
    const text = submission.userMessage?.text || '';
    return `${isAdded ? 'added' : 'root'}-${timestamp}-${text.substring(0, 20)}`;
  };

  // Track when submissions start and complete
  const trackSubmission = (submissionId: string, isStarting: boolean) => {
    if (isStarting) {
      activeSubmissions.current.add(submissionId);
      console.log(`📊 [SUBMISSION TRACKING] Started: ${submissionId}`, {
        activeCount: activeSubmissions.current.size,
        activeSubmissions: Array.from(activeSubmissions.current)
      });
    } else {
      activeSubmissions.current.delete(submissionId);
      console.log(`📊 [SUBMISSION TRACKING] Completed: ${submissionId}`, {
        activeCount: activeSubmissions.current.size,
        activeSubmissions: Array.from(activeSubmissions.current)
      });
    }
  };

  // Create panel-specific chat helpers with submission tracking
  const createPanelHelpers = (baseHelpers: any, isAdded: boolean) => {
    const currentSubmissionId = isAdded ? 
      getSubmissionId(addedSubmission, true) : 
      getSubmissionId(rootSubmission, false);

    return {
      ...baseHelpers,
      setIsSubmitting: (value: boolean) => {
        if (currentSubmissionId) {
          trackSubmission(currentSubmissionId, value);
        }

        // In comparison mode, only set global isSubmitting false when all submissions are done
        if (!value && isComparisonMode) {
          // Check if there are any active submissions left
          if (activeSubmissions.current.size === 0) {
            baseHelpers.setIsSubmitting(false);
          }
          // Don't set global isSubmitting to false yet if there are active submissions
        } else {
          // In single mode or when starting a submission, pass through
          baseHelpers.setIsSubmitting(value);
        }
      }
    };
  };

  // Create the panel-specific helpers
  const leftChatHelpers = createPanelHelpers(chatHelpers, false);
  const rightChatHelpers = createPanelHelpers(addedChatHelpers, true);

  // Detect comparison mode
  useEffect(() => {
    const hasComparison = !!(rootSubmission && addedSubmission && 
                           Object.keys(rootSubmission).length > 0 && 
                           Object.keys(addedSubmission).length > 0);
    setIsComparisonMode(hasComparison);
    
    console.log(`🔄 [COMPARISON MODE] ${hasComparison ? 'ENABLED' : 'DISABLED'}`, {
      hasRootSubmission: !!(rootSubmission && Object.keys(rootSubmission).length > 0),
      hasAddedSubmission: !!(addedSubmission && Object.keys(addedSubmission).length > 0)
    });
  }, [rootSubmission, addedSubmission]);

  // Clean up active submissions on unmount
  useEffect(() => {
    return () => {
      activeSubmissions.current.clear();
    };
  }, []);

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