import { useMemo, useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { getConfigDefaults, PermissionTypes, Permissions } from 'librechat-data-provider';
import type { ContextType } from '~/common';
import ModelSelector from './Menus/Endpoints/ModelSelector';
import { PresetsMenu, HeaderNewChat, OpenSidebar } from './Menus';
import { useGetStartupConfig } from '~/data-provider';
import ExportAndShareMenu from './ExportAndShareMenu';
import { useMediaQuery, useHasAccess, useAuthContext } from '~/hooks'; // Make sure to add useAuthContext
import BookmarkMenu from './Menus/BookmarkMenu';
import { TemporaryChat } from './TemporaryChat';
import AddMultiConvo from './AddMultiConvo';

// Token balance display component
function TokenBalanceDisplay() {
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthContext();

  useEffect(() => {
    // Function to fetch token balance
    async function fetchTokenBalance() {
      try {
        if (!user || !user.email) {
          setLoading(false);
          return;
        }
        
        const response = await fetch(`/api/token-balance?email=${encodeURIComponent(user.email)}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch token balance');
        }
        
        const data = await response.json();
        
        if (data.authenticated) {
          setTokenBalance(data.tokenCredits);
        }
      } catch (err) {
        console.error('Error fetching token balances:', err);
      } finally {
        setLoading(false);
      }
    }
    
    if (user) {
      fetchTokenBalance();
    }
    
    // Refresh balance periodically
    const interval = setInterval(() => {
      if (user) fetchTokenBalance();
    }, 60000); // Refresh every minute
    
    return () => clearInterval(interval);
  }, [user]);
  
  if (!user || loading || tokenBalance === null) {
    return null; // Don't show anything if not ready
  }
  
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium dark:bg-gray-700">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" className="text-blue-500">
        <path d="M0 5a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V5zm5-3a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3H5z"/>
        <path d="M8 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm2-1a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
      </svg>
      <span>{tokenBalance.toLocaleString()} tokens</span>
    </div>
  );
}

const defaultInterface = getConfigDefaults().interface;

export default function Header() {
  const { data: startupConfig } = useGetStartupConfig();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? defaultInterface,
    [startupConfig],
  );
  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });
  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  
  return (
    <div className="sticky top-0 z-10 flex h-14 w-full items-center justify-between bg-white p-2 font-semibold text-text-primary dark:bg-gray-800">
      <div className="hide-scrollbar flex w-full items-center justify-between gap-2 overflow-x-auto">
        <div className="mx-1 flex items-center gap-2">
          {!navVisible && <OpenSidebar setNavVisible={setNavVisible} />}
          {!navVisible && <HeaderNewChat />}
          {<ModelSelector startupConfig={startupConfig} />}
          {interfaceConfig.presets === true && interfaceConfig.modelSelect && <PresetsMenu />}
          {hasAccessToBookmarks === true && <BookmarkMenu />}
          {hasAccessToMultiConvo === true && <AddMultiConvo />}
          {isSmallScreen && (
            <>
              <ExportAndShareMenu
                isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
              />
              <TemporaryChat />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Add the token balance display here */}
          <TokenBalanceDisplay />
          
          {!isSmallScreen && (
            <>
              <ExportAndShareMenu
                isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
              />
              <TemporaryChat />
            </>
          )}
        </div>
      </div>
      {/* Empty div for spacing */}
      <div />
    </div>
  );
}
