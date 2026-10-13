const { ADMIN_MAX_ATTEMPTS, ADMIN_WINDOW_MS } = require('../config');
const { truncate } = require('../lib/text');

const adminAttempts = new Map();

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

module.exports = { rateLimited, clearRateLimit };
