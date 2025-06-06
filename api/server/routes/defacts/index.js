// api/server/routes/defacts/index.js
// Custom router that handles DeFacts, DeNews, and DeResearch models

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
3. Check your response: Have you unconsciously adopted progressive framing?
4. Context: Include perspectives often excluded from mainstream coverage

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

// Main chat completions endpoint
router.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model, stream = false, ...otherParams } = req.body;
    
    console.log('DeFacts Router - Model requested:', model);
    
    // Get configuration for the requested model
    const config = MODEL_CONFIGS[model];
    const systemPrompt = SYSTEM_PROMPTS[model];
    
    if (!config || !systemPrompt) {
      return res.status(400).json({ 
        error: `Invalid model: ${model}. Choose from: DeFacts, DeNews, DeResearch` 
      });
    }
    
    // Select the appropriate client
    const client = config.client === 'perplexity' ? perplexity : openai;
    
    // Prepend system prompt to messages
    const enhancedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    
    // Handle streaming
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const streamResponse = await client.chat.completions.create({
        messages: enhancedMessages,
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        stream: true,
        ...otherParams,
      });
      
      for await (const chunk of streamResponse) {
        // Format SSE response
        const data = JSON.stringify({
          ...chunk,
          model: model,  // Keep the DeFacts model name
        });
        res.write(`data: ${data}\n\n`);
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Non-streaming response
      const completion = await client.chat.completions.create({
        messages: enhancedMessages,
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        stream: false,
        ...otherParams,
      });
      
      // Return response with DeFacts model name
      res.json({
        ...completion,
        model: model,  // Keep the DeFacts model name
        defacts_metadata: {
          actual_model: config.model,
          mode: model,
        }
      });
    }
    
  } catch (error) {
    console.error('DeFacts Router Error:', error);
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message 
    });
  }
});

// Models endpoint (for LibreChat)
router.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'DeFacts',
        object: 'model',
        created: Date.now(),
        owned_by: 'defacts-ai',
        permission: [],
        root: 'DeFacts',
        parent: null,
      },
      {
        id: 'DeNews',
        object: 'model',
        created: Date.now(),
        owned_by: 'defacts-ai',
        permission: [],
        root: 'DeNews',
        parent: null,
      },
      {
        id: 'DeResearch',
        object: 'model',
        created: Date.now(),
        owned_by: 'defacts-ai',
        permission: [],
        root: 'DeResearch',
        parent: null,
      },
    ],
  });
});

module.exports = router;