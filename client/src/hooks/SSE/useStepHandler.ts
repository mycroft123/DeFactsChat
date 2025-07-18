import { useCallback, useRef } from 'react';
import { StepTypes, ContentTypes, ToolCallTypes, getNonEmptyValue } from 'librechat-data-provider';
import type {
  Agents,
  TMessage,
  PartMetadata,
  EventSubmission,
  TMessageContentParts,
} from 'librechat-data-provider';
import type { SetterOrUpdater } from 'recoil';
import type { AnnounceOptions } from '~/common';
import { MESSAGE_UPDATE_INTERVAL } from '~/common';

// Optional debug import - only if debug-utils.ts exists
let useLibreChatDebug: any = null;
try {
  const debugUtils = require('~/utils/debug-utils');
  useLibreChatDebug = debugUtils.useLibreChatDebug;
} catch (e) {
  // Debug utils not available, continue without debugging
  console.log('[STEP_HANDLER] Debug utils not available, continuing without debugging');
}

type TUseStepHandler = {
  announcePolite: (options: AnnounceOptions) => void;
  setMessages: (messages: TMessage[]) => void;
  getMessages: () => TMessage[] | undefined;
  setIsSubmitting: SetterOrUpdater<boolean>;
  lastAnnouncementTimeRef: React.MutableRefObject<number>;
};

type TStepEvent = {
  event: string;
  data:
    | Agents.MessageDeltaEvent
    | Agents.AgentUpdate
    | Agents.RunStep
    | Agents.ToolEndEvent
    | {
        runId?: string;
        message: string;
      };
};

type MessageDeltaUpdate = { type: ContentTypes.TEXT; text: string; tool_call_ids?: string[] };

type ReasoningDeltaUpdate = { type: ContentTypes.THINK; think: string };

type AllContentTypes =
  | ContentTypes.TEXT
  | ContentTypes.THINK
  | ContentTypes.TOOL_CALL
  | ContentTypes.IMAGE_FILE
  | ContentTypes.IMAGE_URL
  | ContentTypes.ERROR;

