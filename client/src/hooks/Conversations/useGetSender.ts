import { useCallback } from 'react';
import { getResponseSender } from 'librechat-data-provider';
import type { TEndpointOption, TEndpointsConfig } from 'librechat-data-provider';
import { useGetEndpointsQuery } from '~/data-provider';
import { useChatContext, useAddedChatContext } from '~/Providers';

export default function useGetSender() {
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const { conversation: mainConversation } = useChatContext();
  const { conversation: addedConversation } = useAddedChatContext();
  
  return useCallback(
    (endpointOption: TEndpointOption) => {
      // Check if this is the main chat by comparing conversation IDs
      // If there's no addedConversation, it's definitely the main chat
      // If the endpointOption matches the main conversation, it's the main chat
      const isMainChat = !addedConversation || 
        (mainConversation && endpointOption.conversationId === mainConversation.conversationId);
      
      // Force DeFacts AI for main chat
      if (isMainChat) {
        return 'DeFacts AI';
      }
      
      // Use normal logic for comparison chat
      const { modelDisplayLabel } = endpointsConfig?.[endpointOption.endpoint ?? ''] ?? {};
      return getResponseSender({ ...endpointOption, modelDisplayLabel });
    },
    [endpointsConfig, mainConversation, addedConversation],
  );
}