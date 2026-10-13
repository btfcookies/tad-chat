const path = require('node:path');
const { once } = require('node:events');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Replace @upstash/redis with an in-memory fake *before* anything loads src/state.
// Values are JSON round-tripped like the real client, so persisted shapes are real.
const store = new Map();
const failures = { setKeys: new Set() };
const fakeRedis = {
  async get(key) {
    return store.has(key) ? JSON.parse(store.get(key)) : null;
  },
  async set(key, value) {
    if (failures.setKeys.has(key)) {
      failures.setKeys.delete(key);
      throw new Error('simulated redis outage');
    }
    store.set(key, JSON.stringify(value));
    return 'OK';
  },
};
const redisPath = require.resolve('@upstash/redis');
require.cache[redisPath] = {
  id: redisPath,
  filename: redisPath,
  loaded: true,
  exports: { Redis: { fromEnv: () => fakeRedis } },
};

// Rate limiters, in-flight signup sets and `state` are module-level singletons.
// Every test loads a fresh copy of src/ so none of that leaks between tests.
const SRC_DIR = path.join(__dirname, '..', 'src') + path.sep;
let state;
let SESSION_TTL_MS;
let server;
let base;
let ipCounter = 0;
// Every test uses its own client IP so the per-IP rate limits don't bleed over.
const freshIp = () => `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function api(method, path, { body, cookie, ip } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip || freshIp(),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie();
  const sessionHeader = setCookie.find((c) => c.startsWith('session='));
  return {
    status: res.status,
    body: await res.json(),
    setCookie: sessionHeader || null,
    cookie: sessionHeader ? sessionHeader.split(';')[0] : null,
  };
}

const goodSignup = (overrides = {}) => ({
  username: 'alice',
  password: 'correct horse',
  school: 'stmarks',
  ...overrides,
});

beforeEach(async () => {
  store.clear();
  failures.setKeys.clear();
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR)) delete require.cache[key];
  }
  ({ state } = require('../src/state'));
  ({ SESSION_TTL_MS } = require('../src/config'));
  const { createApp } = require('../src/app');
  server = createApp().listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => {
  server.closeAllConnections();
  server.close();
});

describe('signup', () => {
  test('creates an account, signs in, and stores only hashes', async () => {
    const res = await api('POST', '/auth/signup', { body: goodSignup() });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, username: 'alice', school: 'stmarks', verified: false });
    assert.match(res.setCookie, /HttpOnly/i);
    assert.match(res.setCookie, /SameSite=Lax/i);

    const me = await api('GET', '/auth/me', { cookie: res.cookie });
    assert.deepEqual(me.body, { ok: true, username: 'alice', school: 'stmarks', verified: false });

    const stored = state.accounts.alice;
    assert.match(stored.passwordHash, /^\$2[aby]\$/);
    assert.ok(!JSON.stringify(res.body).includes(stored.passwordHash));

    // The raw cookie token must not be a key in the persisted sessions.
    const token = res.cookie.split('=')[1];
    const persisted = JSON.parse(store.get('sessions'));
    assert.ok(!(token in persisted));
    assert.equal(Object.keys(persisted).length, 1);
    assert.ok(state.users.includes('alice'));
  });

  test('rejects bad input', async () => {
    const cases = [
      { username: '' },
      { username: 'x'.repeat(31) },
      { username: 'bad​name' },
      { username: 'bell\u0007' },
      { school: 'hogwarts' },
      { school: undefined },
      { password: 'short' },
      { password: 'x'.repeat(73) },
      { password: 12345678 },
    ];
    for (const overrides of cases) {
      const res = await api('POST', '/auth/signup', { body: goodSignup(overrides) });
      assert.equal(res.status, 400, JSON.stringify(overrides));
      assert.equal(res.body.ok, false);
    }
    assert.deepEqual(state.accounts, {});
  });

  test('usernames are unique case-insensitively and whitespace is collapsed', async () => {
    assert.equal((await api('POST', '/auth/signup', { body: goodSignup() })).status, 200);
    assert.equal((await api('POST', '/auth/signup', { body: goodSignup({ username: 'ALICE' }) })).status, 409);

    const spaced = await api('POST', '/auth/signup', { body: goodSignup({ username: '  Bob   Smith ' }) });
    assert.equal(spaced.body.username, 'Bob Smith');
    assert.equal((await api('POST', '/auth/signup', { body: goodSignup({ username: 'bob smith' }) })).status, 409);
  });

  test('cannot take a name an anonymous user already uses', async () => {
    state.users = ['Bob'];
    const res = await api('POST', '/auth/signup', { body: goodSignup({ username: 'bob' }) });
    assert.equal(res.status, 409);
  });

  test('simultaneous signups for one name produce exactly one account', async () => {
    const results = await Promise.all([
      api('POST', '/auth/signup', { body: goodSignup({ password: 'first password' }) }),
      api('POST', '/auth/signup', { body: goodSignup({ password: 'second password' }) }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(Object.keys(state.accounts).length, 1);
  });

  test('a failed save leaves the name free to retry', async () => {
    failures.setKeys.add('accounts');
    const failed = await api('POST', '/auth/signup', { body: goodSignup() });
    assert.equal(failed.status, 500);
    assert.deepEqual(state.accounts, {});
    assert.ok(!state.users.includes('alice'));

    const retry = await api('POST', '/auth/signup', { body: goodSignup() });
    assert.equal(retry.status, 200);
  });

  test('names that collide with Object.prototype work and cannot be spoofed', async () => {
    for (const username of ['constructor', '__proto__', 'toString']) {
      const created = await api('POST', '/auth/signup', { body: goodSignup({ username }) });
      assert.equal(created.status, 200, username);
      const login = await api('POST', '/auth/login', { body: { username, password: 'correct horse' } });
      assert.equal(login.status, 200, username);
    }
    for (const token of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const me = await api('GET', '/auth/me', { cookie: `session=${token}` });
      assert.equal(me.status, 200);
      assert.equal(me.body.ok, false);
    }
  });

  test('is rate limited per IP', async () => {
    const ip = freshIp();
    let last;
    for (let i = 0; i < 21; i += 1) {
      last = await api('POST', '/auth/signup', { ip, body: goodSignup({ username: `user${i}`, password: 'short' }) });
    }
    assert.equal(last.status, 429);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await api('POST', '/auth/signup', { body: goodSignup() });
  });

  test('accepts the right password, any capitalization of the name', async () => {
    const res = await api('POST', '/auth/login', { body: { username: 'ALICE', password: 'correct horse' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'alice');
    assert.ok(res.cookie);
  });

  test('gives one identical answer for wrong password and unknown user', async () => {
    const wrong = await api('POST', '/auth/login', { body: { username: 'alice', password: 'nope nope nope' } });
    const unknown = await api('POST', '/auth/login', { body: { username: 'nobody', password: 'nope nope nope' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(wrong.cookie, null);
  });

  test('rejects missing or non-string credentials without crashing', async () => {
    for (const body of [{}, { username: 'alice' }, { username: 'alice', password: 5 }, { username: ['alice'], password: 'x' }]) {
      const res = await api('POST', '/auth/login', { body });
      assert.equal(res.status, 401, JSON.stringify(body));
    }
  });

  test('locks an account after repeated failures, even from a new IP', async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await api('POST', '/auth/login', { body: { username: 'alice', password: 'wrong wrong' } });
      assert.equal(res.status, 401);
    }
    const locked = await api('POST', '/auth/login', { body: { username: 'alice', password: 'correct horse' } });
    assert.equal(locked.status, 429);
  });

  test('a successful login clears that account\'s failure count', async () => {
    for (let i = 0; i < 9; i += 1) {
      await api('POST', '/auth/login', { body: { username: 'alice', password: 'wrong wrong' } });
    }
    const ok = await api('POST', '/auth/login', { body: { username: 'alice', password: 'correct horse' } });
    assert.equal(ok.status, 200);
    const again = await api('POST', '/auth/login', { body: { username: 'alice', password: 'wrong wrong' } });
    assert.equal(again.status, 401);
  });
});

describe('sessions', () => {
  async function signedIn() {
    const res = await api('POST', '/auth/login', { body: { username: 'alice', password: 'correct horse' } });
    return res.cookie;
  }

  beforeEach(async () => {
    await api('POST', '/auth/signup', { body: goodSignup() });
  });

  test('logout invalidates the session server-side and clears the cookie', async () => {
    const cookie = await signedIn();
    const out = await api('POST', '/auth/logout', { cookie });
    assert.equal(out.status, 200);
    assert.deepEqual(out.body, { ok: true });
    assert.match(out.setCookie, /session=;/);

    const me = await api('GET', '/auth/me', { cookie });
    assert.equal(me.body.ok, false);
  });

  test('logout without a session is harmless', async () => {
    const out = await api('POST', '/auth/logout');
    assert.equal(out.status, 200);
  });

  test('logging out one device leaves other sessions alone', async () => {
    const a = await signedIn();
    const b = await signedIn();
    await api('POST', '/auth/logout', { cookie: a });
    assert.equal((await api('GET', '/auth/me', { cookie: b })).body.ok, true);
  });

  test('sessions expire server-side', async () => {
    const cookie = await signedIn();
    assert.equal((await api('GET', '/auth/me', { cookie })).body.ok, true);

    for (const session of Object.values(state.sessions)) {
      session.createdAt = Date.now() - SESSION_TTL_MS - 1000;
    }
    const me = await api('GET', '/auth/me', { cookie });
    assert.equal(me.body.ok, false);
  });

  test('legacy string sessions are not honoured', async () => {
    state.sessions = { 'old-uuid-token': 'alice' };
    const me = await api('GET', '/auth/me', { cookie: 'session=old-uuid-token' });
    assert.equal(me.body.ok, false);
  });

  test('expired sessions are pruned when someone signs in', async () => {
    state.sessions = { stale: { username: 'alice', createdAt: Date.now() - SESSION_TTL_MS - 1000 } };
    await signedIn();
    assert.ok(!('stale' in state.sessions));
  });

  test('/auth/me is never cached', async () => {
    const res = await fetch(base + '/auth/me');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
});

describe('name ownership', () => {
  let cookie;

  beforeEach(async () => {
    const res = await api('POST', '/auth/signup', { body: goodSignup() });
    cookie = res.cookie;
  });

  async function post(extra = {}) {
    return api('POST', '/messages', {
      body: { name: 'AnonymousPotato1', text: 'hello', forum: 'general-discussion', ...extra.body },
      cookie: extra.cookie,
    });
  }

  test('signed-in messages are always posted as the account', async () => {
    const res = await post({ cookie, body: { name: 'SomeoneElse' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'alice');
    assert.equal(state.messages['general-discussion'].at(-1).name, 'alice');
    assert.ok(!state.users.includes('SomeoneElse'));
  });

  test('signed-out users cannot post under an account name', async () => {
    for (const name of ['alice', 'ALICE', ' Alice ']) {
      const res = await post({ body: { name } });
      assert.equal(res.status, 403, name);
    }
    assert.equal((state.messages['general-discussion'] || []).length, 0);
  });

  test('signed-out users can still post under other names', async () => {
    const res = await post();
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'AnonymousPotato1');
  });

  test('signed-out users cannot claim or release an account name via /users', async () => {
    const claim = await api('POST', '/users', { body: { name: 'alice', prevName: 'AnonymousPotato1' } });
    assert.equal(claim.status, 409);

    const release = await api('POST', '/users', { body: { name: 'Mallory', prevName: 'alice' } });
    assert.equal(release.status, 200);
    assert.ok(state.users.includes('alice'), 'account name must stay reserved');
  });

  test('account usernames cannot be renamed', async () => {
    const rename = await api('POST', '/users', { cookie, body: { name: 'carol', prevName: 'alice' } });
    assert.equal(rename.status, 409);
    const same = await api('POST', '/users', { cookie, body: { name: 'alice', prevName: 'alice' } });
    assert.equal(same.status, 200);
    assert.ok(state.users.includes('alice'));
  });

  test('forums are created as the account, and not as someone else\'s account', async () => {
    const spoof = await api('POST', '/forums', { body: { forumName: 'Spoofed', name: 'alice' } });
    assert.equal(spoof.status, 403);

    const mine = await api('POST', '/forums', { cookie, body: { forumName: 'Mine', name: 'whoever' } });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.forum.blurb, 'by alice');
    assert.ok('account:alice' in state.forumCreations);
  });
});

describe('admin rate limit (shared limiter code)', () => {
  test('still locks out after the configured failures', async () => {
    const ip = freshIp();
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await api('POST', '/admin/login', { ip, body: { token: 'wrong' } });
    }
    assert.equal(last.status, 429);
  });
});
