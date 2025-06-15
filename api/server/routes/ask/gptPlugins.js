const express = require('express');
const { getResponseSender, Constants } = require('librechat-data-provider');
const { initializeClient } = require('~/server/services/Endpoints/gptPlugins');
const { sendMessage, createOnProgress } = require('~/server/utils');
const { addTitle } = require('~/server/services/Endpoints/openAI');
const { saveMessage, updateMessage } = require('~/models');
const {
  handleAbort,
  createAbortController,
  handleAbortError,
  setHeaders,
  validateModel,
  validateEndpoint,
  buildEndpointOption,
  moderateText,
} = require('~/server/middleware');
const { validateTools } = require('~/app');
const { logger } = require('~/config');

const router = express.Router();

router.use(moderateText);

// Request scope factory to isolate state per request
const createRequestScope = (requestId, model) => {
  console.log(`🔧 [REQUEST SCOPE] Creating isolated scope for ${requestId} (${model})`);
  
  const plugins = [];
  const pluginMap = new Map();
  let streaming = null;
  let timer = null;
  let isActive = true;
  
  // Request-specific cleanup
  const cleanup = () => {
    console.log(`🧹 [CLEANUP] Cleaning up request scope ${requestId}`);
    isActive = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pluginMap.clear();
    plugins.length = 0;
  };
  
  return {
    requestId,
    model,
    plugins,
    pluginMap,
    streaming,
    timer,
    isActive,
    cleanup,
    // Isolated progress creation
    createProgress: (progressOptions = {}) => {
      console.log(`📊 [PROGRESS] Creating isolated progress for ${requestId}`);
      
      return createOnProgress({
        onProgress: () => {
          if (!isActive) {
            console.log(`⚠️ [PROGRESS] Request ${requestId} is no longer active, skipping progress`);
            return;
          }
          
          if (timer) {
            clearTimeout(timer);
          }

          streaming = new Promise((resolve) => {
            timer = setTimeout(() => {
              if (isActive) {
                resolve();
              }
            }, 250);
          });
        },
        ...progressOptions
      });
    }
  };
};

// Active request tracking
const activeRequests = new Map();

// Request cleanup middleware
const requestCleanup = (req, res, next) => {
  const requestId = req.requestId;
  
  // Cleanup on request end
  const cleanup = () => {
    const scope = activeRequests.get(requestId);
    if (scope) {
      scope.cleanup();
      activeRequests.delete(requestId);
      console.log(`🗑️ [REQUEST END] Cleaned up ${requestId}, active requests: ${activeRequests.size}`);
    }
  };
  
  res.on('close', cleanup);
  res.on('finish', cleanup);
  req.on('aborted', cleanup);
  
  // Cleanup on timeout
  setTimeout(() => {
    if (activeRequests.has(requestId)) {
      console.log(`⏰ [TIMEOUT CLEANUP] Cleaning up stale request ${requestId}`);
      cleanup();
    }
  }, 300000); // 5 minutes timeout
  
  next();
};

