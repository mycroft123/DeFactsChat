// sseDebugUtils.ts

// Create SSE debugger for deep inspection
export const createSSEDebugger = (model: string, isComparison: boolean) => {
    const eventLog: any[] = [];
    
    return {
      logRawEvent: (eventType: string, data: any) => {
        const entry = {
          timestamp: new Date().toISOString(),
          model,
          isComparison,
          eventType,
          data,
          dataString: typeof data === 'string' ? data : JSON.stringify(data),
        };
        
        eventLog.push(entry);
        
        if (model === 'DeFacts' || model?.toLowerCase().includes('defacts')) {
          console.log(`🔴 [DEFACTS RAW ${eventType}]:`, data);
          
          if (data && typeof data === 'object') {
            console.log('🔴 [DEFACTS STRUCTURE]:', {
              keys: Object.keys(data),
              hasText: 'text' in data,
              hasContent: 'content' in data,
              hasResponse: 'response' in data,
              hasDelta: 'delta' in data,
              hasMessage: 'message' in data,
              hasResponseMessage: 'responseMessage' in data,
              dataPreview: JSON.stringify(data).substring(0, 200),
            });
            
            if (data.delta) {
              console.log('🔴 [DEFACTS DELTA STRUCTURE]:', {
                deltaKeys: Object.keys(data.delta),
                deltaContent: data.delta.content,
                deltaContentType: typeof data.delta.content,
              });
            }
            
            if (data.responseMessage) {
              console.log('🔴 [DEFACTS RESPONSE MESSAGE]:', {
                hasText: !!data.responseMessage.text,
                textLength: data.responseMessage.text?.length || 0,
                hasContent: !!data.responseMessage.content,
                contentLength: data.responseMessage.content?.length || 0,
              });
            }
          }
        }
      },
      
      exportLog: () => {
        console.log('📋 FULL DEFACTS EVENT LOG:', JSON.stringify(eventLog, null, 2));
        return eventLog;
      }
    };
  };
  
  // Get panel name for logging
  export const getPanelName = (isAddedRequest: boolean, runIndex: number): string => {
    if (!isAddedRequest && runIndex === 0) return 'DEFACTS';
    if (isAddedRequest && runIndex === 1) return 'COMPARISON';
    return `PANEL_${runIndex}`;
  };
  
  // Enhanced debug utility for delta messages
  export const debugDelta = (context: string, data: any, metadata?: any) => {
    const panelName = metadata?.isAddedRequest !== undefined ? 
      getPanelName(metadata.isAddedRequest, metadata.runIndex || 0) : 'UNKNOWN';
    
    console.group(`🔄 [${panelName}] DELTA DEBUG [${context}]`);
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.log('📊 Data:', data);
    if (metadata) {
      console.log('🔍 Metadata:', metadata);
    }
    
    if (data?.delta) {
      console.log('📝 Delta content detected:', {
        hasContent: !!data.delta.content,
        contentType: typeof data.delta.content,
        contentLength: typeof data.delta.content === 'string' ? data.delta.content.length : 0,
        contentPreview: typeof data.delta.content === 'string' ? data.delta.content.substring(0, 100) + '...' : `Type: ${typeof data.delta.content}`,
        deltaKeys: Object.keys(data.delta)
      });
    }
    
    if (data?.text || data?.content) {
      console.log('📝 Message content:', {
        textType: typeof data.text,
        contentType: typeof data.content,
        textLength: typeof data.text === 'string' ? data.text.length : 0,
        contentLength: typeof data.content === 'string' ? data.content.length : 0,
        preview: typeof data.text === 'string' ? data.text.substring(0, 100) + '...' : 
                 typeof data.content === 'string' ? data.content.substring(0, 100) + '...' : 
                 `Text: ${typeof data.text}, Content: ${typeof data.content}`
      });
    }
    
    console.groupEnd();
  };
  
  // Safe content extraction utility
  export const safeGetContent = (obj: any, field: string = 'content'): string => {
    const value = obj?.[field];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (value && typeof value === 'object' && value.toString) return value.toString();
    return '';
  };
  
  // Enhanced text extraction that handles more formats
  export const extractDeltaText = (data: any): string => {
    try {
      if (data?.delta?.text) {
        return data.delta.text;
      }
      
      if (data?.delta?.content) {
        if (Array.isArray(data.delta.content)) {
          const textContent = data.delta.content.find((item: any) => item?.type === 'text');
          if (textContent?.text) {
            return textContent.text;
          }
        } else if (typeof data.delta.content === 'string') {
          return data.delta.content;
        }
      }
      
      if (data?.data?.delta?.content) {
        if (Array.isArray(data.data.delta.content)) {
          const textContent = data.data.delta.content.find((item: any) => item?.type === 'text');
          if (textContent?.text) {
            return textContent.text;
          }
        } else if (typeof data.data.delta.content === 'string') {
          return data.data.delta.content;
        }
      }
      
      if (data?.data?.delta?.text) {
        return data.data.delta.text;
      }
      
      if (data?.content && typeof data.content === 'string') {
        return data.content;
      }
      
      if (data?.message && typeof data.message === 'string') {
        return data.message;
      }
      
      return '';
    } catch (error) {
      console.error('Error extracting delta text:', error);
      return '';
    }
  };
  
  // Check if data contains text (handles multiple formats)
  export const hasTextContent = (data: any): boolean => {
    return !!(
      data?.text || 
      data?.response || 
      data?.delta?.text || 
      extractDeltaText(data)
    );
  };
  
  // Safe preview utility
  export const safePreview = (content: any, length: number = 100): string => {
    if (typeof content === 'string') {
      return content.substring(0, length) + (content.length > length ? '...' : '');
    }
    if (typeof content === 'number') {
      return content.toString();
    }
    if (content === null) return 'null';
    if (content === undefined) return 'undefined';
    return `Type: ${typeof content}`;
  };
  
  // Side-by-side comparison debug
  export const debugComparison = (context: string, data: any) => {
    const panelName = data?.isAddedRequest !== undefined ? 
      getPanelName(data.isAddedRequest, data.runIndex || 0) : 'UNKNOWN';
    
    console.group(`🔗 [${panelName}] DEBUG [${context}]`);
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.log('📊 Data:', data);
    
    if (data?.isAddedRequest !== undefined) {
      console.log('🎯 Panel:', panelName);
      console.log('📍 Is comparison request:', data.isAddedRequest);
    }
    
    if (data?.runIndex !== undefined) {
      console.log('🏃 Run index:', data.runIndex);
    }
    
    console.groupEnd();
  };