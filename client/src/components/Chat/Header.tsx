import { useMemo, useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getConfigDefaults, PermissionTypes, Permissions } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import ModelSelector from './Menus/Endpoints/ModelSelector';
import { PresetsMenu, HeaderNewChat, OpenSidebar } from './Menus';
import { useGetStartupConfig } from '~/data-provider';
import ExportAndShareMenu from './ExportAndShareMenu';
import { useMediaQuery, useHasAccess, useAuthContext } from '~/hooks';
import BookmarkMenu from './Menus/BookmarkMenu';
import { TemporaryChat } from './TemporaryChat';
import AddMultiConvo from './AddMultiConvo';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { useChatContext, useAddedChatContext } from '~/Providers';
import { mainTextareaId } from '~/common';
import { useQueryClient } from '@tanstack/react-query';

const defaultInterface = getConfigDefaults().interface;

// Enhanced debug utility for comparison debugging
const debugComparison = (context: string, data: any) => {
  console.group(`🎭 COMPARISON DEBUG [${context}]`);
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📊 Data:', data);
  console.groupEnd();
};

// Debug utility for message tracking
const debugMessages = (context: string, messages: any[], source: string) => {
  console.group(`📨 MESSAGE DEBUG [${context}] - ${source}`);
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📈 Count:', messages?.length || 0);
  
  if (messages && Array.isArray(messages)) {
    messages.forEach((msg, idx) => {
      console.log(`📝 Message ${idx}:`, {
        id: msg._id || msg.id || msg.messageId || 'no-id',
        text: typeof msg.text === 'string' ? `${msg.text.substring(0, 100)}...` : `Type: ${typeof msg.text}`,
        content: typeof msg.content === 'string' ? `${msg.content.substring(0, 100)}...` : `Type: ${typeof msg.content}`,
        isCreatedByUser: msg.isCreatedByUser,
        error: msg.error,
        sender: msg.sender,
        endpoint: msg.endpoint,
        model: msg.model,
        isCompleted: msg.isCompleted,
        finish_reason: msg.finish_reason,
        parentMessageId: msg.parentMessageId,
        conversationId: msg.conversationId
      });
    });
  }
  
  console.groupEnd();
};

// Safe content extraction
const safeExtractText = (obj: any): string => {
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return obj.toString();
  if (obj && typeof obj.toString === 'function') return obj.toString();
  return 'NO_TEXT';
};

