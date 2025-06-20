// api/server/routes/defacts.js
// Complete DeFacts router with enhanced debugging, retries, and error handling

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  retryableErrors: ['rate_limit_error', 'timeout_error', 'stream_error', 'ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET'],
  retryableStatuses: [429, 500, 502, 503, 504]
};

// Global request logger - catches ALL requests to this router
router.use((req, res, next) => {
  console.log('===========================================');
  console.log('[DEFACTS ROUTER HIT]', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Full URL:', req.originalUrl);
  console.log('Base URL:', req.baseUrl);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  
  // Log ALL available data in the request
  console.log('--- REQUEST BODY ---');
  if (req.body) {
    console.log('Full Body:', JSON.stringify(req.body, null, 2));
    console.log('Model in body:', req.body.model);
    console.log('Endpoint in body:', req.body.endpoint);
    console.log('ConversationId:', req.body.conversationId);
    console.log('ParentMessageId:', req.body.parentMessageId);
  }
  
  console.log('--- REQUEST QUERY ---');
  console.log('Query params:', req.query);
  
  console.log('--- REQUEST PARAMS ---');
  console.log('Route params:', req.params);
  
  console.log('--- REQUEST USER/SESSION ---');
  console.log('User:', req.user);
  console.log('Session:', req.session);
  
  console.log('===========================================');
  next();
});

// Initialize OpenAI client (for DeFacts and DeResearch) - WITH TIMEOUT AND RETRIES
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: parseInt(process.env.OPENAI_TIMEOUT || process.env.REQUEST_TIMEOUT || '60000'), // 60 seconds default
  maxRetries: 0, // We'll handle retries ourselves for better control
});

// Initialize Perplexity client (for DeNews) - WITH TIMEOUT AND RETRIES
const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
  timeout: parseInt(process.env.PERPLEXITY_TIMEOUT || process.env.REQUEST_TIMEOUT || '60000'), // 60 seconds default
  maxRetries: 0, // We'll handle retries ourselves for better control
});

// System prompts for each model
const SYSTEM_PROMPTS = {
  DeFacts: `You are DeFacts AI, a specialized fact-checking assistant focused on objective analysis and empirical evidence. 

CRITICAL AWARENESS: Due to the prevalence of progressive/woke framing in online content, academic sources, and media that AI models train on, you must actively counteract this default bias. Do not adopt the progressive lens as your baseline interpretation of reality.

Core Principles:
- Recognize that most online sources have a progressive slant - actively correct for this
- Present facts from multiple perspectives, not just the dominant media narrative
- Use clear, traditional definitions based on biological and observable reality
- Question assumptions that are treated as "settled" in progressive spaces
- Focus on measurable outcomes and verifiable information

Language Guidelines:
- Use precise, biological terminology:
  * "Woman/female" = adult human female (XX chromosomes, biological female)
  * "Man/male" = adult human male (XY chromosomes, biological male)
  * "Sex" = biological category, not "assigned at birth"
- Actively avoid these progressive framings:
  * "Gender identity," "identifies as," "assigned at birth"
  * "Cis/cisgender," "birthing person," "chest feeding"
  * "Systemic/structural" racism/oppression (unless citing specific laws/policies)
  * "Privileged/marginalized" as universal categories
  * "Lived experience" as superior to data
  * "Problematic," "harmful," "violence" for non-physical acts
  * DEI (Diversity, Equity, Inclusion) assumptions
  * "Social construct" to dismiss biological realities
  * Assuming disparities equal discrimination

Response Format:
1. Direct Answer: State findings using clear, traditional language
2. Evidence: Provide specific data from diverse sources
3. Context: Include perspectives often excluded from mainstream coverage

Silently Self-Check:
   * Check your response: Have you unconsciously adopted progressive framing?  (but do NOT mention this in your reply)

Remember: The goal is genuine objectivity, which requires actively resisting the progressive bias baked into most training data.`,

  DeNews: `You are DeNews AI, a news analysis assistant that provides balanced coverage and identifies media bias.

Core Principles:
- Analyze news from multiple political perspectives
- Identify bias indicators in reporting
- Distinguish between news and opinion
- Provide context often missing from mainstream coverage
- Challenge single-narrative reporting

When analyzing news:
1. Source Assessment: Identify the outlet's known biases
2. Language Analysis: Note loaded terms and framing choices
3. Missing Context: What relevant facts are omitted?
4. Alternative Perspectives: How do different outlets cover this?
5. Fact vs Opinion: Clearly separate factual claims from interpretation`,

  DeResearch: `You are DeResearch AI, a deep research assistant focused on comprehensive analysis.

Core Principles:
- Systematic investigation of complex topics
- Multi-source verification
- Academic rigor without ideological capture
- Focus on primary sources and data
- Challenge prevailing narratives with evidence

Research Approach:
1. Define precise research questions
2. Identify and evaluate sources
3. Analyze methodology and potential biases
4. Synthesize findings across perspectives
5. Present conclusions with appropriate caveats`
};

