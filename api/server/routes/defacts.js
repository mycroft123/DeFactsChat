// api/server/routes/defacts.js
// Complete DeFacts router with debugging and error handling

const express = require('express');
const router = express.Router();
const OpenAI = require('openai');

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
  DeFacts: `You are DeFacts AI, a specialized fact-checking assistant. Your responses follow this structure:

CLAIM ANALYSIS:
[Restate the claim being checked]

VERDICT: [TRUE | FALSE | PARTIALLY TRUE | UNVERIFIABLE | MISLEADING CONTEXT]

EVIDENCE:
• [Key evidence point 1]
• [Key evidence point 2]
• [Additional evidence as needed]

CONTEXT:
[Important context that affects interpretation]

CONFIDENCE: [HIGH | MEDIUM | LOW] based on available evidence

Always prioritize accuracy and provide balanced, well-researched information.`,

  DeNews: `You are DeNews AI, a news analysis and current events assistant powered by real-time information. 

Your approach:
1. **Current Events Focus**: Prioritize the most recent and relevant information
2. **Multiple Sources**: When discussing news, indicate if multiple sources report the same information
3. **Temporal Context**: Always specify dates and timeframes
4. **Developing Stories**: Clearly mark when a story is still developing
5. **Fact vs Opinion**: Distinguish between reported facts and editorial opinions

Format:
📰 HEADLINE SUMMARY: [Main point in one sentence]
📅 TIMELINE: [When this happened/is happening]
🔍 KEY DETAILS: [Bullet points of main facts]
🌐 BROADER CONTEXT: [Why this matters]
⚡ LATEST UPDATES: [Most recent developments]`,

  DeResearch: `You are DeResearch AI, powered by advanced reasoning capabilities for deep analysis and complex problem-solving.

Your approach involves:
1. **Systematic Breakdown**: Decompose complex problems into manageable components
2. **Multi-step Reasoning**: Show your thinking process step-by-step
3. **Consider Multiple Angles**: Explore different approaches and perspectives
4. **Evidence-Based Conclusions**: Support findings with logical reasoning
5. **Acknowledge Limitations**: Be clear about assumptions and uncertainties

Structure your responses as:
🎯 RESEARCH OBJECTIVE
[Clear statement of what we're investigating]

🔬 METHODOLOGY
[How you'll approach this analysis]

📊 ANALYSIS
Step 1: [First component]
Step 2: [Second component]
[Continue as needed]

💡 FINDINGS
• [Key discovery 1]
• [Key discovery 2]

📈 IMPLICATIONS
[What this means in practice]`
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

// Debug middleware - logs all requests
router.use((req, res, next) => {
  console.log(`[DeFacts] ${new Date().toISOString()} - ${req.method} ${req.path}`);
  if (req.body?.model) {
    console.log(`[DeFacts] Model: ${req.body.model}, Messages: ${req.body?.messages?.length || 0}`);
  }
  next();
});

// Main chat completions endpoint
router.post('/v1/chat/completions', handleChatCompletion);

// Compatibility endpoint for GPT Plugins format
router.post('/chat/completions', handleChatCompletion);

