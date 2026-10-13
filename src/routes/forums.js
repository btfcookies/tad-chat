const express = require('express');
const { KEYS, FORUM_COOLDOWN_MS, FORUM_NAME_MAX } = require('../config');
const { redis, state, isForum } = require('../state');
const { normalize, truncate } = require('../lib/text');
const { accountForRequest } = require('../lib/accounts');
const CONTRIBUTOR_NAMES = require('../../public/contributors');

const router = express.Router();

router.get('/forums', (req, res) => {
  res.json(state.customForums.map(({ id, label, blurb }) => ({ id, label, blurb })));
});

router.post('/forums', async (req, res) => {
  if (state.bannedIps.includes(truncate(req.ip, 100))) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }

  const label = normalize(req.body.forumName).replace(/\s+/g, ' ');
  if (!label || label.length > FORUM_NAME_MAX) {
    return res.status(400).json({ ok: false, error: `Forum name must be between 1 and ${FORUM_NAME_MAX} characters.` });
  }

  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Forum name must contain letters or numbers.' });
  }
  if (isForum(id)) {
    return res.status(409).json({ ok: false, error: 'A forum with that name already exists.' });
  }

  const account = accountForRequest(req);
  const creator = account ? account.username : truncate(req.body.name, 30);
  if (!creator) {
    return res.status(400).json({ ok: false, error: 'Username is required.' });
  }
  const limitKey = (account ? 'account:' : 'name:') + creator.toLowerCase();
  const isAdmin = !!account && CONTRIBUTOR_NAMES.includes(account.username.toLowerCase()); //excessive guardrails lmao

  const now = Date.now();
  const last = state.forumCreations[limitKey];
  if (!isAdmin && typeof last === 'number' && now - last < FORUM_COOLDOWN_MS) {
    const hours = Math.ceil((FORUM_COOLDOWN_MS - (now - last)) / (60 * 60 * 1000));
    return res.status(429).json({
      ok: false,
      error: `You can only create one forum per day. Try again in about ${hours} hour${hours === 1 ? '' : 's'}.`,
    });
  }

  // Update in-memory state before awaiting so concurrent requests see it.
  const forum = { id, label, blurb: 'by ' + creator, createdAt: now };
  const prevCreations = state.forumCreations;
  const prevForums = state.customForums;
  state.forumCreations = { [limitKey]: now };
  for (const [key, time] of Object.entries(prevCreations)) {
    if (key !== limitKey && now - time < FORUM_COOLDOWN_MS) state.forumCreations[key] = time;
  }
  state.customForums = [...prevForums, forum];
  state.forumIds.push(id);
  state.messages[id] = [];

  try {
    await redis.set(KEYS.customForums, state.customForums);
    await redis.set(KEYS.forumCreations, state.forumCreations);
  } catch (err) {
    console.error('Failed to save forum:', err);
    state.forumCreations = prevCreations;
    state.customForums = prevForums;
    state.forumIds.splice(state.forumIds.indexOf(id), 1);
    delete state.messages[id];
    return res.status(500).json({ ok: false, error: 'Could not create forum.' });
  }

  res.json({ ok: true, forum: { id, label, blurb: forum.blurb } });
});

router.get('/activity', (req, res) => {
  const counts = {};
  for (const id of state.forumIds) {
    counts[id] = (state.messages[id] || []).length;
  }
  res.json(counts);
});

module.exports = router;