router.post(
  '/',
  validateEndpoint,
  validateModel,
  buildEndpointOption,
  setHeaders,
  async (req, res) => {
    // ===== REQUEST ISOLATION SETUP =====
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const model = req.body.endpointOption?.modelOptions?.model || 'unknown';
    const isDefactsModel = ['DeFacts', 'DeNews', 'DeResearch'].includes(model);
    
    req.requestId = requestId;
    
    console.log(`🔐 [REQUEST START] ${requestId}:`, {
      model,
      isDeFacts: isDefactsModel,
      timestamp: new Date().toISOString(),
      activeRequests: activeRequests.size,
      endpoint: req.body.endpointOption?.endpoint,
      conversationId: req.body.conversationId,
    });
    
    // Create isolated request scope
    const requestScope = createRequestScope(requestId, model);
    activeRequests.set(requestId, requestScope);
    
    // Add staggered delay for DeFacts models to prevent race conditions
    if (isDefactsModel) {
      const delay = Math.floor(Math.random() * 1000) + 500; // 500-1500ms random delay
      console.log(`⏱️ [DEFACTS DELAY] Adding ${delay}ms staggered delay for ${model} to prevent interference`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Check if request is still active after delay
      if (!requestScope.isActive) {
        console.log(`⚠️ [DEFACTS DELAY] Request ${requestId} was cancelled during delay`);
        return;
      }
    }
    
    // Setup request cleanup
    requestCleanup(req, res, () => {});
    
    // ===== EXISTING LOGIC WITH ISOLATED STATE =====
    let {
      text,
      endpointOption,
      conversationId,
      parentMessageId = null,
      overrideParentMessageId = null,
    } = req.body;

    logger.debug('[/ask/gptPlugins]', { 
      requestId, 
      text: text?.substring(0, 100) + '...', 
      conversationId, 
      model,
      ...endpointOption 
    });

    let userMessage;
    let userMessagePromise;
    let promptTokens;
    let userMessageId;
    let responseMessageId;
    const sender = getResponseSender({
      ...endpointOption,
      model: endpointOption.modelOptions.model,
    });
    const newConvo = !conversationId;
    const user = req.user.id;

    // Use isolated plugins from request scope
    const { plugins, pluginMap } = requestScope;

    const getReqData = (data = {}) => {
      for (let key in data) {
        if (key === 'userMessage') {
          userMessage = data[key];
          userMessageId = data[key].messageId;
        } else if (key === 'userMessagePromise') {
          userMessagePromise = data[key];
        } else if (key === 'responseMessageId') {
          responseMessageId = data[key];
        } else if (key === 'promptTokens') {
          promptTokens = data[key];
        } else if (!conversationId && key === 'conversationId') {
          conversationId = data[key];
        }
      }
    };

    // Create isolated progress callbacks
    const {
      onProgress: progressCallback,
      sendIntermediateMessage,
      getPartialText,
    } = requestScope.createProgress();

    const onAgentAction = async (action, runId) => {
      if (!requestScope.isActive) {
        console.log(`⚠️ [AGENT ACTION] Request ${requestId} is no longer active, skipping`);
        return;
      }
      
      pluginMap.set(runId, action.tool);
      sendIntermediateMessage(res, {
        plugins,
        parentMessageId: userMessage.messageId,
        messageId: responseMessageId,
      });
    };

    const onToolStart = async (tool, input, runId, parentRunId) => {
      if (!requestScope.isActive) {
        console.log(`⚠️ [TOOL START] Request ${requestId} is no longer active, skipping`);
        return;
      }
      
      const pluginName = pluginMap.get(parentRunId);
      const latestPlugin = {
        runId,
        loading: true,
        inputs: [input],
        latest: pluginName,
        outputs: null,
      };

      if (requestScope.streaming) {
        await requestScope.streaming;
      }
      const extraTokens = ':::plugin:::\n';
      plugins.push(latestPlugin);
      sendIntermediateMessage(
        res,
        { plugins, parentMessageId: userMessage.messageId, messageId: responseMessageId },
        extraTokens,
      );
    };

    const onToolEnd = async (output, runId) => {
      if (!requestScope.isActive) {
        console.log(`⚠️ [TOOL END] Request ${requestId} is no longer active, skipping`);
        return;
      }
      
      if (requestScope.streaming) {
        await requestScope.streaming;
      }

      const pluginIndex = plugins.findIndex((plugin) => plugin.runId === runId);

      if (pluginIndex !== -1) {
        plugins[pluginIndex].loading = false;
        plugins[pluginIndex].outputs = output;
      }
    };

    const getAbortData = () => ({
      sender,
      conversationId,
      userMessagePromise,
      messageId: responseMessageId,
      parentMessageId: overrideParentMessageId ?? userMessageId,
      text: getPartialText(),
      plugins: plugins.map((p) => ({ ...p, loading: false })),
      userMessage,
      promptTokens,
    });
    
    const { abortController, onStart } = createAbortController(req, res, getAbortData, getReqData);

    try {
      endpointOption.tools = await validateTools(user, endpointOption.tools);
      const { client } = await initializeClient({ req, res, endpointOption });

      // DEBUG: Log client initialization
      console.log(`[CLIENT INIT] ${requestId}:`, {
        clientType: client?.constructor?.name,
        hasGenerateTitle: typeof client?.generateTitle === 'function',
        titleConvo: client?.options?.titleConvo,
        titleModel: client?.options?.titleModel,
        model: model,
      });

      const onChainEnd = () => {
        if (!requestScope.isActive) {
          console.log(`⚠️ [CHAIN END] Request ${requestId} is no longer active, skipping save`);
          return;
        }
        
        if (!client.skipSaveUserMessage) {
          saveMessage(
            req,
            { ...userMessage, user },
            { context: `api/server/routes/ask/gptPlugins.js - onChainEnd - ${requestId}` },
          );
        }
        sendIntermediateMessage(res, {
          plugins,
          parentMessageId: userMessage.messageId,
          messageId: responseMessageId,
        });
      };

      // Enhanced sendMessage with request isolation
      console.log(`📤 [SEND MESSAGE] ${requestId}: Starting message processing for ${model}`);
      
      let response = await client.sendMessage(text, {
        user,
        conversationId,
        parentMessageId,
        overrideParentMessageId,
        getReqData,
        onAgentAction,
        onChainEnd,
        onToolStart,
        onToolEnd,
        onStart,
        getPartialText,
        ...endpointOption,
        progressCallback,
        progressOptions: {
          res,
          plugins,
          requestId: requestId, // Pass request ID for tracking
        },
        abortController,
      });

      // Check if request is still active before processing response
      if (!requestScope.isActive) {
        console.log(`⚠️ [RESPONSE] Request ${requestId} was cancelled, not processing response`);
        return;
      }

      if (overrideParentMessageId) {
        response.parentMessageId = overrideParentMessageId;
      }

      console.log(`📥 [RESPONSE] ${requestId}:`, {
        model,
        hasText: !!response.text,
        textLength: response.text?.length || 0,
        messageId: response.messageId,
        conversationId: response.conversationId,
      });

      const { conversation = {} } = await response.databasePromise;
      delete response.databasePromise;
      conversation.title =
        conversation && !conversation.title ? null : conversation?.title || 'New Chat';

      // Enhanced final message sending with request tracking
      console.log(`📨 [FINAL MESSAGE] ${requestId}: Sending final response for ${model}`);
      
      // Add delay for DeFacts models before sending final message
      if (isDefactsModel) {
        const finalDelay = 1000; // 1 second delay for DeFacts final message
        console.log(`⏱️ [DEFACTS FINAL DELAY] Adding ${finalDelay}ms delay before final message`);
        await new Promise(resolve => setTimeout(resolve, finalDelay));
        
        // Double-check request is still active
        if (!requestScope.isActive) {
          console.log(`⚠️ [FINAL MESSAGE] Request ${requestId} was cancelled during final delay`);
          return;
        }
      }

      sendMessage(res, {
        title: conversation.title,
        final: true,
        conversation,
        requestMessage: userMessage,
        responseMessage: response,
        requestId: requestId, // Include request ID for frontend tracking
      });
      res.end();

      // DEBUG: Title generation check
      console.log(`[TITLE DEBUG] ${requestId}:`, {
        parentMessageId,
        NO_PARENT: Constants.NO_PARENT,
        isNoParent: parentMessageId === Constants.NO_PARENT,
        newConvo,
        hasClient: !!client,
        clientType: client?.constructor?.name,
        willGenerateTitle: parentMessageId === Constants.NO_PARENT && newConvo,
        conversationTitle: conversation?.title,
        model,
      });

      if (parentMessageId === Constants.NO_PARENT && newConvo) {
        console.log(`[TITLE GENERATION] ${requestId}: Generating title for ${model}...`);
        try {
          await addTitle(req, {
            text,
            response,
            client,
          });
          console.log(`[TITLE GENERATION] ${requestId}: Title generated successfully`);
        } catch (error) {
          console.error(`[TITLE GENERATION] ${requestId}: Error generating title:`, error);
        }
      }

      response.plugins = plugins.map((p) => ({ ...p, loading: false }));
      if (response.plugins?.length > 0) {
        await updateMessage(
          req,
          { ...response, user },
          { context: `api/server/routes/ask/gptPlugins.js - save plugins used - ${requestId}` },
        );
      }

      console.log(`✅ [REQUEST COMPLETE] ${requestId}: Successfully processed ${model} request`);
      
    } catch (error) {
      console.error(`❌ [REQUEST ERROR] ${requestId}:`, {
        model,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'),
      });
      
      const partialText = getPartialText();
      handleAbortError(res, req, error, {
        partialText,
        conversationId,
        sender,
        messageId: responseMessageId,
        parentMessageId: userMessageId ?? parentMessageId,
        requestId: requestId,
      });
    } finally {
      // Cleanup will be handled by the middleware
      console.log(`🏁 [REQUEST FINALLY] ${requestId}: Request processing complete`);
    }
  },
);

// Health check endpoint for monitoring
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeRequests: activeRequests.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0-race-condition-fixed'
  });
});

module.exports = router;