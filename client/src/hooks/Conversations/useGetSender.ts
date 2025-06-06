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
      // Comprehensive debug logging
      const timestamp = new Date().toISOString();
      const debugInfo = {
        timestamp,
        endpointOption: {
          conversationId: endpointOption.conversationId,
          endpoint: endpointOption.endpoint,
          model: endpointOption.model,
          modelLabel: endpointOption.modelLabel,
        },
        contexts: {
          hasMainConvo: !!mainConversation,
          mainConvoId: mainConversation?.conversationId,
          mainConvoModel: mainConversation?.model,
          mainConvoEndpoint: mainConversation?.endpoint,
          hasAddedConvo: !!addedConversation,
          addedConvoId: addedConversation?.conversationId,
          addedConvoModel: addedConversation?.model,
          addedConvoEndpoint: addedConversation?.endpoint,
        }
      };
      
      console.log('🔍 [useGetSender] Called:', debugInfo);
      
      // Determine which chat this is
      const isAddedChat = addedConversation && 
        endpointOption.conversationId === addedConversation.conversationId;
      
      const isMainChat = mainConversation && 
        endpointOption.conversationId === mainConversation.conversationId;
      
      console.log('🎯 [useGetSender] Chat Detection:', {
        isMainChat,
        isAddedChat,
        shouldShowDeFacts: isMainChat && !isAddedChat
      });
      
      // Force DeFacts AI for main chat
      if (isMainChat && !isAddedChat) {
        console.log('✅ [useGetSender] Returning: DeFacts AI (forced for main chat)');
        return 'DeFacts AI';
      }
      
      // Use normal logic for comparison chat
      const { modelDisplayLabel } = endpointsConfig?.[endpointOption.endpoint ?? ''] ?? {};
      const result = getResponseSender({ ...endpointOption, modelDisplayLabel });
      
      console.log('📤 [useGetSender] Returning:', result, '(normal logic)');
      return result;
    },
    [endpointsConfig, mainConversation, addedConversation],
  );
}