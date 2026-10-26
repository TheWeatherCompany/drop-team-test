const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const { SignJWT, generateKeyPair, exportJWK } = require('jose');
const { createAuth, readConfig, missingConfig, safeReturnTo, SESSION_COOKIE, FLOW_COOKIE } = require('./auth');

const CLIENT_ID = 'client123';
const CLIENT_SECRET = 'secret456';
const AUTH_SECRET = 'a'.repeat(40);
const PUBLIC_URL = 'https://app.test';

const listen = (app) => new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const baseOf = (server) => `http://127.0.0.1:${server.address().port}`;

// In-process stand-in for Okta: discovery, JWKS and a token endpoint that returns whatever `fake.claims()` says.
async function startFakeOkta() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const app = express();
  const fake = { tokenRequests: [], claims: () => ({}), signWith: privateKey };
  app.get('/.well-known/openid-configuration', (req, res) => res.json({
    issuer: fake.issuer,
    authorization_endpoint: `${fake.issuer}/v1/authorize`,
    token_endpoint: `${fake.issuer}/v1/token`,
    jwks_uri: `${fake.issuer}/v1/keys`,
    end_session_endpoint: `${fake.issuer}/v1/logout`,
  }));
  app.get('/v1/keys', (req, res) => res.json({ keys: [jwk] }));
  app.post('/v1/token', express.urlencoded({ extended: false }), async (req, res) => {
    fake.tokenRequests.push({ body: req.body, authorization: req.headers.authorization });
    const c = { iss: fake.issuer, aud: CLIENT_ID, sub: 'user1', email: 'dev@weather.com', name: 'Dev', ...fake.claims() };
    const jwt = new SignJWT({ email: c.email, name: c.name, nonce: c.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(c.sub).setIssuer(c.iss).setAudience(c.aud)
      .setIssuedAt().setExpirationTime(c.exp || '5m');
    res.json({ id_token: await jwt.sign(fake.signWith), access_token: 'x', token_type: 'Bearer' });
  });
  fake.server = await listen(app);
  fake.issuer = `${baseOf(fake.server)}/oauth2/default`;
  // Serve under /oauth2/default as a real Okta issuer path would.
  const outer = express();
  outer.use('/oauth2/default', app);
  fake.server.close();
  fake.server = await listen(outer);
  fake.issuer = `${baseOf(fake.server)}/oauth2/default`;
  return fake;
}

function configFor(fake, overrides = {}) {
  return { disabled: false, issuer: fake.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, authSecret: AUTH_SECRET, publicUrl: PUBLIC_URL, ...overrides };
}

async function withApp(config, run, deps) {
  const auth = createAuth(config, deps);
  const app = express();
  app.get('/auth/login', auth.login);
  app.get('/auth/callback', auth.callback);
  app.post('/auth/logout', auth.logout);
  app.use(auth.requireAuth);
  app.get('/', (req, res) => res.send('page'));
  app.get('/api/thing', (req, res) => res.json({ ok: true }));
  app.get('/api/me', auth.me);
  const server = await listen(app);
  try { await run(baseOf(server)); } finally { server.close(); }
}

const get = (url, cookie) => fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
const cookiesFrom = (res) => Object.fromEntries(res.headers.getSetCookie().map((c) => { const [pair] = c.split(';'); const i = pair.indexOf('='); return [pair.slice(0, i), pair.slice(i + 1)]; }));
const setCookieFor = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

// Runs /auth/login and returns what the browser would hold plus the parameters sent to Okta.
async function startLogin(base, returnTo) {
  const res = await get(`${base}/auth/login${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`);
  const location = new URL(res.headers.get('location'));
  return { res, location, flowCookie: `${FLOW_COOKIE}=${cookiesFrom(res)[FLOW_COOKIE]}`, params: location.searchParams };
}

test('readConfig trims values and missingConfig fails closed', () => {
  const config = readConfig({ OKTA_ISSUER: 'https://o.okta.com/oauth2/default/', APP_PUBLIC_URL: 'https://app.test/' });
  assert.equal(config.issuer, 'https://o.okta.com/oauth2/default');
  assert.equal(config.publicUrl, 'https://app.test');
  assert.equal(missingConfig(config).length, 3);
  assert.deepEqual(missingConfig({ ...config, disabled: true }), []);
  assert.ok(missingConfig({ ...configFor({ issuer: 'x' }), authSecret: 'short' }).some((m) => m.startsWith('AUTH_SECRET')));
});

test('safeReturnTo only allows same-origin paths', () => {
  assert.equal(safeReturnTo('/a?b=1', PUBLIC_URL), '/a?b=1');
  for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined, '/a\nb']) {
    assert.equal(safeReturnTo(bad, PUBLIC_URL), '/', String(bad));
  }
});

