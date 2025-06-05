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

  // Helper function to get default values
  const getDefaultValues = (): SelectedValues => {
    // Always default to DeFacts
    return {
      endpoint: 'gptPlugins',
      model: 'DeFacts',
      modelSpec: '',
    };
  };

  // State with default values
  const [selectedValues, setSelectedValues] = useState<SelectedValues>(getDefaultValues());
  const [hasInitialized, setHasInitialized] = useState(false);

  // Force DeFacts on initialization and keep it forced
  useEffect(() => {
    if (!hasInitialized) {
      setSelectedValues({
        endpoint: 'gptPlugins',
        model: 'DeFacts',
        modelSpec: '',
      });
      setHasInitialized(true);
      
      // Also trigger the selection handler to update the conversation state
      if (onSelectEndpoint) {
        onSelectEndpoint('gptPlugins', { model: 'DeFacts' });
      }
    }
  }, [hasInitialized, onSelectEndpoint]);
  
  // Override the selector effects to maintain DeFacts
  useSelectorEffects({
    agentsMap,
    conversation,
    assistantsMap,
    setSelectedValues: () => {
      // Always keep DeFacts selected in the UI
      setSelectedValues({
        endpoint: 'gptPlugins',
        model: 'DeFacts',
        modelSpec: '',
      });
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
    // Save selection for comparison
    localStorage.setItem('defacts_comparison_spec', spec.name);
    localStorage.setItem('defacts_comparison_endpoint', spec.preset.endpoint);
    
    let model = spec.preset.model ?? null;
    if (isAgentsEndpoint(spec.preset.endpoint)) {
      model = spec.preset.agent_id ?? '';
    } else if (isAssistantsEndpoint(spec.preset.endpoint)) {
      model = spec.preset.assistant_id ?? '';
    }
    
    if (model) {
      localStorage.setItem('defacts_comparison_model', model);
    }
    
    // Always use DeFacts for main conversation
    onSelectSpec?.({
      ...spec,
      preset: {
        ...spec.preset,
        endpoint: 'gptPlugins',
        model: 'DeFacts',
      }
    });
    
    // Keep UI showing DeFacts
    setSelectedValues({
      endpoint: 'gptPlugins',
      model: 'DeFacts',
      modelSpec: spec.name,
    });
  };

  const handleSelectEndpoint = (endpoint: Endpoint) => {
    // Save for comparison
    localStorage.setItem('defacts_comparison_endpoint', endpoint.value);
    
    if (!endpoint.hasModels) {
      // Always use DeFacts
      if (endpoint.value) {
        onSelectEndpoint?.('gptPlugins', { model: 'DeFacts' });
      }
      // Keep UI showing DeFacts
      setSelectedValues({
        endpoint: 'gptPlugins',
        model: 'DeFacts',
        modelSpec: '',
      });
    }
  };

  const handleSelectModel = (endpoint: Endpoint, model: string) => {
    // Save for comparison
    localStorage.setItem('defacts_comparison_endpoint', endpoint.value);
    localStorage.setItem('defacts_comparison_model', model);
    
    // Always use DeFacts for main
    onSelectEndpoint?.('gptPlugins', { model: 'DeFacts' });
    
    // Keep UI showing DeFacts
    setSelectedValues({
      endpoint: 'gptPlugins',
      model: 'DeFacts',
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