export default function Header() {
  const { data: startupConfig } = useGetStartupConfig();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const { user } = useAuthContext();
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Add queryClient hook INSIDE the component
  const queryClient = useQueryClient();
  
  // Add the chat context hooks for compare functionality
  const { conversation, setConversation } = useChatContext();
  const { conversation: addedConversation, setConversation: setAddedConvo } = useAddedChatContext();
  
  // State to prevent multiple clicks
  const [isComparing, setIsComparing] = useState(false);
  
  // State for selected comparison model
  const [selectedCompareModel, setSelectedCompareModel] = useState('gpt-4');
  
  // Add a ref to track if comparison is in progress
  const comparisonInProgress = useRef(false);
  
  // Track the last selected model for comparison - default to GPT-4
  const [lastSelectedModel, setLastSelectedModel] = useState({
    endpoint: 'openAI',
    model: 'gpt-4'
  });
  
  // Debug both conversations comprehensively
  useEffect(() => {
    debugComparison('CONVERSATION_STATE_MONITOR', {
      mainConversation: {
        id: conversation?.conversationId,
        endpoint: conversation?.endpoint,
        model: conversation?.model,
        title: conversation?.title,
        hasMessages: !!conversation?.messages,
        messageCount: conversation?.messages?.length || 0,
        isComparison: conversation?.isComparison
      },
      addedConversation: {
        id: addedConversation?.conversationId,
        endpoint: addedConversation?.endpoint,
        model: addedConversation?.model,
        title: addedConversation?.title,
        hasMessages: !!addedConversation?.messages,
        messageCount: addedConversation?.messages?.length || 0,
        isComparison: addedConversation?.isComparison
      }
    });
    
    // Check message storage in query cache
    if (conversation?.conversationId) {
      const mainMessages = queryClient.getQueryData(['messages', conversation.conversationId]);
      debugMessages('MAIN_CONVERSATION', mainMessages as any[], 'Query Cache');
      
      // Check comparison messages
      const comparisonKey = `${conversation.conversationId}_comparison_1`;
      const comparisonMessages = queryClient.getQueryData(['messages', comparisonKey]);
      debugMessages('COMPARISON_MESSAGES', comparisonMessages as any[], `Query Cache - ${comparisonKey}`);
    }
    
    // Debug all query cache keys related to messages
    const queryCache = queryClient.getQueryCache();
    const allQueries = queryCache.getAll();
    const messageQueries = allQueries.filter(query => 
      query.queryKey[0] === 'messages' && query.state.data
    );
    
    debugComparison('ALL_MESSAGE_QUERIES', {
      totalQueries: allQueries.length,
      messageQueries: messageQueries.length,
      queryKeys: messageQueries.map(q => q.queryKey),
      queryData: messageQueries.map(q => ({
        key: q.queryKey,
        messageCount: Array.isArray(q.state.data) ? q.state.data.length : 'not-array',
        hasData: !!q.state.data
      }))
    });
    
  }, [conversation, addedConversation, queryClient]);

  // Monitor localStorage changes
  useEffect(() => {
    const savedEndpoint = localStorage.getItem('defacts_comparison_endpoint');
    const savedModel = localStorage.getItem('defacts_comparison_model');
    
    debugComparison('LOCALSTORAGE_CHECK', {
      savedEndpoint,
      savedModel,
      currentSelected: selectedCompareModel
    });
    
    if (savedEndpoint && savedModel) {
      setLastSelectedModel({
        endpoint: savedEndpoint,
        model: savedModel
      });
    } else {
      // If nothing saved, ensure GPT-4 is set as default
      localStorage.setItem('defacts_comparison_endpoint', 'openAI');
      localStorage.setItem('defacts_comparison_model', 'gpt-4');
    }
  }, [selectedCompareModel]);
  
  // Enhanced LibreChat debugging
  useEffect(() => {
    debugComparison('LIBRECHAT_SYSTEM_DEBUG', {
      hasStartupConfig: !!startupConfig,
      hasUser: !!user,
      hasConversation: !!conversation
    });
    
    // 1. Check available endpoints with enhanced logging
    fetch('/api/endpoints')
      .then(res => res.json())
      .then(endpoints => {
        debugComparison('AVAILABLE_ENDPOINTS', endpoints);
        
        // Check each endpoint type
        Object.entries(endpoints).forEach(([name, config]) => {
          debugComparison(`ENDPOINT_${name.toUpperCase()}`, config);
        });
      })
      .catch(err => {
        console.error('❌ Error fetching endpoints:', err);
        debugComparison('ENDPOINT_FETCH_ERROR', { error: err.message });
      });
    
    // 2. Enhanced startup config debugging
    if (startupConfig) {
      debugComparison('STARTUP_CONFIG_DETAILED', {
        modelSpecs: startupConfig.modelSpecs,
        endpoints: startupConfig.endpoints,
        interface: startupConfig.interface,
        balance: startupConfig.balance,
        customConfig: startupConfig.customConfig
      });
    }
    
    // 3. Monitor fetch requests with enhanced filtering
    const originalFetch = window.fetch;
    window.fetch = function(...args: any[]) {
      const url = args[0];
      const isApiCall = url.includes('/api/ask/') || url.includes('/api/chat/');
      
      if (isApiCall) {
        const requestDetails = {
          url: url,
          method: args[1]?.method || 'GET',
          headers: args[1]?.headers,
          bodySize: args[1]?.body?.length || 0
        };
        
        // Parse body for detailed logging
        if (args[1]?.body) {
          try {
            const body = JSON.parse(args[1].body);
            requestDetails.body = {
              endpoint: body.endpoint,
              model: body.model,
              conversationId: body.conversationId,
              parentMessageId: body.parentMessageId,
              messageCount: body.messages?.length || 0,
              isComparison: body._isAddedRequest,
              userMessagePreview: body.messages?.[body.messages.length - 1]?.text?.substring(0, 100)
            };
            
            debugComparison('API_REQUEST', requestDetails);
          } catch (e) {
            debugComparison('API_REQUEST_UNPARSEABLE', requestDetails);
          }
        }
      }
      
      return originalFetch.apply(this, args).then(response => {
        if (isApiCall) {
          debugComparison('API_RESPONSE', {
            url: url,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries())
          });
          
          if (!response.ok) {
            console.error('❌ API Error Response:', response);
          }
        }
        return response;
      }).catch(error => {
        if (isApiCall) {
          debugComparison('API_REQUEST_ERROR', {
            url: url,
            error: error.message,
            stack: error.stack
          });
        }
        throw error;
      });
    };
    
    // 4. Monitor SSE connections
    const originalEventSource = window.EventSource;
    if (originalEventSource) {
      window.EventSource = function(url: string, options?: any) {
        debugComparison('SSE_CONNECTION_CREATED', {
          url: url,
          options: options
        });
        
        const es = new originalEventSource(url, options);
        
        const originalAddEventListener = es.addEventListener;
        es.addEventListener = function(type: string, listener: any, options?: any) {
          debugComparison('SSE_EVENT_LISTENER_ADDED', {
            eventType: type,
            url: url
          });
          
          // Wrap the listener to log events
          const wrappedListener = (event: any) => {
            debugComparison('SSE_EVENT_RECEIVED', {
              type: type,
              url: url,
              dataLength: event.data?.length || 0,
              dataPreview: event.data?.substring(0, 100)
            });
            return listener(event);
          };
          
          return originalAddEventListener.call(this, type, wrappedListener, options);
        };
        
        return es;
      };
    }
    
    // 5. Monitor recoil state changes (if possible)
    const recoilDebugObserver = () => {
      // This would require access to recoil internals
      // For now, we'll rely on the conversation state monitoring above
    };
    
    // 6. Check for comparison-related DOM elements
    const checkComparisonDOM = () => {
      const comparisonElements = document.querySelectorAll('[data-testid*="comparison"], [class*="comparison"], [id*="comparison"]');
      debugComparison('COMPARISON_DOM_ELEMENTS', {
        count: comparisonElements.length,
        elements: Array.from(comparisonElements).map(el => ({
          tagName: el.tagName,
          id: el.id,
          className: el.className,
          testId: el.getAttribute('data-testid')
        }))
      });
    };
    
    checkComparisonDOM();
    
    // Monitor DOM changes
    const observer = new MutationObserver((mutations) => {
      let hasComparisonChanges = false;
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (element.textContent?.includes('comparison') || 
                  element.className?.includes('comparison') ||
                  element.id?.includes('comparison')) {
                hasComparisonChanges = true;
              }
            }
          });
        }
      });
      
      if (hasComparisonChanges) {
        debugComparison('DOM_COMPARISON_CHANGES', { mutations: mutations.length });
        checkComparisonDOM();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'id', 'data-testid']
    });
    
    // Cleanup
    return () => {
      window.fetch = originalFetch;
      if (originalEventSource) {
        window.EventSource = originalEventSource;
      }
      observer.disconnect();
    };
  }, [conversation, startupConfig]);
  
  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );
  
  // Format the token balance as DeFacts tokens with 4 decimal places
  const formattedBalance = useMemo(() => {
    if (!user || typeof user.tokenCredits !== 'number') {
      return '0.0000';
    }
    return (user.tokenCredits / 10000).toFixed(4);
  }, [user]);
  
  // Send user email and token info to parent window when user data is available
  useEffect(() => {
    if (user && user.email) {
      // Check if we're in an iframe
      const isInIframe = window !== window.top;
      
      if (isInIframe) {
        // Send message to parent with the email and token balance
        window.parent.postMessage({
          type: 'DEFACTS_USER_INFO',
          email: user.email,
          tokenBalance: formattedBalance,
          rawTokenCredits: user.tokenCredits || 0
        }, '*'); // Use '*' for any domain, or specify exact domain for security
        
        debugComparison('PARENT_MESSAGE_SENT', {
          email: user.email,
          tokenBalance: formattedBalance
        });
      }
    }
  }, [user, formattedBalance]);
  
  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });
  
  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });
  
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  
  // Enhanced compare handler with comprehensive debugging
  const handleCompareModels = () => {
    debugComparison('COMPARE_MODELS_START', {
      hasConversation: !!conversation,
      comparisonInProgress: comparisonInProgress.current,
      selectedModel: selectedCompareModel,
      currentEndpoint: conversation?.endpoint,
      currentModel: conversation?.model
    });
    
    if (!conversation || comparisonInProgress.current) {
      debugComparison('COMPARE_MODELS_BLOCKED', {
        reason: !conversation ? 'no-conversation' : 'comparison-in-progress'
      });
      return;
    }
    
    comparisonInProgress.current = true;
    setIsComparing(true);
    
    // First, ensure main conversation is DeFacts (only when comparing)
    if (conversation.endpoint !== 'gptPlugins') {
      debugComparison('SETTING_MAIN_TO_DEFACTS', {
        from: { endpoint: conversation.endpoint, model: conversation.model },
        to: { endpoint: 'gptPlugins', model: 'DeFacts' }
      });
      
      setConversation(prev => ({
        ...prev,
        endpoint: 'gptPlugins',
        model: 'DeFacts'
      }));
    }
    
    const { title: _t, ...convo } = conversation;
    
    let comparisonConvo;
    
    if (selectedCompareModel === 'perplexity') {
      const perplexityModel = 'llama-3.1-sonar-small-128k-online';
      
      comparisonConvo = {
        conversationId: convo.conversationId,
        endpoint: 'Perplexity',
        model: perplexityModel,
        title: '',
        modelLabel: 'Perplexity',
        chatGptLabel: 'Perplexity',
        isComparison: true,
        _isAddedRequest: true,
        temperature: 0.7,
        resendFiles: false,
        imageDetail: 'auto',
        greeting: '',
        promptPrefix: null,
        examples: [],
        files: [],
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
      };
      
      debugComparison('PERPLEXITY_COMPARISON_OBJECT', comparisonConvo);
    } else {
      // Clean the GPT-4 comparison object
      comparisonConvo = {
        conversationId: convo.conversationId,
        endpoint: 'openAI',
        model: 'gpt-4o',
        title: '',
        modelLabel: 'GPT-4',
        chatGptLabel: 'GPT-4',
        isComparison: true,
        _isAddedRequest: true,
        temperature: convo.temperature || 0.7,
        maxOutputTokens: convo.maxOutputTokens || 2048,
        maxContextTokens: convo.maxContextTokens || 128000,
        max_tokens: convo.max_tokens || 2048,
        tools: convo.tools || [],
        agentOptions: convo.agentOptions || null,
        resendFiles: false,
        imageDetail: convo.imageDetail || 'auto',
        iconURL: null, // Force null to use default OpenAI icon
        greeting: '',
        promptPrefix: null, // Clear any DeFacts prompt
        examples: convo.examples || [],
        files: convo.files || [],
        createdAt: convo.createdAt,
        updatedAt: convo.updatedAt,
      };
      
      // Clean up any key fields
      if ('key' in comparisonConvo) {
        delete (comparisonConvo as any).key;
      }
      if ('apiKey' in comparisonConvo) {
        delete (comparisonConvo as any).apiKey;
      }
      
      debugComparison('GPT4_COMPARISON_OBJECT', comparisonConvo);
    }
    
    debugComparison('SETTING_ADDED_CONVERSATION', {
      comparisonConvo,
      conversationId: comparisonConvo.conversationId
    });
    
    setAddedConvo(comparisonConvo);
    
    // Focus textarea
    const textarea = document.getElementById(mainTextareaId);
    if (textarea) {
      textarea.focus();
      debugComparison('TEXTAREA_FOCUSED', { textareaId: mainTextareaId });
    } else {
      debugComparison('TEXTAREA_NOT_FOUND', { textareaId: mainTextareaId });
    }
    
    // Reset comparison state after delay
    setTimeout(() => {
      comparisonInProgress.current = false;
      setIsComparing(false);
      debugComparison('COMPARISON_STATE_RESET', {});
    }, 2000);
  };

  return (
    <div className="sticky top-0 z-10 flex h-auto w-full flex-col bg-white p-2 font-semibold text-text-primary dark:bg-gray-800 md:h-14 md:flex-row">
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex flex-1 items-center gap-2">
          {!navVisible && <OpenSidebar setNavVisible={setNavVisible} />}
          {!navVisible && <HeaderNewChat />}
          
          {/* Advanced Features Toggle Button */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Advanced
            {showAdvanced ? (
              <ChevronUpIcon className="h-4 w-4" />
            ) : (
              <ChevronDownIcon className="h-4 w-4" />
            )}
          </button>
          
          {/* Debug Info - Remove in production */}
          {process.env.NODE_ENV === 'development' && (
            <div className="text-xs text-gray-500">
              Main: {conversation?.endpoint}/{conversation?.model} | 
              Added: {addedConversation?.endpoint}/{addedConversation?.model}
            </div>
          )}
        </div>
        
        {/* Right side icons - Only show on desktop */}
        {!isSmallScreen && (
          <div className="flex items-center gap-2">
            {hasAccessToBookmarks === true && <BookmarkMenu />}
            <ExportAndShareMenu
              isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
            />
          </div>
        )}
      </div>
      
      {/* Advanced Features - Stack vertically on mobile */}
      {showAdvanced && (
        <div className={`${isSmallScreen ? 'mt-2 flex flex-col gap-2' : 'flex items-center gap-2'}`}>
          {/* Desktop - inline layout */}
          {!isSmallScreen && (
            <>
              {hasAccessToMultiConvo === true && conversation && (
                <div className="flex items-center gap-3 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-700/50">
                   <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="compareModel"
                        value="gpt-4"
                        checked={selectedCompareModel === 'gpt-4'}
                        onChange={(e) => {
                          setSelectedCompareModel(e.target.value);
                          debugComparison('MODEL_SELECTION_CHANGED', { 
                            selected: e.target.value,
                            previous: selectedCompareModel 
                          });
                        }}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 dark:text-blue-400"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">GPT4</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="compareModel"
                        value="perplexity"
                        checked={selectedCompareModel === 'perplexity'}
                        onChange={(e) => {
                          setSelectedCompareModel(e.target.value);
                          debugComparison('MODEL_SELECTION_CHANGED', { 
                            selected: e.target.value,
                            previous: selectedCompareModel 
                          });
                        }}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 dark:text-blue-400"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Perplexity</span>
                    </label>
                  </div>
                  <button 
                    onClick={handleCompareModels}
                    disabled={isComparing}
                    className={`ml-2 flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                      isComparing 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500' 
                        : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-800/50'
                    }`}
                  >
                    {isComparing ? 'Comparing...' : 'Compare'}
                  </button>
                </div>
              )}
              <div className="ml-2">
                <TemporaryChat />
              </div>
            </>
          )}
          
          {/* Mobile - stacked layout */}
          {isSmallScreen && (
            <>
              {hasAccessToMultiConvo === true && conversation && (
                <div className="flex flex-col gap-2 rounded-md bg-gray-50 p-3 dark:bg-gray-700/50">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Compare with:</span>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="compareModelMobile"
                        value="gpt-4"
                        checked={selectedCompareModel === 'gpt-4'}
                        onChange={(e) => setSelectedCompareModel(e.target.value)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 dark:text-blue-400"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">GPT-4</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="compareModelMobile"
                        value="perplexity"
                        checked={selectedCompareModel === 'perplexity'}
                        onChange={(e) => setSelectedCompareModel(e.target.value)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 dark:text-blue-400"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Perplexity</span>
                    </label>
                  </div>
                  <button 
                    onClick={handleCompareModels}
                    disabled={isComparing}
                    className={`flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                      isComparing 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500' 
                        : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-800/50'
                    }`}
                  >
                    {isComparing ? 'Comparing...' : 'Compare'}
                  </button>
                </div>
              )}
              <TemporaryChat />
              <div className="flex gap-2 justify-between w-full">
                {hasAccessToBookmarks === true && <BookmarkMenu />}
                <ExportAndShareMenu
                  isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}