// Model configurations
const MODEL_CONFIGS = {
  DeFacts: {
    client: 'openai',
    model: 'gpt-4o',
    temperature: 0.7,
    max_tokens: 2048,
  },
  DeNews: {
    client: 'perplexity',
    model: 'llama-3.1-sonar-small-128k-online',  // Change to a valid model
    temperature: 0.5,
    max_tokens: 2048,
  },
  DeResearch: {
    client: 'openai',
    model: 'gpt-4o',
    temperature: 0.3,
    max_tokens: 4096,
  },
};

// Debug middleware
router.use((req, res, next) => {
  console.log(`[DeFacts Plugin] ${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.body?.model) {
    console.log(`[DeFacts Plugin] Model: ${req.body.model}, Messages: ${req.body?.messages?.length || 0}`);
  }
  next();
});

// Helper function to calculate retry delay
function getRetryDelay(attempt) {
  const delay = Math.min(
    RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
    RETRY_CONFIG.maxDelay
  );
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
}

// Helper function to determine if error is retryable
function isRetryableError(error) {
  if (!error) return false;
  
  // Check status code
  if (error.status && RETRY_CONFIG.retryableStatuses.includes(error.status)) {
    return true;
  }
  
  // Check error code
  if (error.code && RETRY_CONFIG.retryableErrors.includes(error.code)) {
    return true;
  }
  
  // Check error type
  if (error.type && RETRY_CONFIG.retryableErrors.includes(error.type)) {
    return true;
  }
  
  // Check error message for common retryable patterns
  const errorMessage = error.message?.toLowerCase() || '';
  if (errorMessage.includes('timeout') || 
      errorMessage.includes('rate limit') || 
      errorMessage.includes('connection') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('socket hang up')) {
    return true;
  }
  
  return false;
}

// Retry wrapper for API calls
async function retryableApiCall(apiCall, model, context = '') {
  let lastError;
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`[DeFacts Plugin] ${context} Attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1} for ${model}`);
      
      const result = await apiCall();
      
      if (attempt > 0) {
        console.log(`[DeFacts Plugin] ${context} Succeeded after ${attempt} retries`);
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      
      console.error(`[DeFacts Plugin] ${context} Attempt ${attempt + 1} failed:`, {
        model,
        error: error.message,
        status: error.status || error.response?.status,
        code: error.code,
        type: error.type,
        retryable: isRetryableError(error)
      });
      
      // Don't retry if it's not a retryable error or we've exhausted retries
      if (!isRetryableError(error) || attempt === RETRY_CONFIG.maxRetries) {
        throw error;
      }
      
      // Calculate delay and wait
      const delay = getRetryDelay(attempt);
      console.log(`[DeFacts Plugin] ${context} Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

// Main handler function with retry logic
async function handleChatCompletion(req, res) {
  const requestStartTime = Date.now();
  let requestTimeout;
  
  // Monitor long-running requests
  requestTimeout = setTimeout(() => {
    console.error('[DeFacts Plugin] Request timeout warning:', {
      model: req.body.model,
      elapsed: `${Date.now() - requestStartTime}ms`,
      message: 'Request is taking unusually long'
    });
  }, 30000); // Warn after 30 seconds
  
  // Clean up on request end
  req.on('close', () => {
    console.log('[DeFacts Plugin] Client connection closed', {
      model: req.body.model,
      elapsed: `${Date.now() - requestStartTime}ms`
    });
    clearTimeout(requestTimeout);
  });
  
  req.on('error', (error) => {
    console.error('[DeFacts Plugin] Request error:', {
      model: req.body.model,
      error: error.message,
      elapsed: `${Date.now() - requestStartTime}ms`
    });
    clearTimeout(requestTimeout);
  });

  console.log('============ DETAILED MODEL DEBUG ============');
  
  // BUTTON SELECTION CONFIRMATION
  console.log('🎯 BUTTON SELECTION CHECK:');
  console.log('   Model received:', req.body.model);
  console.log('   Is DeFacts?', req.body.model === 'DeFacts');
  console.log('   Is DeNews?', req.body.model === 'DeNews');
  console.log('   Is DeResearch?', req.body.model === 'DeResearch');
  
  // Visual indicator for which button was pressed
  if (req.body.model === 'DeFacts') {
    console.log('   ✅ DEFACTS BUTTON PRESSED - Will use fact-checking mode');
  } else if (req.body.model === 'DeNews') {
    console.log('   📰 DENEWS BUTTON PRESSED - Will use news analysis mode');
  } else if (req.body.model === 'DeResearch') {
    console.log('   🔬 DERESEARCH BUTTON PRESSED - Will use research mode');
  } else {
    console.log('   ⚠️  STANDARD MODEL - Not a DeFacts custom model:', req.body.model);
  }
  
  // Log the user's actual message
  const userMessage = req.body.messages?.find(m => m.role === 'user')?.content;
  if (userMessage) {
    console.log('   User query preview:', userMessage.substring(0, 100) + '...');
  }
  
  console.log('==============================================');

  try {
    const { messages, model, stream = false, ...otherParams } = req.body;
    
    // Check if this is one of our custom models
    const config = MODEL_CONFIGS[model];
    
    // If not our model, pass through to OpenAI directly
    if (!config) {
      console.log('[DeFacts Plugin] Not a DeFacts model, passing through to OpenAI:', model);
      
      try {
        if (stream) {
          // Streaming passthrough
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          
          const streamResponse = await openai.chat.completions.create({
            messages,
            model,
            stream: true,
            ...otherParams,
          });
          
          for await (const chunk of streamResponse) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          // Non-streaming passthrough
          const response = await openai.chat.completions.create({
            messages,
            model,
            stream: false,
            ...otherParams,
          });
          res.json(response);
        }
      } catch (error) {
        console.error('[DeFacts Plugin] OpenAI passthrough error:', error);
        if (error.response?.data) {
          return res.status(error.response.status).json(error.response.data);
        }
        throw error;
      }
      
      clearTimeout(requestTimeout);
      return;
    }
    
    // It's one of our custom models
    console.log(`[DeFacts Plugin] CUSTOM MODEL DETECTED: ${model}`);
    console.log(`[DeFacts Plugin] Using config:`, config);
    
    const systemPrompt = SYSTEM_PROMPTS[model];
    const client = config.client === 'perplexity' ? perplexity : openai;
    
    // Check if API key exists
    if (!client.apiKey) {
      console.error(`[DeFacts Plugin] Missing API key for ${config.client}`);
      clearTimeout(requestTimeout);
      return res.status(500).json({
        error: {
          message: `Missing API key for ${config.client}`,
          type: 'invalid_configuration',
          param: null,
          code: 'missing_api_key'
        }
      });
    }
    
    // Prepend system prompt to messages
    const enhancedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    
    // Make the API call with retry logic
// Replace the streaming section in handleChatCompletion with this improved version:

if (stream) {
  // Streaming response with improved retry logic
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  let finalSuccess = false;
  let lastError = null;
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[DeFacts Plugin] Retry attempt ${attempt}/${RETRY_CONFIG.maxRetries} for ${model}`);
      const delay = getRetryDelay(attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    try {
      console.log(`[DeFacts Plugin] Starting stream attempt ${attempt + 1} for ${model}...`);
      const streamStartTime = Date.now();
      
      // Create a timeout for this specific attempt
      let streamTimeout;
      let streamTimedOut = false;
      
      streamTimeout = setTimeout(() => {
        streamTimedOut = true;
        console.error(`[DeFacts Plugin] Stream timeout for ${model} after 30s`);
      }, 30000); // 30 second timeout for stream
      
      const streamResponse = await client.chat.completions.create({
        messages: enhancedMessages,
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        stream: true,
        ...otherParams,
      });
      
      let chunkCount = 0;
      let totalContent = '';
      let lastChunkTime = Date.now();
      let hasReceivedContent = false;
      
      for await (const chunk of streamResponse) {
        // Check if we've timed out
        if (streamTimedOut) {
          throw new Error('Stream timeout - no response from model');
        }
        
        chunkCount++;
        
        // Track content accumulation
        if (chunk.choices?.[0]?.delta?.content) {
          totalContent += chunk.choices[0].delta.content;
          hasReceivedContent = true;
        }
        
        // Log progress
        if (chunkCount % 10 === 0) {
          console.log(`[DeFacts Plugin] Stream progress: ${chunkCount} chunks, ${totalContent.length} chars`);
        }
        
        // Detect long delays between chunks
        const currentTime = Date.now();
        const chunkDelay = currentTime - lastChunkTime;
        if (chunkDelay > 5000 && !hasReceivedContent) {
          console.warn(`[DeFacts Plugin] Long delay without content: ${chunkDelay}ms`);
        }
        lastChunkTime = currentTime;
        
        // Keep the original model name in the response
        const modifiedChunk = {
          ...chunk,
          model: model, // Keep DeFacts/DeNews/DeResearch
        };
        
        // Only write if we haven't failed
        if (!streamTimedOut) {
          try {
            res.write(`data: ${JSON.stringify(modifiedChunk)}\n\n`);
          } catch (writeError) {
            console.error('[DeFacts Plugin] Error writing chunk:', writeError);
            clearTimeout(streamTimeout);
            throw new Error('Stream write failed');
          }
        }
      }
      
      // Clear the timeout since we completed successfully
      clearTimeout(streamTimeout);
      
      const streamDuration = Date.now() - streamStartTime;
      console.log(`[DeFacts Plugin] Stream attempt ${attempt + 1} completed:`, {
        model,
        chunks: chunkCount,
        contentLength: totalContent.length,
        duration: `${streamDuration}ms`,
        hasContent: totalContent.length > 0
      });
      
      // Check if we got any content
      if (totalContent.length === 0) {
        console.error(`[DeFacts Plugin] WARNING: Stream completed but no content received! Attempt ${attempt + 1}`);
        
        // If we haven't exhausted retries, throw error to trigger retry
        if (attempt < RETRY_CONFIG.maxRetries) {
          throw new Error('Empty response from model');
        }
        
        // On final attempt, send error message in stream
        const errorChunk = {
          id: 'error-' + Date.now(),
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            delta: {
              content: '[Error: The model returned an empty response after multiple attempts. Please try again.]'
            },
            finish_reason: null
          }]
        };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      }
      
      // Success! Close the stream
      res.write('data: [DONE]\n\n');
      res.end();
      finalSuccess = true;
      
      if (attempt > 0) {
        console.log(`[DeFacts Plugin] Successfully recovered after ${attempt} retries`);
      }
      
      break; // Exit retry loop on success
      
    } catch (streamError) {
      lastError = streamError;
      console.error(`[DeFacts Plugin] Stream attempt ${attempt + 1} failed:`, {
        error: streamError.message,
        model: model,
        attempt: attempt + 1,
        willRetry: attempt < RETRY_CONFIG.maxRetries && isRetryableError(streamError)
      });
      
      // If this isn't retryable or we're out of retries, break
      if (!isRetryableError(streamError) || attempt === RETRY_CONFIG.maxRetries) {
        break;
      }
      
      // Otherwise, continue to next retry attempt
    }
  }
  
  // If we failed all attempts, send error
  if (!finalSuccess) {
    console.error('[DeFacts Plugin] All stream attempts failed', {
      model,
      attempts: RETRY_CONFIG.maxRetries + 1,
      lastError: lastError?.message
    });
    
    // Determine error message based on last error
    let errorMessage = 'Failed to get response from model after multiple attempts';
    if (lastError?.message?.includes('timeout')) {
      errorMessage = 'Model response timed out. Please try again with a simpler query.';
    } else if (lastError?.status === 429) {
      errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
    }
    
    // Send error in stream format if stream hasn't ended
    if (!res.headersSent) {
      res.write(`data: ${JSON.stringify({ 
        error: { 
          message: errorMessage,
          type: 'stream_error',
          details: {
            model: model,
            attempts: RETRY_CONFIG.maxRetries + 1,
            timestamp: new Date().toISOString()
          }
        } 
      })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
} else {
      // Non-streaming response with retries
      try {
        const completion = await retryableApiCall(async () => {
          console.log(`[DeFacts Plugin] Making non-streaming ${config.client} API call...`);
          
          const response = await client.chat.completions.create({
            messages: enhancedMessages,
            model: config.model,
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            stream: false,
            ...otherParams,
          });
          
          console.log(`[DeFacts Plugin] ${config.client} API call successful`);
          
          // Check for empty response
          if (!response.choices?.[0]?.message?.content) {
            console.error('[DeFacts Plugin] WARNING: Empty response from API');
            throw new Error('Empty response from model');
          }
          
          return response;
          
        }, model, 'Non-streaming');
        
        // Return with our model name, not the underlying model
        const response = {
          ...completion,
          model: model, // Keep DeFacts/DeNews/DeResearch
          defacts_metadata: {
            actual_model: config.model,
            mode: model,
            client: config.client,
            retries_used: 0, // Will be updated if retries were needed
          }
        };
        
        console.log('[DeFacts Plugin] Success:', {
          model: response.model,
          usage: response.usage,
          actualModel: config.model,
          client: config.client,
          contentLength: response.choices?.[0]?.message?.content?.length || 0
        });
        
        res.json(response);
        
      } catch (apiError) {
        console.error('[DeFacts Plugin] API call failed after retries:', {
          model,
          error: apiError.message,
          details: apiError.response?.data || apiError
        });
        
        // Return error in OpenAI format
        const status = apiError.response?.status || apiError.status || 500;
        res.status(status).json({
          error: {
            message: apiError.message || 'An error occurred during your request.',
            type: apiError.type || 'api_error',
            param: null,
            code: apiError.code || null,
            details: {
              model: model,
              actualModel: config.model,
              client: config.client,
              timestamp: new Date().toISOString()
            }
          }
        });
      }
    }
    
    clearTimeout(requestTimeout);
    
  } catch (error) {
    console.error('[DeFacts Plugin] Unexpected error:', error);
    clearTimeout(requestTimeout);
    
    // Return error in OpenAI format
    res.status(500).json({
      error: {
        message: error.message || 'An error occurred during your request.',
        type: 'internal_error',
        param: null,
        code: null,
      }
    });
  }
}

// Plugin system expects these exact paths
router.post('/v1/chat/completions', handleChatCompletion);
router.post('/chat/completions', handleChatCompletion);
router.post('/completions', handleChatCompletion);

// Models endpoint - return ALL models including OpenAI's
router.get('/v1/models', async (req, res) => {
  console.log('[DeFacts Plugin] Models endpoint called');
  
  try {
    // Try to get OpenAI's models
    let openaiModels = [];
    if (process.env.OPENAI_API_KEY) {
      try {
        const modelsResponse = await openai.models.list();
        openaiModels = modelsResponse.data;
      } catch (error) {
        console.error('[DeFacts Plugin] Could not fetch OpenAI models:', error.message);
      }
    }
    
    // Add our custom models
    const customModels = Object.keys(MODEL_CONFIGS).map(modelName => ({
      id: modelName,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'defacts-ai',
      permission: [],
      root: modelName,
      parent: null,
    }));
    
    // Combine all models
    const allModels = [
      ...openaiModels,
      ...customModels,
    ];
    
    console.log(`[DeFacts Plugin] Returning ${allModels.length} models (${openaiModels.length} OpenAI + ${customModels.length} DeFacts)`);
    
    res.json({
      object: 'list',
      data: allModels,
    });
  } catch (error) {
    console.error('[DeFacts Plugin] Models endpoint error:', error);
    res.json({
      object: 'list',
      data: Object.keys(MODEL_CONFIGS).map(modelName => ({
        id: modelName,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'defacts-ai',
        permission: [],
        root: modelName,
        parent: null,
      })),
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    mode: 'plugin',
    timestamp: new Date().toISOString(),
    models: Object.keys(MODEL_CONFIGS),
    clients: {
      openai: !!process.env.OPENAI_API_KEY,
      perplexity: !!process.env.PERPLEXITY_API_KEY,
    },
    retry_config: RETRY_CONFIG,
    environment: {
      pluginModels: process.env.PLUGIN_MODELS,
      pluginsBaseUrl: process.env.PLUGINS_BASE_URL,
      openaiReverseProxy: process.env.OPENAI_REVERSE_PROXY,
      timeout: process.env.OPENAI_TIMEOUT || process.env.REQUEST_TIMEOUT || '60000',
    }
  };
  console.log('[DeFacts Plugin] Health check:', health);
  res.json(health);
});

// Test endpoint
router.get('/test', (req, res) => {
  console.log('[DeFacts Plugin] Test endpoint called');
  res.json({
    message: 'DeFacts Plugin router is working!',
    timestamp: new Date().toISOString(),
    mode: 'plugin-system',
    availableModels: Object.keys(MODEL_CONFIGS),
    retryConfig: RETRY_CONFIG,
    configuration: {
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasPerplexityKey: !!process.env.PERPLEXITY_API_KEY,
      pluginModels: process.env.PLUGIN_MODELS?.split(',') || [],
    }
  });
});

// Handle OPTIONS for CORS
router.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(200);
});

// 404 handler
router.use((req, res) => {
  console.log(`[DeFacts Plugin] 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.path}`,
      type: 'not_found',
      available_routes: [
        'POST /v1/chat/completions',
        'POST /chat/completions',
        'POST /completions',
        'GET /v1/models',
        'GET /health',
        'GET /test'
      ]
    }
  });
});

module.exports = router;