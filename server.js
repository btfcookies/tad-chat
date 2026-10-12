const express = require('express');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(express.static('public'));
const redis = Redis.fromEnv();
const USERS_KEY = 'users';
const ACCOUNTS_KEY = 'accounts';
const SESSIONS_KEY = 'sessions';
const BANNED_IPS_KEY = 'banned_ips';
const CUSTOM_FORUMS_KEY = 'custom_forums';
const FORUM_CREATIONS_KEY = 'forum_creations';
const FORUM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FORUM_NAME_MAX = 40;
let bannedIps = [];
const forum_ids = ['general-discussion','math-on-level', 'math-honors', 'science-lane',  'science-carron', 'humanities-alipour', 'humanities-fox', 'humanities-balan', 'humanities-rutherford'];
const isForum = (id) => forum_ids.includes(id);
const messagesKey = (forum) => 'messages:' + forum;
let messages = {};
let users = [];
let accounts = {};
let sessions = {};
let customForums = [];
let forumCreations = {};

const normalize = (value) => (typeof value === 'string' ? value.trim() : '');
const truncate = (value, maxLength) => normalize(value).slice(0, maxLength);

const UNKNOWN_TELEMETRY = 'Could not find value';
const telemetryString = (value, maxLength) => {
  const normalized = normalize(value);
  return normalized ? normalized.slice(0, maxLength) : UNKNOWN_TELEMETRY;
};
const telemetryInt = (value, max) =>
  Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : UNKNOWN_TELEMETRY;


async function loadState() {
  const storedForums = await redis.get(CUSTOM_FORUMS_KEY);
  customForums = Array.isArray(storedForums) ? storedForums : [];
  for (const forum of customForums) {
    if (!isForum(forum.id)) forum_ids.push(forum.id);
  }

  const storedCreations = await redis.get(FORUM_CREATIONS_KEY);
  forumCreations = storedCreations && typeof storedCreations === 'object' ? storedCreations : {};

  const entries = await Promise.all(
    forum_ids.map(async (id) => [id, await redis.get(messagesKey(id))])
  );
  messages = {};
  for (const [id, stored] of entries) {
    messages[id] = Array.isArray(stored) ? stored : [];
  }

  const storedUsers = await redis.get(USERS_KEY);
  users = Array.isArray(storedUsers) ? storedUsers : [];

  const storedAccounts = await redis.get(ACCOUNTS_KEY);
  accounts = storedAccounts && typeof storedAccounts === 'object' ? storedAccounts : {};

  const storedSessions = await redis.get(SESSIONS_KEY);
  sessions = storedSessions && typeof storedSessions === 'object' ? storedSessions : {};

  const storedBans = await redis.get(BANNED_IPS_KEY);
  bannedIps = Array.isArray(storedBans) ? storedBans : [];
}

const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const adminSessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setAdminSessionCookie(req, res, sessionId) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${sessionId}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  ];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAdminSessionCookie(req, res) {
  const parts = [`${ADMIN_SESSION_COOKIE}=`, 'HttpOnly', 'Path=/', 'SameSite=Strict', 'Max-Age=0'];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function isAdmin(req) {
  const sessionId = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (!sessionId) return false;
  const session = adminSessions.get(sessionId);
  if (!session) return false;
  if (Date.now() - session.createdAt > ADMIN_SESSION_TTL_MS) {
    adminSessions.delete(sessionId);
    return false;
  }
  return true;
}

const adminAttempts = new Map();
const ADMIN_MAX_ATTEMPTS = 10;
const ADMIN_WINDOW_MS = 5 * 60 * 1000;

function rateLimited(req) {
  const key = truncate(req.ip, 100);
  const now = Date.now();
  const entry = adminAttempts.get(key);

  if (entry && now - entry.windowStart > ADMIN_WINDOW_MS) {
    adminAttempts.delete(key);
  }

  const current = adminAttempts.get(key);
  if (current && current.count >= ADMIN_MAX_ATTEMPTS) {
    return true;
  }

  const updated = current ? { windowStart: current.windowStart, count: current.count + 1 } : { windowStart: now, count: 1 };
  adminAttempts.set(key, updated);
  return false;
}

function clearRateLimit(req) {
  adminAttempts.delete(truncate(req.ip, 100));
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }
  next();
}

async function rememberUser(name) {
  const trimmed = normalize(name);
  if (!trimmed || users.includes(trimmed)) return;
  const next = [...users, trimmed];
  await redis.set(USERS_KEY, next);
  users = next;
}

