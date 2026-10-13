const crypto = require('crypto');
const { KEYS } = require('../config');
const { redis, state } = require('../state');
const { normalize } = require('./text');

async function rememberUser(name) {
  const trimmed = normalize(name);
  if (!trimmed || state.users.includes(trimmed)) return;
  const next = [...state.users, trimmed];
  await redis.set(KEYS.users, next);
  state.users = next;
}

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
  if (!next.includes(name)) {
    next.push(name);
  }
  await redis.set(KEYS.users, next);
  state.users = next;
  return { ok: true, name };
}

async function startSession(res, lowerUsername) {
  const token = crypto.randomUUID();
  state.sessions[token] = lowerUsername;
  await redis.set(KEYS.sessions, state.sessions);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30, //max 30 days
  });
}

function accountForRequest(req) {
  const token = req.cookies && req.cookies.session;
  const lower = token && state.sessions[token];
  return lower ? state.accounts[lower] : null;
}

module.exports = { rememberUser, claimUsername, startSession, accountForRequest };
