import { v4 } from 'uuid';
import { useCallback, useRef } from 'react';
import { useSetRecoilState } from 'recoil';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import {
  QueryKeys,
  Constants,
  EndpointURLs,
  tPresetSchema,
  tMessageSchema,
  tConvoUpdateSchema,
  ContentTypes,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TMessage, TConversation, EventSubmission } from 'librechat-data-provider';
import type { TResData, TFinalResData, ConvoGenerator } from '~/common';
import type { InfiniteData } from '@tanstack/react-query';
import type { TGenTitleMutation } from '~/data-provider';
import type { SetterOrUpdater, Resetter } from 'recoil';
import type { ConversationCursorData } from '~/utils';
import {
  logger,
  scrollToEnd,
  getAllContentText,
  addConvoToAllQueries,
  updateConvoInAllQueries,
  removeConvoFromAllQueries,
  findConversationInInfinite,
} from '~/utils';
import useAttachmentHandler from '~/hooks/SSE/useAttachmentHandler';
import useContentHandler from '~/hooks/SSE/useContentHandler';
import store, { useApplyNewAgentTemplate } from '~/store';
import useStepHandler from '~/hooks/SSE/useStepHandler';
import { useAuthContext } from '~/hooks/AuthContext';
import { MESSAGE_UPDATE_INTERVAL } from '~/common';
import { useLiveAnnouncer } from '~/Providers';

type TSyncData = {
  sync: boolean;
  thread_id: string;
  messages?: TMessage[];
  requestMessage: TMessage;
  responseMessage: TMessage;
  conversationId: string;
};

export type EventHandlerParams = {
  isAddedRequest?: boolean;
  genTitle?: TGenTitleMutation;
  setCompleted: React.Dispatch<React.SetStateAction<Set<unknown>>>;
  setMessages: (messages: TMessage[]) => void;
  getMessages: () => TMessage[] | undefined;
  setIsSubmitting: SetterOrUpdater<boolean>;
  setConversation?: SetterOrUpdater<TConversation | null>;
  newConversation?: ConvoGenerator;
  setShowStopButton: SetterOrUpdater<boolean>;
  resetLatestMessage?: Resetter;
};

const createErrorMessage = ({
  errorMetadata,
  getMessages,
  submission,
  error,
}: {
  getMessages: () => TMessage[] | undefined;
  errorMetadata?: Partial<TMessage>;
  submission: EventSubmission;
  error?: Error | unknown;
}) => {
  console.log('[EVENT_HANDLERS DEBUG - createErrorMessage]', {
    hasErrorMetadata: !!errorMetadata,
    errorType: error?.constructor?.name,
    errorMessage: (error as Error)?.message,
    submissionModel: submission.conversation?.model,
  });

  const currentMessages = getMessages();
  const latestMessage = currentMessages?.[currentMessages.length - 1];
  let errorMessage: TMessage;
  const text = submission.initialResponse.text.length > 45 ? submission.initialResponse.text : '';
  const errorText =
    (errorMetadata?.text || text || (error as Error | undefined)?.message) ??
    'Error cancelling request';
  const latestContent = latestMessage?.content ?? [];
  let isValidContentPart = false;
  if (latestContent.length > 0) {
    const latestContentPart = latestContent[latestContent.length - 1];
    const latestPartValue = latestContentPart?.[latestContentPart.type ?? ''];
    isValidContentPart =
      latestContentPart.type !== ContentTypes.TEXT ||
      (latestContentPart.type === ContentTypes.TEXT && typeof latestPartValue === 'string')
        ? true
        : latestPartValue?.value !== '';
  }
  if (
    latestMessage?.conversationId &&
    latestMessage?.messageId &&
    latestContent &&
    isValidContentPart
  ) {
    const content = [...latestContent];
    content.push({
      type: ContentTypes.ERROR,
      error: errorText,
    });
    errorMessage = {
      ...latestMessage,
      ...errorMetadata,
      error: undefined,
      text: '',
      content,
    };
    if (
      submission.userMessage.messageId &&
      submission.userMessage.messageId !== errorMessage.parentMessageId
    ) {
      errorMessage.parentMessageId = submission.userMessage.messageId;
    }
    return errorMessage;
  } else if (errorMetadata) {
    return errorMetadata as TMessage;
  } else {
    errorMessage = {
      ...submission,
      ...submission.initialResponse,
      text: errorText,
      unfinished: !!text.length,
      error: true,
    };
  }
  return tMessageSchema.parse(errorMessage);
};