test('login redirects to Okta with PKCE, state, nonce and the callback URI', async () => {
  const fake = await startFakeOkta();
  try {
    await withApp(configFor(fake), async (base) => {
      const { res, location, params } = await startLogin(base, '/page');
      assert.equal(res.status, 302);
      assert.equal(location.pathname, '/oauth2/default/v1/authorize');
      assert.equal(params.get('client_id'), CLIENT_ID);
      assert.equal(params.get('response_type'), 'code');
      assert.equal(params.get('scope'), 'openid profile email');
      assert.equal(params.get('redirect_uri'), `${PUBLIC_URL}/auth/callback`);
      assert.equal(params.get('code_challenge_method'), 'S256');
      assert.ok(params.get('state') && params.get('nonce') && params.get('code_challenge'));
      const flow = setCookieFor(res, FLOW_COOKIE);
      assert.match(flow, /HttpOnly/);
      assert.match(flow, /Secure/);
      assert.match(flow, /SameSite=Lax/);
    });
  } finally { fake.server.close(); }
});

test('callback happy path: exchanges code with PKCE verifier, sets session, returns to return_to', async () => {
  const fake = await startFakeOkta();
  try {
    await withApp(configFor(fake), async (base) => {
      const { params, flowCookie } = await startLogin(base, '/page?x=1');
      fake.claims = () => ({ nonce: params.get('nonce') });
      const res = await get(`${base}/auth/callback?code=abc&state=${params.get('state')}`, flowCookie);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/page?x=1');

      const sent = fake.tokenRequests[0];
      assert.equal(sent.body.grant_type, 'authorization_code');
      assert.equal(sent.body.code, 'abc');
      assert.equal(sent.body.redirect_uri, `${PUBLIC_URL}/auth/callback`);
      // The verifier must hash to the challenge we sent to /authorize.
      assert.equal(crypto.createHash('sha256').update(sent.body.code_verifier).digest('base64url'), params.get('code_challenge'));
      assert.equal(sent.authorization, `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`);

      assert.match(setCookieFor(res, SESSION_COOKIE), /HttpOnly/);
      assert.match(setCookieFor(res, FLOW_COOKIE), /Max-Age=0/);

      const session = `${SESSION_COOKIE}=${cookiesFrom(res)[SESSION_COOKIE]}`;
      assert.equal((await get(`${base}/`, session)).status, 200);
      assert.equal((await get(`${base}/api/thing`, session)).status, 200);
      assert.deepEqual(await (await get(`${base}/api/me`, session)).json(), { sub: 'user1', email: 'dev@weather.com', name: 'Dev' });
    });
  } finally { fake.server.close(); }
});

test('callback rejects a hostile return_to by landing on /', async () => {
  const fake = await startFakeOkta();
  try {
    await withApp(configFor(fake), async (base) => {
      const { params, flowCookie } = await startLogin(base, '//evil.com');
      fake.claims = () => ({ nonce: params.get('nonce') });
      const res = await get(`${base}/auth/callback?code=abc&state=${params.get('state')}`, flowCookie);
      assert.equal(res.headers.get('location'), '/');
    });
  } finally { fake.server.close(); }
});

test('callback rejects bad state, missing flow cookie, Okta errors and a replayed flow on another secret', async () => {
  const fake = await startFakeOkta();
  try {
    await withApp(configFor(fake), async (base) => {
      const { params, flowCookie } = await startLogin(base);
      fake.claims = () => ({ nonce: params.get('nonce') });
      assert.equal((await get(`${base}/auth/callback?code=abc&state=wrong`, flowCookie)).status, 400);
      assert.equal((await get(`${base}/auth/callback?code=abc&state=${params.get('state')}`)).status, 400);
      assert.equal((await get(`${base}/auth/callback?error=access_denied&state=${params.get('state')}`, flowCookie)).status, 401);
      assert.equal(fake.tokenRequests.length, 0, 'no token exchange on a rejected callback');
    });
    // A flow cookie minted under a different AUTH_SECRET must not verify.
    let foreignFlow;
    await withApp(configFor(fake, { authSecret: 'b'.repeat(40) }), async (base) => { foreignFlow = (await startLogin(base)).flowCookie; });
    await withApp(configFor(fake), async (base) => {
      assert.equal((await get(`${base}/auth/callback?code=abc&state=x`, foreignFlow)).status, 400);
    });
  } finally { fake.server.close(); }
});

test('callback rejects ID tokens with a wrong nonce, audience, issuer, expiry or signing key', async () => {
  const fake = await startFakeOkta();
  const other = await generateKeyPair('RS256');
  try {
    const origError = console.error; console.error = () => {};
    try {
      const cases = {
        'wrong nonce': () => ({ nonce: 'nope' }),
        'wrong audience': (nonce) => ({ nonce, aud: 'someone-else' }),
        'wrong issuer': (nonce) => ({ nonce, iss: 'https://evil.example/oauth2/default' }),
        expired: (nonce) => ({ nonce, exp: Math.floor(Date.now() / 1000) - 3600 }),
      };
      for (const [name, claims] of Object.entries(cases)) {
        await withApp(configFor(fake), async (base) => {
          const { params, flowCookie } = await startLogin(base);
          fake.claims = () => claims(params.get('nonce'));
          const res = await get(`${base}/auth/callback?code=abc&state=${params.get('state')}`, flowCookie);
          assert.equal(res.status, 401, name);
          assert.equal(setCookieFor(res, SESSION_COOKIE), undefined, `${name}: no session`);
        });
      }
      // Valid claims but signed by a key that is not in Okta's JWKS.
      const realKey = fake.signWith;
      fake.signWith = other.privateKey;
      await withApp(configFor(fake), async (base) => {
        const { params, flowCookie } = await startLogin(base);
        fake.claims = () => ({ nonce: params.get('nonce') });
        const res = await get(`${base}/auth/callback?code=abc&state=${params.get('state')}`, flowCookie);
        assert.equal(res.status, 401, 'wrong signing key');
      });
      fake.signWith = realKey;
    } finally { console.error = origError; }
  } finally { fake.server.close(); }
});

