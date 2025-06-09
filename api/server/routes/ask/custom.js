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
  // Middleware to handle OpenRouter requests
  async (req, res, next) => {
    try {
      console.log('🎯 [CUSTOM ROUTE DEBUG] ==================');
      console.log('📋 [Custom Route] Full request body:', JSON.stringify(req.body, null, 2));
      
      // The payload clearly has text field, so let's check other required fields
      const requiredFields = ['text', 'endpoint', 'model'];
      const missingFields = requiredFields.filter(field => !req.body[field]);
      
      if (missingFields.length > 0) {
        console.error('❌ [Custom Route] Missing required fields:', missingFields);
      }
      
      const { endpoint, spec, model, key } = req.body;
      
      // Check if this is an OpenRouter request
      const isOpenRouter = spec === 'OpenRouter' ||
                          endpoint === 'OpenRouter' ||
                          model?.includes('perplexity') ||
                          req.body.chatGptLabel?.includes('OpenRouter');
      
      console.log('🤔 [Custom Route] Request details:', {
        isOpenRouter,
        endpoint,
        spec,
        model,
        key: key === 'never' ? 'never' : 'exists'
      });
      
      // Load your Railway secret
      const openRouterKey = process.env.OPENROUTER_KEY;
      if (!openRouterKey && isOpenRouter) {
        console.error('❌ [Custom Route] Missing OPENROUTER_KEY in environment');
        throw new Error('Missing OPENROUTER_KEY in environment');
      }
      
      // Override the "never" key for OpenRouter requests
      if (isOpenRouter && openRouterKey) {
        console.log('🔄 [Custom Route] Replacing key "never" with actual OpenRouter key');
        req.body.key = openRouterKey;
      }
      
      console.log('📤 [Custom Route] Proceeding with key:', 
        req.body.key ? req.body.key.substring(0, 20) + '...' : 'NO KEY');
      
      next();
    } catch (error) {
      console.error('❌ [Custom Route] Middleware error:', error);
      res.status(500).json({ error: error.message });
    }
  },
  async (req, res) => {
    try {
      console.log('🎯 [CUSTOM CONTROLLER] ==================');
      
      // Log exactly what we're passing to initializeClient
      console.log('📦 [Controller] req.body has these keys:', Object.keys(req.body));
      console.log('📦 [Controller] req.user:', req.user ? { id: req.user.id, hasUser: true } : 'NO USER');
      
      if (!req.user || !req.user.id) {
        throw new Error('User not authenticated');
      }
      
      // Build the payload - let's see exactly what we're building
      const payload = {
        ...req.body,
        user: req.user.id,
      };
      
      console.log('🏗️ [Controller] Payload for initializeClient:', {
        hasText: !!payload.text,
        text: payload.text?.substring(0, 50) + '...',
        endpoint: payload.endpoint,
        spec: payload.spec,
        model: payload.model,
        user: payload.user,
        allKeys: Object.keys(payload)
      });
      
      // Try to add title - this might be where the error occurs
      try {
        if (payload.text) {
          console.log('📝 [Controller] Adding title to text...');
          payload.prompt = await addTitle(payload.text);
          console.log('✅ [Controller] Title added successfully');
        }
      } catch (titleError) {
        console.error('❌ [Controller] Error in addTitle:', titleError);
        // Continue without title
        payload.prompt = payload.text;
      }
      
      console.log('🏗️ [Controller] About to initialize client...');
      
      // This is likely where the error occurs
      let client;
      try {
        client = initializeClient(payload);
        console.log('✅ [Controller] Client initialized successfully');
      } catch (clientError) {
        console.error('❌ [Controller] Error in initializeClient:', clientError);
        console.error('❌ [Controller] Error stack:', clientError.stack);
        throw clientError;
      }
      
      // Try to create controller
      try {
        console.log('🎮 [Controller] Creating controller...');
        const controller = new Controller(client);
        console.log('✅ [Controller] Controller created, executing...');
        await controller(req, res);
      } catch (controllerError) {
        console.error('❌ [Controller] Error in Controller execution:', controllerError);
        console.error('❌ [Controller] Error stack:', controllerError.stack);
        throw controllerError;
      }
    } catch (error) {
      console.error('❌ [Controller] Final error:', error.message);
      console.error('❌ [Controller] Full error:', error);
      res.status(500).json({ 
        error: error.message,
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          body: req.body ? Object.keys(req.body) : 'no body'
        } : undefined
      });
    }
  }
);

module.exports = router;