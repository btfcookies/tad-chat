const { ADMIN_MAX_ATTEMPTS, ADMIN_WINDOW_MS } = require('../config');
const { truncate } = require('../lib/text');

const SWEEP_THRESHOLD = 5000;

// Fixed-window counter keyed by an arbitrary string. State is per process.
function createLimiter({ max, windowMs }) {
  const entries = new Map();

  function live(key, now) {
    const entry = entries.get(key);
    if (entry && now - entry.windowStart > windowMs) {
      entries.delete(key);
      return null;
    }
    return entry || null;
  }

  return {
    isBlocked(key) {
      const entry = live(key, Date.now());
      return !!entry && entry.count >= max;
    },
    record(key) {
      const now = Date.now();
      const entry = live(key, now);
      entries.set(key, entry ? { windowStart: entry.windowStart, count: entry.count + 1 } : { windowStart: now, count: 1 });
      if (entries.size > SWEEP_THRESHOLD) {
        for (const k of entries.keys()) live(k, now);
      }
    },
    reset(key) {
      entries.delete(key);
    },
  };
}

const adminLimiter = createLimiter({ max: ADMIN_MAX_ATTEMPTS, windowMs: ADMIN_WINDOW_MS });
const adminKey = (req) => truncate(req.ip, 100);

// Counts every attempt (successful ones are forgiven via clearRateLimit).
function rateLimited(req) {
  const key = adminKey(req);
  if (adminLimiter.isBlocked(key)) return true;
  adminLimiter.record(key);
  return false;
}

function clearRateLimit(req) {
  adminLimiter.reset(adminKey(req));
}

module.exports = { createLimiter, rateLimited, clearRateLimit };
