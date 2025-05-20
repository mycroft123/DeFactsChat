// api/server/routes/tokenBalance.js

const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { logger } = require('~/config');
const { requireJwtAuth } = require('~/server/middleware');

/**
 * @route GET /token-balance
 * @desc Get the token balance for the authenticated user
 * @access Private
 */
router.get('/token-balance', requireJwtAuth, async (req, res) => {
  try {
    // User is guaranteed to be authenticated due to requireJwtAuth middleware
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

    logger.info(`[Token Balance] Looking up balance for user ID: ${userId}`);

    // Find the user's balance in the balances collection
    const balance = await db.collection('balances').findOne({ user: userId });
    
    if (balance) {
      logger.info(`[Token Balance] Found balance: ${balance.tokenCredits} tokens`);
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
      }
    }

    // Return the token balance (or 0 if not found)
    return res.json({
      tokenCredits: balance?.tokenCredits || 0
    });
  } catch (error) {
    logger.error(`[Token Balance] Server error: ${error.message}`);
    return res.status(500).json({ 
      tokenCredits: 0,
      error: 'Internal server error' 
    });
  }
});

module.exports = router;