test('unauthenticated: pages redirect to /auth/login, /api gets 401, forged and foreign cookies are rejected', async () => {
  const fake = await startFakeOkta();
  try {
    await withApp(configFor(fake), async (base) => {
      const page = await get(`${base}/`);
      assert.equal(page.status, 302);
      assert.equal(page.headers.get('location'), '/auth/login?return_to=%2F');
      assert.equal((await get(`${base}/api/thing`)).status, 401);
      assert.equal((await get(`${base}/api/thing`, `${SESSION_COOKIE}=garbage`)).status, 401);
      // Well-formed HS256 JWT, but signed with a secret that isn't ours.
      const forged = await new SignJWT({ sub: 'attacker', email: 'a@b.c' })
        .setProtectedHeader({ alg: 'HS256' }).setAudience('session').setExpirationTime('1h')
        .sign(new TextEncoder().encode('z'.repeat(40)));
      assert.equal((await get(`${base}/api/thing`, `${SESSION_COOKIE}=${forged}`)).status, 401);
      // Unsigned (alg none) token.
      const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x","aud":"session"}').toString('base64url')}.`;
      assert.equal((await get(`${base}/api/thing`, `${SESSION_COOKIE}=${none}`)).status, 401);
    });
  } finally { fake.server.close(); }
});

test('an expired session is rejected', async () => {
  const fake = await startFakeOkta();
  try {
    let clock = Date.now();
    await withApp(configFor(fake), async (base) => {
      const { params, flowCookie } = await startLogin(base);
      fake.claims = () => ({ nonce: params.get('nonce') });
      const res = await get(`${base}/auth/callback?code=abc&state=${params.get('state')}`, flowCookie);
      const session = `${SESSION_COOKIE}=${cookiesFrom(res)[SESSION_COOKIE]}`;
      assert.equal((await get(`${base}/api/thing`, session)).status, 200);
      clock += 9 * 60 * 60 * 1000;
      assert.equal((await get(`${base}/api/thing`, session)).status, 401);
    }, { now: () => clock });
  } finally { fake.server.close(); }
});

test('missing config fails closed with 503 on every route', async () => {
  const fake = await startFakeOkta();
  const origError = console.error; console.error = () => {};
  try {
    await withApp(configFor(fake, { clientSecret: '' }), async (base) => {
      assert.equal((await get(`${base}/`)).status, 503);
      assert.equal((await get(`${base}/api/thing`)).status, 503);
      assert.equal((await get(`${base}/auth/login`)).status, 503);
    });
  } finally { console.error = origError; fake.server.close(); }
});

test('AUTH_DISABLED bypasses the gate', async () => {
  await withApp({ disabled: true, issuer: '', clientId: '', clientSecret: '', authSecret: '', publicUrl: '' }, async (base) => {
    assert.equal((await get(`${base}/`)).status, 200);
    assert.equal((await get(`${base}/api/thing`)).status, 200);
  });
});

test('Okta being unreachable gives 503 on login, not a crash', async () => {
  const origError = console.error; console.error = () => {};
  try {
    await withApp({ ...configFor({ issuer: 'http://127.0.0.1:1/oauth2/default' }) }, async (base) => {
      assert.equal((await get(`${base}/auth/login`)).status, 503);
    });
  } finally { console.error = origError; }
});

test('logout clears the session and returns the Okta end-session URL with the id_token_hint', async () => {
  const fake = await startFakeOkta();
  try {
    await withApp(configFor(fake), async (base) => {
      const { params, flowCookie } = await startLogin(base);
      fake.claims = () => ({ nonce: params.get('nonce') });
      const cb = await get(`${base}/auth/callback?code=abc&state=${params.get('state')}`, flowCookie);
      const session = `${SESSION_COOKIE}=${cookiesFrom(cb)[SESSION_COOKIE]}`;

      const res = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: session } });
      assert.equal(res.status, 200);
      assert.match(setCookieFor(res, SESSION_COOKIE), /Max-Age=0/);
      const { redirect } = await res.json();
      const url = new URL(redirect);
      assert.equal(url.pathname, '/oauth2/default/v1/logout');
      assert.ok(url.searchParams.get('id_token_hint'));
      assert.equal(url.searchParams.get('post_logout_redirect_uri'), `${PUBLIC_URL}/`);

      const anon = await (await fetch(`${base}/auth/logout`, { method: 'POST' })).json();
      assert.equal(anon.redirect, '/');
    });
  } finally { fake.server.close(); }
});
