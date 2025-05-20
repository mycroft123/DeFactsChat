// api/server/routes/tokenBalance.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { logger } = require('~/config');
const passport = require('passport');
const { requireJwtAuth } = require('~/server/middleware');

/**
 * Custom diagnostic middleware to see what's happening during authentication
 */
const authDiagnostic = (req, res, next) => {
  logger.info('=== AUTH DIAGNOSTIC START ===');
  logger.info(`Request URL: ${req.originalUrl}`);
  logger.info(`Auth header present: ${!!req.headers.authorization}`);
  logger.info(`Cookie count: ${Object.keys(req.cookies || {}).length}`);
  logger.info(`Cookie names: ${Object.keys(req.cookies || {}).join(', ')}`);
  logger.info(`User on request: ${!!req.user}`);
  
  // Log some info about the request
  logger.info(`Request method: ${req.method}`);
  logger.info(`Request IP: ${req.ip}`);
  logger.info(`User agent: ${req.headers['user-agent']}`);
  
  // Call next middleware in the chain
  logger.info('=== AUTH DIAGNOSTIC END ===');
  next();
};

/**
 * Version 1: Using your existing requireJwtAuth middleware
 */
router.get('/token-balance-auth-test', authDiagnostic, requireJwtAuth, (req, res) => {
  // If we get here, auth was successful
  logger.info('Auth successful with requireJwtAuth!');
  res.json({
    message: 'Authentication successful with requireJwtAuth',
    user: {
      id: req.user._id,
      email: req.user.email
    }
  });
});

/**
 * Version 2: Using passport directly with inline callback
 */
router.get('/token-balance-passport-test', authDiagnostic, (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) {
      logger.error(`Passport auth error: ${err.message}`);
      return res.status(500).json({ error: 'Auth error', message: err.message });
    }
    
    if (!user) {
      logger.warn(`Passport auth failed: ${info ? info.message : 'No user'}`);
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: info ? info.message : 'Authentication failed',
        info: info
      });
    }
    
    // Success!
    logger.info('Auth successful with inline passport!');
    return res.json({
      message: 'Authentication successful with inline passport',
      user: {
        id: user._id,
        email: user.email
      }
    });
  })(req, res, next);
});

/**
 * Version 3: Using the original token balance endpoint 
 */
router.get('/token-balance', authDiagnostic, requireJwtAuth, async (req, res) => {
  try {
    logger.info(`[Token Balance] Request for user: ${req.user.email} (${req.user._id})`);
    
    // Get MongoDB connection from app locals
    const db = req.app.locals.mongodb;
    if (!db) {
      logger.error('[Token Balance] MongoDB connection not available');
      return res.status(500).json({ tokenCredits: 0, error: 'Database connection not available' });
    }

    // Create ObjectId from user ID (handle both string and ObjectId formats)
    let userId;
    try {
      // If the ID is already an ObjectId, this will still work
      userId = new ObjectId(req.user._id);
    } catch (error) {
      logger.error(`[Token Balance] Error converting user ID to ObjectId: ${error.message}`);
      return res.status(500).json({ tokenCredits: 0, error: 'Invalid user ID format' });
    }

    // Find the user's balance in the balances collection
    const balance = await db.collection('balances').findOne({ user: userId });
    
    if (balance) {
      logger.info(`[Token Balance] Found balance: ${balance.tokenCredits} tokens`);
      return res.json({
        tokenCredits: balance.tokenCredits || 0
      });
    } else {
      logger.info('[Token Balance] No balance found with ObjectId, trying string ID');
      
      // Try using the string version of the ID as fallback
      const stringIdBalance = await db.collection('balances').findOne({ 
        user: req.user._id.toString() 
      });
      
      if (stringIdBalance) {
        logger.info(`[Token Balance] Found balance with string ID: ${stringIdBalance.tokenCredits} tokens`);
        return res.json({
          tokenCredits: stringIdBalance.tokenCredits || 0
        });
      } else {
        logger.info('[Token Balance] No balance found with either ID format');
        return res.json({ tokenCredits: 0 });
      }
    }
  } catch (error) {
    logger.error(`[Token Balance] Server error: ${error.message}`);
    return res.status(500).json({ 
      tokenCredits: 0,
      error: 'Internal server error' 
    });
  }
});

/**
 * Version 4: A public endpoint for testing
 */
router.get('/token-balance-public', authDiagnostic, (req, res) => {
  // Just for comparison - send back info about the request
  res.json({
    message: 'This is the public endpoint (no auth required)',
    hasUser: !!req.user,
    cookies: Object.keys(req.cookies || {}),
    hasAuthHeader: !!req.headers.authorization
  });
});

module.exports = router;
