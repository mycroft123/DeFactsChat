const {
  CacheKeys,
  ErrorTypes,
  envVarRegex,
  FetchTokenConfig,
  extractEnvVariable,
} = require('librechat-data-provider');
const { Providers } = require('@librechat/agents');
const { getUserKeyValues, checkUserKeyExpiry } = require('~/server/services/UserService');
const { getLLMConfig } = require('~/server/services/Endpoints/openAI/llm');
const { getCustomEndpointConfig } = require('~/server/services/Config');
const { createHandleLLMNewToken } = require('~/app/clients/generators');
const { fetchModels } = require('~/server/services/ModelService');
const OpenAIClient = require('~/app/clients/OpenAIClient');
const { isUserProvided } = require('~/server/utils');
const getLogStores = require('~/cache/getLogStores');

const { PROXY } = process.env;

const initializeClient = async ({ req, res, endpointOption, optionsOnly, overrideEndpoint }) => {
  console.log('🎯 [CUSTOM INITIALIZE] ==================== START ====================');
  console.log('📋 [Custom Initialize] Called with:', {
    endpoint: req?.body?.endpoint,
    overrideEndpoint,
    model: req?.body?.model,
    spec: req?.body?.spec,
    keyExists: !!req?.body?.key,
    keyValue: req?.body?.key === 'never' ? 'never' : req?.body?.key ? 'exists' : 'missing',
    optionsOnly,
  });

  const { key: expiresAt } = req.body;
  const endpoint = overrideEndpoint ?? req.body.endpoint;

  console.log('🔍 [Custom Initialize] Using endpoint:', endpoint);

  const endpointConfig = await getCustomEndpointConfig(endpoint);
  if (!endpointConfig) {
    console.error('❌ [Custom Initialize] Config not found for endpoint:', endpoint);
    throw new Error(`Config not found for the ${endpoint} custom endpoint.`);
  }

  console.log('📄 [Custom Initialize] Endpoint config:', {
    name: endpointConfig.name,
    apiKey: endpointConfig.apiKey ? 'exists' : 'missing',
    baseURL: endpointConfig.baseURL,
    userProvide: endpointConfig.userProvide,
  });

  const CUSTOM_API_KEY = extractEnvVariable(endpointConfig.apiKey);
  const CUSTOM_BASE_URL = extractEnvVariable(endpointConfig.baseURL);

  console.log('🔑 [Custom Initialize] Extracted values:', {
    CUSTOM_API_KEY: CUSTOM_API_KEY ? CUSTOM_API_KEY.substring(0, 20) + '...' : 'missing',
    CUSTOM_BASE_URL,
  });

  let resolvedHeaders = {};
  if (endpointConfig.headers && typeof endpointConfig.headers === 'object') {
    Object.keys(endpointConfig.headers).forEach((key) => {
      resolvedHeaders[key] = extractEnvVariable(endpointConfig.headers[key]);
    });
  }

  if (CUSTOM_API_KEY.match(envVarRegex)) {
    console.error('❌ [Custom Initialize] API Key matches env var regex, not resolved');
    throw new Error(`Missing API Key for ${endpoint}.`);
  }

  if (CUSTOM_BASE_URL.match(envVarRegex)) {
    console.error('❌ [Custom Initialize] Base URL matches env var regex, not resolved');
    throw new Error(`Missing Base URL for ${endpoint}.`);
  }

  let userProvidesKey = isUserProvided(CUSTOM_API_KEY);
  const userProvidesURL = isUserProvided(CUSTOM_BASE_URL);

  console.log('🔐 [Custom Initialize] User provides:', {
    userProvidesKey,
    userProvidesURL,
  });

  let userValues = null;
  if (expiresAt && (userProvidesKey || userProvidesURL)) {
    console.log('👤 [Custom Initialize] Checking user key values...');
    checkUserKeyExpiry(expiresAt, endpoint);
    userValues = await getUserKeyValues({ userId: req.user.id, name: endpoint });
    console.log('👤 [Custom Initialize] User values retrieved:', !!userValues);
  }

  let apiKey = userProvidesKey ? userValues?.apiKey : CUSTOM_API_KEY;
  let baseURL = userProvidesURL ? userValues?.baseURL : CUSTOM_BASE_URL;

  console.log('🔑 [Custom Initialize] Before OpenRouter check:', {
    apiKey: apiKey ? apiKey.substring(0, 20) + '...' : 'missing',
    baseURL,
  });

  // Check multiple conditions for OpenRouter
  const isOpenRouterRequest = 
    endpointConfig.name === 'OpenRouter' ||
    endpoint === 'OpenRouter' ||
    req?.body?.spec === 'OpenRouter' ||
    req?.body?.model?.includes('perplexity') ||
    req?.body?.chatGptLabel?.includes('OpenRouter');

  console.log('🤔 [Custom Initialize] Is OpenRouter request?', {
    isOpenRouterRequest,
    configName: endpointConfig.name,
    endpoint,
    spec: req?.body?.spec,
    model: req?.body?.model,
    envKeyExists: !!process.env.OPENROUTER_KEY,
  });

  // Force OpenRouter to use environment key
  if (isOpenRouterRequest && process.env.OPENROUTER_KEY) {
    apiKey = process.env.OPENROUTER_KEY;
    const logger = req.app.locals.logger || console;
    logger.info(`[Custom Initialize] Forcing OpenRouter to use environment key: ${apiKey.substring(0, 20)}...`);
    console.log('✅ [Custom Initialize] Forced OpenRouter key from environment');
    // Override the userProvidesKey flag so it doesn't check for user key
    userProvidesKey = false;
  } else if (isOpenRouterRequest && !process.env.OPENROUTER_KEY) {
    console.error('❌ [Custom Initialize] OpenRouter request but no OPENROUTER_KEY in environment!');
  }

  console.log('🔑 [Custom Initialize] After OpenRouter check:', {
    apiKey: apiKey ? apiKey.substring(0, 20) + '...' : 'missing',
    userProvidesKey,
  });

  // Skip user key check for OpenRouter when using env key
  if (userProvidesKey && !apiKey && !isOpenRouterRequest) {
    console.error('❌ [Custom Initialize] No user key provided');
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (userProvidesURL && !baseURL) {
    console.error('❌ [Custom Initialize] No base URL provided');
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_BASE_URL,
      }),
    );
  }

  if (!apiKey) {
    console.error('❌ [Custom Initialize] No API key available');
    throw new Error(`${endpoint} API key not provided.`);
  }

  if (!baseURL) {
    console.error('❌ [Custom Initialize] No base URL available');
    throw new Error(`${endpoint} Base URL not provided.`);
  }

  console.log('✅ [Custom Initialize] Validation passed, creating client...');

  const cache = getLogStores(CacheKeys.TOKEN_CONFIG);
  const tokenKey =
    !endpointConfig.tokenConfig && (userProvidesKey || userProvidesURL)
      ? `${endpoint}:${req.user.id}`
      : endpoint;

  let endpointTokenConfig =
    !endpointConfig.tokenConfig &&
    FetchTokenConfig[endpoint.toLowerCase()] &&
    (await cache.get(tokenKey));

  if (
    FetchTokenConfig[endpoint.toLowerCase()] &&
    endpointConfig &&
    endpointConfig.models.fetch &&
    !endpointTokenConfig
  ) {
    console.log('📊 [Custom Initialize] Fetching models...');
    await fetchModels({ apiKey, baseURL, name: endpoint, user: req.user.id, tokenKey });
    endpointTokenConfig = await cache.get(tokenKey);
  }

  const customOptions = {
    headers: resolvedHeaders,
    addParams: endpointConfig.addParams,
    dropParams: endpointConfig.dropParams,
    titleConvo: endpointConfig.titleConvo,
    titleModel: endpointConfig.titleModel,
    forcePrompt: endpointConfig.forcePrompt,
    summaryModel: endpointConfig.summaryModel,
    modelDisplayLabel: endpointConfig.modelDisplayLabel,
    titleMethod: endpointConfig.titleMethod ?? 'completion',
    contextStrategy: endpointConfig.summarize ? 'summarize' : null,
    directEndpoint: endpointConfig.directEndpoint,
    titleMessageRole: endpointConfig.titleMessageRole,
    streamRate: endpointConfig.streamRate,
    endpointTokenConfig,
  };

  /** @type {undefined | TBaseEndpoint} */
  const allConfig = req.app.locals.all;
  if (allConfig) {
    customOptions.streamRate = allConfig.streamRate;
  }

  let clientOptions = {
    reverseProxyUrl: baseURL ?? null,
    proxy: PROXY ?? null,
    req,
    res,
    ...customOptions,
    ...endpointOption,
  };

  console.log('🔧 [Custom Initialize] Client options prepared:', {
    reverseProxyUrl: clientOptions.reverseProxyUrl,
    hasApiKey: !!apiKey,
    model: clientOptions.model,
  });

  if (optionsOnly) {
    console.log('📦 [Custom Initialize] Returning options only (not full client)');
    const modelOptions = endpointOption.model_parameters;
    if (endpoint !== Providers.OLLAMA) {
      clientOptions = Object.assign(
        {
          modelOptions,
        },
        clientOptions,
      );
      clientOptions.modelOptions.user = req.user.id;
      const options = getLLMConfig(apiKey, clientOptions, endpoint);
      if (!customOptions.streamRate) {
        return options;
      }
      options.llmConfig.callbacks = [
        {
          handleLLMNewToken: createHandleLLMNewToken(clientOptions.streamRate),
        },
      ];
      return options;
    }

    if (clientOptions.reverseProxyUrl) {
      modelOptions.baseUrl = clientOptions.reverseProxyUrl.split('/v1')[0];
      delete clientOptions.reverseProxyUrl;
    }

    return {
      llmConfig: modelOptions,
    };
  }

  console.log('🏗️ [Custom Initialize] Creating OpenAIClient with:', {
    apiKeyLength: apiKey?.length,
    apiKeyStart: apiKey?.substring(0, 10),
  });

  const client = new OpenAIClient(apiKey, clientOptions);
  
  console.log('✅ [Custom Initialize] Client created successfully');
  console.log('🎯 [CUSTOM INITIALIZE] ==================== END ====================');
  
  return {
    client,
    openAIApiKey: apiKey,
  };
};

module.exports = initializeClient;