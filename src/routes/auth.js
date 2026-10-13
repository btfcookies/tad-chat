const express = require('express');
const bcrypt = require('bcryptjs');
const {
  USERNAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX_BYTES,
  SCHOOLS,
  LOGIN_IP_MAX_FAILURES,
  LOGIN_IP_WINDOW_MS,
  LOGIN_USER_MAX_FAILURES,
  LOGIN_USER_WINDOW_MS,
  SIGNUP_MAX_PER_IP,
  SIGNUP_WINDOW_MS,
} = require('../config');
const { state } = require('../state');
const { truncate } = require('../lib/text');
const {
  canonicalName,
  accountKey,
  getAccount,
  persistAccounts,
  claimUsername,
  releaseUsername,
  startSession,
  endSession,
  accountForRequest,
} = require('../lib/accounts');
const { createLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const BCRYPT_ROUNDS = 10;
// Compared against when the account doesn't exist, so a login attempt takes the
// same time whether or not the username is registered.
const DUMMY_HASH = bcrypt.hashSync('no-such-account', BCRYPT_ROUNDS);

const signupLimiter = createLimiter({ max: SIGNUP_MAX_PER_IP, windowMs: SIGNUP_WINDOW_MS });
const loginIpLimiter = createLimiter({ max: LOGIN_IP_MAX_FAILURES, windowMs: LOGIN_IP_WINDOW_MS });
const loginUserLimiter = createLimiter({ max: LOGIN_USER_MAX_FAILURES, windowMs: LOGIN_USER_WINDOW_MS });

// Names currently being created. Reserved before the first await so two
// simultaneous signups for one name cannot both get through.
const pendingSignups = new Set();

const ipKey = (req) => truncate(req.ip, 100);
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;

const publicAccount = (account) => ({
  username: account.username,
  school: account.school,
  verified: account.verified,
});

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

router.post('/auth/signup', async (req, res) => {
  const ip = ipKey(req);
  if (signupLimiter.isBlocked(ip)) {
    return fail(res, 429, 'Too many accounts created from this network. Try again later.');
  }
  signupLimiter.record(ip);

  const username = canonicalName(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const school = typeof req.body.school === 'string' && Object.hasOwn(SCHOOLS, req.body.school)
    ? req.body.school
    : null;

  if (!username || username.length > USERNAME_MAX) {
    return fail(res, 400, `Username must be between 1 and ${USERNAME_MAX} characters`);
  }
  if (INVISIBLE_OR_CONTROL.test(username)) {
    return fail(res, 400, 'Username contains characters that are not allowed');
  }
  if (!school) {
    return fail(res, 400, 'School is required');
  }
  if (password.length < PASSWORD_MIN) {
    return fail(res, 400, `Password must be at least ${PASSWORD_MIN} characters`);
  }
  if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) {
    return fail(res, 400, 'Password is too long');
  }

  const lower = accountKey(username);
  if (pendingSignups.has(lower) || getAccount(username)) {
    return fail(res, 409, 'Username is already taken');
  }
  pendingSignups.add(lower);

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const claim = await claimUsername(username, null);
    if (!claim.ok) {
      return fail(res, 409, 'Username is already taken');
    }

    const account = { username, passwordHash, school, verified: false };
    state.accounts = { ...state.accounts, [lower]: account };
    try {
      await persistAccounts();
    } catch (err) {
      const { [lower]: _removed, ...rest } = state.accounts;
      state.accounts = rest;
      await releaseUsername(username).catch(() => {});
      throw err;
    }

    await startSession(req, res, lower);
    res.json({ ok: true, ...publicAccount(account) });
  } catch (err) {
    console.error('Failed to create account:', err);
    if (!res.headersSent) fail(res, 500, 'Could not create account.');
  } finally {
    pendingSignups.delete(lower);
  }
});

router.post('/auth/login', async (req, res) => {
  const ip = ipKey(req);
  const lower = accountKey(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (loginIpLimiter.isBlocked(ip) || (lower && loginUserLimiter.isBlocked(lower))) {
    return fail(res, 429, 'Too many attempts. Try again later.');
  }

  try {
    const account = getAccount(lower);
    const matches = await bcrypt.compare(password, account ? account.passwordHash : DUMMY_HASH);

    if (!account || !password || !matches) {
      loginIpLimiter.record(ip);
      // Only tracked for real accounts so an attacker can't grow this table by
      // guessing names that don't exist (the per-IP limit still applies to those).
      if (account) loginUserLimiter.record(lower);
      return fail(res, 401, 'Wrong username or password');
    }

    loginUserLimiter.reset(lower);
    await startSession(req, res, lower);
    res.json({ ok: true, ...publicAccount(account) });
  } catch (err) {
    console.error('Failed to log in:', err);
    if (!res.headersSent) fail(res, 500, 'Could not sign in.');
  }
});

router.post('/auth/logout', async (req, res) => {
  try {
    await endSession(req, res);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to log out:', err);
    if (!res.headersSent) fail(res, 500, 'Could not sign out.');
  }
});

// Answers 200 either way: a signed-out visitor is a normal state, not an error.
router.get('/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const account = accountForRequest(req);
  if (!account) return res.json({ ok: false });
  res.json({ ok: true, ...publicAccount(account) });
});

module.exports = router;
