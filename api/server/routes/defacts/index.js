// api/server/routes/defacts/index.js
// Custom endpoint that routes to different models based on selected mode

const express = require('express');
const router = express.Router();
const { sendMessage, createOnProgress } = require('../../utils');
const { saveMessage } = require('../../models');
const OpenAI = require('openai');

// Initialize clients
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Perplexity uses OpenAI-compatible API
const perplexityClient = new OpenAI({
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseURL: 'https://api.perplexity.ai',
});

// System prompts for each mode
const SYSTEM_PROMPTS = {
  defact: `You are DeFacts AI, a specialized fact-checking assistant. Your responses follow this structure:

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

  denews: `You are DeNews AI, a news analysis and current events assistant powered by real-time information. 

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

  deresearch: `You are DeResearch AI, powered by advanced reasoning capabilities for deep analysis and complex problem-solving.

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
• [Additional findings]

📈 IMPLICATIONS
[What this means in practice]

🔄 FURTHER RESEARCH
[Questions that remain open]`
};

// Model configurations for each mode
const MODEL_CONFIGS = {
  defact: {
    model: 'gpt-4o',
    temperature: 0.7,
    max_tokens: 2048,
  },
  denews: {
    model: 'sonar-medium-online', // Perplexity's online model for news
    temperature: 0.5,
    max_tokens: 2048,
  },
  deresearch: {
    model: 'o1-preview', // or 'o1-mini' for faster/cheaper
    temperature: 0.3, // Lower temperature for research
    max_tokens: 4096, // More tokens for detailed analysis
  },
};

router.post('/chat/completions', async (req, res) => {
  try {
    const { messages, mode = 'defact', stream = false, ...otherParams } = req.body;
    
    // Validate mode
    if (!['defact', 'denews', 'deresearch'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode selected' });
    }

    // Get configuration for selected mode
    const config = MODEL_CONFIGS[mode];
    const systemPrompt = SYSTEM_PROMPTS[mode];

    // Prepend system prompt to messages
    const enhancedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    // Select the appropriate client
    let client;
    let finalConfig = { ...config };

    if (mode === 'denews') {
      client = perplexityClient;
    } else {
      client = openaiClient;
      // For o1 models, handle special requirements
      if (mode === 'deresearch' && config.model.startsWith('o1')) {
        // o1 models don't support system messages in the same way
        // Merge system prompt into first user message
        if (enhancedMessages[1]?.role === 'user') {
          enhancedMessages[1].content = `${systemPrompt}\n\n${enhancedMessages[1].content}`;
          enhancedMessages.shift(); // Remove system message
        }
        // o1 models don't support temperature, top_p, etc.
        delete finalConfig.temperature;
      }
    }

    // Make the API call
    if (stream) {
      // Handle streaming response
      const stream = await client.chat.completions.create({
        messages: enhancedMessages,
        ...finalConfig,
        ...otherParams,
        stream: true,
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ 
            choices: [{ delta: { content } }],
            mode: mode 
          })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Handle non-streaming response
      const completion = await client.chat.completions.create({
        messages: enhancedMessages,
        ...finalConfig,
        ...otherParams,
        stream: false,
      });

      // Add mode information to response
      completion.mode = mode;
      completion.model_used = config.model;

      res.json(completion);
    }

  } catch (error) {
    console.error('DeFacts API Error:', error);
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message,
      mode: req.body.mode 
    });
  }
});

// Endpoint to get available modes and their descriptions
router.get('/modes', (req, res) => {
  res.json({
    modes: [
      {
        id: 'defact',
        name: 'DeFact',
        description: 'Fact-checking and verification',
        model: 'GPT-4',
        icon: '✓'
      },
      {
        id: 'denews',
        name: 'DeNews',
        description: 'Current events and news analysis',
        model: 'Perplexity Online',
        icon: '📰'
      },
      {
        id: 'deresearch',
        name: 'DeResearch',
        description: 'Deep research and analysis',
        model: 'O1',
        icon: '🔬'
      }
    ]
  });
});

module.exports = router;