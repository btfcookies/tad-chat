const express = require('express');
const crypto = require('crypto');
const { KEYS, ADMIN_SESSION_COOKIE } = require('../config');
const { redis, state } = require('../state');
const { truncate } = require('../lib/text');
const {
  adminSessions,
  parseCookies,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  requireAdmin,
} = require('../middleware/admin');
const { rateLimited, clearRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/admin/login', (req, res) => {
  if (rateLimited(req)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  const token = req.body.token;
  const expected = process.env.ADMIN_TOKEN;
  if (typeof token !== 'string' || !token || !expected || token !== expected) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }

  clearRateLimit(req);
  const sessionId = crypto.randomBytes(32).toString('hex');
  adminSessions.set(sessionId, { createdAt: Date.now() });
  setAdminSessionCookie(req, res, sessionId);
  res.json({ ok: true });
});

router.post('/admin/logout', (req, res) => {
  const sessionId = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (sessionId) adminSessions.delete(sessionId);
  clearAdminSessionCookie(req, res);
  res.json({ ok: true });
});

router.post('/admin/ban', requireAdmin, async (req, res) => {
  const ip = truncate(req.body.ip, 100);
  if (!ip) {
    return res.status(400).json({ ok: false, error: 'ip is required.' });
  }
  if (!state.bannedIps.includes(ip)) {
    const next = [...state.bannedIps, ip];
    await redis.set(KEYS.bannedIps, next);
    state.bannedIps = next;
  }
  res.json({ ok: true, bannedIps: state.bannedIps });
});

router.post('/admin/unban', requireAdmin, async (req, res) => {
  const ip = truncate(req.body.ip, 100);
  const next = state.bannedIps.filter((banned) => banned !== ip);
  await redis.set(KEYS.bannedIps, next);
  state.bannedIps = next;
  res.json({ ok: true, bannedIps: state.bannedIps });
});

router.get('/admin/banned', requireAdmin, (req, res) => {
  res.json({ ok: true, bannedIps: state.bannedIps });
});

module.exports = router;
