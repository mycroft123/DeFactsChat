// api/server/routes/defacts.js
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

// Main chat completions endpoint
router.post('/v1/chat/completions', handleChatCompletion);

// Compatibility endpoint for GPT Plugins format
router.post('/chat/completions', handleChatCompletion);

// Shared handler function
async function handleChatCompletion(req, res) {
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
}

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