async function claimUsername(rawName, prevName) {
  const name = normalize(rawName);
  if (!name) {
    return { ok: false, error: 'Username cannot be empty.' };
  }

  const lower = name.toLowerCase();
  const takenByOther = users.some(
    (u) => u.toLowerCase() === lower && u !== prevName
  );
  if (takenByOther) {
    return { ok: false, error: 'That username is already taken.' };
  }

  const next = prevName ? users.filter((u) => u !== prevName) : [...users];
  if (!next.includes(name)) {
    next.push(name);
  }
  await redis.set(USERS_KEY, next);
  users = next;
  return { ok: true, name };
}

async function startSession(res, lowerUsername) {
  const token = crypto.randomUUID();
  sessions[token] = lowerUsername;
  await redis.set(SESSIONS_KEY, sessions);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30, //max 30 days
  })
}

function accountForRequest(req) {
  const token = req.cookies && req.cookies.session;
  const lower = token && sessions[token];
  return lower ? accounts[lower] : null;
}

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.post('/auth/signup', async (req, res ) => {
  const username = normalize(req.body.username);
  const school = truncate(req.body.school, 50);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!username || username.length > 30) {
    return res.status(400).json({ok: false, error: "Username must be between 1 and 30 characters"});
  }

  if (!school) {
    return res.status(400).json({ok: false, error: "School is required"});
  }

  if (!password) {
    return res.status(400).json({ok: false, error: "Password is required"});
  }

  const lower = username.toLowerCase();
  if (accounts[lower]) {
    return res.status(409).json({ok: false, error: "Username is already taken"});
  }

  const claim = await claimUsername(username, null);
  if (!claim.ok){
    return res.status(409).json(claim);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  accounts[lower] = {username, passwordHash, school, verified: false};
  await redis.set(ACCOUNTS_KEY, accounts);

  await startSession(res, lower);
  res.json({ok: true, username, school, verified: false});
})

app.post('/auth/login', async (req, res) =>{
  const username = normalize(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const account = accounts[username.toLowerCase()];

  if (!account || !password || !(await bcrypt.compare(password, account.passwordHash))) {
    return res.status(401).json({ok: false, error: 'Wrong username or password'});
  }

  await startSession(res, username.toLowerCase());
  res.json({ok: true, username: account.username, school: account.school, verified: account.verified})
})

app.post('/messages', async (req, res) => {
  if (bannedIps.includes(truncate(req.ip, 100))) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }

  const forum = req.body.forum;
  if (!isForum(forum)) {
    return res.status(400).json({ ok: false, error: 'Unknown forum.' });
  }

  if (typeof req.body.text !== 'string' || req.body.text.length > 2000) {
    return res.status(400).json({ ok: false, error: 'Message is too long.' });
  }
  if (typeof req.body.name !== 'string' || req.body.name.length > 100) {
    return res.status(400).json({ ok: false, error: 'Name is too long.' });
  }

  const clientTelemetry = req.body.telemetry && typeof req.body.telemetry === 'object'
    ? req.body.telemetry
    : {};

  const msg = {
    name: req.body.name,
    text: req.body.text,
    time: Date.now(),
    ip: truncate(req.ip, 100),
    userAgent: truncate(req.headers['user-agent'], 300) || null,
    telemetry: {
      screen: telemetryString(clientTelemetry.screen, 50),
      timezone: telemetryString(clientTelemetry.timezone, 100),
      language: telemetryString(clientTelemetry.language, 50),
      platform: telemetryString(clientTelemetry.platform, 100),
      composeMs: telemetryInt(clientTelemetry.composeMs, 24 * 60 * 60 * 1000),
      pasted: clientTelemetry.pasted === true,
      tabSwitches: telemetryInt(clientTelemetry.tabSwitches, 1000),
      deviceMemory: telemetryInt(clientTelemetry.deviceMemory, 1024),
      cpuCores: telemetryInt(clientTelemetry.cpuCores, 256),
      connectionType: telemetryString(clientTelemetry.connectionType, 30),
      referrer: telemetryString(clientTelemetry.referrer, 300),
      sessionMessageCount: telemetryInt(clientTelemetry.sessionMessageCount, 100000),
    },
  };

  const next = [...(messages[forum] || []), msg];
  try {
    await redis.set(messagesKey(forum), next);
    messages[forum] = next;
  } catch (err) {
    console.error('Failed to save message:', err);
    return res.status(500).json({ ok: false, error: 'Could not save message.' });
  }

  try {
    await rememberUser(msg.name);
  } catch (err) {
    console.error('Failed to remember user:', err);
  }

  res.json(toPublicMessage(msg));
});

