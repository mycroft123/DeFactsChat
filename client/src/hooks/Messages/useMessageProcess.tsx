import throttle from 'lodash/throttle';
import { useRecoilValue } from 'recoil';
import { Constants } from 'librechat-data-provider';
import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import type { TMessage } from 'librechat-data-provider';
import { useChatContext, useAddedChatContext } from '~/Providers';
import { getTextKey, logger } from '~/utils';
import store from '~/store';

export default function useMessageProcess({ message }: { message?: TMessage | null }) {
  const latestText = useRef<string | number>('');
  const [siblingMessage, setSiblingMessage] = useState<TMessage | null>(null);
  
  // CRITICAL FIX: Stabilize showSibling during streaming
  const [stableShowSibling, setStableShowSibling] = useState(false);
  const showSiblingLockRef = useRef(false);
  
  const hasNoChildren = useMemo(() => (message?.children?.length ?? 0) === 0, [message]);

  const {
    index,
    conversation,
    latestMessage,
    setAbortScroll,
    setLatestMessage,
    isSubmitting: isSubmittingRoot,
  } = useChatContext();
  const { isSubmitting: isSubmittingAdditional } = useAddedChatContext();
  const latestMultiMessage = useRecoilValue(store.latestMessageFamily(index + 1));
  const isSubmittingFamily = useMemo(
    () => isSubmittingRoot || isSubmittingAdditional,
    [isSubmittingRoot, isSubmittingAdditional],
  );

  useEffect(() => {
    const convoId = conversation?.conversationId;
    if (convoId === Constants.NEW_CONVO) {
      return;
    }
    if (!message) {
      return;
    }
    if (!hasNoChildren) {
      return;
    }

    const textKey = getTextKey(message, convoId);

    // Check for text/conversation change
    const logInfo = {
      textKey,
      'latestText.current': latestText.current,
      messageId: message.messageId,
      convoId,
    };
    if (
      textKey !== latestText.current ||
      (convoId != null &&
        latestText.current &&
        convoId !== latestText.current.split(Constants.COMMON_DIVIDER)[2])
    ) {
      logger.log('latest_message', '[useMessageProcess] Setting latest message; logInfo:', logInfo);
      latestText.current = textKey;
      setLatestMessage({ ...message });
    } else {
      logger.log('latest_message', 'No change in latest message; logInfo', logInfo);
    }
  }, [hasNoChildren, message, setLatestMessage, conversation?.conversationId]);

  const handleScroll = useCallback(
    (event: unknown | TouchEvent | WheelEvent) => {
      throttle(() => {
        logger.log(
          'message_scrolling',
          `useMessageProcess: setting abort scroll to ${isSubmittingFamily}, handleScroll event`,
          event,
        );
        if (isSubmittingFamily) {
          setAbortScroll(true);
        } else {
          setAbortScroll(false);
        }
      }, 500)();
    },
    [isSubmittingFamily, setAbortScroll],
  );

  // CRITICAL FIX: Calculate raw showSibling value
  const rawShowSibling = useMemo(
    () =>
      (hasNoChildren && latestMultiMessage && (latestMultiMessage.children?.length ?? 0) === 0) ||
      !!siblingMessage,
    [hasNoChildren, latestMultiMessage, siblingMessage],
  );

  // CRITICAL FIX: Stabilize showSibling during streaming to prevent re-renders
  useEffect(() => {
    console.log('[SHOW_SIBLING_STABILITY]', {
      rawShowSibling,
      stableShowSibling,
      isSubmittingFamily,
      showSiblingLocked: showSiblingLockRef.current,
      messageId: message?.messageId,
    });

    // If not currently streaming, always update
    if (!isSubmittingFamily) {
      // Release the lock when streaming stops
      if (showSiblingLockRef.current) {
        console.log('[SHOW_SIBLING_STABILITY] Releasing lock - streaming stopped');
        showSiblingLockRef.current = false;
      }
      
      // Update to raw value when not streaming
      if (stableShowSibling !== rawShowSibling) {
        console.log('[SHOW_SIBLING_STABILITY] Updating stable value (not streaming):', rawShowSibling);
        setStableShowSibling(rawShowSibling);
      }
      return;
    }

    // If streaming is active
    if (isSubmittingFamily) {
      // Lock the value on first stream (prevent changes)
      if (!showSiblingLockRef.current) {
        console.log('[SHOW_SIBLING_STABILITY] Locking showSibling during streaming:', stableShowSibling);
        showSiblingLockRef.current = true;
      }
      
      // If we don't have a sibling view yet but should, establish it now
      if (!stableShowSibling && rawShowSibling) {
        console.log('[SHOW_SIBLING_STABILITY] Establishing sibling view at start of streaming');
        setStableShowSibling(true);
      }
      
      // Don't change stableShowSibling while streaming
      return;
    }
  }, [rawShowSibling, stableShowSibling, isSubmittingFamily, message?.messageId]);

  // CRITICAL FIX: Use stable showSibling instead of raw
  const showSibling = stableShowSibling;

  useEffect(() => {
    if (
      hasNoChildren &&
      latestMultiMessage &&
      latestMultiMessage.conversationId === message?.conversationId
    ) {
      const newSibling = Object.assign({}, latestMultiMessage, {
        parentMessageId: message.parentMessageId,
        depth: message.depth,
      });
      setSiblingMessage(newSibling);
    }
  }, [hasNoChildren, latestMultiMessage, message, setSiblingMessage, latestMessage]);

  return {
    showSibling,
    handleScroll,
    conversation,
    siblingMessage,
    setSiblingMessage,
    isSubmittingFamily,
    latestMultiMessage,
  };
}