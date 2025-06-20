import type * as t from './types';
import { EndpointURLs } from './config';
import * as s from './schemas';

export default function createPayload(submission: t.TSubmission) {
  const {
    conversation,
    userMessage,
    endpointOption,
    isEdited,
    isContinued,
    isTemporary,
    ephemeralAgent,
  } = submission;
  const { conversationId } = s.tConvoUpdateSchema.parse(conversation);
  const { endpoint, endpointType } = endpointOption as {
    endpoint: s.EModelEndpoint;
    endpointType?: s.EModelEndpoint;
  };
  
  // Handle custom endpoints by mapping custom_* to 'custom'
  let lookupEndpoint = endpoint;
  if (endpoint.startsWith('custom_')) {
    lookupEndpoint = s.EModelEndpoint.custom;  // Use the enum value instead of string
  }
  
  let server = EndpointURLs[endpointType ?? lookupEndpoint];
  
  const isEphemeral = s.isEphemeralAgent(endpoint, ephemeralAgent);
  
  if (isEdited && s.isAssistantsEndpoint(endpoint)) {
    server += '/modify';
  } else if (isEdited) {
    server = server.replace('/ask/', '/edit/');
  } else if (isEphemeral) {
    server = `${EndpointURLs[s.EModelEndpoint.agents]}/${endpoint}`;
  }
  
  const payload: t.TPayload = {
    ...userMessage,
    ...endpointOption,
    ephemeralAgent: isEphemeral ? ephemeralAgent : undefined,
    isContinued: !!(isEdited && isContinued),
    conversationId,
    isTemporary,
  };
  
  return { server, payload };
}