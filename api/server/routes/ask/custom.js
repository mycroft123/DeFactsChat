// server/routes/ask.js

const express = require('express');
const AskController = require('~/server/controllers/AskController');
const { initializeClient } = require('~/server/services/Endpoints/custom');
const { addTitle } = require('~/server/services/Endpoints/openAI');
const {
  setHeaders,
  validateModel,
  validateEndpoint,
  buildEndpointOption,
} = require('~/server/middleware');

const router = express.Router();

router.post(
  '/',
  validateEndpoint,
  validateModel,
  buildEndpointOption,
  setHeaders,
  async (req, res, next) => {
    try {
      // Load your Railway secret (uppercase)
      const openRouterKey = process.env.OPENROUTER_KEY;
      if (!openRouterKey) {
        throw new Error('Missing OPENROUTER_KEY in environment');
      }

      // Override any user-supplied key
      req.body.key = openRouterKey;

      // Build the payload
      const payload = {
        ...req.body,
        endpoint: req.endpoint,
        model: req.model,
      };

      // (Optional) enrich the prompt with a title
      payload.prompt = await addTitle(payload.prompt);

      // Initialize the OpenRouter client
      const client = initializeClient(payload);

      // Delegate to your controller
      const result = await AskController.handle(client, payload);

      return res.json(result);
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
