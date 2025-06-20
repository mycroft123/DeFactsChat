import { memo, useCallback, useState, useEffect, useRef, useMemo } from 'react';
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

  // IMPORTANT: Declare these BEFORE using them
  const chatHelpers = useChatHelpers(index, conversationId);
  const addedChatHelpers = useAddedResponse({ rootIndex: index });

  // Track active submissions instead of permanent panel states
  const activeSubmissions = useRef<Set<string>>(new Set());
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const submissionTimeouts = useRef<Map<string, any>>(new Map());

  // Add a failsafe to clear stuck submissions after a timeout
  const clearStuckSubmissions = useCallback(() => {
    const now = Date.now();
    const stuckThreshold = 15000; // Reduced to 15 seconds (was 30)
    let hasStuckSubmissions = false;
    
    // Log current state
    if (activeSubmissions.current.size > 0) {
      console.log('🔍 [FAILSAFE CHECK] Active submissions:', {
        count: activeSubmissions.current.size,
        submissions: Array.from(activeSubmissions.current),
        timeSinceLastCheck: now - ((window as any).__lastSubmissionCheck || now)
      });
    }
    
    // Don't use timestamp-based logic since our IDs don't have timestamps anymore
    // Instead, track submission start times separately
    if (activeSubmissions.current.size > 0) {
      // Check if we've been stuck for too long
      const timeSinceCheck = now - ((window as any).__lastSubmissionCheck || 0);
      if (timeSinceCheck > stuckThreshold) {
        hasStuckSubmissions = true;
        console.warn(`⚠️ [SUBMISSION STUCK] Clearing ${activeSubmissions.current.size} stuck submissions after ${stuckThreshold/1000}s`);
        
        // Clear all stuck submissions
        activeSubmissions.current.forEach(submissionId => {
          const timeout = submissionTimeouts.current.get(submissionId);
          if (timeout) {
            clearTimeout(timeout);
            submissionTimeouts.current.delete(submissionId);
          }
        });
        
        activeSubmissions.current.clear();
      }
    } else {
      // Reset the check timer when no active submissions
      (window as any).__lastSubmissionCheck = now;
    }
    
    if (hasStuckSubmissions || activeSubmissions.current.size === 0) {
      // Always try to clear if no active submissions
   //   console.log('🔓 [FAILSAFE] Ensuring submit button is enabled');
      chatHelpers.setIsSubmitting(false);
      addedChatHelpers.setIsSubmitting(false);
    }
  }, [chatHelpers, addedChatHelpers]);

  // Run failsafe check periodically
  useEffect(() => {
    const interval = setInterval(() => {
      clearStuckSubmissions();
      
      // Extra aggressive check - if no active submissions but button still disabled
      if (activeSubmissions.current.size === 0) {
        // Check if submit button is actually disabled (you might need to adjust this check)
        const submitButton = document.querySelector('button[type="submit"]') || 
                           document.querySelector('button[data-testid="send-button"]') ||
                           document.querySelector('textarea')?.closest('form')?.querySelector('button');
        
        if (submitButton && submitButton.hasAttribute('disabled')) {
       //   console.warn('🚨 [FAILSAFE OVERRIDE] Submit button stuck disabled with no active submissions!');
          chatHelpers.setIsSubmitting(false);
          addedChatHelpers.setIsSubmitting(false);
        }
      }
    }, 1000); // Check every 1 second
    return () => clearInterval(interval);
  }, [clearStuckSubmissions, chatHelpers, addedChatHelpers]);

  // Add debug methods to window
  useEffect(() => {
    (window as any).forceResetSubmissions = () => {
      console.log('🔧 [FORCE RESET] Clearing all submissions');
      activeSubmissions.current.clear();
      submissionTimeouts.current.forEach(timeout => clearTimeout(timeout));
      submissionTimeouts.current.clear();
      chatHelpers.setIsSubmitting(false);
      addedChatHelpers.setIsSubmitting(false);
    };

    (window as any).debugSubmissions = () => {
      console.log('🔍 [DEBUG] Current submission state:', {
        activeSubmissions: Array.from(activeSubmissions.current),
        activeCount: activeSubmissions.current.size,
        isComparisonMode,
        rootSubmission: !!rootSubmission,
        addedSubmission: !!addedSubmission,
        timeouts: submissionTimeouts.current.size
      });
    };
    
    return () => {
      delete (window as any).forceResetSubmissions;
      delete (window as any).debugSubmissions;
    };
  }, [chatHelpers, addedChatHelpers, isComparisonMode, rootSubmission, addedSubmission]);

  // Create unique submission IDs
  const getSubmissionId = (submission: any, isAdded: boolean) => {
    if (!submission || !submission.userMessage?.text) return null;
    // Use a more stable ID based on the actual submission content and conversation
    const conversationId = submission.conversation?.conversationId || 'new';
    const messageId = submission.userMessage?.messageId || submission.initialResponse?.messageId || '';
    const text = submission.userMessage?.text || '';
    return `${isAdded ? 'added' : 'root'}-${conversationId}-${messageId}-${text.substring(0, 20).replace(/\s/g, '_')}`;
  };

  // Track when submissions start and complete
  const trackSubmission = useCallback((submissionId: string, isStarting: boolean) => {
    if (!submissionId) return;
    
    if (isStarting) {
      // Only add if not already tracking
      if (activeSubmissions.current.has(submissionId)) {
        console.log(`⚠️ [SUBMISSION TRACKING] Already tracking: ${submissionId}`);
        return;
      }
      
      activeSubmissions.current.add(submissionId);
      
      // Set a timeout to auto-clear this submission if it gets stuck
      const timeout = setTimeout(() => {
        if (activeSubmissions.current.has(submissionId)) {
          console.warn(`⏰ [TIMEOUT] Auto-clearing submission: ${submissionId}`);
          activeSubmissions.current.delete(submissionId);
          
          // Force clear isSubmitting if no active submissions
          if (activeSubmissions.current.size === 0) {
            chatHelpers.setIsSubmitting(false);
            addedChatHelpers.setIsSubmitting(false);
          }
        }
      }, 60000); // Reduced to 1 minute (was 2 minutes)
      
      submissionTimeouts.current.set(submissionId, timeout);
      
      console.log(`📊 [SUBMISSION TRACKING] Started: ${submissionId}`, {
        activeCount: activeSubmissions.current.size,
        activeSubmissions: Array.from(activeSubmissions.current)
      });
    } else {
      // Only delete if we're tracking it
      if (!activeSubmissions.current.has(submissionId)) {
        console.log(`⚠️ [SUBMISSION TRACKING] Not tracking: ${submissionId}`);
        return;
      }
      
      activeSubmissions.current.delete(submissionId);
      
      // Clear the timeout for this submission
      const timeout = submissionTimeouts.current.get(submissionId);
      if (timeout) {
        clearTimeout(timeout);
        submissionTimeouts.current.delete(submissionId);
      }
      
      console.log(`📊 [SUBMISSION TRACKING] Completed: ${submissionId}`, {
        activeCount: activeSubmissions.current.size,
        activeSubmissions: Array.from(activeSubmissions.current)
      });
    }
  }, [chatHelpers, addedChatHelpers]);

  // Create panel-specific chat helpers with submission tracking