// Shared handler function
async function handleChatCompletion(req, res) {
  // Detailed logging
  console.log('=== DEFACTS CHAT REQUEST ===');
  console.log('Time:', new Date().toISOString());
  console.log('Model requested:', req.body.model);
  console.log('Stream:', req.body.stream);
  console.log('Message count:', req.body.messages?.length);
  if (req.body.messages?.length > 0) {
    console.log('Last message preview:', req.body.messages[req.body.messages.length - 1].content?.substring(0, 100) + '...');
  }
  console.log('===========================');

  try {
    const { messages, model, stream = false, ...otherParams } = req.body;
    
    // Get configuration for the requested model
    const config = MODEL_CONFIGS[model];
    const systemPrompt = SYSTEM_PROMPTS[model];
    
    if (!config || !systemPrompt) {
      console.log('[DeFacts] ERROR: Invalid model requested:', model);
      return res.status(400).json({ 
        error: {
          message: `Invalid model: ${model}. Choose from: ${Object.keys(MODEL_CONFIGS).join(', ')}`,
          type: 'invalid_request_error',
          param: 'model',
          code: 'model_not_found'
        }
      });
    }
    
    console.log(`[DeFacts] Using ${config.client} client with model: ${config.model}`);
    
    // Select the appropriate client
    const client = config.client === 'perplexity' ? perplexity : openai;
    
    // Prepend system prompt to messages
    const enhancedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    
    // Handle streaming
    if (stream) {
      console.log('[DeFacts] Starting streaming response...');
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
          // Format SSE response with DeFacts model name
          const data = JSON.stringify({
            ...chunk,
            model: model,  // Keep the DeFacts model name
          });
          res.write(`data: ${data}\n\n`);
        }
        
        console.log(`[DeFacts] Streaming completed. Sent ${chunkCount} chunks`);
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (streamError) {
        console.error('[DeFacts] Streaming error:', streamError);
        res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response
      console.log('[DeFacts] Making non-streaming API call...');
      try {
        const completion = await client.chat.completions.create({
          messages: enhancedMessages,
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.max_tokens,
          stream: false,
          ...otherParams,
        });
        
        console.log('[DeFacts] API call successful');
        console.log(`[DeFacts] Response tokens: ${completion.usage?.total_tokens || 'unknown'}`);
        
        // Return response with DeFacts model name
        const response = {
          ...completion,
          model: model,  // Keep the DeFacts model name
          defacts_metadata: {
            actual_model: config.model,
            mode: model,
            client: config.client,
          }
        };
        
        res.json(response);
      } catch (apiError) {
        console.error('[DeFacts] API Error:', apiError.message);
        console.error('[DeFacts] Error details:', apiError.response?.data || apiError);
        
        // If it's an API error from OpenAI/Perplexity, pass it through
        if (apiError.response?.status && apiError.response?.data) {
          return res.status(apiError.response.status).json(apiError.response.data);
        }
        
        // Otherwise, return a generic error
        return res.status(500).json({
          error: {
            message: apiError.message || 'Failed to process request',
            type: 'api_error',
            code: 'internal_error'
          }
        });
      }
    }
    
  } catch (error) {
    console.error('[DeFacts] Unexpected error:', error);
    res.status(500).json({ 
      error: {
        message: 'Internal server error',
        type: 'server_error',
        details: error.message,
      }
    });
  }
}

// Models endpoint (for LibreChat)
router.get('/v1/models', (req, res) => {
  console.log('[DeFacts] Models endpoint called');
  
  const models = {
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
  };
  
  console.log('[DeFacts] Returning models:', models.data.map(m => m.id).join(', '));
  res.json(models);
});

// Health check endpoint
router.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    models: Object.keys(MODEL_CONFIGS),
    clients: {
      openai: !!process.env.OPENAI_API_KEY,
      perplexity: !!process.env.PERPLEXITY_API_KEY,
    }
  };
  console.log('[DeFacts] Health check:', health);
  res.json(health);
});

// Test endpoint
router.get('/test', (req, res) => {
  console.log('[DeFacts] Test endpoint called');
  res.json({
    message: 'DeFacts router is working!',
    timestamp: new Date().toISOString(),
    availableModels: Object.keys(MODEL_CONFIGS),
    environment: {
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasPerplexityKey: !!process.env.PERPLEXITY_API_KEY,
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
  console.log(`[DeFacts] 404 - Route not found: ${req.method} ${req.path}`);
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.path}`,
      type: 'not_found',
      available_routes: [
        'POST /v1/chat/completions',
        'POST /chat/completions',
        'GET /v1/models',
        'GET /health',
        'GET /test'
      ]
    }
  });
});

module.exports = router;