export default function useStepHandler({
  setMessages,
  getMessages,
  setIsSubmitting,
  announcePolite,
  lastAnnouncementTimeRef,
}: TUseStepHandler) {
  const toolCallIdMap = useRef(new Map<string, string | undefined>());
  const messageMap = useRef(new Map<string, TMessage>());
  const stepMap = useRef(new Map<string, Agents.RunStep>());
  const deltaCountRef = useRef(0);
  const totalTextLengthRef = useRef(0);

  // Optional debug hook - only if available
  const debug = useLibreChatDebug ? useLibreChatDebug() : null;

  const updateContent = (
    message: TMessage,
    index: number,
    contentPart: Agents.MessageContentComplex,
    finalUpdate = false,
  ) => {
    console.log('[STEP_HANDLER DEBUG - updateContent]', {
      messageId: message.messageId,
      index,
      contentType: contentPart.type,
      finalUpdate,
      hasText: 'text' in contentPart,
      textLength: 'text' in contentPart ? (contentPart.text as string)?.length : 0,
      currentMessageText: message.text?.substring(0, 50),
    });

    const contentType = contentPart.type ?? '';
    if (!contentType) {
      console.warn('[STEP_HANDLER WARNING] No content type found in content part', contentPart);
      return message;
    }

    const updatedContent = [...(message.content || [])] as Array<Partial<TMessageContentParts> | undefined>;
    
    if (!updatedContent[index]) {
      updatedContent[index] = { type: contentPart.type as AllContentTypes };
    }

    if (
      contentType.startsWith(ContentTypes.TEXT) &&
      ContentTypes.TEXT in contentPart &&
      typeof contentPart.text === 'string'
    ) {
      const currentContent = updatedContent[index] as MessageDeltaUpdate;
      const previousText = currentContent.text || '';
      const newText = contentPart.text;
      const update: MessageDeltaUpdate = {
        type: ContentTypes.TEXT,
        text: previousText + newText,
      };

      if (contentPart.tool_call_ids != null) {
        update.tool_call_ids = contentPart.tool_call_ids;
      }
      updatedContent[index] = update;

      console.log('[STEP_HANDLER DEBUG - TEXT UPDATE]', {
        index,
        previousTextLength: previousText.length,
        newTextLength: newText.length,
        totalTextLength: update.text.length,
        textPreview: update.text.substring(0, 100),
      });
    } else if (
      contentType.startsWith(ContentTypes.AGENT_UPDATE) &&
      ContentTypes.AGENT_UPDATE in contentPart &&
      contentPart.agent_update
    ) {
      const update: Agents.AgentUpdate = {
        type: ContentTypes.AGENT_UPDATE,
        agent_update: contentPart.agent_update,
      };

      updatedContent[index] = update;
      console.log('[STEP_HANDLER DEBUG - AGENT UPDATE]', { index, update });
    } else if (
      contentType.startsWith(ContentTypes.THINK) &&
      ContentTypes.THINK in contentPart &&
      typeof contentPart.think === 'string'
    ) {
      const currentContent = updatedContent[index] as ReasoningDeltaUpdate;
      const update: ReasoningDeltaUpdate = {
        type: ContentTypes.THINK,
        think: (currentContent.think || '') + contentPart.think,
      };

      updatedContent[index] = update;
      console.log('[STEP_HANDLER DEBUG - THINK UPDATE]', {
        index,
        thinkLength: update.think.length,
      });
    } else if (contentType === ContentTypes.IMAGE_URL && 'image_url' in contentPart) {
      const currentContent = updatedContent[index] as {
        type: ContentTypes.IMAGE_URL;
        image_url: string;
      };
      updatedContent[index] = {
        ...currentContent,
      };
      console.log('[STEP_HANDLER DEBUG - IMAGE URL]', { index });
    } else if (contentType === ContentTypes.TOOL_CALL && 'tool_call' in contentPart) {
      const existingContent = updatedContent[index] as Agents.ToolCallContent | undefined;
      const existingToolCall = existingContent?.tool_call;
      const toolCallArgs = (contentPart.tool_call as Agents.ToolCall).args;
      const args =
        finalUpdate ||
        typeof existingToolCall?.args === 'object' ||
        typeof toolCallArgs === 'object'
          ? contentPart.tool_call.args
          : (existingToolCall?.args ?? '') + (toolCallArgs ?? '');

      const id = getNonEmptyValue([contentPart.tool_call.id, existingToolCall?.id]) ?? '';
      const name = getNonEmptyValue([contentPart.tool_call.name, existingToolCall?.name]) ?? '';

      const newToolCall: Agents.ToolCall & PartMetadata = {
        id,
        name,
        args,
        type: ToolCallTypes.TOOL_CALL,
        auth: contentPart.tool_call.auth,
        expires_at: contentPart.tool_call.expires_at,
      };

      if (finalUpdate) {
        newToolCall.progress = 1;
        newToolCall.output = contentPart.tool_call.output;
      }

      updatedContent[index] = {
        type: ContentTypes.TOOL_CALL,
        tool_call: newToolCall,
      };

      console.log('[STEP_HANDLER DEBUG - TOOL CALL]', {
        index,
        toolCallId: id,
        toolCallName: name,
        finalUpdate,
      });
    }

    // IMPORTANT FIX: Update the message text from content if it's text content
    let messageText = message.text || '';
    let textContentFound = false;
    updatedContent.forEach((content, idx) => {
      if (content?.type === ContentTypes.TEXT && 'text' in content) {
        messageText = content.text || '';
        textContentFound = true;
        console.log('[STEP_HANDLER DEBUG - TEXT EXTRACTION]', {
          contentIndex: idx,
          extractedTextLength: messageText.length,
          extractedTextPreview: messageText.substring(0, 100),
        });
      }
    });

    const updatedMessage = { 
      ...message, 
      content: updatedContent as TMessageContentParts[], 
      text: messageText 
    };

    console.log('[STEP_HANDLER DEBUG - FINAL MESSAGE UPDATE]', {
      messageId: updatedMessage.messageId,
      originalTextLength: message.text?.length || 0,
      updatedTextLength: updatedMessage.text?.length || 0,
      textContentFound,
      contentCount: updatedContent.length,
      textPreview: updatedMessage.text?.substring(0, 100),
    });

    return updatedMessage;
  };

  return useCallback(
    ({ event, data }: TStepEvent, submission: EventSubmission) => {
      // Determine panel type
      const isAddedRequest = (submission as any)._isAddedRequest || 
                            (submission as any).isAddedRequest ||
                            (submission.conversation as any)?._isAddedRequest ||
                            false;
      const panelType = isAddedRequest ? 'right' : 'left';
      
      // CRITICAL FIX: Create truly unique messageIds per panel
      const conversationId = submission.conversation?.conversationId || 'default';
      const endpoint = submission.conversation?.endpoint || 'unknown';
      const model = submission.conversation?.model || 'unknown';
      
      // Create a unique identifier for this panel's context
      const panelContext = `${conversationId}-${endpoint}-${model}-${panelType}`;
      
      console.log('[STEP_HANDLER DEBUG - PANEL CONTEXT]', {
        event,
        panelType,
        conversationId,
        endpoint,
        model,
        panelContext,
        timestamp: new Date().toISOString()
      });
      
      // Optional debug logging
      if (debug) {
        try {
          debug.logSSEEvent(event, data, panelType);
        } catch (e) {
          console.warn('[STEP_HANDLER] Debug logging failed:', e);
        }
      }

      const messages = getMessages() || [];
      const { userMessage } = submission;
      
      // Only set submitting on initial events, not on every delta
      if (event === 'on_run_step' || event === 'on_agent_update') {
        setIsSubmitting(true);
      }

      const currentTime = Date.now();
      if (currentTime - lastAnnouncementTimeRef.current > MESSAGE_UPDATE_INTERVAL) {
        announcePolite({ message: 'composing', isStatus: true });
        lastAnnouncementTimeRef.current = currentTime;
      }

      if (event === 'on_run_step') {
        const runStep = data as Agents.RunStep;
        // CRITICAL FIX: Create unique messageId per panel
        const baseRunId = runStep.runId ?? '';
        const responseMessageId = `${baseRunId}-${panelContext}`;
        
        console.log('[STEP_HANDLER DEBUG - RUN STEP]', {
          runStepId: runStep.id,
          baseRunId,
          responseMessageId,
          stepType: runStep.stepDetails.type,
          index: runStep.index,
          messageMapSize: messageMap.current.size,
          panelType,
          uniqueIdCreated: true,
        });

        if (!runStep.runId) {
          console.warn('[STEP_HANDLER WARNING] No runId found in run step event');
          if (debug) {
            try {
              debug.logError(new Error('No runId found in run step event'), 'RUN_STEP_NO_ID', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug error logging failed:', e);
            }
          }
          return;
        }

        stepMap.current.set(runStep.id, runStep);
        let response = messageMap.current.get(responseMessageId);

        if (!response) {
          const responseMessage = messages[messages.length - 1] as TMessage;

          response = {
            ...responseMessage,
            parentMessageId: userMessage.messageId,
            conversationId: userMessage.conversationId,
            messageId: responseMessageId, // Unique per panel
            content: [],
          };

          messageMap.current.set(responseMessageId, response);
          
          // Find and update the correct message
          const messageIndex = messages.findIndex(msg => 
            msg.messageId === responseMessageId
          );
          
          let finalMessages;
          if (messageIndex >= 0) {
            // Update existing message
            finalMessages = [...messages];
            finalMessages[messageIndex] = response;
          } else {
            // Add new message if not found
            finalMessages = [...messages, response];
          }
          
          // Optional debug logging
          if (debug) {
            try {
              debug.logMessages(finalMessages, 'RUN_STEP_NEW_RESPONSE', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug message logging failed:', e);
            }
          }
          
          setMessages(finalMessages);

          console.log('[STEP_HANDLER DEBUG - NEW RESPONSE CREATED]', {
            responseMessageId,
            parentMessageId: userMessage.messageId,
            panelType,
            uniqueId: true,
          });
        }

        // Store tool call IDs if present
        if (runStep.stepDetails.type === StepTypes.TOOL_CALLS) {
          let updatedResponse = { ...response };
          (runStep.stepDetails.tool_calls as Agents.ToolCall[]).forEach((toolCall) => {
            const toolCallId = toolCall.id ?? '';
            if ('id' in toolCall && toolCallId) {
              toolCallIdMap.current.set(runStep.id, toolCallId);
            }

            const contentPart: Agents.MessageContentComplex = {
              type: ContentTypes.TOOL_CALL,
              tool_call: {
                name: toolCall.name ?? '',
                args: toolCall.args,
                id: toolCallId,
              },
            };

            updatedResponse = updateContent(updatedResponse, runStep.index, contentPart);
          });

          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          const messageIndex = currentMessages.findIndex(msg => 
            msg.messageId === responseMessageId
          );
          
          if (messageIndex >= 0) {
            const finalMessages = [...currentMessages];
            finalMessages[messageIndex] = updatedResponse;
            setMessages(finalMessages);
          } else {
            setMessages([...currentMessages, updatedResponse]);
          }

          // Optional debug logging
          if (debug) {
            try {
              debug.logMessages(currentMessages, 'RUN_STEP_TOOL_CALLS', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug message logging failed:', e);
            }
          }
        }
      } else if (event === 'on_agent_update') {
        const { agent_update } = data as Agents.AgentUpdate;
        // CRITICAL FIX: Create unique messageId per panel
        const baseRunId = agent_update.runId || '';
        const responseMessageId = `${baseRunId}-${panelContext}`;
        
        console.log('[STEP_HANDLER DEBUG - AGENT UPDATE]', {
          baseRunId,
          responseMessageId,
          index: agent_update.index,
          panelType,
          uniqueIdCreated: true,
        });

        if (!agent_update.runId) {
          console.warn('[STEP_HANDLER WARNING] No runId found in agent update event');
          if (debug) {
            try {
              debug.logError(new Error('No runId found in agent update event'), 'AGENT_UPDATE_NO_ID', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug error logging failed:', e);
            }
          }
          return;
        }

        const response = messageMap.current.get(responseMessageId);
        if (response) {
          const updatedResponse = updateContent(response, agent_update.index, data);
          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          
          // Find and update the correct message
          const messageIndex = currentMessages.findIndex(msg => 
            msg.messageId === responseMessageId
          );
          
          if (messageIndex >= 0) {
            const finalMessages = [...currentMessages];
            finalMessages[messageIndex] = updatedResponse;
            setMessages(finalMessages);
          } else {
            console.warn('[STEP_HANDLER] Message not found for update:', responseMessageId);
            setMessages([...currentMessages, updatedResponse]);
          }
          
          // Optional debug logging
          if (debug) {
            try {
              debug.logMessages(currentMessages, 'AGENT_UPDATE', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug message logging failed:', e);
            }
          }
        }
      } else if (event === 'on_message_delta') {
        deltaCountRef.current++;
        const messageDelta = data as Agents.MessageDeltaEvent;
        
        console.log('[STEP_HANDLER DEBUG - MESSAGE DELTA]', {
          deltaCount: deltaCountRef.current,
          messageDeltaId: messageDelta.id,
          hasDelta: !!messageDelta.delta,
          hasContent: !!messageDelta.delta?.content,
          deltaContent: messageDelta.delta?.content,
          contentType: Array.isArray(messageDelta.delta?.content) 
            ? messageDelta.delta.content[0]?.type 
            : messageDelta.delta?.content?.type,
          stepMapSize: stepMap.current.size,
          messageMapSize: messageMap.current.size,
          panelType,
        });
        
        const runStep = stepMap.current.get(messageDelta.id);
        // CRITICAL FIX: Create unique messageId per panel
        const baseRunId = runStep?.runId ?? '';
        const responseMessageId = `${baseRunId}-${panelContext}`;

        if (!runStep || !runStep?.runId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for message delta event', {
            messageDeltaId: messageDelta.id,
            hasRunStep: !!runStep,
            responseMessageId,
            stepMapKeys: Array.from(stepMap.current.keys()),
            messageMapKeys: Array.from(messageMap.current.keys()),
            panelType,
          });
          
          if (debug) {
            try {
              debug.logError(
                new Error(`No run step or runId found for message delta: ${messageDelta.id}`),
                'MESSAGE_DELTA_NO_STEP',
                panelType
              );
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug error logging failed:', e);
            }
          }
          return;
        }

        const response = messageMap.current.get(responseMessageId);
        if (response && messageDelta.delta.content) {
          const contentPart = Array.isArray(messageDelta.delta.content)
            ? messageDelta.delta.content[0]
            : messageDelta.delta.content;

          console.log('[STEP_HANDLER DEBUG - DELTA CONTENT]', {
            responseMessageId,
            runStepIndex: runStep.index,
            contentPartType: contentPart?.type,
            hasText: 'text' in (contentPart || {}),
            textLength: 'text' in (contentPart || {}) ? (contentPart.text as string)?.length : 0,
            textPreview: 'text' in (contentPart || {}) ? (contentPart.text as string)?.substring(0, 50) : '',
            panelType,
            uniqueId: true,
          });

          const beforeUpdateText = response.text || '';
          const updatedResponse = updateContent(response, runStep.index, contentPart);
          const afterUpdateText = updatedResponse.text || '';

          // Optional debug logging for delta
          if (debug) {
            try {
              const storageKey = debug.generateStorageKey(
                submission.userMessage?.conversationId || 'unknown',
                panelType
              );
              debug.logDelta({
                messageId: responseMessageId,
                deltaType: 'message_delta',
                content: contentPart,
                textLength: afterUpdateText.length - beforeUpdateText.length,
                panelType,
                timestamp: new Date().toISOString(),
                storageKey
              });
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug delta logging failed:', e);
            }
          }

          if ('text' in (contentPart || {})) {
            totalTextLengthRef.current += (contentPart.text as string)?.length || 0;
          }

          console.log('[STEP_HANDLER DEBUG - DELTA RESULT]', {
            responseMessageId,
            beforeTextLength: beforeUpdateText.length,
            afterTextLength: afterUpdateText.length,
            textAdded: afterUpdateText.length - beforeUpdateText.length,
            totalTextAccumulated: totalTextLengthRef.current,
            contentChanged: JSON.stringify(response.content) !== JSON.stringify(updatedResponse.content),
            panelType,
            uniqueId: true,
          });

          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          
          // Find and update the correct message
          const messageIndex = currentMessages.findIndex(msg => 
            msg.messageId === responseMessageId
          );
          
          if (messageIndex >= 0) {
            const finalMessages = [...currentMessages];
            finalMessages[messageIndex] = updatedResponse;
            setMessages(finalMessages);
          } else {
            console.warn('[STEP_HANDLER] Message not found for delta update:', responseMessageId);
            setMessages([...currentMessages, updatedResponse]);
          }
          
          // Optional debug logging
          if (debug) {
            try {
              debug.logMessages(currentMessages, 'MESSAGE_DELTA_UPDATE', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug message logging failed:', e);
            }
          }
        } else {
          console.warn('[STEP_HANDLER WARNING - NO RESPONSE OR CONTENT]', {
            hasResponse: !!response,
            hasDeltaContent: !!messageDelta.delta.content,
            responseMessageId,
            messageMapKeys: Array.from(messageMap.current.keys()),
            panelType,
          });
          
          if (debug) {
            try {
              debug.logError(
                new Error(`No response or delta content for message delta: ${messageDelta.id}`),
                'MESSAGE_DELTA_NO_CONTENT',
                panelType
              );
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug error logging failed:', e);
            }
          }
        }
      } else if (event === 'on_reasoning_delta') {
        const reasoningDelta = data as Agents.ReasoningDeltaEvent;
        const runStep = stepMap.current.get(reasoningDelta.id);
        // CRITICAL FIX: Create unique messageId per panel
        const baseRunId = runStep?.runId ?? '';
        const responseMessageId = `${baseRunId}-${panelContext}`;

        console.log('[STEP_HANDLER DEBUG - REASONING DELTA]', {
          reasoningDeltaId: reasoningDelta.id,
          hasContent: !!reasoningDelta.delta.content,
          panelType,
          uniqueIdCreated: true,
        });

        if (!runStep || !runStep?.runId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for reasoning delta event');
          if (debug) {
            try {
              debug.logError(
                new Error(`No run step or runId found for reasoning delta: ${reasoningDelta.id}`),
                'REASONING_DELTA_NO_STEP',
                panelType
              );
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug error logging failed:', e);
            }
          }
          return;
        }

        const response = messageMap.current.get(responseMessageId);
        if (response && reasoningDelta.delta.content != null) {
          const contentPart = Array.isArray(reasoningDelta.delta.content)
            ? reasoningDelta.delta.content[0]
            : reasoningDelta.delta.content;

          const updatedResponse = updateContent(response, runStep.index, contentPart);

          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          
          // Find and update the correct message
          const messageIndex = currentMessages.findIndex(msg => 
            msg.messageId === responseMessageId
          );
          
          if (messageIndex >= 0) {
            const finalMessages = [...currentMessages];
            finalMessages[messageIndex] = updatedResponse;
            setMessages(finalMessages);
          } else {
            console.warn('[STEP_HANDLER] Message not found for reasoning delta:', responseMessageId);
            setMessages([...currentMessages, updatedResponse]);
          }
          
          // Optional debug logging
          if (debug) {
            try {
              debug.logMessages(currentMessages, 'REASONING_DELTA_UPDATE', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug message logging failed:', e);
            }
          }
        }
      } else if (event === 'on_run_step_delta') {
        const runStepDelta = data as Agents.RunStepDeltaEvent;
        const runStep = stepMap.current.get(runStepDelta.id);
        // CRITICAL FIX: Create unique messageId per panel
        const baseRunId = runStep?.runId ?? '';
        const responseMessageId = `${baseRunId}-${panelContext}`;

        console.log('[STEP_HANDLER DEBUG - RUN STEP DELTA]', {
          runStepDeltaId: runStepDelta.id,
          deltaType: runStepDelta.delta.type,
          panelType,
          uniqueIdCreated: true,
        });

        if (!runStep || !runStep?.runId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for run step delta event');
          if (debug) {
            try {
              debug.logError(
                new Error(`No run step or runId found for run step delta: ${runStepDelta.id}`),
                'RUN_STEP_DELTA_NO_STEP',
                panelType
              );
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug error logging failed:', e);
            }
          }
          return;
        }

        const response = messageMap.current.get(responseMessageId);
        if (
          response &&
          runStepDelta.delta.type === StepTypes.TOOL_CALLS &&
          runStepDelta.delta.tool_calls
        ) {
          let updatedResponse = { ...response };

          runStepDelta.delta.tool_calls.forEach((toolCallDelta) => {
            const toolCallId = toolCallIdMap.current.get(runStepDelta.id) ?? '';

            const contentPart: Agents.MessageContentComplex = {
              type: ContentTypes.TOOL_CALL,
              tool_call: {
                name: toolCallDelta.name ?? '',
                args: toolCallDelta.args ?? '',
                id: toolCallId,
              },
            };

            if (runStepDelta.delta.auth != null) {
              contentPart.tool_call.auth = runStepDelta.delta.auth;
              contentPart.tool_call.expires_at = runStepDelta.delta.expires_at;
            }

            updatedResponse = updateContent(updatedResponse, runStep.index, contentPart);
          });

          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          const messageIndex = currentMessages.findIndex(msg => 
            msg.messageId === responseMessageId
          );
          
          if (messageIndex >= 0) {
            const finalMessages = [...currentMessages];
            finalMessages[messageIndex] = updatedResponse;
            setMessages(finalMessages);
          } else {
            setMessages([...currentMessages, updatedResponse]);
          }

          // Optional debug logging
          if (debug) {
            try {
              debug.logMessages(currentMessages, 'RUN_STEP_DELTA_UPDATE', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug message logging failed:', e);
            }
          }
        }
      } else if (event === 'on_run_step_completed') {
        const { result } = data as unknown as { result: Agents.ToolEndEvent };

        const { id: stepId } = result;

        console.log('[STEP_HANDLER DEBUG - RUN STEP COMPLETED]', {
          stepId,
          toolCallName: result.tool_call?.name,
          panelType,
          uniqueIdCreated: true,
        });

        const runStep = stepMap.current.get(stepId);
        // CRITICAL FIX: Create unique messageId per panel
        const baseRunId = runStep?.runId ?? '';
        const responseMessageId = `${baseRunId}-${panelContext}`;

        if (!runStep || !runStep?.runId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for completed tool call event');
          if (debug) {
            try {
              debug.logError(
                new Error(`No run step or runId found for completed tool call: ${stepId}`),
                'RUN_STEP_COMPLETED_NO_STEP',
                panelType
              );
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug error logging failed:', e);
            }
          }
          return;
        }

        const response = messageMap.current.get(responseMessageId);
        if (response) {
          let updatedResponse = { ...response };

          const contentPart: Agents.MessageContentComplex = {
            type: ContentTypes.TOOL_CALL,
            tool_call: result.tool_call,
          };

          updatedResponse = updateContent(updatedResponse, runStep.index, contentPart, true);

          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          const messageIndex = currentMessages.findIndex(msg => 
            msg.messageId === responseMessageId
          );
          
          if (messageIndex >= 0) {
            const finalMessages = [...currentMessages];
            finalMessages[messageIndex] = updatedResponse;
            setMessages(finalMessages);
          } else {
            setMessages([...currentMessages, updatedResponse]);
          }

          // Optional debug logging
          if (debug) {
            try {
              debug.logMessages(currentMessages, 'RUN_STEP_COMPLETED_UPDATE', panelType);
            } catch (e) {
              console.warn('[STEP_HANDLER] Debug message logging failed:', e);
            }
          }
        }
      }

      return () => {
        console.log('[STEP_HANDLER DEBUG - CLEANUP]', {
          toolCallMapSize: toolCallIdMap.current.size,
          messageMapSize: messageMap.current.size,
          stepMapSize: stepMap.current.size,
          totalDeltas: deltaCountRef.current,
          totalTextLength: totalTextLengthRef.current,
          panelType,
          uniqueIdSystemUsed: true,
        });
        
        // Optional debug logging for cleanup
        if (debug) {
          try {
            debug.logStorageOperation('clear', 'step_handler_cleanup', panelType, {
              toolCallMapSize: toolCallIdMap.current.size,
              messageMapSize: messageMap.current.size,
              stepMapSize: stepMap.current.size,
              totalDeltas: deltaCountRef.current,
              totalTextLength: totalTextLengthRef.current,
            });
          } catch (e) {
            console.warn('[STEP_HANDLER] Debug cleanup logging failed:', e);
          }
        }
        
        toolCallIdMap.current.clear();
        messageMap.current.clear();
        stepMap.current.clear();
        deltaCountRef.current = 0;
        totalTextLengthRef.current = 0;
      };
    },
    [getMessages, setIsSubmitting, lastAnnouncementTimeRef, announcePolite, setMessages, debug],
  );
}