// Modified createPanelHelpers function to fix the infinite loop
const createPanelHelpers = useCallback((baseHelpers: any, isAdded: boolean) => {
  // Track last submission ID to prevent duplicates
  let lastSubmissionId: string | null = null;
  let isCurrentlySubmitting = false;
  
  return {
    ...baseHelpers,
    setIsSubmitting: (value: boolean) => {
      const currentSubmissionId = isAdded ? 
        getSubmissionId(addedSubmission, true) : 
        getSubmissionId(rootSubmission, false);

      console.log(`🎯 [PANEL ${isAdded ? 'RIGHT' : 'LEFT'}] setIsSubmitting(${value})`, {
        submissionId: currentSubmissionId,
        lastSubmissionId,
        isCurrentlySubmitting,
        activeCount: activeSubmissions.current.size
      });

      if (value && currentSubmissionId) {
        // FIX: Prevent repeated calls for the same submission
        if (currentSubmissionId === lastSubmissionId && isCurrentlySubmitting) {
          console.log(`⚠️ [PANEL ${isAdded ? 'RIGHT' : 'LEFT'}] Ignoring duplicate setIsSubmitting(true) for same submission`);
          return; // Don't call baseHelpers.setIsSubmitting again
        }
        
        // Only track if it's a new submission
        if (currentSubmissionId !== lastSubmissionId) {
          lastSubmissionId = currentSubmissionId;
          trackSubmission(currentSubmissionId, true);
        }
        
        isCurrentlySubmitting = true;
        baseHelpers.setIsSubmitting(true);
      } else if (!value) {
        // Completing a submission
        if (lastSubmissionId) {
          trackSubmission(lastSubmissionId, false);
          lastSubmissionId = null;
        }
        
        isCurrentlySubmitting = false;

        // In comparison mode, check if all submissions are done
        if (isComparisonMode) {
          // Small delay to ensure both panels have time to update
          setTimeout(() => {
            console.log('🔍 [SUBMISSION CHECK] Checking if all panels done', {
              activeCount: activeSubmissions.current.size,
              activeSubmissions: Array.from(activeSubmissions.current),
              isComparisonMode
            });
            
            if (activeSubmissions.current.size === 0) {
              console.log('✅ [SUBMISSION COMPLETE] All panels done, enabling submit button');
              baseHelpers.setIsSubmitting(false);
            } else {
              console.log('⏳ [SUBMISSION PARTIAL] Still waiting for other panel(s)', {
                remaining: activeSubmissions.current.size,
                active: Array.from(activeSubmissions.current)
              });
            }
          }, 100);
        } else {
          // Single mode - immediately set to false
          console.log('📝 [SINGLE MODE] Setting isSubmitting to false immediately');
          baseHelpers.setIsSubmitting(false);
        }
      }
    }
  };
}, [rootSubmission, addedSubmission, isComparisonMode, trackSubmission]);

  // Create the panel-specific helpers
  const leftChatHelpers = useMemo(() => createPanelHelpers(chatHelpers, false), [chatHelpers, createPanelHelpers]);
  const rightChatHelpers = useMemo(() => createPanelHelpers(addedChatHelpers, true), [addedChatHelpers, createPanelHelpers]);

  // Detect comparison mode - use a more stable detection
  useEffect(() => {
    // Check if we have any comparison submissions in the current conversation
    const hasRootSubmission = !!(rootSubmission && Object.keys(rootSubmission).length > 0);
    const hasAddedSubmission = !!(addedSubmission && Object.keys(addedSubmission).length > 0);
    
    // Once in comparison mode, stay in comparison mode for this conversation
    // Only switch back if explicitly changed by user
    if (hasRootSubmission && hasAddedSubmission && !isComparisonMode) {
      setIsComparisonMode(true);
      console.log(`🔄 [COMPARISON MODE] ENABLED`, {
        hasRootSubmission,
        hasAddedSubmission
      });
    }
    // Don't automatically disable comparison mode just because one panel is empty
    // This prevents UI from switching back to single panel
    else if (isComparisonMode && hasRootSubmission) {
      console.log(`🔄 [COMPARISON MODE] MAINTAINED (waiting for comparison panel)`, {
        hasRootSubmission,
        hasAddedSubmission
      });
    }
  }, [rootSubmission, addedSubmission, isComparisonMode]);

  // Clean up active submissions on unmount
  useEffect(() => {
    return () => {
      activeSubmissions.current.clear();
      // Clear all timeouts
      submissionTimeouts.current.forEach(timeout => clearTimeout(timeout));
      submissionTimeouts.current.clear();
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