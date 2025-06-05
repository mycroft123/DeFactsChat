import debounce from 'lodash/debounce';
import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import type { Endpoint, SelectedValues } from '~/common';
import { useAgentsMapContext, useAssistantsMapContext, useChatContext } from '~/Providers';
import { useEndpoints, useSelectorEffects, useKeyDialog } from '~/hooks';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { useGetEndpointsQuery } from '~/data-provider';
import { filterItems } from './utils';

type ModelSelectorContextType = {
  // State
  searchValue: string;
  selectedValues: SelectedValues;
  endpointSearchValues: Record<string, string>;
  searchResults: (t.TModelSpec | Endpoint)[] | null;
  // LibreChat
  modelSpecs: t.TModelSpec[];
  mappedEndpoints: Endpoint[];
  agentsMap: t.TAgentsMap | undefined;
  assistantsMap: t.TAssistantsMap | undefined;
  endpointsConfig: t.TEndpointsConfig;

  // Functions
  endpointRequiresUserKey: (endpoint: string) => boolean;
  setSelectedValues: React.Dispatch<React.SetStateAction<SelectedValues>>;
  setSearchValue: (value: string) => void;
  setEndpointSearchValue: (endpoint: string, value: string) => void;
  handleSelectSpec: (spec: t.TModelSpec) => void;
  handleSelectEndpoint: (endpoint: Endpoint) => void;
  handleSelectModel: (endpoint: Endpoint, model: string) => void;
} & ReturnType<typeof useKeyDialog>;

const ModelSelectorContext = createContext<ModelSelectorContextType | undefined>(undefined);

export function useModelSelectorContext() {
  const context = useContext(ModelSelectorContext);
  if (context === undefined) {
    throw new Error('useModelSelectorContext must be used within a ModelSelectorProvider');
  }
  return context;
}

interface ModelSelectorProviderProps {
  children: React.ReactNode;
  startupConfig: t.TStartupConfig | undefined;
}

