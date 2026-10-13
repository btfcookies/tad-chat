const express = require('express');
const { state } = require('../state');
const { claimUsername, getAccount, accountForRequest } = require('../lib/accounts');

const router = express.Router();

router.post('/users', async (req, res) => {
  try {
    const account = accountForRequest(req);
    if (account) {
      const sameName = typeof req.body.name === 'string' && req.body.name.trim() === account.username;
      if (!sameName) {
        return res.status(409).json({ ok: false, error: 'Account usernames cannot be changed.' });
      }
      return res.json({ ok: true, name: account.username, users: state.users });
    }

    if (getAccount(req.body.name)) {
      return res.status(409).json({ ok: false, error: 'That username belongs to an account.' });
    }
    // prevName comes from the client, so it must never be allowed to release an
    // account's name from the user list.
    const prevName = typeof req.body.prevName === 'string' && !getAccount(req.body.prevName)
      ? req.body.prevName
      : null;

    const result = await claimUsername(req.body.name, prevName);
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
