import { useCallback } from 'react';
import { getResponseSender } from 'librechat-data-provider';
import type { TEndpointOption, TEndpointsConfig } from 'librechat-data-provider';
import { useGetEndpointsQuery } from '~/data-provider';

export default function useGetSender() {
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  
  return useCallback(
    (endpointOption: TEndpointOption) => {
      // Simple check - if it's DeFacts/gptPlugins, always return "DeFacts AI"
      if (endpointOption.endpoint === 'gptPlugins' && endpointOption.model === 'DeFacts') {
        console.log('✅ [useGetSender] Returning: DeFacts AI (detected DeFacts model)');
        return 'DeFacts AI';
      }
      
      // For everything else, use normal logic
      const { modelDisplayLabel } = endpointsConfig?.[endpointOption.endpoint ?? ''] ?? {};
      const result = getResponseSender({ ...endpointOption, modelDisplayLabel });
      console.log('📤 [useGetSender] Returning:', result, 'for model:', endpointOption.model);
      return result;
    },
    [endpointsConfig],
  );
}