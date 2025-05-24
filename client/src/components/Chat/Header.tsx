import { useMemo, useEffect } from 'react';
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
const defaultInterface = getConfigDefaults().interface;

export default function Header() {
  const { data: startupConfig } = useGetStartupConfig();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();
  const { user } = useAuthContext();
  
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
  
  return (
    <div className="sticky top-0 z-10 flex h-14 w-full items-center justify-between bg-white p-2 font-semibold text-text-primary dark:bg-gray-800">
      <div className="hide-scrollbar flex w-full items-center justify-between gap-2 overflow-x-auto">
        <div className="mx-1 flex items-center gap-2">
          {!navVisible && <OpenSidebar setNavVisible={setNavVisible} />}
          {!navVisible && <HeaderNewChat />}
          {<ModelSelector startupConfig={startupConfig} />}
          {/* {interfaceConfig.presets === true && interfaceConfig.modelSelect && <PresetsMenu />} */}
          {hasAccessToBookmarks === true && <BookmarkMenu />}
          {hasAccessToMultiConvo === true && <AddMultiConvo />}
          
          {/* Add token balance for small screens */}
          {isSmallScreen && user && (
            <div className="ml-auto mr-2 flex items-center">
              <div className="rounded-full bg-green-100 px-2 py-1 text-xs dark:bg-green-900/30">
                <span className="font-medium text-green-800 dark:text-green-400">
                  {formattedBalance}
                </span>
              </div>
            </div>
          )}
          
          {isSmallScreen && (
            <>
              <ExportAndShareMenu
                isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
              />
              <TemporaryChat />
            </>
          )}
        </div>
        {!isSmallScreen && (
          <div className="flex items-center gap-2">
            {/* Token balance display in header - more visible */}
            {user && (
              <div className="mr-3 flex items-center">
                <div className="rounded-full bg-green-100 px-3 py-1.5 text-sm font-bold shadow-sm dark:bg-green-900/30">
                  <span className="font-semibold text-green-800 dark:text-green-400">
                    {formattedBalance} <span className="font-medium">DeFacts</span>
                  </span>
                </div>
              </div>
            )}
            <ExportAndShareMenu
              isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
            />
            <TemporaryChat />
          </div>
        )}
      </div>
    </div>
  );
}