const { Redis } = require('@upstash/redis');
const { KEYS, messagesKey } = require('./config');

const redis = Redis.fromEnv();

// Shared in-memory copy of everything persisted in Redis. Modules must read and
// write through this object (state.users = next) rather than caching the values.
const state = {
  forumIds: ['general-discussion'],
  messages: {},
  users: [],
  accounts: {},
  sessions: {},
  customForums: [],
  forumCreations: {},
  bannedIps: [],
};

const isForum = (id) => state.forumIds.includes(id);

async function loadState() {
  const storedForums = await redis.get(KEYS.customForums);
  state.customForums = Array.isArray(storedForums) ? storedForums : [];
  for (const forum of state.customForums) {
    if (!isForum(forum.id)) state.forumIds.push(forum.id);
  }

  const storedCreations = await redis.get(KEYS.forumCreations);
  state.forumCreations = storedCreations && typeof storedCreations === 'object' ? storedCreations : {};

  const entries = await Promise.all(
    state.forumIds.map(async (id) => [id, await redis.get(messagesKey(id))])
  );
  state.messages = {};
  for (const [id, stored] of entries) {
    state.messages[id] = Array.isArray(stored) ? stored : [];
  }

  const storedUsers = await redis.get(KEYS.users);
  state.users = Array.isArray(storedUsers) ? storedUsers : [];

  const storedAccounts = await redis.get(KEYS.accounts);
  state.accounts = storedAccounts && typeof storedAccounts === 'object' ? storedAccounts : {};

  const storedSessions = await redis.get(KEYS.sessions);
  state.sessions = storedSessions && typeof storedSessions === 'object' ? storedSessions : {};

  const storedBans = await redis.get(KEYS.bannedIps);
  state.bannedIps = Array.isArray(storedBans) ? storedBans : [];
}

module.exports = { redis, state, isForum, loadState };
