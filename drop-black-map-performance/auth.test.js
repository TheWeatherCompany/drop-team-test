const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAuth, readConfig, missingConfig, buildLoginUrl } = require('./auth');

const CONFIG = {
  disabled: false,
  application: 'dropblack',
  amsHost: 'https://ams.test/access-management',
  accountAppUrl: 'https://acct.test',
  publicUrl: 'https://app.test',
};

function fakeResponse({ status = 200, body = {}, setCookies = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { getSetCookie: () => setCookies },
  };
}

// Boots a real Express app on an ephemeral port so redirects/status codes are exercised end to end.
async function withServer(config, fetchImpl, run, opts = {}) {
  const auth = createAuth(config, { fetchImpl, ...opts });
  const app = express();
  app.post('/auth/logout', auth.logout);
  app.use(auth.requireAuth);
  app.get('/', (req, res) => res.send('page'));
  app.get('/api/thing', (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

const get = (url, headers) => fetch(url, { headers, redirect: 'manual' });

test('readConfig reads env, trims trailing slashes, accepts ACCESS_MANAGEMENT_HOST', () => {
  const config = readConfig({
    ACCESS_MANAGEMENT_HOST: 'https://ams.test/x/',
    NEXT_PUBLIC_ACCOUNT_APP_URL: 'https://acct.test/',
    APP_PUBLIC_URL: 'https://app.test/',
  });
  assert.equal(config.amsHost, 'https://ams.test/x');
  assert.equal(config.accountAppUrl, 'https://acct.test');
  assert.equal(config.publicUrl, 'https://app.test');
  assert.equal(config.application, 'dropblack');
  assert.equal(config.disabled, false);
});

test('missingConfig lists absent settings unless auth is disabled', () => {
  assert.deepEqual(missingConfig({ ...CONFIG, amsHost: '', publicUrl: '' }).length, 2);
  assert.deepEqual(missingConfig({ ...CONFIG, amsHost: '', disabled: true }), []);
});

test('buildLoginUrl sets application and return_to', () => {
  const url = new URL(buildLoginUrl(CONFIG, '/a?b=1'));
  assert.equal(url.origin + url.pathname, 'https://acct.test/auth/login');
  assert.equal(url.searchParams.get('application'), 'dropblack');
  assert.equal(url.searchParams.get('return_to'), 'https://app.test/a?b=1');
});

test('page request without a cookie redirects to the hosted login', async () => {
  let called = false;
  await withServer(CONFIG, async () => { called = true; return fakeResponse(); }, async (base) => {
    const res = await get(`${base}/`);
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get('location')).searchParams.get('return_to'), 'https://app.test/');
  });
  assert.equal(called, false, 'no cookie means AMS is not called');
});

test('api request without a cookie gets 401 JSON, not a redirect', async () => {
  await withServer(CONFIG, async () => fakeResponse(), async (base) => {
    const res = await get(`${base}/api/thing`);
    assert.equal(res.status, 401);
  });
});

test('active session passes through and forwards cookie + X-Application to AMS', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return fakeResponse({ body: { active: true, jwt: 'x' } }); };
  await withServer(CONFIG, fetchImpl, async (base) => {
    const res = await get(`${base}/api/thing`, { cookie: 'ory_session_x=abc' });
    assert.equal(res.status, 200);
  });
  assert.equal(calls[0].url, 'https://ams.test/access-management/authentication/session');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Cookie, 'ory_session_x=abc');
  assert.equal(calls[0].init.headers['X-Application'], 'dropblack');
});

test('inactive session redirects pages and 401s the API', async () => {
  for (const response of [fakeResponse({ body: { active: false } }), fakeResponse({ status: 401 })]) {
    await withServer(CONFIG, async () => response, async (base) => {
      assert.equal((await get(`${base}/`, { cookie: 'c=1' })).status, 302);
      assert.equal((await get(`${base}/api/thing`, { cookie: 'c=1' })).status, 401);
    });
  }
});

test('AMS outage returns 503 instead of redirecting (no login loop)', async () => {
  const origError = console.error; console.error = () => {};
  try {
    await withServer(CONFIG, async () => fakeResponse({ status: 502 }), async (base) => {
      assert.equal((await get(`${base}/`, { cookie: 'c=1' })).status, 503);
    });
    await withServer(CONFIG, async () => { throw new Error('boom'); }, async (base) => {
      assert.equal((await get(`${base}/api/thing`, { cookie: 'c=1' })).status, 503);
    });
  } finally { console.error = origError; }
});

test('active sessions are cached briefly, then re-checked', async () => {
  let calls = 0;
  let clock = 1000;
  const fetchImpl = async () => { calls++; return fakeResponse({ body: { active: true } }); };
  await withServer(CONFIG, fetchImpl, async (base) => {
    await get(`${base}/`, { cookie: 'c=1' });
    await get(`${base}/`, { cookie: 'c=1' });
    assert.equal(calls, 1);
    clock += 31 * 1000;
    await get(`${base}/`, { cookie: 'c=1' });
    assert.equal(calls, 2);
  }, { now: () => clock });
});

test('inactive results are never cached', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return fakeResponse({ body: { active: false } }); };
  await withServer(CONFIG, fetchImpl, async (base) => {
    await get(`${base}/`, { cookie: 'c=1' });
    await get(`${base}/`, { cookie: 'c=1' });
  });
  assert.equal(calls, 2);
});

test('missing config fails closed with 503', async () => {
  const origError = console.error; console.error = () => {};
  try {
    await withServer({ ...CONFIG, amsHost: '' }, async () => fakeResponse(), async (base) => {
      assert.equal((await get(`${base}/`, { cookie: 'c=1' })).status, 503);
    });
  } finally { console.error = origError; }
});

test('AUTH_DISABLED bypasses the gate', async () => {
  await withServer({ ...CONFIG, disabled: true }, async () => { throw new Error('unused'); }, async (base) => {
    assert.equal((await get(`${base}/`)).status, 200);
  });
});

test('logout proxies to AMS, relays Set-Cookie, and clears the cache', async () => {
  let sessionCalls = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/authentication/logout')) return fakeResponse({ status: 200, setCookies: ['ory_session_x=; Max-Age=0; Domain=.weather.com'] });
    sessionCalls++;
    return fakeResponse({ body: { active: true } });
  };
  await withServer(CONFIG, fetchImpl, async (base) => {
    await get(`${base}/`, { cookie: 'c=1' });
    const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: 'c=1' } });
    assert.equal(res.status, 204);
    assert.match(res.headers.get('set-cookie'), /ory_session_x=;/);
    await get(`${base}/`, { cookie: 'c=1' });
  });
  assert.equal(sessionCalls, 2);
});
