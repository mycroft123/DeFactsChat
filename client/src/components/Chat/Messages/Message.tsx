import React, { useRef, memo } from 'react';
import { useRecoilValue } from 'recoil';
import { useMessageProcess } from '~/hooks';
import type { TMessageProps } from '~/common';
import MessageRender from './ui/MessageRender';
// eslint-disable-next-line import/no-cycle
import MultiMessage from './MultiMessage';
import { cn } from '~/utils';
import store from '~/store';

const MessageContainer = React.memo(
  ({
    handleScroll,
    children,
  }: {
    handleScroll: (event?: unknown) => void;
    children: React.ReactNode;
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
      <div
        ref={containerRef}
        className="text-token-text-primary w-full border-0 bg-transparent dark:border-0 dark:bg-transparent"
        onWheel={handleScroll}
        onTouchMove={handleScroll}
      >
        {children}
      </div>
    );
  },
);

function Message(props: TMessageProps) {
  const {
    showSibling,
    conversation,
    handleScroll,
    siblingMessage,
    latestMultiMessage,
    isSubmittingFamily,
  } = useMessageProcess({ message: props.message });
  const { message, currentEditId, setCurrentEditId } = props;
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  if (!message || typeof message !== 'object') {
    return null;
  }

  const { children, messageId = null } = message;

  return (
    <>
      <MessageContainer handleScroll={handleScroll}>
        {showSibling ? (
          <div className="m-auto my-2 flex justify-center p-4 py-2 md:gap-6">
            <div
              className={cn(
                'flex w-full flex-row flex-wrap justify-between gap-1 md:flex-nowrap md:gap-2',
                maximizeChatSpace ? 'w-full max-w-full' : 'md:max-w-5xl xl:max-w-6xl',
              )}
            >
              <MessageRender
                {...props}
                message={message}
                isSubmittingFamily={isSubmittingFamily}
                isCard
              />
              <MessageRender
                {...props}
                isMultiMessage
                isCard
                message={siblingMessage ?? latestMultiMessage ?? undefined}
                isSubmittingFamily={isSubmittingFamily}
              />
            </div>
          </div>
        ) : (
          <div className="m-auto justify-center p-4 py-2 md:gap-6 ">
            <MessageRender {...props} />
          </div>
        )}
      </MessageContainer>
      <MultiMessage
        key={messageId}
        messageId={messageId}
        conversation={conversation}
        messagesTree={children ?? []}
        currentEditId={currentEditId}
        setCurrentEditId={setCurrentEditId}
      />
    </>
  );
}

export default memo(Message, (prevProps, nextProps) => {
  // Custom comparison to prevent re-renders during streaming
  if (prevProps.message?.messageId !== nextProps.message?.messageId) {
    console.log('[MESSAGE_MEMO] Different messageId, re-rendering');
    return false;
  }
  
  if (prevProps.message?.text !== nextProps.message?.text) {
    console.log('[MESSAGE_MEMO] Text changed, re-rendering');
    return false;
  }
  
  if (JSON.stringify(prevProps.message?.content) !== JSON.stringify(nextProps.message?.content)) {
    console.log('[MESSAGE_MEMO] Content changed, re-rendering');
    return false;
  }
  
  if (prevProps.currentEditId !== nextProps.currentEditId) {
    console.log('[MESSAGE_MEMO] Edit state changed, re-rendering');
    return false;
  }
  
  // For all other changes (like other messages in the array), don't re-render
  console.log('[MESSAGE_MEMO] Preventing unnecessary re-render for', prevProps.message?.messageId);
  return true;
});