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

    const updatedContent = [...(message.content || [])] as Array
      Partial<TMessageContentParts> | undefined
    >;
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
      console.log('[STEP_HANDLER DEBUG - EVENT]', {
        event,
        dataType: data?.constructor?.name,
        submissionModel: submission.conversation?.model,
        submissionEndpoint: submission.conversation?.endpoint,
        timestamp: new Date().toISOString(),
      });

      const messages = getMessages() || [];
      const { userMessage } = submission;
      setIsSubmitting(true);

      const currentTime = Date.now();
      if (currentTime - lastAnnouncementTimeRef.current > MESSAGE_UPDATE_INTERVAL) {
        announcePolite({ message: 'composing', isStatus: true });
        lastAnnouncementTimeRef.current = currentTime;
      }

      if (event === 'on_run_step') {
        const runStep = data as Agents.RunStep;
        const responseMessageId = runStep.runId ?? '';
        
        console.log('[STEP_HANDLER DEBUG - RUN STEP]', {
          runStepId: runStep.id,
          runId: runStep.runId,
          stepType: runStep.stepDetails.type,
          index: runStep.index,
          messageMapSize: messageMap.current.size,
        });

        if (!responseMessageId) {
          console.warn('[STEP_HANDLER WARNING] No message id found in run step event');
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
            messageId: responseMessageId,
            content: [],
          };

          messageMap.current.set(responseMessageId, response);
          setMessages([...messages.slice(0, -1), response]);

          console.log('[STEP_HANDLER DEBUG - NEW RESPONSE CREATED]', {
            responseMessageId,
            parentMessageId: userMessage.messageId,
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
          const updatedMessages = messages.map((msg) =>
            msg.messageId === runStep.runId ? updatedResponse : msg,
          );

          setMessages(updatedMessages);
        }
      } else if (event === 'on_agent_update') {
        const { agent_update } = data as Agents.AgentUpdate;
        const responseMessageId = agent_update.runId || '';
        
        console.log('[STEP_HANDLER DEBUG - AGENT UPDATE]', {
          runId: agent_update.runId,
          index: agent_update.index,
        });

        if (!responseMessageId) {
          console.warn('[STEP_HANDLER WARNING] No message id found in agent update event');
          return;
        }

        const response = messageMap.current.get(responseMessageId);
        if (response) {
          const updatedResponse = updateContent(response, agent_update.index, data);
          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          setMessages([...currentMessages.slice(0, -1), updatedResponse]);
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
        });
        
        const runStep = stepMap.current.get(messageDelta.id);
        const responseMessageId = runStep?.runId ?? '';

        if (!runStep || !responseMessageId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for message delta event', {
            messageDeltaId: messageDelta.id,
            hasRunStep: !!runStep,
            responseMessageId,
            stepMapKeys: Array.from(stepMap.current.keys()),
            messageMapKeys: Array.from(messageMap.current.keys()),
          });
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
          });

          const beforeUpdateText = response.text || '';
          const updatedResponse = updateContent(response, runStep.index, contentPart);
          const afterUpdateText = updatedResponse.text || '';

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
          });

          messageMap.current.set(responseMessageId, updatedResponse);
          const currentMessages = getMessages() || [];
          setMessages([...currentMessages.slice(0, -1), updatedResponse]);
        } else {
          console.warn('[STEP_HANDLER WARNING - NO RESPONSE OR CONTENT]', {
            hasResponse: !!response,
            hasDeltaContent: !!messageDelta.delta.content,
            responseMessageId,
            messageMapKeys: Array.from(messageMap.current.keys()),
          });
        }
      } else if (event === 'on_reasoning_delta') {
        const reasoningDelta = data as Agents.ReasoningDeltaEvent;
        const runStep = stepMap.current.get(reasoningDelta.id);
        const responseMessageId = runStep?.runId ?? '';

        console.log('[STEP_HANDLER DEBUG - REASONING DELTA]', {
          reasoningDeltaId: reasoningDelta.id,
          hasContent: !!reasoningDelta.delta.content,
        });

        if (!runStep || !responseMessageId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for reasoning delta event');
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
          setMessages([...currentMessages.slice(0, -1), updatedResponse]);
        }
      } else if (event === 'on_run_step_delta') {
        const runStepDelta = data as Agents.RunStepDeltaEvent;
        const runStep = stepMap.current.get(runStepDelta.id);
        const responseMessageId = runStep?.runId ?? '';

        console.log('[STEP_HANDLER DEBUG - RUN STEP DELTA]', {
          runStepDeltaId: runStepDelta.id,
          deltaType: runStepDelta.delta.type,
        });

        if (!runStep || !responseMessageId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for run step delta event');
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
          const updatedMessages = messages.map((msg) =>
            msg.messageId === runStep.runId ? updatedResponse : msg,
          );

          setMessages(updatedMessages);
        }
      } else if (event === 'on_run_step_completed') {
        const { result } = data as unknown as { result: Agents.ToolEndEvent };

        const { id: stepId } = result;

        console.log('[STEP_HANDLER DEBUG - RUN STEP COMPLETED]', {
          stepId,
          toolCallName: result.tool_call?.name,
        });

        const runStep = stepMap.current.get(stepId);
        const responseMessageId = runStep?.runId ?? '';

        if (!runStep || !responseMessageId) {
          console.warn('[STEP_HANDLER WARNING] No run step or runId found for completed tool call event');
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
          const updatedMessages = messages.map((msg) =>
            msg.messageId === runStep.runId ? updatedResponse : msg,
          );

          setMessages(updatedMessages);
        }
      }

      return () => {
        console.log('[STEP_HANDLER DEBUG - CLEANUP]', {
          toolCallMapSize: toolCallIdMap.current.size,
          messageMapSize: messageMap.current.size,
          stepMapSize: stepMap.current.size,
          totalDeltas: deltaCountRef.current,
          totalTextLength: totalTextLengthRef.current,
        });
        
        toolCallIdMap.current.clear();
        messageMap.current.clear();
        stepMap.current.clear();
        deltaCountRef.current = 0;
        totalTextLengthRef.current = 0;
      };
    },
    [getMessages, setIsSubmitting, lastAnnouncementTimeRef, announcePolite, setMessages],
  );
}