export const getConvoTitle = ({
  parentId,
  queryClient,
  currentTitle,
  conversationId,
}: {
  parentId?: string | null;
  queryClient: ReturnType<typeof useQueryClient>;
  currentTitle?: string | null;
  conversationId?: string | null;
}): string | null | undefined => {
  if (
    parentId !== Constants.NO_PARENT &&
    (currentTitle?.toLowerCase().includes('new chat') ?? false)
  ) {
    const currentConvo = queryClient.getQueryData<TConversation>([
      QueryKeys.conversation,
      conversationId,
    ]);
    if (currentConvo?.title) {
      return currentConvo.title;
    }
    const convos = queryClient.getQueryData<InfiniteData<ConversationCursorData>>([
      QueryKeys.allConversations,
    ]);
    const cachedConvo = findConversationInInfinite(convos, conversationId ?? '');
    return cachedConvo?.title ?? currentConvo?.title ?? null;
  }
  return currentTitle;
};

export default function useEventHandlers({
  genTitle,
  setMessages,
  getMessages,
  setCompleted,
  isAddedRequest = false,
  setConversation,
  setIsSubmitting,
  newConversation,
  setShowStopButton,
  resetLatestMessage,
}: EventHandlerParams) {
  const queryClient = useQueryClient();
  const { announcePolite } = useLiveAnnouncer();
  const applyAgentTemplate = useApplyNewAgentTemplate();
  const setAbortScroll = useSetRecoilState(store.abortScroll);
  const navigate = useNavigate();
  const location = useLocation();

  const lastAnnouncementTimeRef = useRef(Date.now());
  const { conversationId: paramId } = useParams();
  const { token } = useAuthContext();

  // Debug ref to track handler calls
  const handlerCallsRef = useRef({
    messageHandler: 0,
    syncHandler: 0,
    createdHandler: 0,
    finalHandler: 0,
    errorHandler: 0,
  });

  const contentHandler = useContentHandler({ setMessages, getMessages });
  const stepHandler = useStepHandler({
    setMessages,
    getMessages,
    announcePolite,
    setIsSubmitting,
    lastAnnouncementTimeRef,
  });
  const attachmentHandler = useAttachmentHandler(queryClient);

  const messageHandler = useCallback(
    (data: string | undefined, submission: EventSubmission) => {
      handlerCallsRef.current.messageHandler++;
      console.log('[EVENT_HANDLERS DEBUG - messageHandler]', {
        callCount: handlerCallsRef.current.messageHandler,
        dataLength: data?.length || 0,
        isAddedRequest,
        model: submission.conversation?.model,
        endpoint: submission.conversation?.endpoint,
        isRegenerate: submission.isRegenerate,
        hasPlugin: !!submission.plugin,
        hasPlugins: !!submission.plugins?.length,
      });

      const {
        messages,
        userMessage,
        plugin,
        plugins,
        initialResponse,
        isRegenerate = false,
      } = submission;
      const text = data ?? '';
      setIsSubmitting(true);

      const currentTime = Date.now();
      if (currentTime - lastAnnouncementTimeRef.current > MESSAGE_UPDATE_INTERVAL) {
        announcePolite({ message: 'composing', isStatus: true });
        lastAnnouncementTimeRef.current = currentTime;
      }

      const responseMessage = {
        ...initialResponse,
        text,
        plugin: plugin ?? null,
        plugins: plugins ?? [],
      };

      console.log('[EVENT_HANDLERS DEBUG - messageHandler response]', {
        responseMessageId: responseMessage.messageId,
        textLength: text.length,
        textPreview: text.substring(0, 100),
      });

      if (isRegenerate) {
        setMessages([...messages, responseMessage]);
      } else {
        setMessages([...messages, userMessage, responseMessage]);
      }
    },
    [setMessages, announcePolite, setIsSubmitting, isAddedRequest],
  );

  const cancelHandler = useCallback(
    (data: TResData, submission: EventSubmission) => {
      console.log('[EVENT_HANDLERS DEBUG - cancelHandler]', {
        hasRequestMessage: !!data.requestMessage,
        hasResponseMessage: !!data.responseMessage,
        responseText: data.responseMessage?.text?.substring(0, 100),
        hasConversation: !!data.conversation,
        isAddedRequest,
        model: submission.conversation?.model,
      });

      const { requestMessage, responseMessage, conversation } = data;
      const { messages, isRegenerate = false } = submission;
      const convoUpdate =
        (conversation as TConversation | null) ?? (submission.conversation as TConversation);

      // update the messages
      if (isRegenerate) {
        const messagesUpdate = (
          [...messages, responseMessage] as Array<TMessage | undefined>
        ).filter((msg) => msg);
        setMessages(messagesUpdate as TMessage[]);
      } else {
        const messagesUpdate = (
          [...messages, requestMessage, responseMessage] as Array<TMessage | undefined>
        ).filter((msg) => msg);
        setMessages(messagesUpdate as TMessage[]);
      }

      const isNewConvo = conversation.conversationId !== submission.conversation.conversationId;
      if (isNewConvo) {
        removeConvoFromAllQueries(queryClient, submission.conversation.conversationId as string);
      }

      // refresh title
      if (genTitle && isNewConvo && requestMessage.parentMessageId === Constants.NO_PARENT) {
        setTimeout(() => {
          genTitle.mutate({ conversationId: convoUpdate.conversationId as string });
        }, 2500);
      }

      if (setConversation && !isAddedRequest) {
        setConversation((prevState) => {
          const update = { ...prevState, ...convoUpdate };
          return update;
        });
      }

      setIsSubmitting(false);
    },
    [setMessages, setConversation, genTitle, isAddedRequest, queryClient, setIsSubmitting],
  );

  const syncHandler = useCallback(
    (data: TSyncData, submission: EventSubmission) => {
      handlerCallsRef.current.syncHandler++;
      console.log('[EVENT_HANDLERS DEBUG - syncHandler]', {
        callCount: handlerCallsRef.current.syncHandler,
        conversationId: data.conversationId,
        threadId: data.thread_id,
        hasResponseMessage: !!data.responseMessage,
        responseText: data.responseMessage?.text?.substring(0, 100),
        isAddedRequest,
        model: submission.conversation?.model,
      });

      const { conversationId, thread_id, responseMessage, requestMessage } = data;
      const { initialResponse, messages: _messages, userMessage } = submission;
      const messages = _messages.filter((msg) => msg.messageId !== userMessage.messageId);

      setMessages([
        ...messages,
        requestMessage,
        {
          ...initialResponse,
          ...responseMessage,
        },
      ]);

      announcePolite({
        message: 'start',
        isStatus: true,
      });

      let update = {} as TConversation;
      if (setConversation && !isAddedRequest) {
        setConversation((prevState) => {
          const parentId = requestMessage.parentMessageId;
          const title = getConvoTitle({
            parentId,
            queryClient,
            conversationId,
            currentTitle: prevState?.title,
          });
          update = tConvoUpdateSchema.parse({
            ...prevState,
            conversationId,
            thread_id,
            title,
            messages: [requestMessage.messageId, responseMessage.messageId],
          }) as TConversation;
          return update;
        });

        if (requestMessage.parentMessageId === Constants.NO_PARENT) {
          addConvoToAllQueries(queryClient, update);
        } else {
          updateConvoInAllQueries(queryClient, update.conversationId!, (_c) => update);
        }
      } else if (setConversation) {
        setConversation((prevState) => {
          update = tConvoUpdateSchema.parse({
            ...prevState,
            conversationId,
            thread_id,
            messages: [requestMessage.messageId, responseMessage.messageId],
          }) as TConversation;
          return update;
        });
      }

      setShowStopButton(true);
      if (resetLatestMessage) {
        resetLatestMessage();
      }
    },
    [
      queryClient,
      setMessages,
      isAddedRequest,
      announcePolite,
      setConversation,
      setShowStopButton,
      resetLatestMessage,
    ],
  );

  const createdHandler = useCallback(
    (data: TResData, submission: EventSubmission) => {
      handlerCallsRef.current.createdHandler++;
      console.log('[EVENT_HANDLERS DEBUG - createdHandler]', {
        callCount: handlerCallsRef.current.createdHandler,
        conversationId: submission.userMessage.conversationId,
        isAddedRequest,
        isRegenerate: submission.isRegenerate,
        isTemporary: submission.isTemporary,
        model: submission.conversation?.model,
        endpoint: submission.conversation?.endpoint,
        parentMessageId: submission.userMessage.parentMessageId,
      });

      const { messages, userMessage, isRegenerate = false, isTemporary = false } = submission;
      const initialResponse = {
        ...submission.initialResponse,
        parentMessageId: userMessage.messageId,
        messageId: userMessage.messageId + '_',
      };

      console.log('[EVENT_HANDLERS DEBUG - createdHandler initialResponse]', {
        messageId: initialResponse.messageId,
        parentMessageId: initialResponse.parentMessageId,
        hasText: !!initialResponse.text,
        textLength: initialResponse.text?.length || 0,
      });

      if (isRegenerate) {
        setMessages([...messages, initialResponse]);
      } else {
        setMessages([...messages, userMessage, initialResponse]);
      }

      const { conversationId, parentMessageId } = userMessage;
      lastAnnouncementTimeRef.current = Date.now();
      announcePolite({
        message: 'start',
        isStatus: true,
      });

      let update = {} as TConversation;
      if (conversationId) {
        applyAgentTemplate(conversationId, submission.conversation.conversationId);
      }
      if (setConversation && !isAddedRequest) {
        setConversation((prevState) => {
          const parentId = isRegenerate ? userMessage.overrideParentMessageId : parentMessageId;
          const title = getConvoTitle({
            parentId,
            queryClient,
            conversationId,
            currentTitle: prevState?.title,
          });
          update = tConvoUpdateSchema.parse({
            ...prevState,
            conversationId,
            title,
          }) as TConversation;
          return update;
        });

        if (!isTemporary) {
          if (parentMessageId === Constants.NO_PARENT) {
            addConvoToAllQueries(queryClient, update);
          } else {
            updateConvoInAllQueries(queryClient, update.conversationId!, (_c) => update);
          }
        }
      } else if (setConversation) {
        setConversation((prevState) => {
          update = tConvoUpdateSchema.parse({
            ...prevState,
            conversationId,
          }) as TConversation;
          return update;
        });
      }

      if (resetLatestMessage) {
        resetLatestMessage();
      }
      scrollToEnd(() => setAbortScroll(false));
    },
    [
      setMessages,
      queryClient,
      setAbortScroll,
      isAddedRequest,
      announcePolite,
      setConversation,
      resetLatestMessage,
      applyAgentTemplate,
    ],
  );

  const finalHandler = useCallback(
    (data: TFinalResData, submission: EventSubmission) => {
      handlerCallsRef.current.finalHandler++;
      const { requestMessage, responseMessage, conversation, runMessages } = data;
      const {
        messages,
        conversation: submissionConvo,
        isRegenerate = false,
        isTemporary = false,
      } = submission;

      console.log('[EVENT_HANDLERS DEBUG - FINAL HANDLER START]', {
        callCount: handlerCallsRef.current.finalHandler,
        isAddedRequest,
        model: submissionConvo?.model,
        endpoint: submissionConvo?.endpoint,
        messageId: responseMessage?.messageId,
        hasResponseMessage: !!responseMessage,
        hasRequestMessage: !!requestMessage,
        hasText: !!responseMessage?.text,
        textLength: responseMessage?.text?.length || 0,
        textPreview: responseMessage?.text?.substring(0, 100),
        conversationId: conversation?.conversationId,
        currentMessages: getMessages()?.length || 0,
        runMessages: runMessages?.length || 0,
        hasContent: !!responseMessage?.content?.length,
        contentTypes: responseMessage?.content?.map(c => c.type),
      });

      // Check for empty response from DeFacts or other models
      if (responseMessage && !responseMessage.text && (!responseMessage.content || responseMessage.content.length === 0)) {
        console.warn('[EVENT_HANDLERS WARNING - EMPTY RESPONSE]', {
          messageId: responseMessage.messageId,
          model: submissionConvo?.model,
          endpoint: submissionConvo?.endpoint,
          conversationId: conversation?.conversationId,
        });
        
        // Add error content to empty response
        responseMessage.content = [{
          type: ContentTypes.ERROR,
          error: `No response received from ${submissionConvo?.model || 'AI'}`,
        }];
        responseMessage.error = true;
      }

      setShowStopButton(false);
      setCompleted((prev) => new Set(prev.add(submission.initialResponse.messageId)));

      const currentMessages = getMessages();
      /* Early return if messages are empty; i.e., the user navigated away */
      if (!currentMessages || currentMessages.length === 0) {
        console.log('[EVENT_HANDLERS DEBUG - EARLY RETURN] No current messages');
        setIsSubmitting(false);
        return;
      }

      /* a11y announcements */
      announcePolite({ message: 'end', isStatus: true });
      announcePolite({ message: getAllContentText(responseMessage) });

      /* Update messages; if assistants endpoint, client doesn't receive responseMessage */
      let finalMessages: TMessage[] = [];
      if (runMessages) {
        finalMessages = [...runMessages];
      } else if (isRegenerate && responseMessage) {
        finalMessages = [...messages, responseMessage];
      } else if (requestMessage != null && responseMessage != null) {
        finalMessages = [...messages, requestMessage, responseMessage];
      }

      const isComparison = isAddedRequest === true;
      const cacheKey = isComparison 
        ? `${conversation.conversationId}_comparison`
        : conversation.conversationId;

      console.log('[EVENT_HANDLERS DEBUG - BEFORE SET MESSAGES]', {
        finalMessagesCount: finalMessages.length,
        lastMessage: finalMessages[finalMessages.length - 1],
        lastMessageId: finalMessages[finalMessages.length - 1]?.messageId,
        lastMessageText: finalMessages[finalMessages.length - 1]?.text?.substring(0, 100),
        lastMessageModel: finalMessages[finalMessages.length - 1]?.model,
        lastMessageContent: finalMessages[finalMessages.length - 1]?.content,
        isComparison,
        conversationId: conversation?.conversationId,
        cacheKey,
      });

      if (finalMessages.length > 0) {
        setMessages(finalMessages);
        
        // Set messages in query cache with appropriate key
        queryClient.setQueryData<TMessage[]>(
          [QueryKeys.messages, cacheKey],
          finalMessages,
        );

        console.log('[EVENT_HANDLERS DEBUG - AFTER SET MESSAGES]', {
          updatedMessages: getMessages()?.length || 0,
          cacheKey,
          isAddedRequest,
          cachedMessages: queryClient.getQueryData<TMessage[]>([QueryKeys.messages, cacheKey])?.length || 0,
        });
      } else if (
        isAssistantsEndpoint(submissionConvo.endpoint) &&
        (!submissionConvo.conversationId || submissionConvo.conversationId === Constants.NEW_CONVO)
      ) {
        queryClient.setQueryData<TMessage[]>(
          [QueryKeys.messages, conversation.conversationId],
          [...currentMessages],
        );
      }

      const isNewConvo = conversation.conversationId !== submissionConvo.conversationId;
      if (isNewConvo) {
        console.log('[EVENT_HANDLERS DEBUG - NEW CONVO]', {
          oldConvoId: submissionConvo.conversationId,
          newConvoId: conversation.conversationId,
        });
        removeConvoFromAllQueries(queryClient, submissionConvo.conversationId as string);
      }

      /* Refresh title */
      if (
        genTitle &&
        isNewConvo &&
        !isTemporary &&
        requestMessage &&
        requestMessage.parentMessageId === Constants.NO_PARENT
      ) {
        setTimeout(() => {
          genTitle.mutate({ conversationId: conversation.conversationId as string });
        }, 2500);
      }

      if (setConversation && isAddedRequest !== true) {
        setConversation((prevState) => {
          const update = {
            ...prevState,
            ...(conversation as TConversation),
          };
          if (prevState?.model != null && prevState.model !== submissionConvo.model) {
            update.model = prevState.model;
          }
          const cachedConvo = queryClient.getQueryData<TConversation>([
            QueryKeys.conversation,
            conversation.conversationId,
          ]);
          if (!cachedConvo) {
            queryClient.setQueryData([QueryKeys.conversation, conversation.conversationId], update);
          }
          return update;
        });
        if (location.pathname === '/c/new') {
          navigate(`/c/${conversation.conversationId}`, { replace: true });
        }
      }

      setIsSubmitting(false);

      console.log('[EVENT_HANDLERS DEBUG - FINAL HANDLER END]', {
        handlerCalls: handlerCallsRef.current,
        finalConversationId: conversation.conversationId,
        isAddedRequest,
      });
    },
    [
      setShowStopButton,
      setCompleted,
      getMessages,
      announcePolite,
      genTitle,
      setConversation,
      isAddedRequest,
      setIsSubmitting,
      setMessages,
      queryClient,
      location.pathname,
      navigate,
    ],
  );

  const errorHandler = useCallback(
    ({ data, submission }: { data?: TResData; submission: EventSubmission }) => {
      handlerCallsRef.current.errorHandler++;
      console.log('[EVENT_HANDLERS DEBUG - errorHandler]', {
        callCount: handlerCallsRef.current.errorHandler,
        hasData: !!data,
        errorMessage: data?.responseMessage?.text || data?.text,
        model: submission.conversation?.model,
        endpoint: submission.conversation?.endpoint,
        isAddedRequest,
      });

      const { messages, userMessage, initialResponse } = submission;
      setCompleted((prev) => new Set(prev.add(initialResponse.messageId)));

      const conversationId =
        userMessage.conversationId ?? submission.conversation?.conversationId ?? '';

      const setErrorMessages = (convoId: string, errorMessage: TMessage) => {
        const finalMessages: TMessage[] = [...messages, userMessage, errorMessage];
        setMessages(finalMessages);
        
        const cacheKey = isAddedRequest ? `${convoId}_comparison` : convoId;
        queryClient.setQueryData<TMessage[]>([QueryKeys.messages, cacheKey], finalMessages);
        
        console.log('[EVENT_HANDLERS DEBUG - ERROR MESSAGES SET]', {
          convoId,
          cacheKey,
          errorMessageText: errorMessage.text,
          finalMessagesCount: finalMessages.length,
        });
      };

      const parseErrorResponse = (data: TResData | Partial<TMessage>) => {
        const metadata = data['responseMessage'] ?? data;
        const errorMessage: Partial<TMessage> = {
          ...initialResponse,
          ...metadata,
          error: true,
          parentMessageId: userMessage.messageId,
        };

        if (errorMessage.messageId === undefined || errorMessage.messageId === '') {
          errorMessage.messageId = v4();
        }

        return tMessageSchema.parse(errorMessage);
      };

      if (!data) {
        const convoId = conversationId || `_${v4()}`;
        const errorMetadata = parseErrorResponse({
          text: 'Error connecting to server, try refreshing the page.',
          ...submission,
          conversationId: convoId,
        });
        const errorResponse = createErrorMessage({
          errorMetadata,
          getMessages,
          submission,
        });
        setErrorMessages(convoId, errorResponse);
        if (newConversation) {
          newConversation({
            template: { conversationId: convoId },
            preset: tPresetSchema.parse(submission.conversation),
          });
        }
        setIsSubmitting(false);
        return;
      }

      const receivedConvoId = data.conversationId ?? '';
      if (!conversationId && !receivedConvoId) {
        const convoId = `_${v4()}`;
        const errorResponse = parseErrorResponse(data);
        setErrorMessages(convoId, errorResponse);
        if (newConversation) {
          newConversation({
            template: { conversationId: convoId },
            preset: tPresetSchema.parse(submission.conversation),
          });
        }
        setIsSubmitting(false);
        return;
      } else if (!receivedConvoId) {
        const errorResponse = parseErrorResponse(data);
        setErrorMessages(conversationId, errorResponse);
        setIsSubmitting(false);
        return;
      }

      const errorResponse = tMessageSchema.parse({
        ...data,
        error: true,
        parentMessageId: userMessage.messageId,
      });

      setErrorMessages(receivedConvoId, errorResponse);
      if (receivedConvoId && paramId === Constants.NEW_CONVO && newConversation) {
        newConversation({
          template: { conversationId: receivedConvoId },
          preset: tPresetSchema.parse(submission.conversation),
        });
      }

      setIsSubmitting(false);
      return;
    },
    [
      setCompleted,
      setMessages,
      paramId,
      newConversation,
      setIsSubmitting,
      getMessages,
      queryClient,
      isAddedRequest,
    ],
  );

  const abortConversation = useCallback(
    async (conversationId = '', submission: EventSubmission, messages?: TMessage[]) => {
      console.log('[EVENT_HANDLERS DEBUG - abortConversation]', {
        conversationId,
        model: submission.conversation?.model,
        endpoint: submission.conversation?.endpoint,
        messagesLength: messages?.length,
        isAddedRequest,
      });

      const runAbortKey = `${conversationId}:${messages?.[messages.length - 1]?.messageId ?? ''}`;
      const { endpoint: _endpoint, endpointType } =
        (submission.conversation as TConversation | null) ?? {};
      const endpoint = endpointType ?? _endpoint;
      if (
        !isAssistantsEndpoint(endpoint) &&
        messages?.[messages.length - 1] != null &&
        messages[messages.length - 2] != null
      ) {
        let requestMessage = messages[messages.length - 2];
        const responseMessage = messages[messages.length - 1];
        if (requestMessage.messageId !== responseMessage.parentMessageId) {
          // the request message is the parent of response, which we search for backwards
          for (let i = messages.length - 3; i >= 0; i--) {
            if (messages[i].messageId === responseMessage.parentMessageId) {
              requestMessage = messages[i];
              break;
            }
          }
        }
        finalHandler(
          {
            conversation: {
              conversationId,
            },
            requestMessage,
            responseMessage,
          },
          submission,
        );
        return;
      } else if (!isAssistantsEndpoint(endpoint)) {
        const convoId = conversationId || `_${v4()}`;
        logger.log('conversation', 'Aborted conversation with minimal messages, ID: ' + convoId);
        if (newConversation) {
          newConversation({
            template: { conversationId: convoId },
            preset: tPresetSchema.parse(submission.conversation),
          });
        }
        setIsSubmitting(false);
        return;
      }

      try {
        const response = await fetch(`${EndpointURLs[endpoint ?? '']}/abort`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            abortKey: runAbortKey,
            endpoint,
          }),
        });

        // Check if the response is JSON
        const contentType = response.headers.get('content-type');
        if (contentType != null && contentType.includes('application/json')) {
          const data = await response.json();
          console.log('[EVENT_HANDLERS DEBUG - abort response]', {
            status: response.status,
            hasFinal: data.final === true,
            hasResponseMessage: !!data.responseMessage,
          });
          
          if (response.status === 404) {
            setIsSubmitting(false);
            return;
          }
          if (data.final === true) {
            finalHandler(data, submission);
          } else {
            cancelHandler(data, submission);
          }
        } else if (response.status === 204 || response.status === 200) {
          setIsSubmitting(false);
        } else {
          throw new Error(
            'Unexpected response from server; Status: ' +
              response.status +
              ' ' +
              response.statusText,
          );
        }
      } catch (error) {
        console.error('[EVENT_HANDLERS ERROR - abortConversation]', error);
        const errorResponse = createErrorMessage({
          getMessages,
          submission,
          error,
        });
        setMessages([...submission.messages, submission.userMessage, errorResponse]);
        if (newConversation) {
          newConversation({
            template: { conversationId: conversationId || errorResponse.conversationId || v4() },
            preset: tPresetSchema.parse(submission.conversation),
          });
        }
        setIsSubmitting(false);
      }
    },
    [
      finalHandler,
      newConversation,
      setIsSubmitting,
      token,
      cancelHandler,
      getMessages,
      setMessages,
      isAddedRequest,
    ],
  );

  return {
    stepHandler,
    syncHandler,
    finalHandler,
    errorHandler,
    messageHandler,
    contentHandler,
    createdHandler,
    attachmentHandler,
    abortConversation,
  };
}

