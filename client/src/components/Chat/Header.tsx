import { useMemo, useEffect, useState } from 'react';
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
const defaultInterface = getConfigDefaults().interface;

export default function Header() {
  const { data: startupConfig } = useGetStartupConfig();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const { user } = useAuthContext();
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Add the chat context hooks for compare functionality
  const { conversation, setConversation } = useChatContext();
  const { setConversation: setAddedConvo, conversation: addedConversation } = useAddedChatContext();
  
  // State to prevent multiple clicks
  const [isComparing, setIsComparing] = useState(false);
  
  // Force DeFacts as default on mount
  useEffect(() => {
    if (conversation && conversation.endpoint !== 'gptPlugins') {
      console.log('🔧 Forcing DeFacts for main conversation');
      setConversation(prev => ({
        ...prev,
        endpoint: 'gptPlugins',
        model: 'DeFacts'
      }));
    }
  }, []); // Run once on mount
  
  // Track the last selected model for comparison - default to GPT-4
  const [lastSelectedModel, setLastSelectedModel] = useState({
    endpoint: 'openAI',
    model: 'gpt-4'
  });
  
  // Listen for model selection changes
  useEffect(() => {
    // Check conversation changes to track what was selected
    if (conversation && conversation.endpoint !== 'gptPlugins') {
      // User selected a non-DeFacts model, save it for comparison
      setLastSelectedModel({
        endpoint: conversation.endpoint,
        model: conversation.model || 'gpt-4'
      });
      // Also save to localStorage as backup
      localStorage.setItem('defacts_comparison_endpoint', conversation.endpoint);
      localStorage.setItem('defacts_comparison_model', conversation.model || 'gpt-4');
    }
  }, [conversation?.endpoint, conversation?.model]);
  
  // Also check localStorage on mount in case there's a saved preference
  useEffect(() => {
    const savedEndpoint = localStorage.getItem('defacts_comparison_endpoint');
    const savedModel = localStorage.getItem('defacts_comparison_model');
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
  }, []);
  
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
        
        console.log('Sent user info to parent:', user.email, formattedBalance);
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
  
  // Modified compare handler with proper comparison marking - force GPT-4
  const handleCompareModels = (e) => {
    // Prevent default to avoid any bubble-up issues
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Prevent multiple clicks
    if (!conversation || isComparing) {
      console.log('Compare blocked:', { hasConversation: !!conversation, isComparing });
      return;
    }
    
    // Check if we already have an added conversation
    if (addedConversation) {
      console.log('Already comparing, clearing existing comparison');
      setAddedConvo(null);
      setTimeout(() => {
        handleCompareModels(e);
      }, 100);
      return;
    }
    
    // Set comparing state to prevent double-clicks
    setIsComparing(true);
    
    const { title: _t, conversationId, ...convo } = conversation;
    
    console.log('Compare button clicked:', {
      mainModel: 'DeFacts',
      comparisonModel: 'gpt-4',
      comparisonEndpoint: 'openAI',
      timestamp: Date.now(),
      isMobile: isSmallScreen
    });
    
    // Create comparison conversation with special flag - force GPT-4
    const comparisonConvo = {
      ...convo,
      conversationId: undefined, // Clear conversation ID to ensure new thread
      title: '',
      model: 'gpt-4', // Force GPT-4 here
      endpoint: 'openAI', // Force OpenAI endpoint
      // Add a flag to identify this as a comparison
      isComparison: true,
      // This ensures the comparison is properly marked when it goes through SSE
      _isAddedRequest: true,
      // Add timestamp to ensure uniqueness
      _timestamp: Date.now()
    };
    
    // Use GPT-4 for comparison
    setAddedConvo(comparisonConvo);

    // Reset comparing state after a delay
    setTimeout(() => {
      setIsComparing(false);
    }, 1000);

    const textarea = document.getElementById(mainTextareaId);
    if (textarea) {
      textarea.focus();
    }
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
                <button 
                  onClick={handleCompareModels}
                  disabled={isComparing}
                  className={`flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    isComparing 
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500' 
                      : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-800/50'
                  }`}
                >
                  {isComparing ? 'Comparing...' : 'Compare GPT 4.0'}
                </button>
              )}
              {hasAccessToBookmarks === true && <BookmarkMenu />}
              <div className="ml-2">
                <TemporaryChat />
              </div>
            </>
          )}
          
          {/* Mobile - stacked layout */}
          {isSmallScreen && (
            <>
              <div className="flex items-center gap-2 justify-between w-full">
                {hasAccessToMultiConvo === true && conversation && (
                  <button 
                    onClick={handleCompareModels}
                    disabled={isComparing}
                    className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                      isComparing 
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500' 
                        : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-800/50'
                    }`}
                  >
                    {isComparing ? 'Comparing...' : 'Compare GPT 4.0'}
                  </button>
                )}
                <TemporaryChat />
              </div>
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