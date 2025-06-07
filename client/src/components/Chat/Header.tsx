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
  const { setConversation: setAddedConvo } = useAddedChatContext();
  
  // State for comparison model selection
  const [selectedComparisonModel, setSelectedComparisonModel] = useState<'gpt4' | 'perplexity'>('gpt4');
  
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
  
  // Unified compare handler based on selected model
  const handleCompare = () => {
    if (!conversation) return;
    
    const { title: _t, ...convo } = conversation;
    
    let comparisonConvo;
    
    if (selectedComparisonModel === 'gpt4') {
      console.log('Comparing with GPT-4');
      comparisonConvo = {
        ...convo,
        title: '',
        model: 'gpt-4',
        endpoint: 'openAI',
        isComparison: true,
        _isAddedRequest: true
      };
    } else {
      console.log('Comparing with Perplexity');
      comparisonConvo = {
        ...convo,
        title: '',
        model: 'perplexity',
        endpoint: 'perplexity',
        isComparison: true,
        _isAddedRequest: true
      };
    }
    
    setAddedConvo(comparisonConvo);

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
                <div className="flex items-center gap-3 rounded-md bg-gray-50 p-2 dark:bg-gray-700/50">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Compare with:</span>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="comparison-model"
                      value="gpt4"
                      checked={selectedComparisonModel === 'gpt4'}
                      onChange={(e) => setSelectedComparisonModel('gpt4')}
                      className="h-4 w-4 text-green-600 focus:ring-green-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">GPT-4</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="comparison-model"
                      value="perplexity"
                      checked={selectedComparisonModel === 'perplexity'}
                      onChange={(e) => setSelectedComparisonModel('perplexity')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Perplexity</span>
                  </label>
                  <button 
                    onClick={handleCompare}
                    className={`ml-2 flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      selectedComparisonModel === 'gpt4'
                        ? 'bg-green-100 text-green-700 hover:bg-green-200 focus:ring-green-500 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-800/50'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200 focus:ring-blue-500 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-800/50'
                    }`}
                  >
                    Compare
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
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Compare with:</span>
                  <div className="flex gap-4">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="comparison-model-mobile"
                        value="gpt4"
                        checked={selectedComparisonModel === 'gpt4'}
                        onChange={(e) => setSelectedComparisonModel('gpt4')}
                        className="h-4 w-4 text-green-600 focus:ring-green-500"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">GPT-4</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="comparison-model-mobile"
                        value="perplexity"
                        checked={selectedComparisonModel === 'perplexity'}
                        onChange={(e) => setSelectedComparisonModel('perplexity')}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Perplexity</span>
                    </label>
                  </div>
                  <button 
                    onClick={handleCompare}
                    className={`mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      selectedComparisonModel === 'gpt4'
                        ? 'bg-green-100 text-green-700 hover:bg-green-200 focus:ring-green-500 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-800/50'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200 focus:ring-blue-500 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-800/50'
                    }`}
                  >
                    Compare with {selectedComparisonModel === 'gpt4' ? 'GPT-4' : 'Perplexity'}
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 w-full">
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