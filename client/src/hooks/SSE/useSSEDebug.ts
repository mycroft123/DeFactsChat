// hooks/SSE/useSSEDebug.ts
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
        
        // Special logging for DeFacts
        if (model === 'DeFacts' || model?.includes('defacts')) {
          console.log(`🔴 [DEFACTS RAW ${eventType}]:`, data);
          
          // Log the structure deeply
          if (data && typeof data === 'object') {
            console.log('🔴 [DEFACTS STRUCTURE]:', {
              keys: Object.keys(data),
              hasText: 'text' in data,
              hasContent: 'content' in data,
              hasResponse: 'response' in data,
              hasDelta: 'delta' in data,
              hasMessage: 'message' in data,
              dataPreview: JSON.stringify(data).substring(0, 200),
            });
          }
        }
      },
      
      exportLog: () => {
        console.log('📋 FULL EVENT LOG:', JSON.stringify(eventLog, null, 2));
        return eventLog;
      }
    };
  };