export function ModelSelectorProvider({ children, startupConfig }: ModelSelectorProviderProps) {
  const agentsMap = useAgentsMapContext();
  const assistantsMap = useAssistantsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { conversation, newConversation } = useChatContext();
  const modelSpecs = useMemo(() => startupConfig?.modelSpecs?.list ?? [], [startupConfig]);
  const { mappedEndpoints, endpointRequiresUserKey } = useEndpoints({
    agentsMap,
    assistantsMap,
    startupConfig,
    endpointsConfig,
  });
  const { onSelectEndpoint, onSelectSpec } = useSelectMention({
    // presets,
    modelSpecs,
    assistantsMap,
    endpointsConfig,
    newConversation,
    returnHandlers: true,
  });

  // Helper function to get default values - ALWAYS DeFacts for main chat
  const getDefaultValues = (): SelectedValues => {
    // Always default to DeFacts, regardless of conversation state
    return {
      endpoint: 'gptPlugins',
      model: 'DeFacts',
      modelSpec: '',
    };
  };

  // Helper function to get comparison values from localStorage
  const getComparisonValues = (): SelectedValues => {
    const savedEndpoint = localStorage.getItem('defacts_comparison_endpoint');
    const savedModel = localStorage.getItem('defacts_comparison_model');
    const savedSpec = localStorage.getItem('defacts_comparison_spec');
    
    return {
      endpoint: savedEndpoint || 'openAI',
      model: savedModel || 'gpt-3.5-turbo',
      modelSpec: savedSpec || '',
    };
  };

  // State with default values - always shows comparison selection in UI
  const [selectedValues, setSelectedValues] = useState<SelectedValues>(getComparisonValues());
  const [hasInitialized, setHasInitialized] = useState(false);

  // Initialize DeFacts as default on mount
  useEffect(() => {
    if (!hasInitialized) {
      // Force DeFacts as the main conversation model
      if (onSelectEndpoint) {
        onSelectEndpoint('gptPlugins', { model: 'DeFacts' });
      }
      setHasInitialized(true);
    }
  }, [hasInitialized, onSelectEndpoint]);

  // Override selector effects to maintain comparison values in UI
  useSelectorEffects({
    agentsMap,
    conversation,
    assistantsMap,
    setSelectedValues: (values) => {
      // Always show comparison values in the selector UI
      const compValues = getComparisonValues();
      setSelectedValues(compValues);
    },
  });

  const [searchValue, setSearchValueState] = useState('');
  const [endpointSearchValues, setEndpointSearchValues] = useState<Record<string, string>>({});

  const keyProps = useKeyDialog();

  // Memoized search results
  const searchResults = useMemo(() => {
    if (!searchValue) {
      return null;
    }
    const allItems = [...modelSpecs, ...mappedEndpoints];
    return filterItems(allItems, searchValue, agentsMap, assistantsMap || {});
  }, [searchValue, modelSpecs, mappedEndpoints, agentsMap, assistantsMap]);

  // Functions
  const setDebouncedSearchValue = useMemo(
    () =>
      debounce((value: string) => {
        setSearchValueState(value);
      }, 200),
    [],
  );
  const setEndpointSearchValue = (endpoint: string, value: string) => {
    setEndpointSearchValues((prev) => ({
      ...prev,
      [endpoint]: value,
    }));
  };

  const handleSelectSpec = (spec: t.TModelSpec) => {
    let model = spec.preset.model ?? null;
    let endpoint = spec.preset.endpoint;
    
    // Save the selection for comparison use
    localStorage.setItem('defacts_comparison_spec', spec.name);
    localStorage.setItem('defacts_comparison_endpoint', endpoint);
    
    if (isAgentsEndpoint(endpoint)) {
      model = spec.preset.agent_id ?? '';
      localStorage.setItem('defacts_comparison_model', model);
    } else if (isAssistantsEndpoint(endpoint)) {
      model = spec.preset.assistant_id ?? '';
      localStorage.setItem('defacts_comparison_model', model);
    } else if (model) {
      localStorage.setItem('defacts_comparison_model', model);
    }
    
    // Always use DeFacts for main conversation
    const deFactsSpec = {
      ...spec,
      preset: {
        ...spec.preset,
        endpoint: 'gptPlugins',
        model: 'DeFacts',
      }
    };
    onSelectSpec?.(deFactsSpec);
    
    // Update UI to show comparison selection
    setSelectedValues({
      endpoint: endpoint,
      model: model || '',
      modelSpec: spec.name,
    });
  };

  const handleSelectEndpoint = (endpoint: Endpoint) => {
    // Save endpoint for comparison use
    localStorage.setItem('defacts_comparison_endpoint', endpoint.value);
    
    if (!endpoint.hasModels) {
      // Always use DeFacts for main conversation
      if (endpoint.value) {
        onSelectEndpoint?.('gptPlugins');
      }
      
      // Update UI to show comparison selection
      setSelectedValues({
        endpoint: endpoint.value,
        model: '',
        modelSpec: '',
      });
    }
  };

  const handleSelectModel = (endpoint: Endpoint, model: string) => {
    // Save selection for comparison use
    localStorage.setItem('defacts_comparison_endpoint', endpoint.value);
    localStorage.setItem('defacts_comparison_model', model);
    
    // Always use DeFacts for main conversation
    if (isAgentsEndpoint(endpoint.value)) {
      onSelectEndpoint?.('gptPlugins', {
        model: 'DeFacts',
      });
    } else if (isAssistantsEndpoint(endpoint.value)) {
      onSelectEndpoint?.('gptPlugins', {
        model: 'DeFacts',
      });
    } else {
      onSelectEndpoint?.('gptPlugins', { model: 'DeFacts' });
    }
    
    // Update UI to show comparison selection
    setSelectedValues({
      endpoint: endpoint.value,
      model: model,
      modelSpec: '',
    });
  };

  const value = {
    // State
    searchValue,
    searchResults,
    selectedValues,
    endpointSearchValues,
    // LibreChat
    agentsMap,
    modelSpecs,
    assistantsMap,
    mappedEndpoints,
    endpointsConfig,

    // Functions
    handleSelectSpec,
    handleSelectModel,
    setSelectedValues,
    handleSelectEndpoint,
    setEndpointSearchValue,
    endpointRequiresUserKey,
    setSearchValue: setDebouncedSearchValue,
    // Dialog
    ...keyProps,
  };

  return <ModelSelectorContext.Provider value={value}>{children}</ModelSelectorContext.Provider>;
}