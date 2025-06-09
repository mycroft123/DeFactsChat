const { Controller } = require('librechat-data-provider');
const { initializeClient } = require('~/server/services/Endpoints/custom');
const { saveMessage, getConvoTitle, getConvo } = require('~/models');
const { sendMessage, createOnProgress } = require('~/server/utils');
const { addTitle } = require('~/server/services/Endpoints/openAI');
const { logger } = require('~/config');

const router = express.Router();

router.post('/abort', async (req, res) => {
  // ... existing abort code ...
});

router.post(
  '/',
  // Your middlewares
  async (req, res, next) => {
    try {
      console.log('🎯 [CUSTOM ROUTE DEBUG] ==================');
      console.log('📋 [Custom Route] Full request body:', JSON.stringify(req.body, null, 2));
      console.log('🔑 [Custom Route] Headers:', req.headers);
      console.log('🎯 =====================================');

      // Check what endpoint/spec we're dealing with
      const { endpoint, spec, model, key } = req.body;
      console.log('🔍 [Custom Route] Extracted values:', {
        endpoint,
        spec,
        model,
        keyStatus: key ? `exists (${key === 'never' ? 'never' : 'some value'})` : 'missing'
      });

      // Check if this is an OpenRouter request
      const isOpenRouter = spec === 'OpenRouter' || 
                          endpoint === 'OpenRouter' || 
                          model?.includes('perplexity') ||
                          req.body.chatGptLabel?.includes('OpenRouter');
      
      console.log('🤔 [Custom Route] Is OpenRouter request?', isOpenRouter);

      // Load your Railway secret (uppercase)
      const openRouterKey = process.env.OPENROUTER_KEY;
      if (!openRouterKey) {
        console.error('❌ [Custom Route] Missing OPENROUTER_KEY in environment');
        throw new Error('Missing OPENROUTER_KEY in environment');
      }

      console.log('✅ [Custom Route] OpenRouter key found in env:', openRouterKey.substring(0, 20) + '...');

      // Override any user-supplied key for OpenRouter requests
      if (isOpenRouter) {
        console.log('🔄 [Custom Route] Overriding key for OpenRouter request');
        req.body.key = openRouterKey;
      }

      // Log before passing to next handler
      console.log('📤 [Custom Route] Passing to next handler with key:', 
        req.body.key ? req.body.key.substring(0, 20) + '...' : 'NO KEY');

      next();
    } catch (error) {
      console.error('❌ [Custom Route] Error:', error);
      res.status(500).json({ error: error.message });
    }
  },
  async (req, res) => {
    try {
      console.log('🎯 [CUSTOM CONTROLLER DEBUG] ==================');
      console.log('📋 [Custom Controller] Starting request processing');
      
      // Build the payload
      const payload = {
        ...req.body,
        user: req.user.id,
      };

      console.log('📦 [Custom Controller] Payload prepared:', {
        endpoint: payload.endpoint,
        spec: payload.spec,
        model: payload.model,
        keyExists: !!payload.key
      });

      // (Optional) enrich the prompt with a title
      payload.prompt = await addTitle(payload.prompt);

      console.log('🏗️ [Custom Controller] Initializing client...');
      
      // Initialize the OpenRouter client
      const client = initializeClient(payload);
      
      console.log('✅ [Custom Controller] Client initialized successfully');

      // Delegate to your controller
      const controller = new Controller(client);
      await controller(req, res);
    } catch (error) {
      console.error('❌ [Custom Controller] Error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;