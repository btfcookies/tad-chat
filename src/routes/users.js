const express = require('express');
const { state } = require('../state');
const { claimUsername } = require('../lib/accounts');

const router = express.Router();

router.post('/users', async (req, res) => {
  try {
    const result = await claimUsername(req.body.name, req.body.prevName);
    if (!result.ok) {
      return res.status(409).json(result);
    }
    res.json({ ok: true, name: result.name, users: state.users });
  } catch (err) {
    console.error('Failed to claim username:', err);
    res.status(500).json({ ok: false, error: 'Could not save username.' });
  }
});

router.get('/users', (req, res) => {
  res.json(state.users);
});

module.exports = router;
