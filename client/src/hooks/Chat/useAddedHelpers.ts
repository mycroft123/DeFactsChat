import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryKeys } from 'librechat-data-provider';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import useChatFunctions from '~/hooks/Chat/useChatFunctions';
import store from '~/store';

export default function useAddedHelpers({
  rootIndex = 0,
  currentIndex,
  paramId,
}: {
  rootIndex?: number;
  currentIndex: number;
  paramId?: string;
}) {
  console.log('🔧 [useAddedHelpers] Initialized:', { 
    rootIndex, 
    currentIndex, 
    paramId,
    timestamp: new Date().toISOString()
  });
  
  const queryClient = useQueryClient();
  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(rootIndex));
  
  const setLatestMultiMessage = useSetRecoilState(store.latestMessageFamily(currentIndex));
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(currentIndex);
  
  // Track accumulated streaming content
  const streamingContentRef = useRef(new Map());
  const messageCountRef = useRef(0);
  
  // Get root messages for reference
  const rootMessages = queryClient.getQueryData<TMessage[]>([
    QueryKeys.messages, 
    paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? ''
  ]);
  
  const actualLatestMessage = rootMessages?.[rootMessages.length - 1];
  
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(currentIndex));
  
  // Disable sibling threading
  const setSiblingIdx = useSetRecoilState(store.messagesSiblingIdxFamily(null));
  
  const parentMessageId = actualLatestMessage?.parentMessageId || null;
  const actualSiblingIdxSetter = useSetRecoilState(
    store.messagesSiblingIdxFamily(parentMessageId)
  );
  
  const resetSiblingIndex = useCallback(() => {
    if (parentMessageId) {
      actualSiblingIdxSetter(0);
    }
  }, [actualSiblingIdxSetter, parentMessageId]);
  
  const queryParam = paramId === 'new' ? paramId : conversation?.conversationId ?? paramId ?? '';

  // COMPREHENSIVE DEBUG FUNCTION
  const debugMessageStructure = useCallback((msg: any, context: string, index?: number) => {
    const debugId = `MSG_${index ?? 'unknown'}_${context}_${Date.now()}`;
    
    console.group(`🔬 [${debugId}] FULL MESSAGE ANALYSIS`);
    
    // Basic info
    console.log('📋 Basic Info:', {
      messageId: msg.messageId,
      role: msg.role,
      isCompleted: msg.isCompleted,
      finish_reason: msg.finish_reason,
      parentMessageId: msg.parentMessageId,
      timestamp: new Date().toISOString()
    });
    
    // Top-level properties analysis
    console.log('🔍 Top-level Properties:', {
      allKeys: Object.keys(msg),
      keyCount: Object.keys(msg).length,
      hasText: !!msg.text,
      hasContent: !!msg.content,
      hasDelta: !!msg.delta,
      hasChildren: !!msg.children,
      hasMetadata: !!msg.metadata
    });
    
    // Text content analysis
    console.log('📝 Text Content Analysis:', {
      text: {
        exists: !!msg.text,
        type: typeof msg.text,
        length: msg.text ? msg.text.length : 0,
        preview: msg.text ? msg.text.substring(0, 100) + '...' : null,
        isEmpty: msg.text === '' || msg.text === null || msg.text === undefined
      },
      content: {
        exists: !!msg.content,
        type: typeof msg.content,
        isArray: Array.isArray(msg.content),
        length: Array.isArray(msg.content) ? msg.content.length : (msg.content ? msg.content.length : 0),
        preview: typeof msg.content === 'string' ? msg.content.substring(0, 100) + '...' : 
                Array.isArray(msg.content) ? JSON.stringify(msg.content).substring(0, 200) + '...' : 
                msg.content ? JSON.stringify(msg.content).substring(0, 100) + '...' : null
      }
    });
    
    // Delta analysis (streaming content)
    if (msg.delta) {
      console.log('🌊 Delta Content Analysis:', {
        deltaExists: true,
        deltaKeys: Object.keys(msg.delta),
        deltaContent: {
          exists: !!msg.delta.content,
          type: typeof msg.delta.content,
          isArray: Array.isArray(msg.delta.content),
          length: Array.isArray(msg.delta.content) ? msg.delta.content.length : 
                 typeof msg.delta.content === 'string' ? msg.delta.content.length : 0,
          preview: Array.isArray(msg.delta.content) ? 
                  JSON.stringify(msg.delta.content).substring(0, 200) + '...' :
                  typeof msg.delta.content === 'string' ? msg.delta.content.substring(0, 100) + '...' :
                  JSON.stringify(msg.delta.content || {}).substring(0, 100) + '...'
        },
        deltaText: {
          exists: !!msg.delta.text,
          type: typeof msg.delta.text,
          value: msg.delta.text,
          length: msg.delta.text ? msg.delta.text.length : 0
        },
        otherDeltaProps: Object.keys(msg.delta).filter(k => !['content', 'text'].includes(k))
      });
      
      // Deep dive into delta content array
      if (Array.isArray(msg.delta.content)) {
        msg.delta.content.forEach((part, partIndex) => {
          console.log(`🔬 Delta Part ${partIndex}:`, {
            type: part?.type,
            hasText: !!part?.text,
            textLength: part?.text ? part.text.length : 0,
            textValue: part?.text,
            allPartKeys: part ? Object.keys(part) : [],
            rawPart: JSON.stringify(part).substring(0, 200) + '...'
          });
        });
      }
    } else {
      console.log('🌊 Delta Content Analysis: No delta found');
    }
    
    // Content array deep dive
    if (Array.isArray(msg.content)) {
      console.log('📦 Content Array Analysis:');
      msg.content.forEach((part, partIndex) => {
        console.log(`  Part ${partIndex}:`, {
          type: part?.type,
          hasText: !!part?.text,
          textLength: part?.text ? part.text.length : 0,
          textPreview: part?.text ? part.text.substring(0, 50) + '...' : null,
          allKeys: part ? Object.keys(part) : [],
          raw: JSON.stringify(part).substring(0, 150) + '...'
        });
      });
    }
    
    // Search for text in ALL properties
    const textSearchResults = [];
    const searchForText = (obj: any, path: string = '') => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        const currentPath = path ? `${path}.${key}` : key;
        
        if (typeof value === 'string' && value.trim().length > 0) {
          textSearchResults.push({
            path: currentPath,
            length: value.length,
            preview: value.substring(0, 80) + (value.length > 80 ? '...' : ''),
            fullValue: value
          });
        } else if (typeof value === 'object' && value !== null) {
          searchForText(value, currentPath);
        }
      });
    };
    
    searchForText(msg);
    console.log('🔍 All Text Found in Message:', textSearchResults);
    
    // Raw message dump
    console.log('🗂️ Raw Message (first 1000 chars):', JSON.stringify(msg, null, 2).substring(0, 1000) + '...');
    
    // Accumulated content check
    const messageId = msg.messageId || `temp_${index}`;
    const accumulated = streamingContentRef.current.get(messageId);
    if (accumulated) {
      console.log('💾 Accumulated Content:', {
        exists: true,
        length: accumulated.length,
        preview: accumulated.substring(0, 100) + '...'
      });
    }
    
    console.groupEnd();
    
    return textSearchResults;
  }, []);

  // ENHANCED TEXT EXTRACTION WITH FULL DEBUGGING
  const extractTextContent = useCallback((msg: any, context: string = 'unknown'): string => {
    messageCountRef.current += 1;
    const messageIndex = messageCountRef.current;
    
    console.log(`🔍 [extractTextContent] Starting extraction ${messageIndex} (${context})`);
    
    // Full debug analysis
    const textSearchResults = debugMessageStructure(msg, context, messageIndex);
    
    const messageId = msg.messageId || `temp_${messageIndex}`;
    let extractedText = '';
    let extractionMethod = '';
    
    // METHOD 1: Try direct text property
    if (typeof msg.text === 'string' && msg.text.trim()) {
      extractedText = msg.text.trim();
      extractionMethod = 'direct_text';
      console.log('✅ [extractTextContent] METHOD 1 SUCCESS - Direct text:', extractedText.substring(0, 100) + '...');
    }
    
    // METHOD 2: Try content as string
    else if (typeof msg.content === 'string' && msg.content.trim()) {
      extractedText = msg.content.trim();
      extractionMethod = 'content_string';
      console.log('✅ [extractTextContent] METHOD 2 SUCCESS - Content string:', extractedText.substring(0, 100) + '...');
    }
    
    // METHOD 3: Try content array
    else if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text.trim())
        .filter(Boolean);
      
      if (textParts.length > 0) {
        extractedText = textParts.join(' ');
        extractionMethod = 'content_array';
        console.log('✅ [extractTextContent] METHOD 3 SUCCESS - Content array:', extractedText.substring(0, 100) + '...');
      }
    }
    
    // METHOD 4: Try delta content (streaming)
    if (!extractedText && msg.delta) {
      console.log('🌊 [extractTextContent] Trying delta methods...');
      
      // 4a: Delta content array
      if (Array.isArray(msg.delta.content)) {
        const deltaText = msg.delta.content
          .filter(part => part?.type === 'text' && typeof part.text === 'string')
          .map(part => part.text)
          .join('');
        
        if (deltaText.trim()) {
          const existingContent = streamingContentRef.current.get(messageId) || '';
          extractedText = existingContent + deltaText;
          streamingContentRef.current.set(messageId, extractedText);
          extractionMethod = 'delta_content_array_accumulated';
          console.log('✅ [extractTextContent] METHOD 4a SUCCESS - Delta array accumulated:', {
            deltaLength: deltaText.length,
            totalLength: extractedText.length,
            preview: extractedText.substring(0, 100) + '...'
          });
        }
      }
      
      // 4b: Direct delta text
      else if (typeof msg.delta.text === 'string' && msg.delta.text.trim()) {
        const existingContent = streamingContentRef.current.get(messageId) || '';
        extractedText = existingContent + msg.delta.text.trim();
        streamingContentRef.current.set(messageId, extractedText);
        extractionMethod = 'delta_text_accumulated';
        console.log('✅ [extractTextContent] METHOD 4b SUCCESS - Delta text accumulated:', extractedText.substring(0, 100) + '...');
      }
      
      // 4c: Delta content string
      else if (typeof msg.delta.content === 'string' && msg.delta.content.trim()) {
        const existingContent = streamingContentRef.current.get(messageId) || '';
        extractedText = existingContent + msg.delta.content.trim();
        streamingContentRef.current.set(messageId, extractedText);
        extractionMethod = 'delta_content_string_accumulated';
        console.log('✅ [extractTextContent] METHOD 4c SUCCESS - Delta content string accumulated:', extractedText.substring(0, 100) + '...');
      }
    }
    
    // METHOD 5: Check accumulated content
    if (!extractedText) {
      const accumulated = streamingContentRef.current.get(messageId);
      if (accumulated && accumulated.trim()) {
        extractedText = accumulated.trim();
        extractionMethod = 'accumulated_only';
        console.log('✅ [extractTextContent] METHOD 5 SUCCESS - Using accumulated:', extractedText.substring(0, 100) + '...');
      }
    }
    
    // METHOD 6: Search through all found text
    if (!extractedText && textSearchResults.length > 0) {
      // Prefer longer text content
      const bestResult = textSearchResults.reduce((best, current) => 
        current.length > best.length ? current : best
      );
      extractedText = bestResult.fullValue.trim();
      extractionMethod = `property_search_${bestResult.path}`;
      console.log('✅ [extractTextContent] METHOD 6 SUCCESS - Property search:', {
        path: bestResult.path,
        preview: extractedText.substring(0, 100) + '...'
      });
    }
    
    // METHOD 7: Final fallbacks
    if (!extractedText) {
      if (msg.role === 'assistant' && (!msg.isCompleted || !msg.finish_reason)) {
        extractedText = '⏳ Generating response...';
        extractionMethod = 'streaming_placeholder';
        console.log('⏳ [extractTextContent] METHOD 7a - Streaming placeholder');
      } else {
        extractedText = msg.role === 'user' 
          ? '[User message content not available]'
          : '[Assistant response not available]';
        extractionMethod = 'fallback_placeholder';
        console.warn('⚠️ [extractTextContent] METHOD 7b - Final fallback placeholder');
      }
    }
    
    console.log(`🎯 [extractTextContent] FINAL RESULT ${messageIndex}:`, {
      messageId,
      role: msg.role,
      method: extractionMethod,
      textLength: extractedText.length,
      preview: extractedText.substring(0, 150) + '...',
      isCompleted: msg.isCompleted,
      finishReason: msg.finish_reason
    });
    
    return extractedText;
  }, [debugMessageStructure]);

  // ENHANCED MESSAGE PROCESSING
  const setMessages = useCallback(
    (messages: TMessage[]) => {
      if (!messages || messages.length === 0) {
        console.warn('🔧 [setMessages] Empty messages array received');
        return;
      }
      
      const timestamp = new Date().toISOString();
      console.group(`🔧 [setMessages] Processing ${messages.length} messages at ${timestamp}`);
      console.log('📊 Processing Summary:', {
        messageCount: messages.length,
        currentIndex,
        queryParam,
        streamingMapSize: streamingContentRef.current.size
      });
      
      const processedMessages = messages.map((msg, index) => {
        console.group(`📝 Processing Message ${index}`);
        
        const extractedText = extractTextContent(msg, `setMessages_${index}`);
        
        const processed = {
          ...msg,
          text: extractedText,
          siblingCount: 1,
          siblingIndex: 0,
          children: [],
          isCompleted: msg.isCompleted || msg.finish_reason === 'stop',
          finish_reason: msg.finish_reason || (msg.isCompleted ? 'stop' : undefined),
          // Debug metadata
          _debugInfo: {
            processedAt: timestamp,
            originalTextType: typeof msg.text,
            originalContentType: typeof msg.content,
            extractedLength: extractedText.length,
            currentIndex,
            messageIndex: index,
            hadDelta: !!msg.delta,
            streamingMapSize: streamingContentRef.current.size
          }
        };
        
        console.log(`✅ Message ${index} processed:`, {
          messageId: processed.messageId,
          role: processed.role,
          textLength: processed.text.length,
          isCompleted: processed.isCompleted,
          finishReason: processed.finish_reason,
          hasPlaceholder: processed.text.includes('[') && processed.text.includes(']'),
          isStreamingPlaceholder: processed.text.includes('⏳')
        });
        
        console.groupEnd();
        return processed;
      });
      
      // Store in cache
      const cacheKey = queryParam;
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, cacheKey], processedMessages);
      console.log(`💾 Stored ${processedMessages.length} messages in cache: ${cacheKey}`);
      
      // Update latest message
      const latestMessage = processedMessages[processedMessages.length - 1];
      if (latestMessage) {
        console.log('🎯 Setting latest message:', {
          messageId: latestMessage.messageId,
          role: latestMessage.role,
          textLength: latestMessage.text.length,
          isCompleted: latestMessage.isCompleted
        });
        
        setLatestMultiMessage({ 
          ...latestMessage, 
          depth: -1,
          _forceUpdate: timestamp
        });
      }
      
      resetSiblingIndex();
      
      console.log('🎉 [setMessages] Processing complete!');
      console.groupEnd();
    },
    [queryParam, queryClient, setLatestMultiMessage, currentIndex, resetSiblingIndex, extractTextContent],
  );

  // ENHANCED MESSAGE RETRIEVAL
  const getMessages = useCallback(() => {
    const cacheKey = queryParam;
    const messages = queryClient.getQueryData<TMessage[]>([QueryKeys.messages, cacheKey]);
    
    console.log('🔧 [getMessages] Retrieved messages:', {
      currentIndex,
      cacheKey,
      messageCount: messages?.length || 0,
      hasMessages: !!messages && messages.length > 0,
      streamingMapSize: streamingContentRef.current.size,
      streamingKeys: Array.from(streamingContentRef.current.keys())
    });
    
    return messages || [];
  }, [queryParam, queryClient, currentIndex]);

  const setSubmission = useSetRecoilState(store.submissionByIndex(currentIndex));

  const { ask, regenerate } = useChatFunctions({
    index: currentIndex,
    files,
    setFiles,
    getMessages,
    setMessages,
    isSubmitting,
    conversation,
    setSubmission,
    latestMessage: actualLatestMessage,
  });

  const continueGeneration = () => {
    if (!actualLatestMessage) {
      console.error('Failed to regenerate the message: latestMessage not found.');
      return;
    }

    const messages = getMessages();
    const parentMessage = messages?.find(
      (element) => element.messageId == actualLatestMessage.parentMessageId,
    );

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask({ ...parentMessage }, { isContinued: true, isRegenerate: true, isEdited: true });
    } else {
      console.error('Failed to regenerate the message: parentMessage not found, or not created by user.');
    }
  };

  const stopGenerating = () => {
    console.log('🛑 [stopGenerating] Clearing submissions and streaming content');
    streamingContentRef.current.clear();
    clearAllSubmissions();
  };

  const handleStopGenerating = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    stopGenerating();
  };

  const handleRegenerate = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const parentMessageId = actualLatestMessage?.parentMessageId;
    if (!parentMessageId) {
      console.error('Failed to regenerate the message: parentMessageId not found.');
      return;
    }
    console.log('🔄 [handleRegenerate] Regenerating message with parentId:', parentMessageId);
    regenerate({ parentMessageId });
  };

  const handleContinue = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    continueGeneration();
  };

  return {
    ask,
    regenerate,
    getMessages,
    setMessages,
    conversation,
    isSubmitting,
    setSiblingIdx,
    latestMessage: actualLatestMessage,
    stopGenerating,
    handleContinue,
    setConversation,
    setIsSubmitting,
    handleRegenerate,
    handleStopGenerating,
  };
}