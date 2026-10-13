const crypto = require('crypto');
const { KEYS, SESSION_COOKIE, SESSION_TTL_MS } = require('../config');
const { redis, state } = require('../state');
const { normalize } = require('./text');

// Accounts and sessions are plain objects keyed by user-influenced strings, so
// every lookup goes through hasOwn ("constructor" or "__proto__" must not match).
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : null);

// Writes to one Redis key are queued so a slow write can never land after a
// newer one. Each write persists whatever the in-memory state is at that moment.
function serialPersist(key, read) {
  let tail = Promise.resolve();
  return () => {
    const run = () => redis.set(key, read());
    const write = tail.then(run, run);
    tail = write.catch(() => {});
    return write;
  };
}

const persistUsers = serialPersist(KEYS.users, () => state.users);
const persistAccounts = serialPersist(KEYS.accounts, () => state.accounts);
const persistSessions = serialPersist(KEYS.sessions, () => state.sessions);

// Canonical form of an account name: trimmed, inner whitespace collapsed.
const canonicalName = (value) => normalize(value).replace(/\s+/g, ' ');
const accountKey = (value) => canonicalName(value).toLowerCase();

function getAccount(name) {
  return own(state.accounts, accountKey(name));
}

async function rememberUser(name) {
  const trimmed = normalize(name);
  if (!trimmed || state.users.includes(trimmed)) return;
  state.users = [...state.users, trimmed];
  await persistUsers();
}

// Check and update happen with no await in between, so two concurrent claims
// for the same name cannot both succeed.
async function claimUsername(rawName, prevName) {
  const name = normalize(rawName);
  if (!name) {
    return { ok: false, error: 'Username cannot be empty.' };
  }

  const lower = name.toLowerCase();
  const takenByOther = state.users.some(
    (u) => u.toLowerCase() === lower && u !== prevName
  );
  if (takenByOther) {
    return { ok: false, error: 'That username is already taken.' };
  }

  const next = prevName ? state.users.filter((u) => u !== prevName) : [...state.users];
  const added = !next.includes(name);
  if (added) next.push(name);
  state.users = next;

  try {
    await persistUsers();
  } catch (err) {
    state.users = state.users.filter((u) => u !== name || !added);
    if (prevName && !state.users.includes(prevName)) state.users = [...state.users, prevName];
    throw err;
  }
  return { ok: true, name };
}

async function releaseUsername(name) {
  if (!state.users.includes(name)) return;
  state.users = state.users.filter((u) => u !== name);
  await persistUsers();
}

const isLive = (session, now) =>
  !!session &&
  typeof session === 'object' &&
  typeof session.username === 'string' &&
  typeof session.createdAt === 'number' &&
  now - session.createdAt < SESSION_TTL_MS;

// Only a hash of the session token is stored, so reading Redis does not hand
// out usable logins.
const sessionId = (token) => crypto.createHash('sha256').update(token).digest('hex');

function cookieOptions(req) {
  return { httpOnly: true, sameSite: 'lax', secure: !!req.secure, path: '/' };
}

function tokenFromRequest(req) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  return typeof token === 'string' && token ? token : null;
}

async function startSession(req, res, lowerUsername) {
  const token = crypto.randomBytes(32).toString('hex');
  const id = sessionId(token);
  const now = Date.now();

  const next = {};
  for (const [existingId, session] of Object.entries(state.sessions)) {
    if (isLive(session, now)) next[existingId] = session;
  }
  next[id] = { username: lowerUsername, createdAt: now };
  state.sessions = next;

  try {
    await persistSessions();
  } catch (err) {
    const { [id]: _removed, ...rest } = state.sessions;
    state.sessions = rest;
    throw err;
  }

  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req), maxAge: SESSION_TTL_MS });
}

async function endSession(req, res) {
  const token = tokenFromRequest(req);
  if (token) {
    const id = sessionId(token);
    if (Object.hasOwn(state.sessions, id)) {
      const { [id]: _removed, ...rest } = state.sessions;
      state.sessions = rest;
      await persistSessions();
    }
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
}

function accountForRequest(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const session = own(state.sessions, sessionId(token));
  if (!isLive(session, Date.now())) return null;
  return own(state.accounts, session.username);
}

// Decides who a request is speaking as. A signed-in user always speaks as their
// account; a signed-out user may not use a name that an account owns.
function resolveSender(req, suppliedName) {
  const account = accountForRequest(req);
  if (account) return { ok: true, name: account.username, account };
  if (getAccount(suppliedName)) {
    return {
      ok: false,
      status: 403,
      error: 'That username belongs to an account. Sign in to use it.',
    };
  }
  return { ok: true, name: suppliedName, account: null };
}

module.exports = {
  canonicalName,
  accountKey,
  getAccount,
  persistAccounts,
  rememberUser,
  claimUsername,
  releaseUsername,
  startSession,
  endSession,
  accountForRequest,
  resolveSender,
};
