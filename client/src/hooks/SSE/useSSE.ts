import { useEffect, useState } from 'react';
import { v4 } from 'uuid';
import { SSE } from 'sse.js';
import { useSetRecoilState } from 'recoil';
import {
  request,
  Constants,
  /* @ts-ignore */
  createPayload,
  isAgentsEndpoint,
  LocalStorageKeys,
  removeNullishValues,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TMessage, TPayload, TSubmission, EventSubmission } from 'librechat-data-provider';
import type { EventHandlerParams } from './useEventHandlers';
import type { TResData } from '~/common';
import { useGenTitleMutation, useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import useEventHandlers from './useEventHandlers';
import store from '~/store';

const clearDraft = (conversationId?: string | null) => {
  if (conversationId) {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${conversationId}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${conversationId}`);
  } else {
    localStorage.removeItem(`${LocalStorageKeys.TEXT_DRAFT}${Constants.NEW_CONVO}`);
    localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`);
  }
};

type ChatHelpers = Pick <
  EventHandlerParams,
  | 'setMessages'
  | 'getMessages'
  | 'setConversation'
  | 'setIsSubmitting'
  | 'newConversation'
  | 'resetLatestMessage'
>;

export default function useSSE(
  submission: TSubmission | null,
  chatHelpers: ChatHelpers,
  isAddedRequest = false,
  runIndex = 0,
) {
  const genTitle = useGenTitleMutation();
  const setActiveRunId = useSetRecoilState(store.activeRunFamily(runIndex));

  const { token, isAuthenticated } = useAuthContext();
  const [completed, setCompleted] = useState(new Set());
  const setAbortScroll = useSetRecoilState(store.abortScrollFamily(runIndex));
  const setShowStopButton = useSetRecoilState(store.showStopButtonByIndex(runIndex));

  const {
    setMessages,
    getMessages,
    setConversation,
    setIsSubmitting,
    newConversation,
    resetLatestMessage,
  } = chatHelpers;

  const {
    stepHandler,
    syncHandler,
    finalHandler,
    errorHandler,
    messageHandler,
    contentHandler,
    createdHandler,
    attachmentHandler,
    abortConversation,
  } = useEventHandlers({
    genTitle,
    setMessages,
    getMessages,
    setCompleted,
    isAddedRequest,
    setConversation,
    setIsSubmitting,
    newConversation,
    setShowStopButton,
    resetLatestMessage,
  });

  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });

  useEffect(() => {
    if (submission == null || Object.keys(submission).length === 0) {
      return;
    }

    let { userMessage } = submission;

    const payloadData = createPayload(submission);
    let { payload } = payloadData;
    if (isAssistantsEndpoint(payload.endpoint) || isAgentsEndpoint(payload.endpoint)) {
      payload = removeNullishValues(payload) as TPayload;
    }

    // Enhanced debugging
    console.log('🚀 [useSSE] Sending request:', {
      model: payload?.model,
      endpoint: payload?.endpoint,
      isAddedRequest,
      conversationId: submission?.conversation?.conversationId,
      userMessage: userMessage?.text?.substring(0, 50) + '...',
    });
    
    console.log('📦 [useSSE] Full payload:', JSON.stringify(payload, null, 2));
    console.log('🔗 [useSSE] Server URL:', payloadData.server);

    let textIndex = null;

    const sse = new SSE(payloadData.server, {
      payload: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });

    // Add debugging for all SSE events
    sse.addEventListener('open', () => {
      setAbortScroll(false);
      console.log('✅ [useSSE] Connection opened successfully');
      console.log('📡 [useSSE] Connection details:', {
        url: payloadData.server,
        readyState: sse.readyState,
        withCredentials: sse.withCredentials,
      });
    });

    sse.addEventListener('attachment', (e: MessageEvent) => {
      console.log('📎 [useSSE] Attachment event received:', e.data);
      try {
        const data = JSON.parse(e.data);
        attachmentHandler({ data, submission: submission as EventSubmission });
      } catch (error) {
        console.error('❌ [useSSE] Error parsing attachment:', error);
      }
    });

    sse.addEventListener('message', (e: MessageEvent) => {
      console.log('💬 [useSSE] Message event received:', e.data?.substring(0, 100) + '...');
      
      let data;
      try {
        data = JSON.parse(e.data);
      } catch (error) {
        console.error('❌ [useSSE] Error parsing message:', error);
        console.error('Raw message data:', e.data);
        return;
      }

      if (data.final != null) {
        console.log('✅ [useSSE] Final message received:', data);
        clearDraft(submission.conversation?.conversationId);
        const { plugins } = data;
        finalHandler(data, { ...submission, plugins } as EventSubmission);
        (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();
        console.log('final', data);
        return;
      } else if (data.created != null) {
        console.log('🆕 [useSSE] Created event:', data);
        const runId = v4();
        setActiveRunId(runId);
        userMessage = {
          ...userMessage,
          ...data.message,
          overrideParentMessageId: userMessage.overrideParentMessageId,
        };

        createdHandler(data, { ...submission, userMessage } as EventSubmission);
      } else if (data.event != null) {
        console.log('📊 [useSSE] Step event:', data);
        stepHandler(data, { ...submission, userMessage } as EventSubmission);
      } else if (data.sync != null) {
        console.log('🔄 [useSSE] Sync event:', data);
        const runId = v4();
        setActiveRunId(runId);
        /* synchronize messages to Assistants API as well as with real DB ID's */
        syncHandler(data, { ...submission, userMessage } as EventSubmission);
      } else if (data.type != null) {
        console.log('📝 [useSSE] Content event:', { type: data.type, index: data.index });
        const { text, index } = data;
        if (text != null && index !== textIndex) {
          textIndex = index;
        }

        contentHandler({ data, submission: submission as EventSubmission });
      } else {
        console.log('📨 [useSSE] Standard message:', data);
        const text = data.text ?? data.response;
        const { plugin, plugins } = data;

        const initialResponse = {
          ...(submission.initialResponse as TMessage),
          parentMessageId: data.parentMessageId,
          messageId: data.messageId,
        };

        if (data.message != null) {
          messageHandler(text, { ...submission, plugin, plugins, userMessage, initialResponse });
        }
      }
    });

    sse.addEventListener('cancel', async () => {
      console.log('🚫 [useSSE] Cancel event received');
      const streamKey = (submission as TSubmission | null)?.['initialResponse']?.messageId;
      if (completed.has(streamKey)) {
        setIsSubmitting(false);
        setCompleted((prev) => {
          prev.delete(streamKey);
          return new Set(prev);
        });
        return;
      }

      setCompleted((prev) => new Set(prev.add(streamKey)));
      const latestMessages = getMessages();
      const conversationId = latestMessages?.[latestMessages.length - 1]?.conversationId;
      return await abortConversation(
        conversationId ??
          userMessage.conversationId ??
          submission.conversation?.conversationId ??
          '',
        submission as EventSubmission,
        latestMessages,
      );
    });

    sse.addEventListener('error', async (e: MessageEvent) => {
      console.error('❌ [useSSE] Error in server stream');
      console.error('🔍 [useSSE] Error event details:', {
        data: e.data,
        type: e.type,
        lastEventId: e.lastEventId,
        origin: e.origin,
        /* @ts-ignore */
        responseCode: e.responseCode,
        /* @ts-ignore */
        statusCode: e.statusCode,
        /* @ts-ignore */
        status: e.status,
      });
      
      // Log the full error event
      console.error('🔍 [useSSE] Full error event:', e);
      
      // Try to get more error details
      /* @ts-ignore */
      if (e.target) {
        console.error('🔍 [useSSE] Error target details:', {
          /* @ts-ignore */
          readyState: e.target.readyState,
          /* @ts-ignore */
          url: e.target.url,
          /* @ts-ignore */
          status: e.target.status,
          /* @ts-ignore */
          statusText: e.target.statusText,
        });
      }

      /* @ts-ignore */
      if (e.responseCode === 401) {
        console.log('🔑 [useSSE] 401 error - attempting token refresh');
        /* token expired, refresh and retry */
        try {
          const refreshResponse = await request.refreshToken();
          const token = refreshResponse?.token ?? '';
          if (!token) {
            throw new Error('Token refresh failed.');
          }
          sse.headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          };

          request.dispatchTokenUpdatedEvent(token);
          sse.stream();
          return;
        } catch (error) {
          /* token refresh failed, continue handling the original 401 */
          console.error('❌ [useSSE] Token refresh failed:', error);
        }
      }

      (startupConfig?.balance?.enabled ?? false) && balanceQuery.refetch();

      let data: TResData | undefined = undefined;
      try {
        data = JSON.parse(e.data) as TResData;
        console.error('🔍 [useSSE] Parsed error data:', data);
      } catch (error) {
        console.error('❌ [useSSE] Could not parse error data:', error);
        console.error('Raw error data:', e.data);
        console.log(e);
        setIsSubmitting(false);
      }

      errorHandler({ data, submission: { ...submission, userMessage } as EventSubmission });
    });

    // Add state change listener for debugging
    /* @ts-ignore */
    if (sse.addEventListener) {
      sse.addEventListener('readystatechange', () => {
        /* @ts-ignore */
        console.log('🔄 [useSSE] ReadyState changed:', sse.readyState);
      });
    }

    setIsSubmitting(true);
    console.log('🚀 [useSSE] Starting stream...');
    sse.stream();

    return () => {
      const isCancelled = sse.readyState <= 1;
      console.log('🛑 [useSSE] Cleanup - closing connection', { 
        readyState: sse.readyState, 
        isCancelled 
      });
      sse.close();
      if (isCancelled) {
        const e = new Event('cancel');
        /* @ts-ignore */
        sse.dispatchEvent(e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission]);
}