import { atom } from 'recoil';

// Store only the comparison model
export const comparisonModelAtom = atom<string>({
  key: 'comparisonModel',
  default: 'gpt-3.5-turbo',
});

export const comparisonEndpointAtom = atom<string>({
  key: 'comparisonEndpoint', 
  default: 'openAI',
});

// Track if we're in comparison mode
export const isComparisonModeAtom = atom<boolean>({
  key: 'isComparisonMode',
  default: false,
});

export default {
  comparisonModelAtom,
  comparisonEndpointAtom,
  isComparisonModeAtom,
};