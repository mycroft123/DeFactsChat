// useSSEDebug.ts - Centralized debugging utilities for SSE

// Types
interface AICallDebugInfo {
    requestId: string;
    panel: 'LEFT' | 'RIGHT' | 'SINGLE';
    model: string;
    endpoint: string;
    timestamp: number;
    payload: any;
    response?: any;
    error?: any;
    duration?: number;
    sseEvents: Array<{
      type: string;
      data: any;
      timestamp: number;
    }>;
  }
  
  // Global debug storage
  const AI_CALL_DEBUG_HISTORY: AICallDebugInfo[] = [];
  
  // Debug AI calls
  export const debugAICall = (info: Partial<AICallDebugInfo>) => {
    const debugEntry: AICallDebugInfo = {
      requestId: info.requestId || 'unknown',
      panel: info.panel || 'SINGLE',
      model: info.model || 'unknown',
      endpoint: info.endpoint || 'unknown',
      timestamp: Date.now(),
      payload: info.payload,
      response: info.response,
      error: info.error,
      duration: info.duration,
      sseEvents: info.sseEvents || [],
    };
    
    AI_CALL_DEBUG_HISTORY.push(debugEntry);
    
    // Keep only last 50 entries
    if (AI_CALL_DEBUG_HISTORY.length > 50) {
      AI_CALL_DEBUG_HISTORY.shift();
    }
    
    console.log('🔍 [AI_CALL_DEBUG]', debugEntry);
  };
  
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
  
  // Enhanced pre-flight check function
  export const performPreflightCheck = async (
    server: string,
    payload: any,
    token: string,
    model: string
  ): Promise<{ success: boolean; error?: any; details?: any }> => {
    console.log(`🛫 [PREFLIGHT CHECK] Starting for ${model}...`);
    
    try {
      // First, try OPTIONS request to check CORS
      try {
        const optionsResponse = await fetch(server, {
          method: 'OPTIONS',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
        
        console.log(`🛫 [PREFLIGHT OPTIONS]`, {
          status: optionsResponse.status,
          headers: Object.fromEntries(optionsResponse.headers.entries()),
        });
      } catch (optionsError) {
        console.warn(`⚠️ [PREFLIGHT OPTIONS] Failed:`, optionsError);
      }
      
      // Then try actual POST request
      const response = await fetch(server, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      
      const responseHeaders = Object.fromEntries(response.headers.entries());
      let responseData = null;
      
      try {
        const responseText = await response.text();
        if (responseText) {
          responseData = JSON.parse(responseText);
        }
      } catch (e) {
        // Response might not be JSON
      }
      
      const result = {
        success: response.ok,
        details: {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          data: responseData,
          hasSSEHeaders: responseHeaders['content-type']?.includes('text/event-stream'),
        },
      };
      
      console.log(`🛫 [PREFLIGHT RESULT]`, result);
      
      return result;
    } catch (error) {
      console.error(`❌ [PREFLIGHT ERROR]`, error);
      return {
        success: false,
        error: error,
        details: {
          errorType: (error as Error).constructor.name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
      };
    }
  };
  
  // Diagnostic function for RIGHT panel failures
  export const diagnoseRightPanelFailure = () => {
    console.log('🔍 DIAGNOSING RIGHT PANEL FAILURE...');
    console.log('=====================================');
    
    // Import REQUEST_TRACKER if available
    const REQUEST_TRACKER = (window as any).REQUEST_TRACKER;
    if (!REQUEST_TRACKER) {
      console.error('REQUEST_TRACKER not available');
      return;
    }
    
    // 1. Check active requests
    const activeRequests = Array.from(REQUEST_TRACKER.activeRequests.values());
    const rightPanelRequests = activeRequests.filter((r: any) => r.panel === 'RIGHT');
    
    console.log('1️⃣ Active RIGHT Panel Requests:', rightPanelRequests.length);
    rightPanelRequests.forEach((req: any) => {
      console.log('  - Request:', {
        id: req.id,
        model: req.model,
        status: req.status,
        duration: Date.now() - req.startTime,
        messageId: req.messageId,
      });
    });
    
    // 2. Check comparison mode detection
    const panels = document.querySelectorAll('[data-panel]');
    console.log('2️⃣ Panel Detection:', {
      panelCount: panels.length,
      isComparisonMode: panels.length > 1,
      panelAttributes: Array.from(panels).map(p => p.getAttribute('data-panel')),
    });
    
    // 3. Check for stuck requests
    const stuckRequests = activeRequests.filter((r: any) => 
      r.status === 'pending' && 
      Date.now() - r.startTime > 5000 // More than 5 seconds
    );
    
    if (stuckRequests.length > 0) {
      console.log('3️⃣ ⚠️  STUCK REQUESTS FOUND:', stuckRequests.length);
      stuckRequests.forEach((req: any) => {
        console.log('  - Stuck Request:', {
          panel: req.panel,
          model: req.model,
          duration: `${Math.round((Date.now() - req.startTime) / 1000)}s`,
          question: req.question.substring(0, 50),
        });
      });
    } else {
      console.log('3️⃣ ✅ No stuck requests');
    }
    
    // 4. Check AI call history
    const pendingAICalls = AI_CALL_DEBUG_HISTORY.filter(call => !call.duration);
    const failedAICalls = AI_CALL_DEBUG_HISTORY.filter(call => call.error);
    
    console.log('4️⃣ AI Call Status:', {
      total: AI_CALL_DEBUG_HISTORY.length,
      pending: pendingAICalls.length,
      failed: failedAICalls.length,
    });
    
    if (failedAICalls.length > 0) {
      console.log('  ❌ Failed AI Calls:');
      failedAICalls.forEach(call => {
        console.log('    -', {
          panel: call.panel,
          model: call.model,
          error: call.error,
        });
      });
    }
    
    // 5. Provide recommendations
    console.log('\n📋 DIAGNOSTIC SUMMARY:');
    
    if (rightPanelRequests.length === 0) {
      console.log('❌ No RIGHT panel requests found - The request may not be starting');
      console.log('   → Check if submission is being passed to the RIGHT panel');
      console.log('   → Verify isAddedRequest=true for RIGHT panel');
    } else if (stuckRequests.some((r: any) => r.panel === 'RIGHT')) {
      console.log('❌ RIGHT panel request is stuck in pending state');
      console.log('   → Check SSE connection establishment');
      console.log('   → Verify server endpoint is responding');
      console.log('   → Check for CORS or authentication issues');
    } else {
      console.log('⚠️  Unable to determine specific failure reason');
      console.log('   → Enable more verbose logging');
      console.log('   → Check browser DevTools Network tab');
      console.log('   → Verify model availability');
    }
    
    return {
      rightPanelRequests,
      stuckRequests: stuckRequests.filter((r: any) => r.panel === 'RIGHT'),
      isComparisonMode: panels.length > 1,
    };
  };
  
  // ChatGPT Stream Analysis function
  export const analyzeChatGPTStream = (connectionId?: string) => {
    const CHATGPT_RAW_STREAM = (window as any).CHATGPT_RAW_STREAM;
    
    if (!CHATGPT_RAW_STREAM || CHATGPT_RAW_STREAM.length === 0) {
      console.log('No ChatGPT stream data captured');
      return;
    }
    
    let messages = CHATGPT_RAW_STREAM;
    
    // Filter by connection ID if provided
    if (connectionId) {
      messages = messages.filter((m: any) => m.connectionId.includes(connectionId));
    }
    
    console.log(`\n🤖 CHATGPT STREAM ANALYSIS (${messages.length} messages)`);
    console.log('=====================================');
    
    // Group by connection
    const connections: Record<string, any[]> = {};
    messages.forEach((msg: any) => {
      if (!connections[msg.connectionId]) {
        connections[msg.connectionId] = [];
      }
      connections[msg.connectionId].push(msg);
    });
    
    Object.entries(connections).forEach(([connId, msgs]) => {
      console.log(`\n📡 Connection: ${connId}`);
      console.log(`Messages: ${msgs.length}`);
      
      // Analyze message types
      const messageTypes = {
        empty: 0,
        done: 0,
        data: 0,
        error: 0,
        delta: 0,
        final: 0,
        created: 0,
        runStep: 0,
        other: 0,
      };
      
      let totalContent = '';
      let deltaCount = 0;
      const eventTypes: Record<string, number> = {};
      
      msgs.forEach((msg: any, index: number) => {
        if (!msg.raw || msg.raw.trim() === '') {
          messageTypes.empty++;
          return;
        }
        
        try {
          // Check for OpenAI format
          if (msg.raw.startsWith('data: ')) {
            const jsonStr = msg.raw.substring(6).trim();
            if (jsonStr === '[DONE]') {
              messageTypes.done++;
              return;
            }
            
            const parsed = JSON.parse(jsonStr);
            if (parsed.choices?.[0]?.delta?.content) {
              messageTypes.delta++;
              deltaCount++;
              totalContent += parsed.choices[0].delta.content;
            }
          } else {
            // Custom format
            const parsed = JSON.parse(msg.raw);
            
            if (parsed.event) {
              eventTypes[parsed.event] = (eventTypes[parsed.event] || 0) + 1;
              
              if (parsed.event === 'on_message_delta' && parsed.data?.delta?.content) {
                messageTypes.delta++;
                const content = parsed.data.delta.content;
                if (Array.isArray(content) && content[0]?.type === 'text') {
                  deltaCount++;
                  totalContent += content[0].text || '';
                }
              } else if (parsed.event === 'on_run_step') {
                messageTypes.runStep++;
              }
            } else if (parsed.message) {
              messageTypes.created++;
            } else if (parsed.final) {
              messageTypes.final++;
            } else if (parsed.error) {
              messageTypes.error++;
            } else {
              messageTypes.other++;
            }
          }
        } catch (e) {
          messageTypes.other++;
        }
      });
      
      console.log('\nMessage Types:', messageTypes);
      console.log('Event Types:', eventTypes);
      console.log(`Delta messages with content: ${deltaCount}`);
      console.log(`Total content length: ${totalContent.length} chars`);
      
      // Show first and last few messages
      console.log('\nFirst 3 messages:');
      msgs.slice(0, 3).forEach((msg: any, i: number) => {
        try {
          if (msg.raw.startsWith('data: ')) {
            console.log(`  [${i}]: OpenAI format:`, msg.raw.substring(0, 100) + '...');
          } else {
            const parsed = JSON.parse(msg.raw);
            console.log(`  [${i}]:`, {
              event: parsed.event,
              hasData: !!parsed.data,
              preview: JSON.stringify(parsed).substring(0, 150) + '...'
            });
          }
        } catch {
          console.log(`  [${i}]:`, msg.raw?.substring(0, 100) + '...');
        }
      });
      
      console.log('\nLast 3 messages:');
      msgs.slice(-3).forEach((msg: any, i: number) => {
        try {
          if (msg.raw.startsWith('data: ')) {
            console.log(`  [${msgs.length - 3 + i}]: OpenAI format:`, msg.raw.substring(0, 100) + '...');
          } else {
            const parsed = JSON.parse(msg.raw);
            console.log(`  [${msgs.length - 3 + i}]:`, {
              event: parsed.event,
              final: parsed.final,
              hasResponseMessage: !!parsed.responseMessage,
              preview: JSON.stringify(parsed).substring(0, 150) + '...'
            });
          }
        } catch {
          console.log(`  [${msgs.length - 3 + i}]:`, msg.raw?.substring(0, 100) + '...');
        }
      });
      
      // Show accumulated content
      if (totalContent) {
        console.log('\n📝 Accumulated content from deltas:');
        console.log('Length:', totalContent.length);
        console.log('Preview:', totalContent.substring(0, 200) + '...');
        console.log('End:', '...' + totalContent.substring(totalContent.length - 100));
      }
      
      // Analyze final message
      const finalMsg = msgs.find((m: any) => {
        try {
          return JSON.parse(m.raw).final === true;
        } catch {
          return false;
        }
      });
      
      if (finalMsg) {
        try {
          const final = JSON.parse(finalMsg.raw);
          console.log('\n✅ Final message found:', {
            hasResponseMessage: !!final.responseMessage,
            responseText: final.responseMessage?.text?.substring(0, 100) + '...',
            textLength: final.responseMessage?.text?.length || 0,
          });
        } catch (e) {
          console.error('Error parsing final message:', e);
        }
      }
    });
  };
  
  // Install global debug functions
  export const installDebugGlobals = () => {
    if (typeof window !== 'undefined') {
      (window as any).AI_DEBUG = {
        showHistory: () => {
          console.table(AI_CALL_DEBUG_HISTORY.map(entry => ({
            requestId: entry.requestId.substring(0, 8),
            panel: entry.panel,
            model: entry.model,
            endpoint: entry.endpoint,
            timestamp: new Date(entry.timestamp).toLocaleTimeString(),
            hasError: !!entry.error,
            duration: entry.duration ? `${entry.duration}ms` : 'pending',
            eventCount: entry.sseEvents.length,
          })));
        },
        showRequest: (requestId: string) => {
          const entry = AI_CALL_DEBUG_HISTORY.find(e => 
            e.requestId.includes(requestId) || e.requestId === requestId
          );
          if (entry) {
            console.log('📋 AI Call Details:', entry);
          } else {
            console.log('Request not found');
          }
        },
        showFailures: () => {
          const failures = AI_CALL_DEBUG_HISTORY.filter(e => e.error);
          console.log(`❌ Failed AI Calls (${failures.length}):`, failures);
        },
        showPending: () => {
          const pending = AI_CALL_DEBUG_HISTORY.filter(e => !e.duration);
          console.log(`⏳ Pending AI Calls (${pending.length}):`, pending);
          return pending;
        },
        clear: () => {
          AI_CALL_DEBUG_HISTORY.length = 0;
          console.log('🧹 AI debug history cleared');
        },
      };
      
      (window as any).diagnoseRight = diagnoseRightPanelFailure;
      
      (window as any).forceCompleteStuck = () => {
        const REQUEST_TRACKER = (window as any).REQUEST_TRACKER;
        if (!REQUEST_TRACKER) {
          console.error('REQUEST_TRACKER not available');
          return;
        }
        
        const activeRequests = Array.from(REQUEST_TRACKER.activeRequests.entries());
        let completed = 0;
        
        activeRequests.forEach(([id, req]: [string, any]) => {
          if (req.status === 'pending' && Date.now() - req.startTime > 5000) {
            console.log(`Force completing stuck request: ${req.panel} - ${req.model}`);
            REQUEST_TRACKER.completeRequest(id, false, 0, 'Force completed - was stuck');
            completed++;
          }
        });
        
        console.log(`✅ Force completed ${completed} stuck requests`);
      };
      
      // Initialize ChatGPT monitoring storage
      (window as any).CHATGPT_RAW_STREAM = (window as any).CHATGPT_RAW_STREAM || [];
      
      // ChatGPT monitoring functions
      (window as any).analyzeChatGPTStream = analyzeChatGPTStream;
      
      (window as any).debugLastChatGPTFailure = () => {
        const REQUEST_TRACKER = (window as any).REQUEST_TRACKER;
        if (!REQUEST_TRACKER) {
          console.error('REQUEST_TRACKER not available');
          return;
        }
        
        // Get failed ChatGPT requests
        const failedRequests = Array.from(REQUEST_TRACKER.completedRequests.values())
          .filter((r: any) => (r.model === 'gpt-4o' || r.model?.includes('gpt')) && r.status === 'failed')
          .sort((a: any, b: any) => b.startTime - a.startTime);
          
        if (failedRequests.length === 0) {
          console.log('No failed ChatGPT requests found');
          return;
        }
        
        const lastFailed = failedRequests[0];
        console.log('❌ Last failed ChatGPT request:', {
          questionNumber: lastFailed.questionNumber,
          question: lastFailed.question,
          duration: lastFailed.duration,
          error: lastFailed.error,
          responseLength: lastFailed.responseLength,
        });
        
        // Find the connection for this request
        const failureTime = lastFailed.startTime;
        const CHATGPT_RAW_STREAM = (window as any).CHATGPT_RAW_STREAM;
        const relevantMessages = CHATGPT_RAW_STREAM?.filter((m: any) => 
          m.timestamp >= failureTime && 
          m.timestamp <= failureTime + (lastFailed.duration || 30000)
        ) || [];
        
        console.log(`\n📡 Found ${relevantMessages.length} messages during this request`);
        
        if (relevantMessages.length > 0) {
          console.log('Analyzing stream for this failure...');
          const connectionId = relevantMessages[0]?.connectionId;
          if (connectionId) {
            analyzeChatGPTStream(connectionId);
          }
        }
      };
      
      (window as any).monitorChatGPT = (enable = true) => {
        if (enable) {
          (window as any).CHATGPT_MONITOR_ENABLED = true;
          console.log('🔍 ChatGPT monitoring ENABLED - will log all messages in real-time');
        } else {
          (window as any).CHATGPT_MONITOR_ENABLED = false;
          console.log('🔍 ChatGPT monitoring DISABLED');
        }
      };
      
      (window as any).detectChatGPTFormat = () => {
        const CHATGPT_RAW_STREAM = (window as any).CHATGPT_RAW_STREAM;
        
        if (!CHATGPT_RAW_STREAM || CHATGPT_RAW_STREAM.length === 0) {
          console.log('No ChatGPT messages to analyze');
          return;
        }
        
        const formats = {
          openai: 0,
          custom: 0,
          unknown: 0
        };
        
        CHATGPT_RAW_STREAM.forEach((msg: any) => {
          if (msg.raw?.startsWith('data: ')) {
            formats.openai++;
          } else {
            try {
              const parsed = JSON.parse(msg.raw);
              if (parsed.event || parsed.message || parsed.final) {
                formats.custom++;
              } else {
                formats.unknown++;
              }
            } catch {
              formats.unknown++;
            }
          }
        });
        
        console.log('🤖 ChatGPT Format Analysis:', formats);
        console.log('Primary format:', formats.openai > formats.custom ? 'OpenAI Standard' : 'Custom Event');
        
        // Show examples of each format
        console.log('\nFormat Examples:');
        
        const openaiExample = CHATGPT_RAW_STREAM.find((m: any) => m.raw?.startsWith('data: '));
        if (openaiExample) {
          console.log('OpenAI format example:', openaiExample.raw.substring(0, 200));
        }
        
        const customExample = CHATGPT_RAW_STREAM.find((m: any) => {
          try {
            const p = JSON.parse(m.raw);
            return p.event || p.message || p.final;
          } catch {
            return false;
          }
        });
        if (customExample) {
          console.log('Custom format example:', customExample.raw.substring(0, 200));
        }
      };
      
      // Log available commands
      console.log(`
  🔍 AI Debugging Commands:
  - AI_DEBUG.showHistory()     // Show all AI calls
  - AI_DEBUG.showRequest('id') // Show specific request details
  - AI_DEBUG.showFailures()    // Show only failed calls
  - AI_DEBUG.showPending()     // Show active/pending calls
  - AI_DEBUG.clear()           // Clear history
  
  🔧 Request Tracker Commands:
  - REQUEST_TRACKER.showCurrentState()
  - REQUEST_TRACKER.showSummary()
  
  🔍 Diagnostic Commands:
  - diagnoseRight()        // Diagnose RIGHT panel failures
  - forceCompleteStuck()   // Force complete stuck requests
  
  🤖 ChatGPT Debugging Commands:
  - monitorChatGPT(true)         // Enable real-time logging
  - analyzeChatGPTStream()       // Analyze all captured messages
  - debugLastChatGPTFailure()    // Debug the last failure
  - detectChatGPTFormat()        // Check which format is being used
  - window.CHATGPT_RAW_STREAM    // Access raw message array
  `);
    }
  };