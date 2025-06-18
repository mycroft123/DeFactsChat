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
      panels: Map<string, {
        element: HTMLElement;
        data: {
          id: string;
          innerHTML: string;
          className: string;
          style: string;
        }
      }>;
    }>({
      panels: new Map(),
    });

    // Preserve panels before re-render
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      
      // Find all panels (left and right)
      const panels = container.querySelectorAll('[id$="_left"], [id$="_right"]') as NodeListOf<HTMLElement>;
      
      panels.forEach(panel => {
        if (!preservedPanelsRef.current.panels.has(panel.id)) {
          console.log('🔄 [PANEL PRESERVE] Storing panel:', panel.id);
          
          // Store both the element reference and its data
          preservedPanelsRef.current.panels.set(panel.id, {
            element: panel,
            data: {
              id: panel.id,
              innerHTML: panel.innerHTML,
              className: panel.className,
              style: panel.style.cssText,
            }
          });
        }
      });
    });

    // Restore panels after re-render
    useEffect(() => {
      if (!containerRef.current) return;

      const container = containerRef.current;
      
      // Check each preserved panel
      preservedPanelsRef.current.panels.forEach((panelInfo, panelId) => {
        // Use a more robust way to check if panel exists
        const existingPanel = Array.from(container.querySelectorAll('[id$="_left"], [id$="_right"]'))
          .find(el => el.id === panelId);
        
        if (!existingPanel) {
          console.log('🔧 [PANEL RESTORE] Restoring panel:', panelId);
          
          // Create new panel element
          const restoredPanel = document.createElement('div');
          restoredPanel.id = panelInfo.data.id;
          restoredPanel.className = panelInfo.data.className;
          restoredPanel.innerHTML = panelInfo.data.innerHTML;
          if (panelInfo.data.style) {
            restoredPanel.style.cssText = panelInfo.data.style;
          }
          
          // Find appropriate insertion point - try multiple strategies
          let insertionPoint: Element | null = null;
          
          // Strategy 1: Look for prose/markdown content
          insertionPoint = container.querySelector('.prose, [class*="markdown"], [class*="content"]');
          
          // Strategy 2: Look for the first div with substantial content
          if (!insertionPoint) {
            const divs = container.querySelectorAll('div');
            for (const div of divs) {
              if (div.textContent && div.textContent.length > 50) {
                insertionPoint = div;
                break;
              }
            }
          }
          
          // Strategy 3: Use the first child element
          if (!insertionPoint) {
            insertionPoint = container.firstElementChild;
          }
          
          // Strategy 4: Append directly to container
          if (!insertionPoint) {
            insertionPoint = container;
          }
          
          if (insertionPoint) {
            insertionPoint.appendChild(restoredPanel);
            
            // Update our preserved reference
            preservedPanelsRef.current.panels.set(panelId, {
              element: restoredPanel,
              data: panelInfo.data
            });
            
            console.log('✅ [PANEL RESTORE] Successfully restored panel:', panelId);
          } else {
            console.warn('⚠️ [PANEL RESTORE] Could not find insertion point for:', panelId);
          }
        }
      });
    });

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        console.log('🧹 [PANEL CLEANUP] Clearing preserved panels');
        preservedPanelsRef.current.panels.clear();
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