const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { logger } = require('~/config');
const { requireJwtAuth } = require('~/server/middleware');

console.log('=== TOKEN BALANCE MODULE INITIALIZED ===');
console.log('MODULE PATH:', __filename);
console.log('DIRNAME:', __dirname);

// Test route that doesn't require authentication
router.get('/token-balance-public', (req, res) => {
  console.log('PUBLIC TOKEN BALANCE ROUTE HIT');
  logger.info('[Debug] Public token balance route accessed');
  
  return res.json({
    message: 'Public token balance route is working',
    timestamp: new Date().toISOString(),
    path: req.path,
    baseUrl: req.baseUrl,
    originalUrl: req.originalUrl,
    headers: req.headers
  });
});

// Test route for checking MongoDB connection
router.get('/db-test', (req, res) => {
  console.log('DB TEST ROUTE HIT');
  logger.info('[Debug] DB test route accessed');
  
  try {
    const db = req.app.locals.mongodb;
    if (!db) {
      console.log('MongoDB connection NOT AVAILABLE in db-test');
      logger.error('[Debug] MongoDB connection not available in db-test');
      return res.status(500).json({ 
        error: 'MongoDB connection not available',
        app_locals_keys: Object.keys(req.app.locals)
      });
    }
    
    console.log('MongoDB connection AVAILABLE in db-test');
    logger.info('[Debug] MongoDB connection available in db-test');
    
    // Return success without actually querying DB
    return res.json({
      status: 'success',
      message: 'DB connection exists',
      mongo_client_keys: Object.keys(db),
      app_locals_keys: Object.keys(req.app.locals)
    });
  } catch (error) {
    console.error('DB TEST ERROR:', error);
    logger.error(`[Debug] DB test error: ${error.message}`);
    return res.status(500).json({ 
      error: error.message,
      stack: error.stack
    });
  }
});

