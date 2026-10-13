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

const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const USERNAME_MAX = 30;
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt silently ignores anything past 72 bytes

// Keep in sync with the <select id="school-input"> options in public/index.html.
const SCHOOLS = {
  stmarks: "St. Mark's",
  hday: 'Hockaday',
  other: 'Other',
};

// Failed logins are counted per IP and per account, so one attacker can't walk
// through many accounts and one account can't be hammered from many IPs.
const LOGIN_IP_MAX_FAILURES = 30;
const LOGIN_IP_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_USER_MAX_FAILURES = 10;
const LOGIN_USER_WINDOW_MS = 15 * 60 * 1000;
// Schools share an IP, so this is deliberately generous.
const SIGNUP_MAX_PER_IP = 20;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

module.exports = {
  KEYS,
  messagesKey,
  FORUM_COOLDOWN_MS,
  FORUM_NAME_MAX,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_MS,
  ADMIN_MAX_ATTEMPTS,
  ADMIN_WINDOW_MS,
  SESSION_COOKIE,
  SESSION_TTL_MS,
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
};
