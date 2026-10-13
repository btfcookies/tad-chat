const express = require('express');
const bcrypt = require('bcryptjs');
const { KEYS } = require('../config');
const { redis, state } = require('../state');
const { normalize, truncate } = require('../lib/text');
const { claimUsername, startSession } = require('../lib/accounts');

const router = express.Router();

router.post('/auth/signup', async (req, res) => {
  const username = normalize(req.body.username);
  const school = truncate(req.body.school, 50);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!username || username.length > 30) {
    return res.status(400).json({ ok: false, error: 'Username must be between 1 and 30 characters' });
  }

  if (!school) {
    return res.status(400).json({ ok: false, error: 'School is required' });
  }

  if (!password) {
    return res.status(400).json({ ok: false, error: 'Password is required' });
  }

  const lower = username.toLowerCase();
  if (state.accounts[lower]) {
    return res.status(409).json({ ok: false, error: 'Username is already taken' });
  }

  const claim = await claimUsername(username, null);
  if (!claim.ok) {
    return res.status(409).json(claim);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  state.accounts[lower] = { username, passwordHash, school, verified: false };
  await redis.set(KEYS.accounts, state.accounts);

  await startSession(res, lower);
  res.json({ ok: true, username, school, verified: false });
});

router.post('/auth/login', async (req, res) => {
  const username = normalize(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const account = state.accounts[username.toLowerCase()];

  if (!account || !password || !(await bcrypt.compare(password, account.passwordHash))) {
    return res.status(401).json({ ok: false, error: 'Wrong username or password' });
  }

  await startSession(res, username.toLowerCase());
  res.json({ ok: true, username: account.username, school: account.school, verified: account.verified });
});

module.exports = router;