// Export this helper hook separately for use in comparison views
export function useComparisonMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  
  return useQuery({
    queryKey: [QueryKeys.messages, `${conversationId}_comparison`],
    queryFn: () => {
      // First try to get comparison messages
      const comparisonMessages = queryClient.getQueryData<TMessage[]>(
        [QueryKeys.messages, `${conversationId}_comparison`]
      );
      
      console.log('[COMPARISON MESSAGES DEBUG]', {
        conversationId,
        hasComparisonMessages: !!comparisonMessages,
        comparisonLength: comparisonMessages?.length || 0,
        lastComparisonMessage: comparisonMessages?.[comparisonMessages.length - 1],
        lastComparisonText: comparisonMessages?.[comparisonMessages.length - 1]?.text?.substring(0, 100),
      });
      
      if (comparisonMessages && comparisonMessages.length > 0) {
        return comparisonMessages;
      }
      
      // Fallback to regular messages if no comparison messages yet
      const regularMessages = queryClient.getQueryData<TMessage[]>(
        [QueryKeys.messages, conversationId]
      ) || [];
      
      console.log('[COMPARISON MESSAGES DEBUG - FALLBACK]', {
        regularLength: regularMessages.length,
        lastRegularMessage: regularMessages[regularMessages.length - 1],
      });
      
      return regularMessages;
    },
    enabled: !!conversationId,
  });
}