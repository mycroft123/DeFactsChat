// api/server/routes/tokenBalance.js
const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

/**
 * GET /api/user/token-balance
 * Returns the token balance for the currently authenticated user
 */
router.get('/api/user/token-balance', async (req, res) => {
  try {
    // Ensure user is authenticated
    if (!req.user) {
      return res.status(401).json({ tokenCredits: 0, error: 'Unauthorized' });
    }

    // Get database instance from app locals or your preferred method
    const db = req.app.locals.mongodb;
    if (!db) {
      return res.status(500).json({ tokenCredits: 0, error: 'Database connection not available' });
    }

    // Get the authenticated user's ID
    const userId = req.user._id;

    // Find the user's balance in the balances collection
    const balance = await db.collection('balances').findOne({
      user: new ObjectId(userId)
    });

    // Return the token credits (or 0 if no balance found)
    // Always include tokenCredits field even in error cases
    return res.json({
      tokenCredits: balance?.tokenCredits || 0
    });
  } catch (error) {
    console.error('Error fetching token balance:', error);
    // Return 0 tokens on error but still include the field
    return res.status(500).json({ 
      tokenCredits: 0,
      error: 'Internal server error' 
    });
  }
});

module.exports = router;
