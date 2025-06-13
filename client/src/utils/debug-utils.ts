// debug-utils.ts - Comprehensive debugging utilities for LibreChat

export interface DebugMessage {
    messageId: string;
    text?: string;
    content?: any;
    sender?: string;
    endpoint?: string;
    model?: string;
    isCreatedByUser?: boolean;
    error?: boolean;
    parentMessageId?: string;
    conversationId?: string;
    timestamp?: string;
    panelType?: 'single' | 'left' | 'right';
    storageKey?: string;
  }
  
  export interface DebugSubmission {
    conversationId: string;
    endpoint: string;
    model: string;
    userMessage: string;
    panelType: 'single' | 'left' | 'right';
    isComparison: boolean;
    timestamp: string;
    storageKey: string;
  }
  
  export interface DebugDelta {
    messageId: string;
    deltaType: string;
    content: any;
    textLength: number;
    panelType: 'single' | 'left' | 'right';
    timestamp: string;
    storageKey: string;
  }
  
  export interface DebugGUI {
    panelType: 'single' | 'left' | 'right';
    messagesCount: number;
    lastMessageText: string;
    isVisible: boolean;
    storageKey: string;
    timestamp: string;
  }
  
  // Color coding for different panel types
  const PANEL_COLORS = {
    single: '#2563eb', // blue
    left: '#dc2626',   // red (DeFacts)
    right: '#16a34a', // green (comparison model)
    system: '#7c3aed' // purple (system/debug)
  };
  
  // Enhanced debug logger with panel awareness
  export class LibreChatDebugger {
    private static instance: LibreChatDebugger;
    private debugHistory: any[] = [];
    private isEnabled: boolean = true;
    
    private constructor() {
      // Initialize global debug object
      if (typeof window !== 'undefined') {
        window.__LIBRECHAT_DEBUG__ = {
          ...window.__LIBRECHAT_DEBUG__,
          debugger: this,
          getHistory: () => this.debugHistory,
          clearHistory: () => this.debugHistory = [],
          toggle: () => this.isEnabled = !this.isEnabled,
          isEnabled: () => this.isEnabled
        };
      }
    }
  
    static getInstance(): LibreChatDebugger {
      if (!LibreChatDebugger.instance) {
        LibreChatDebugger.instance = new LibreChatDebugger();
      }
      return LibreChatDebugger.instance;
    }
  
    private log(category: string, panelType: 'single' | 'left' | 'right' | 'system', data: any) {
      if (!this.isEnabled) return;
  
      const timestamp = new Date().toISOString();
      const color = PANEL_COLORS[panelType];
      
      const debugEntry = {
        timestamp,
        category,
        panelType,
        data,
        id: `${category}_${panelType}_${Date.now()}`
      };
  
      this.debugHistory.push(debugEntry);
  
      // Keep only last 1000 entries
      if (this.debugHistory.length > 1000) {
        this.debugHistory = this.debugHistory.slice(-1000);
      }
  
      console.group(`%c🔍 [${category}] ${panelType.toUpperCase()} PANEL`, 
        `color: ${color}; font-weight: bold; font-size: 12px;`);
      console.log(`⏰ ${timestamp}`);
      console.log('📊 Data:', data);
      console.groupEnd();
    }
  
    // User Query Tracking
    logUserQuery(query: string, conversationId: string, panelType: 'single' | 'left' | 'right') {
      this.log('USER_QUERY', panelType, {
        query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        queryLength: query.length,
        conversationId,
        storageKey: this.generateStorageKey(conversationId, panelType)
      });
    }
  
    // Submission Tracking
    logSubmission(submission: DebugSubmission) {
      this.log('SUBMISSION', submission.panelType, {
        ...submission,
        userMessagePreview: submission.userMessage.substring(0, 100)
      });
    }
  
    // Message Delta Tracking
    logDelta(delta: DebugDelta) {
      this.log('DELTA_UPDATE', delta.panelType, delta);
    }
  
    // Message State Tracking
    logMessages(messages: DebugMessage[], context: string, panelType: 'single' | 'left' | 'right') {
      const processedMessages = messages.map(msg => ({
        messageId: msg.messageId,
        sender: msg.sender,
        endpoint: msg.endpoint,
        model: msg.model,
        textLength: (msg.text || '').length,
        textPreview: (msg.text || '').substring(0, 100),
        hasError: !!msg.error,
        isUser: !!msg.isCreatedByUser,
        storageKey: msg.storageKey
      }));
  
      this.log('MESSAGES_STATE', panelType, {
        context,
        count: messages.length,
        messages: processedMessages,
        storageKey: messages[0]?.storageKey
      });
    }
  
    // GUI Display Tracking
    logGUIUpdate(gui: DebugGUI) {
      this.log('GUI_UPDATE', gui.panelType, gui);
    }
  
    // Storage Key Management
    logStorageOperation(operation: 'set' | 'get' | 'remove', key: string, panelType: 'single' | 'left' | 'right', data?: any) {
      this.log('STORAGE_OPERATION', panelType, {
        operation,
        key,
        hasData: !!data,
        dataType: data ? typeof data : 'none',
        dataCount: Array.isArray(data) ? data.length : 'not-array'
      });
    }
  
    // Error Tracking
    logError(error: any, context: string, panelType: 'single' | 'left' | 'right') {
      this.log('ERROR', panelType, {
        context,
        error: error.message || error,
        stack: error.stack,
        name: error.name
      });
    }
  
    // SSE Event Tracking
    logSSEEvent(event: string, data: any, panelType: 'single' | 'left' | 'right') {
      this.log('SSE_EVENT', panelType, {
        event,
        dataType: typeof data,
        dataLength: typeof data === 'string' ? data.length : 'not-string',
        dataPreview: typeof data === 'string' ? data.substring(0, 100) : data
      });
    }
  
    // Generate consistent storage keys
    generateStorageKey(conversationId: string, panelType: 'single' | 'left' | 'right'): string {
      if (panelType === 'single') {
        return conversationId;
      } else if (panelType === 'left') {
        return `${conversationId}_defacts`;
      } else if (panelType === 'right') {
        return `${conversationId}_comparison`;
      }
      return conversationId;
    }
  
    // Comprehensive state dump
    dumpState(queryClient: any) {
      const allQueries = queryClient.getQueryCache().getAll();
      const messageQueries = allQueries.filter((q: any) => q.queryKey[0] === 'messages');
      
      this.log('STATE_DUMP', 'system', {
        totalQueries: allQueries.length,
        messageQueries: messageQueries.length,
        queries: messageQueries.map((q: any) => ({
          key: q.queryKey,
          hasData: !!q.state.data,
          dataCount: Array.isArray(q.state.data) ? q.state.data.length : 'not-array',
          panelType: this.identifyPanelType(q.queryKey)
        }))
      });
    }
  
    private identifyPanelType(queryKey: any[]): 'single' | 'left' | 'right' | 'unknown' {
      const key = queryKey.join('_');
      if (key.includes('_defacts')) return 'left';
      if (key.includes('_comparison')) return 'right';
      if (queryKey.length === 2) return 'single'; // Basic [messages, conversationId]
      return 'unknown';
    }
  
    // Export debug data
    exportDebugData() {
      const data = {
        timestamp: new Date().toISOString(),
        history: this.debugHistory,
        summary: this.generateSummary()
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `librechat-debug-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  
    private generateSummary() {
      const categories = this.debugHistory.reduce((acc, entry) => {
        if (!acc[entry.category]) acc[entry.category] = 0;
        acc[entry.category]++;
        return acc;
      }, {} as Record<string, number>);
  
      const panels = this.debugHistory.reduce((acc, entry) => {
        if (!acc[entry.panelType]) acc[entry.panelType] = 0;
        acc[entry.panelType]++;
        return acc;
      }, {} as Record<string, number>);
  
      return {
        totalEntries: this.debugHistory.length,
        categoryCounts: categories,
        panelCounts: panels,
        timeRange: {
          start: this.debugHistory[0]?.timestamp,
          end: this.debugHistory[this.debugHistory.length - 1]?.timestamp
        }
      };
    }
  }
  
  // Enhanced message content extraction
  export function safeExtractMessageContent(msg: any): { text: string; content: any } {
    let text = '';
    let content = null;
  
    // Handle array content (Perplexity/structured format)
    if (Array.isArray(msg?.content)) {
      content = msg.content;
      for (const item of msg.content) {
        if (item?.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0) {
          text = item.text.trim();
          break;
        }
      }
    }
    
    // Handle string content
    if (!text && typeof msg?.content === 'string') {
      text = msg.content.trim();
      content = msg.content;
    }
    
    // Fallback to text field
    if (!text && typeof msg?.text === 'string') {
      text = msg.text.trim();
    }
  
    // Last resort - check other common fields
    if (!text) {
      const candidates = [msg?.response, msg?.message?.text, msg?.message?.content];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          text = candidate.trim();
          break;
        }
      }
    }
  
    return { text, content };
  }
  
  // Storage key utilities
  export const StorageKeyUtils = {
    // Generate unique keys for different panel types
    forSinglePanel: (conversationId: string) => conversationId,
    forLeftPanel: (conversationId: string) => `${conversationId}_defacts`,
    forRightPanel: (conversationId: string) => `${conversationId}_comparison`,
    
    // Parse panel type from key
    getPanelType: (key: string): 'single' | 'left' | 'right' => {
      if (key.includes('_defacts')) return 'left';
      if (key.includes('_comparison')) return 'right';
      return 'single';
    },
    
    // Get base conversation ID from any key
    getConversationId: (key: string): string => {
      if (key.includes('_defacts')) return key.replace('_defacts', '');
      if (key.includes('_comparison')) return key.replace('_comparison', '');
      return key;
    }
  };
  
  // Hook for easy debugging integration
  export function useLibreChatDebug() {
    const debugger = LibreChatDebugger.getInstance();
    
    return {
      logUserQuery: debugger.logUserQuery.bind(debugger),
      logSubmission: debugger.logSubmission.bind(debugger),
      logDelta: debugger.logDelta.bind(debugger),
      logMessages: debugger.logMessages.bind(debugger),
      logGUIUpdate: debugger.logGUIUpdate.bind(debugger),
      logStorageOperation: debugger.logStorageOperation.bind(debugger),
      logError: debugger.logError.bind(debugger),
      logSSEEvent: debugger.logSSEEvent.bind(debugger),
      generateStorageKey: debugger.generateStorageKey.bind(debugger),
      dumpState: debugger.dumpState.bind(debugger),
      exportDebugData: debugger.exportDebugData.bind(debugger)
    };
  }
  
  // Monkey patch console to capture all debug output
  export function initializeDebugCapture() {
    const debugger = LibreChatDebugger.getInstance();
    
    // Capture console.error for automatic error logging
    const originalError = console.error;
    console.error = function(...args: any[]) {
      // Check if this looks like a LibreChat error
      const errorString = args.join(' ');
      if (errorString.includes('EVENT_HANDLERS') || 
          errorString.includes('STEP_HANDLER') || 
          errorString.includes('LibreChat')) {
        debugger.logError(new Error(errorString), 'console.error', 'system');
      }
      originalError.apply(console, args);
    };
    
    // Capture fetch requests
    const originalFetch = window.fetch;
    window.fetch = function(...args: any[]) {
      const url = args[0];
      if (typeof url === 'string' && (url.includes('/api/ask/') || url.includes('/api/chat/'))) {
        const body = args[1]?.body;
        if (body) {
          try {
            const parsedBody = JSON.parse(body);
            const panelType = parsedBody._isAddedRequest ? 'right' : 'single';
            debugger.logSubmission({
              conversationId: parsedBody.conversationId || 'unknown',
              endpoint: parsedBody.endpoint || 'unknown',
              model: parsedBody.model || 'unknown',
              userMessage: parsedBody.messages?.[parsedBody.messages.length - 1]?.text || 'no message',
              panelType,
              isComparison: !!parsedBody._isAddedRequest,
              timestamp: new Date().toISOString(),
              storageKey: debugger.generateStorageKey(parsedBody.conversationId || 'unknown', panelType)
            });
          } catch (e) {
            debugger.logError(e, 'fetch body parsing', 'system');
          }
        }
      }
      return originalFetch.apply(this, args);
    };
  }
  
  // Auto-initialize if in browser
  if (typeof window !== 'undefined') {
    initializeDebugCapture();
  }