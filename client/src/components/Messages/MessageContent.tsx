import React, { useRef, useEffect } from 'react';
import { useMessageProcess } from '~/hooks';
import type { TMessageProps } from '~/common';
// eslint-disable-next-line import/no-cycle
import MultiMessage from '~/components/Chat/Messages/MultiMessage';
import ContentRender from './ContentRender';

const MessageContainer = React.memo(
  ({
    handleScroll,
    children,
  }: {
    handleScroll: (event?: unknown) => void;
    children: React.ReactNode;
  }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const preservedPanelsRef = useRef<{
      leftPanel: HTMLElement | null;
      rightPanel: HTMLElement | null;
      leftPanelData: any;
      rightPanelData: any;
    }>({
      leftPanel: null,
      rightPanel: null,
      leftPanelData: null,
      rightPanelData: null,
    });

    // Preserve panels before re-render
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      
      // Find existing panels
      const leftPanel = container.querySelector('[id$="_left"]') as HTMLElement;
      const rightPanel = container.querySelector('[id$="_right"]') as HTMLElement;
      
      // Store panels if they exist and are different from what we have
      if (leftPanel && leftPanel !== preservedPanelsRef.current.leftPanel) {
        console.log('🔄 [PANEL PRESERVE] Storing LEFT panel:', leftPanel.id);
        preservedPanelsRef.current.leftPanel = leftPanel;
        preservedPanelsRef.current.leftPanelData = {
          id: leftPanel.id,
          innerHTML: leftPanel.innerHTML,
          className: leftPanel.className,
          style: leftPanel.style.cssText,
        };
      }
      
      if (rightPanel && rightPanel !== preservedPanelsRef.current.rightPanel) {
        console.log('🔄 [PANEL PRESERVE] Storing RIGHT panel:', rightPanel.id);
        preservedPanelsRef.current.rightPanel = rightPanel;
        preservedPanelsRef.current.rightPanelData = {
          id: rightPanel.id,
          innerHTML: rightPanel.innerHTML,
          className: rightPanel.className,
          style: rightPanel.style.cssText,
        };
      }
    });

    // Restore panels after re-render
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      const { leftPanel, rightPanel, leftPanelData, rightPanelData } = preservedPanelsRef.current;

      // Restore left panel if it's missing
      if (leftPanelData && !container.querySelector(`#${leftPanelData.id}`)) {
        console.log('🔧 [PANEL RESTORE] Restoring LEFT panel:', leftPanelData.id);
        
        const restoredLeftPanel = document.createElement('div');
        restoredLeftPanel.id = leftPanelData.id;
        restoredLeftPanel.className = leftPanelData.className;
        restoredLeftPanel.innerHTML = leftPanelData.innerHTML;
        if (leftPanelData.style) {
          restoredLeftPanel.style.cssText = leftPanelData.style;
        }
        
        // Find appropriate insertion point
        const insertionPoint = container.querySelector('.prose') || 
                             container.querySelector('[class*="markdown"]') || 
                             container.firstElementChild;
        
        if (insertionPoint) {
          insertionPoint.appendChild(restoredLeftPanel);
          preservedPanelsRef.current.leftPanel = restoredLeftPanel;
        }
      }

      // Restore right panel if it's missing
      if (rightPanelData && !container.querySelector(`#${rightPanelData.id}`)) {
        console.log('🔧 [PANEL RESTORE] Restoring RIGHT panel:', rightPanelData.id);
        
        const restoredRightPanel = document.createElement('div');
        restoredRightPanel.id = rightPanelData.id;
        restoredRightPanel.className = rightPanelData.className;
        restoredRightPanel.innerHTML = rightPanelData.innerHTML;
        if (rightPanelData.style) {
          restoredRightPanel.style.cssText = rightPanelData.style;
        }
        
        // Find appropriate insertion point
        const insertionPoint = container.querySelector('.prose') || 
                             container.querySelector('[class*="markdown"]') || 
                             container.firstElementChild;
        
        if (insertionPoint) {
          insertionPoint.appendChild(restoredRightPanel);
          preservedPanelsRef.current.rightPanel = restoredRightPanel;
        }
      }
    });

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        preservedPanelsRef.current = {
          leftPanel: null,
          rightPanel: null,
          leftPanelData: null,
          rightPanelData: null,
        };
      };
    }, []);

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

export default function MessageContent(props: TMessageProps) {
  const {
    showSibling,
    conversation,
    handleScroll,
    siblingMessage,
    latestMultiMessage,
    isSubmittingFamily,
  } = useMessageProcess({ message: props.message });
  const { message, currentEditId, setCurrentEditId } = props;

  if (!message || typeof message !== 'object') {
    return null;
  }

  const { children, messageId = null } = message;

  return (
    <>
      <MessageContainer handleScroll={handleScroll}>
        {showSibling ? (
          <div className="m-auto my-2 flex justify-center p-4 py-2 md:gap-6">
            <div className="flex w-full flex-row flex-wrap justify-between gap-1 md:max-w-5xl md:flex-nowrap md:gap-2 lg:max-w-5xl xl:max-w-6xl">
              <ContentRender
                {...props}
                message={message}
                isSubmittingFamily={isSubmittingFamily}
                isCard
              />
              <ContentRender
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
            <ContentRender {...props} />
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