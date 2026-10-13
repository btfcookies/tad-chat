const KEYS = {
  users: 'users',
  accounts: 'accounts',
  sessions: 'sessions',
  bannedIps: 'banned_ips',
  customForums: 'custom_forums',
  forumCreations: 'forum_creations',
};

const messagesKey = (forum) => 'messages:' + forum;

const FORUM_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FORUM_NAME_MAX = 40;

const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const ADMIN_MAX_ATTEMPTS = 10;
const ADMIN_WINDOW_MS = 5 * 60 * 1000;

module.exports = {
  KEYS,
  messagesKey,
  FORUM_COOLDOWN_MS,
  FORUM_NAME_MAX,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  ADMIN_MAX_ATTEMPTS,
  ADMIN_WINDOW_MS,
};
