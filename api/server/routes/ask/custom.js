const express = require('express');
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
  // Middleware to inject OpenRouter key
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
                          endpoint === 'custom' || // Add this check
                          model?.includes('perplexity') ||
                          req.body.chatGptLabel?.includes('OpenRouter');
      
      console.log('🤔 [Custom Route] Is OpenRouter request?', isOpenRouter);
      
      // Load your Railway secret (uppercase)
      const openRouterKey = process.env.OPENROUTER_KEY;
      if (!openRouterKey) {
        console.error('❌ [Custom Route] Missing OPENROUTER_KEY in environment');
        // Don't throw error here, let initializeClient handle it
      }
      
      if (openRouterKey) {
        console.log('✅ [Custom Route] OpenRouter key found in env:', openRouterKey.substring(0, 20) + '...');
      }
      
      // Override any user-supplied key for OpenRouter requests
      if (isOpenRouter && openRouterKey) {
        console.log('🔄 [Custom Route] Overriding key for OpenRouter request');
        // Set the key to 'never' to bypass user key check
        req.body.key = 'never';
        // Store the actual API key in a different property
        req.openRouterApiKey = openRouterKey;
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
        },
      });
      
      console.log('✅ [Custom Controller] Client initialized successfully');
      
      const controller = new Controller();
      
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
        abortController: controller,
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