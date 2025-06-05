const { CacheKeys } = require('librechat-data-provider');
const getLogStores = require('~/cache/getLogStores');
const { isEnabled } = require('~/server/utils');
const { saveConvo } = require('~/models');

const addTitle = async (req, { text, response, client }) => {
  console.log('[TITLE DEBUG - addTitle] Starting with:', {
    hasClient: !!client,
    clientType: client?.constructor?.name,
    titleConvoOption: client?.options?.titleConvo,
    TITLE_CONVO_ENV: process.env.TITLE_CONVO,
  });

  const { TITLE_CONVO = 'true' } = process.env ?? {};
  if (!isEnabled(TITLE_CONVO)) {
    console.log('[TITLE DEBUG - addTitle] TITLE_CONVO disabled by env');
    return;
  }
  
  if (client.options.titleConvo === false) {
    console.log('[TITLE DEBUG - addTitle] titleConvo disabled in client options');
    return;
  }
  
  console.log('[TITLE DEBUG - addTitle] Proceeding to call client.titleConvo');
  
  try {
    const titleCache = getLogStores(CacheKeys.GEN_TITLE);
    const key = `${req.user.id}-${response.conversationId}`;
    
    console.log('[TITLE DEBUG - addTitle] Calling client.titleConvo with:', {
      text: text?.substring(0, 50),
      responseText: response?.text?.substring(0, 50),
      conversationId: response.conversationId,
    });
    
    const title = await client.titleConvo({
      text,
      responseText: response?.text ?? '',
      conversationId: response.conversationId,
    });
    
    console.log('[TITLE DEBUG - addTitle] Title generated:', title);
    
    await titleCache.set(key, title, 120000);
    await saveConvo(
      req,
      {
        conversationId: response.conversationId,
        title,
      },
      { context: 'api/server/services/Endpoints/openAI/addTitle.js' },
    );
  } catch (error) {
    console.error('[TITLE DEBUG - addTitle] Error:', error.message);
    console.error('[TITLE DEBUG - addTitle] Full error:', error);
  }
};

module.exports = addTitle;