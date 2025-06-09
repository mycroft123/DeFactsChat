const express = require('express');
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
  // Middleware to inject OpenRouter key
  async (req, res, next) => {
    try {
      console.log('🎯 [CUSTOM ROUTE] Request for model:', req.body.model);
      console.log('📋 [CUSTOM ROUTE] Endpoint:', req.body.endpoint);
      console.log('🔑 [CUSTOM ROUTE] Key status:', req.body.key === 'never' ? 'never' : 'has value');
      
      // Check if this is an OpenRouter/Perplexity request
      if (req.body.model?.includes('perplexity') || 
          req.body.spec === 'OpenRouter' ||
          req.body.chatGptLabel?.includes('OpenRouter') ||
          req.body.modelLabel?.includes('Perplexity')) {
        
        // Get the OpenRouter key from environment
        const openRouterKey = process.env.OPENROUTER_KEY;
        
        if (!openRouterKey) {
          console.error('❌ [CUSTOM ROUTE] OPENROUTER_KEY not found in environment');
        } else if (req.body.key === 'never') {
          console.log('🔄 [CUSTOM ROUTE] Injecting OpenRouter API key');
          // Simply replace the key
          req.body.key = openRouterKey;
        }
      }
      
      next();
    } catch (error) {
      console.error('❌ [CUSTOM ROUTE] Error:', error);
      next(error);
    }
  },
  async (req, res) => {
    try {
      console.log('🎯 [CUSTOM CONTROLLER DEBUG] ==================');
      console.log('📋 [Custom Controller] Starting request processing');
      
      const { text, conversationId, parentMessageId, ...rest } = req.body;
      
      // Ensure we have message content
      if (!text) {
        console.error('❌ [Custom Controller] Missing text in request body');
        return res.status(400).json({ error: 'Message text is required' });
      }
      
      let responseMessage = {
        conversationId,
        parentMessageId: parentMessageId || '00000000-0000-0000-0000-000000000000',
        sender: 'Assistant',
        text: '',
        isCreatedByUser: false,
        error: false,
      };
      
      console.log('🏗️ [Custom Controller] Initializing client...');
      console.log('📍 [Custom Controller] Using endpoint:', req.body.endpoint);
      
      // Initialize client with proper structure
      const { client, openAIApiKey } = await initializeClient({
        req,
        res,
        endpointOption: {
          model_parameters: {
            model: req.body.model,
            temperature: req.body.temperature || 0.7,
            max_tokens: req.body.max_tokens || 2048,
          },
          ...rest
        }
      });
      
      console.log('✅ [Custom Controller] Client initialized successfully');
      
      // Set up SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      
      // Create the onProgress handler
      const onProgress = (token) => {
        if (token === '[DONE]') {
          return;
        }
        responseMessage.text += token;
        sendMessage(res, {
          message: responseMessage,
          created: true,
        });
      };
      
      // Build messages array
      const messages = [
        {
          role: 'user',
          content: text,
        }
      ];
      
      // Add system message if there's a prompt prefix
      if (req.body.promptPrefix) {
        messages.unshift({
          role: 'system',
          content: req.body.promptPrefix,
        });
      }
      
      // Generate the response
      const response = await client.sendMessage(text, {
        conversationId,
        parentMessageId,
        onProgress,
      });
      
      // Save the conversation and messages
      if (response.conversationId) {
        await saveMessage(req, {
          ...responseMessage,
          conversationId: response.conversationId,
          text: response.text,
          unfinished: false,
        });
        
        // Generate title if needed
        if (!req.body.title) {
          const title = await getConvoTitle(req.user.id, response.conversationId);
          if (!title) {
            await addTitle(req, {
              text,
              conversationId: response.conversationId,
              client,
            });
          }
        }
      }
      
      // Send final response
      sendMessage(res, {
        final: true,
        conversation: await getConvo(req.user.id, response.conversationId),
        requestMessage: {
          conversationId: response.conversationId,
          parentMessageId,
          text,
          sender: 'User',
          isCreatedByUser: true,
        },
        responseMessage: {
          ...responseMessage,
          conversationId: response.conversationId,
          text: response.text,
        },
      });
      
    } catch (error) {
      console.error('❌ [Custom Controller] Error:', error);
      const errorMessage = {
        sender: 'Assistant',
        text: `Error: ${error.message}`,
        error: true,
      };
      sendMessage(res, errorMessage);
      res.end();
    }
  }
);

module.exports = router;