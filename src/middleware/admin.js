const { ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_MS } = require('../config');

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

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden.' });
  }
  next();
}

module.exports = {
  adminSessions,
  parseCookies,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  isAdmin,
  requireAdmin,
};
