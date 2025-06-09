const { CacheKeys, EModelEndpoint } = require('librechat-data-provider');
const { normalizeEndpointName, isEnabled } = require('~/server/utils');
const loadCustomConfig = require('./loadCustomConfig');
const getLogStores = require('~/cache/getLogStores');
const { logger } = require('~/config');

/**
 * Retrieves the configuration object
 * @function getCustomConfig
 * @returns {Promise<TCustomConfig | null>}
 * */
async function getCustomConfig() {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  let customConfig = await cache.get(CacheKeys.CUSTOM_CONFIG);

  if (!customConfig) {
    customConfig = await loadCustomConfig();
  }

  if (!customConfig) {
    return null;
  }

  return customConfig;
}

/**
 * Retrieves the configuration object
 * @function getBalanceConfig
 * @returns {Promise<TCustomConfig['balance'] | null>}
 * */
async function getBalanceConfig() {
  const isLegacyEnabled = isEnabled(process.env.CHECK_BALANCE);
  const startBalance = process.env.START_BALANCE;
  /** @type {TCustomConfig['balance']} */
  const config = {
    enabled: isLegacyEnabled,
    startBalance: startBalance != null && startBalance ? parseInt(startBalance, 10) : undefined,
  };
  const customConfig = await getCustomConfig();
  if (!customConfig) {
    return config;
  }
  return { ...config, ...(customConfig?.['balance'] ?? {}) };
}

/**
 *
 * @param {string | EModelEndpoint} endpoint
 */
const getCustomEndpointConfig = async (endpoint) => {
  logger.debug(`[getCustomEndpointConfig] Looking for endpoint: "${endpoint}"`);
  
  const customConfig = await getCustomConfig();
  if (!customConfig) {
    logger.error(`[getCustomEndpointConfig] No custom config loaded`);
    throw new Error(`Config not found for the ${endpoint} custom endpoint.`);
  }

  const { endpoints = {} } = customConfig;
  const customEndpoints = endpoints[EModelEndpoint.custom] || endpoints.custom || [];
  
  logger.debug(`[getCustomEndpointConfig] Found ${customEndpoints.length} custom endpoints`);
  
  if (customEndpoints.length > 0) {
    logger.debug(`[getCustomEndpointConfig] Available endpoints: ${customEndpoints.map(e => e.name).join(', ')}`);
  }
  
  // First try exact match
  let endpointConfig = customEndpoints.find(
    (config) => config.name === endpoint
  );
  
  // If no exact match, try normalized match
  if (!endpointConfig) {
    const normalizedEndpoint = normalizeEndpointName(endpoint);
    logger.debug(`[getCustomEndpointConfig] Trying normalized name: "${normalizedEndpoint}"`);
    
    endpointConfig = customEndpoints.find(
      (config) => normalizeEndpointName(config.name) === normalizedEndpoint
    );
  }
  
  // Special handling for OpenRouter - if endpoint is "custom", look for "OpenRouter"
  if (!endpointConfig && (endpoint === 'custom' || endpoint === 'Custom')) {
    logger.debug(`[getCustomEndpointConfig] Special handling for custom -> OpenRouter`);
    endpointConfig = customEndpoints.find(
      (config) => config.name === 'OpenRouter' || 
                  config.name === 'openrouter' ||
                  normalizeEndpointName(config.name) === 'openrouter'
    );
  }
  
  if (!endpointConfig) {
    logger.error(`[getCustomEndpointConfig] Endpoint "${endpoint}" not found in configuration`);
    throw new Error(`Config not found for the ${endpoint} custom endpoint.`);
  }
  
  logger.debug(`[getCustomEndpointConfig] Found config for endpoint: ${endpointConfig.name}`);
  return endpointConfig;
};

module.exports = { getCustomConfig, getBalanceConfig, getCustomEndpointConfig };