// Test route that requires authentication but does minimal work
router.get('/auth-test', requireJwtAuth, (req, res) => {
  console.log('AUTH TEST ROUTE HIT');
  logger.info('[Debug] Auth test route accessed');
  
  try {
    return res.json({
      message: 'Authentication successful',
      userInfo: {
        id: req.user?._id,
        email: req.user?.email,
        userKeys: req.user ? Object.keys(req.user) : [],
      }
    });
  } catch (error) {
    console.error('AUTH TEST ERROR:', error);
    logger.error(`[Debug] Auth test error: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /token-balance
 * @desc Get the token balance for the authenticated user
 * @access Private
 */
router.get('/token-balance', requireJwtAuth, async (req, res) => {
  console.log('=== TOKEN BALANCE MAIN ROUTE HIT ===');
  logger.info('[Debug] Token balance route accessed');
  
  // Log request info
  console.log('REQUEST PATH:', req.path);
  console.log('REQUEST BASE URL:', req.baseUrl);
  console.log('REQUEST ORIGINAL URL:', req.originalUrl);
  console.log('REQUEST METHOD:', req.method);
  
  // Log authentication info
  console.log('USER AUTHENTICATED:', !!req.user);
  console.log('USER ID:', req.user?._id);
  console.log('USER EMAIL:', req.user?.email);
  
  try {
    // Log auth info
    logger.info(`[Debug] User authenticated: ${!!req.user}`);
    if (req.user) {
      logger.info(`[Debug] User ID: ${req.user._id}`);
      logger.info(`[Debug] User email: ${req.user.email}`);
      logger.info(`[Debug] User keys: ${Object.keys(req.user).join(', ')}`);
    }
    
    // Get MongoDB connection
    const db = req.app.locals.mongodb;
    console.log('MONGODB CONNECTION:', !!db);
    logger.info(`[Debug] MongoDB connection available: ${!!db}`);
    
    if (!db) {
      console.error('MONGODB NOT AVAILABLE');
      logger.error('[Debug] MongoDB connection not available');
      logger.error(`[Debug] Available app.locals keys: ${Object.keys(req.app.locals).join(', ')}`);
      
      return res.status(500).json({ 
        tokenCredits: 0, 
        error: 'Database connection not available',
        debug: {
          appLocalsKeys: Object.keys(req.app.locals)
        }
      });
    }
    
    // Check if we can access MongoDB collections
    try {
      console.log('CHECKING MONGODB COLLECTIONS');
      logger.info('[Debug] Checking MongoDB collections');
      
      const collections = await db.listCollections().toArray();
      console.log('AVAILABLE COLLECTIONS:', collections.map(c => c.name).join(', '));
      logger.info(`[Debug] Available collections: ${collections.map(c => c.name).join(', ')}`);
      
      // Check if balances collection exists
      const hasBalancesCollection = collections.some(c => c.name === 'balances');
      console.log('BALANCES COLLECTION EXISTS:', hasBalancesCollection);
      logger.info(`[Debug] Balances collection exists: ${hasBalancesCollection}`);
    } catch (dbError) {
      console.error('ERROR CHECKING COLLECTIONS:', dbError);
      logger.error(`[Debug] Error checking collections: ${dbError.message}`);
    }
    
    // Create ObjectId from user ID
    let userId;
    try {
      console.log('CREATING OBJECTID FROM:', req.user._id);
      logger.info(`[Debug] Creating ObjectId from: ${req.user._id}`);
      
      userId = new ObjectId(req.user._id);
      console.log('OBJECTID CREATED:', userId.toString());
      logger.info(`[Debug] ObjectId created: ${userId.toString()}`);
    } catch (error) {
      console.error('OBJECTID CREATION ERROR:', error);
      logger.error(`[Debug] ObjectId creation error: ${error.message}`);
      
      return res.status(500).json({ 
        tokenCredits: 0, 
        error: 'Invalid user ID format',
        debug: {
          userId: req.user._id,
          error: error.message
        }
      });
    }
    
    // Find balance using ObjectId
    console.log('QUERYING BALANCE WITH OBJECTID:', userId.toString());
    logger.info(`[Debug] Querying balance with ObjectId: ${userId.toString()}`);
    
    let balance;
    try {
      balance = await db.collection('balances').findOne({ user: userId });
      console.log('BALANCE QUERY RESULT (OBJECTID):', !!balance);
      logger.info(`[Debug] Balance query result (ObjectId): ${!!balance}`);
      
      if (balance) {
        console.log('FOUND BALANCE (OBJECTID):', balance);
        logger.info(`[Debug] Found balance (ObjectId): ${JSON.stringify(balance)}`);
      }
    } catch (dbError) {
      console.error('BALANCE QUERY ERROR (OBJECTID):', dbError);
      logger.error(`[Debug] Balance query error (ObjectId): ${dbError.message}`);
    }
    
    // If not found with ObjectId, try string ID
    if (!balance) {
      console.log('NO BALANCE FOUND WITH OBJECTID, TRYING STRING ID');
      logger.info('[Debug] No balance found with ObjectId, trying string ID');
      
      const stringId = req.user._id.toString();
      console.log('STRING ID:', stringId);
      logger.info(`[Debug] String ID: ${stringId}`);
      
      try {
        const stringIdBalance = await db.collection('balances').findOne({ 
          user: stringId 
        });
        
        console.log('BALANCE QUERY RESULT (STRING):', !!stringIdBalance);
        logger.info(`[Debug] Balance query result (String): ${!!stringIdBalance}`);
        
        if (stringIdBalance) {
          console.log('FOUND BALANCE (STRING):', stringIdBalance);
          logger.info(`[Debug] Found balance (String): ${JSON.stringify(stringIdBalance)}`);
          balance = stringIdBalance;
        } else {
          console.log('NO BALANCE FOUND WITH STRING ID');
          logger.info('[Debug] No balance found with string ID');
        }
      } catch (dbError) {
        console.error('BALANCE QUERY ERROR (STRING):', dbError);
        logger.error(`[Debug] Balance query error (String): ${dbError.message}`);
      }
    }
    
    // Check for balance collection records count for debugging
    try {
      const balanceCount = await db.collection('balances').countDocuments({});
      console.log('TOTAL BALANCES IN COLLECTION:', balanceCount);
      logger.info(`[Debug] Total balances in collection: ${balanceCount}`);
      
      // If we have balances but not for this user, sample a few for debugging
      if (balanceCount > 0 && !balance) {
        const sampleBalances = await db.collection('balances').find({}).limit(3).toArray();
        console.log('SAMPLE BALANCE DOCUMENT STRUCTURE:', 
          sampleBalances.map(b => ({
            id: b._id?.toString(),
            user: b.user?.toString(),
            keys: Object.keys(b)
          }))
        );
        logger.info(`[Debug] Sample balance document keys: ${sampleBalances.map(b => Object.keys(b).join(', '))}`);
      }
    } catch (countError) {
      console.error('ERROR COUNTING BALANCES:', countError);
      logger.error(`[Debug] Error counting balances: ${countError.message}`);
    }
    
    // Return response
    console.log('SENDING RESPONSE:',
      balance ? { tokenCredits: balance.tokenCredits || 0 } : { tokenCredits: 0 }
    );
    logger.info(`[Debug] Sending response with tokenCredits: ${balance?.tokenCredits || 0}`);
    
    return res.json({
      tokenCredits: balance?.tokenCredits || 0,
      debug: {
        found: !!balance,
        balanceId: balance?._id?.toString(),
        timestamp: new Date().toISOString(),
        userId: req.user._id,
        objectIdUsed: userId.toString()
      }
    });
  } catch (error) {
    console.error('MAIN TOKEN BALANCE ERROR:', error);
    logger.error(`[Debug] Main token balance error: ${error.message}`);
    logger.error(`[Debug] Error stack: ${error.stack}`);
    
    return res.status(500).json({ 
      tokenCredits: 0,
      error: 'Internal server error',
      debug: {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Make sure this route is loaded
console.log('=== TOKEN BALANCE ROUTES REGISTERED ===');
logger.info('[Debug] Token balance routes registered');

module.exports = router;