function toPublicMessage(msg) {
  const { name, text, time } = msg;
  return { name, text, time };
}

app.get('/messages', (req, res) => {
  const forum = req.query.forum;
  if (!isForum(forum)) {
    return res.status(400).json({ ok: false, error: 'Unknown forum.' });
  }
  res.json((messages[forum] || []).map(toPublicMessage));
});

app.get('/forums', (req, res) => {
  res.json(customForums.map(({ id, label, blurb }) => ({ id, label, blurb })));
});

app.post('/forums', async (req, res) => {
  if (bannedIps.includes(truncate(req.ip, 100))) {
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

  // Signed-in accounts are limited by account; everyone else by their chat username.
  const account = accountForRequest(req);
  const creator = account ? account.username : truncate(req.body.name, 30);
  if (!creator) {
    return res.status(400).json({ ok: false, error: 'Username is required.' });
  }
  const limitKey = (account ? 'account:' : 'name:') + creator.toLowerCase();

  const now = Date.now();
  const last = forumCreations[limitKey];
  if (typeof last === 'number' && now - last < FORUM_COOLDOWN_MS) {
    const hours = Math.ceil((FORUM_COOLDOWN_MS - (now - last)) / (60 * 60 * 1000));
    return res.status(429).json({
      ok: false,
      error: `You can only create one forum per day. Try again in about ${hours} hour${hours === 1 ? '' : 's'}.`,
    });
  }

  // Update in-memory state before awaiting so concurrent requests see it.
  const forum = { id, label, blurb: 'by ' + creator, createdAt: now };
  const prevCreations = forumCreations;
  const prevForums = customForums;
  forumCreations = { [limitKey]: now };
  for (const [key, time] of Object.entries(prevCreations)) {
    if (key !== limitKey && now - time < FORUM_COOLDOWN_MS) forumCreations[key] = time;
  }
  customForums = [...prevForums, forum];
  forum_ids.push(id);
  messages[id] = [];

  try {
    await redis.set(CUSTOM_FORUMS_KEY, customForums);
    await redis.set(FORUM_CREATIONS_KEY, forumCreations);
  } catch (err) {
    console.error('Failed to save forum:', err);
    forumCreations = prevCreations;
    customForums = prevForums;
    forum_ids.splice(forum_ids.indexOf(id), 1);
    delete messages[id];
    return res.status(500).json({ ok: false, error: 'Could not create forum.' });
  }

  res.json({ ok: true, forum: { id, label, blurb: forum.blurb } });
});

app.post('/users', async (req, res) => {
  try {
    const result = await claimUsername(req.body.name, req.body.prevName);
    if (!result.ok) {
      return res.status(409).json(result);
    }
    res.json({ ok: true, name: result.name, users });
  } catch (err) {
    console.error('Failed to claim username:', err);
    res.status(500).json({ ok: false, error: 'Could not save username.' });
  }
});

app.get('/users', (req, res) => {
  res.json(users);
});

app.get('/activity', (req, res) =>{
  const counts = {};
  for (const id of forum_ids) {
    counts[id] = (messages[id] || []).length;
  }
  res.json(counts);
})


app.post('/admin/login', (req, res) => {
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

app.post('/admin/logout', (req, res) => {
  const sessionId = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (sessionId) adminSessions.delete(sessionId);
  clearAdminSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/admin/ban', requireAdmin, async (req, res) => {
  const ip = truncate(req.body.ip, 100);
  if (!ip) {
    return res.status(400).json({ ok: false, error: 'ip is required.' });
  }
  if (!bannedIps.includes(ip)) {
    const next = [...bannedIps, ip];
    await redis.set(BANNED_IPS_KEY, next);
    bannedIps = next;
  }
  res.json({ ok: true, bannedIps });
});

app.post('/admin/unban', requireAdmin, async (req, res) => {
  const ip = truncate(req.body.ip, 100);
  const next = bannedIps.filter((banned) => banned !== ip);
  await redis.set(BANNED_IPS_KEY, next);
  bannedIps = next;
  res.json({ ok: true, bannedIps });
});

app.get('/admin/banned', requireAdmin, (req, res) => {
  res.json({ ok: true, bannedIps });
});

const PORT = process.env.PORT || 3000;

loadState()
  .then(() => {
    app.listen(PORT, () => console.log('Server running on port ' + PORT));
  })
  .catch((err) => {
    console.error('Failed to load state from Redis:', err);
    process.exit(1);
  });
