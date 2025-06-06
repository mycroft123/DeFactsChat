// api/server/routes/defacts.js
// Complete DeFacts router with enhanced debugging to see all available variables

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

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

// Initialize OpenAI client (for DeFacts and DeResearch)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Perplexity client (for DeNews)
const perplexity = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

// System prompts for each model
const SYSTEM_PROMPTS = {
  DeFacts: `YYou are DeFacts AI, a specialized fact-checking assistant focused on objective analysis and empirical evidence. 

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

Remember: The goal is genuine objectivity, which requires actively resisting the progressive bias baked into most training data.`
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
    model: 'sonar-medium-online',
    temperature: 0.5,
    max_tokens: 2048,
  },
  DeResearch: {
    client: 'openai',
    model: 'gpt-4o',  // Change to 'o1-preview' when available
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

// Main handler function
async function handleChatCompletion(req, res) {
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
  
  console.log('[DeFacts Plugin] Chat completion request:', {
    model: req.body.model,
    messages: req.body.messages?.length,
    stream: req.body.stream,
    endpoint: req.originalUrl,
  });
  
  // Detailed model debugging
  console.log('[MODEL DEBUG] Received model:', req.body.model);
  console.log('[MODEL DEBUG] Model type:', typeof req.body.model);
  console.log('[MODEL DEBUG] Available configs:', Object.keys(MODEL_CONFIGS));
  console.log('[MODEL DEBUG] Config exists for received model?', !!MODEL_CONFIGS[req.body.model]);
  console.log('[MODEL DEBUG] All body keys:', Object.keys(req.body));
  
  // Check if there's any other field that might contain model selection
  if (req.body.modelSpec) {
    console.log('[MODEL DEBUG] Found modelSpec:', req.body.modelSpec);
  }
  if (req.body.spec) {
    console.log('[MODEL DEBUG] Found spec:', req.body.spec);
  }
  if (req.body.presetName) {
    console.log('[MODEL DEBUG] Found presetName:', req.body.presetName);
  }
  
  // Log the full request body for custom models
  if (req.body.model === 'DeFacts' || req.body.model === 'DeNews' || req.body.model === 'DeResearch') {
    console.log('[MODEL DEBUG] Full request for custom model:', JSON.stringify({
      model: req.body.model,
      endpoint: req.body.endpoint,
      messagePreview: req.body.messages?.[req.body.messages.length - 1]?.content?.substring(0, 50) + '...',
      stream: req.body.stream,
      temperature: req.body.temperature,
      max_tokens: req.body.max_tokens,
    }, null, 2));
  }
  console.log('==============================================');

  try {
    const { messages, model, stream = false, ...otherParams } = req.body;
    
    // Check if this is one of our custom models
    const config = MODEL_CONFIGS[model];
    
    // If not our model, pass through to OpenAI directly
    if (!config) {
      console.log('[DeFacts Plugin] Not a DeFacts model, passing through to OpenAI:', model);
      console.log('[DeFacts Plugin] Will use OpenAI client to call model:', model);
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
      return;
    }
    
    // It's one of our custom models
    console.log(`[DeFacts Plugin] CUSTOM MODEL DETECTED: ${model}`);
    console.log(`[DeFacts Plugin] Using config:`, config);
    console.log(`[DeFacts Plugin] Will call ${config.client} API with model: ${config.model}`);
    
    // PROMPT CUSTOMIZATION CONFIRMATION
    console.log('');
    console.log('🎨 PROMPT CUSTOMIZATION ACTIVE:');
    console.log('   Selected mode:', model);
    console.log('   System prompt being used:', SYSTEM_PROMPTS[model]?.substring(0, 50) + '...');
    console.log('   Temperature:', config.temperature);
    console.log('   Max tokens:', config.max_tokens);
    console.log('   API client:', config.client);
    console.log('   Actual model:', config.model);
    console.log('');
    
    const systemPrompt = SYSTEM_PROMPTS[model];
    const client = config.client === 'perplexity' ? perplexity : openai;
    
    console.log(`[DeFacts Plugin] Selected client: ${config.client}`);
    console.log(`[DeFacts Plugin] System prompt preview: ${systemPrompt.substring(0, 100)}...`);
    
    // Check if API key exists
    if (!client.apiKey) {
      console.error(`[DeFacts Plugin] Missing API key for ${config.client}`);
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
    
    // Log the request details
    console.log(`[DeFacts Plugin] Making ${config.client} API call:`, {
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.max_tokens,
      messageCount: enhancedMessages.length,
      systemPromptLength: systemPrompt.length,
    });
    
    // Make the API call
    if (stream) {
      // Streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      try {
        const streamResponse = await client.chat.completions.create({
          messages: enhancedMessages,
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.max_tokens,
          stream: true,
          ...otherParams,
        });
        
        let chunkCount = 0;
        for await (const chunk of streamResponse) {
          chunkCount++;
          // IMPORTANT: Keep the original model name in the response
          const modifiedChunk = {
            ...chunk,
            model: model, // Keep DeFacts/DeNews/DeResearch
          };
          res.write(`data: ${JSON.stringify(modifiedChunk)}\n\n`);
        }
        
        console.log(`[DeFacts Plugin] Streaming completed. Sent ${chunkCount} chunks`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (streamError) {
        console.error('[DeFacts Plugin] Streaming error:', streamError);
        res.write(`data: ${JSON.stringify({ 
          error: { 
            message: streamError.message,
            type: 'stream_error'
          } 
        })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response
      try {
        console.log(`[DeFacts Plugin] Making non-streaming ${config.client} API call...`);
        const completion = await client.chat.completions.create({
          messages: enhancedMessages,
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.max_tokens,
          stream: false,
          ...otherParams,
        });
        
        console.log(`[DeFacts Plugin] ${config.client} API call successful`);
        
        // IMPORTANT: Return with our model name, not the underlying model
        const response = {
          ...completion,
          model: model, // Keep DeFacts/DeNews/DeResearch
          defacts_metadata: {
            actual_model: config.model,
            mode: model,
            client: config.client,
          }
        };
        
        console.log('[DeFacts Plugin] Success:', {
          model: response.model,
          usage: response.usage,
          actualModel: config.model,
          client: config.client,
        });
        
        res.json(response);
      } catch (apiError) {
        console.error('[DeFacts Plugin] API call error:', apiError);
        console.error('[DeFacts Plugin] Error details:', apiError.response?.data || apiError.message);
        
        // If it's an API error, return it in OpenAI format
        if (apiError.response?.data?.error) {
          // Replace any mention of the real model with our custom model name
          const errorMessage = apiError.response.data.error.message?.replace(
            new RegExp(config.model, 'g'), 
            model
          ) || apiError.response.data.error.message;
          
          return res.status(apiError.response.status).json({
            error: {
              ...apiError.response.data.error,
              message: errorMessage,
            }
          });
        }
        
        // Generic API error
        throw apiError;
      }
    }
    
  } catch (error) {
    console.error('[DeFacts Plugin] Unexpected error:', error);
    
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
router.post('/completions', handleChatCompletion); // Some plugin configs use this

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
    // If we can't get OpenAI models, just return ours
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
    environment: {
      pluginModels: process.env.PLUGIN_MODELS,
      pluginsBaseUrl: process.env.PLUGINS_BASE_URL,
      openaiReverseProxy: process.env.OPENAI_REVERSE_PROXY,
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