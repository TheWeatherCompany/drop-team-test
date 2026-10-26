const crypto = require('crypto');
const { SignJWT, jwtVerify, createRemoteJWKSet } = require('jose');

// Okta OIDC (authorization code + PKCE) gate for the config builder.
// Sessions are stateless signed JWT cookies, so this works on serverless hosts with no store.
// Anyone Okta lets into the application (via its assignments) gets in; there is no in-app RBAC.

const SESSION_COOKIE = 'dtt_session';
const FLOW_COOKIE = 'dtt_flow';
const SESSION_MAX_AGE_S = 8 * 60 * 60;
const FLOW_MAX_AGE_S = 10 * 60;
const SCOPE = 'openid profile email';

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function readConfig(env = process.env) {
  return {
    disabled: env.AUTH_DISABLED === 'true',
    issuer: trimSlash(env.OKTA_ISSUER),
    clientId: (env.OKTA_CLIENT_ID || '').trim(),
    clientSecret: (env.OKTA_CLIENT_SECRET || '').trim(),
    authSecret: env.AUTH_SECRET || '',
    // Where this app is reachable. Callback and return URLs are built from this, never the Host header.
    publicUrl: trimSlash(env.APP_PUBLIC_URL),
  };
}

// Fail closed: a deploy missing any of these must not silently serve the app unauthenticated.
function missingConfig(config) {
  if (config.disabled) return [];
  const missing = [
    ['OKTA_ISSUER', config.issuer],
    ['OKTA_CLIENT_ID', config.clientId],
    ['OKTA_CLIENT_SECRET', config.clientSecret],
    ['AUTH_SECRET', config.authSecret],
    ['APP_PUBLIC_URL', config.publicUrl],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (config.authSecret && config.authSecret.length < 32) missing.push('AUTH_SECRET (must be at least 32 characters)');
  return missing;
}

// Only same-origin relative paths are allowed as a post-login destination (open-redirect guard).
function safeReturnTo(raw, publicUrl) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f]/.test(raw)) return '/';
  try {
    const base = new URL(publicUrl || 'http://localhost');
    const parsed = new URL(raw, base);
    if (parsed.origin !== base.origin) return '/';
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return '/';
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = part.slice(idx + 1).trim();
  }
  return out;
}

const b64url = (buffer) => buffer.toString('base64url');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createAuth(config, { fetchImpl = fetch, now = Date.now } = {}) {
  const missing = missingConfig(config);
  const secure = config.publicUrl.startsWith('https://');
  const key = new TextEncoder().encode(config.authSecret);
  let discoveryPromise = null;
  let jwks = null;

  function discover() {
    if (!discoveryPromise) {
      discoveryPromise = (async () => {
        const response = await fetchImpl(`${config.issuer}/.well-known/openid-configuration`);
        if (!response.ok) throw new Error(`discovery failed (${response.status})`);
        const doc = await response.json();
        if (trimSlash(doc.issuer) !== config.issuer) throw new Error('discovery issuer mismatch');
        jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
        return doc;
      })().catch((error) => { discoveryPromise = null; throw error; });
    }
    return discoveryPromise;
  }

  const nowSeconds = () => Math.floor(now() / 1000);

  function sign(payload, maxAgeSeconds, audience) {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(nowSeconds())
      .setExpirationTime(nowSeconds() + maxAgeSeconds)
      .setAudience(audience)
      .sign(key);
  }

  async function verifyOwn(token, audience) {
    try {
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], audience, currentDate: new Date(now()) });
      return payload;
    } catch {
      return null;
    }
  }

  function cookieString(name, value, maxAge) {
    return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  const clearCookie = (res, name) => res.append('Set-Cookie', cookieString(name, '', 0));

  async function currentSession(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return token ? verifyOwn(token, 'session') : null;
  }

  function isConfigured(res) {
    if (config.disabled) return true;
    if (!missing.length) return true;
    console.error(`[auth] not configured, refusing request. Missing: ${missing.join(', ')}`);
    res.status(503).json({ error: 'Authentication is not configured' });
    return false;
  }

  function requireAuth(req, res, next) {
    if (config.disabled) return next();
    if (!isConfigured(res)) return undefined;
    currentSession(req).then((session) => {
      if (session) {
        req.user = { sub: session.sub, email: session.email, name: session.name };
        return next();
      }
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
      return res.redirect(302, `/auth/login?return_to=${encodeURIComponent(safeReturnTo(req.originalUrl, config.publicUrl))}`);
    }).catch(next);
  }

  async function login(req, res) {
    if (config.disabled) return res.redirect(302, '/');
    if (!isConfigured(res)) return undefined;
    try {
      const doc = await discover();
      const state = b64url(crypto.randomBytes(24));
      const nonce = b64url(crypto.randomBytes(24));
      const verifier = b64url(crypto.randomBytes(48));
      const returnTo = safeReturnTo(req.query.return_to, config.publicUrl);
      const flow = await sign({ state, nonce, verifier, returnTo }, FLOW_MAX_AGE_S, 'flow');

      const url = new URL(doc.authorization_endpoint);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPE);
      url.searchParams.set('redirect_uri', `${config.publicUrl}/auth/callback`);
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', b64url(sha256(verifier)));
      url.searchParams.set('code_challenge_method', 'S256');

      res.append('Set-Cookie', cookieString(FLOW_COOKIE, flow, FLOW_MAX_AGE_S));
      return res.redirect(302, url.toString());
    } catch (error) {
      console.error('[auth] login failed:', error.message);
      return res.status(503).type('text').send('Sign-in is temporarily unavailable. Try again shortly.');
    }
  }

  async function callback(req, res) {
    if (config.disabled) return res.redirect(302, '/');
    if (!isConfigured(res)) return undefined;
    const fail = (status, message) => {
      clearCookie(res, FLOW_COOKIE);
      return res.status(status).type('text').send(message);
    };
    try {
      const flowToken = parseCookies(req.headers.cookie)[FLOW_COOKIE];
      const flow = flowToken ? await verifyOwn(flowToken, 'flow') : null;
      if (!flow) return fail(400, 'Sign-in expired or was not started here. Go back and try again.');
      if (req.query.error) return fail(401, `Sign-in was not completed (${String(req.query.error).slice(0, 80)}).`);
      if (typeof req.query.code !== 'string' || typeof req.query.state !== 'string' || !safeEqual(req.query.state, flow.state)) {
        return fail(400, 'Invalid sign-in response.');
      }

      const doc = await discover();
      const tokenResponse = await fetchImpl(doc.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: `${config.publicUrl}/auth/callback`,
          code_verifier: flow.verifier,
        }).toString(),
      });
      if (!tokenResponse.ok) {
        console.error(`[auth] token exchange failed (${tokenResponse.status})`);
        return fail(401, 'Sign-in failed.');
      }
      const tokens = await tokenResponse.json();
      if (typeof tokens.id_token !== 'string') return fail(401, 'Sign-in failed.');

      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: config.issuer,
        audience: config.clientId,
        currentDate: new Date(now()),
      });
      if (!payload.nonce || !safeEqual(payload.nonce, flow.nonce)) return fail(401, 'Sign-in failed.');

      const session = await sign(
        { sub: payload.sub, email: payload.email, name: payload.name, idt: tokens.id_token },
        SESSION_MAX_AGE_S,
        'session',
      );
      clearCookie(res, FLOW_COOKIE);
      res.append('Set-Cookie', cookieString(SESSION_COOKIE, session, SESSION_MAX_AGE_S));
      return res.redirect(302, safeReturnTo(flow.returnTo, config.publicUrl));
    } catch (error) {
      console.error('[auth] callback failed:', error.message);
      return fail(401, 'Sign-in failed.');
    }
  }

  // POST /auth/logout: clear our session and tell the client where Okta's logout lives.
  async function logout(req, res) {
    const session = config.disabled ? null : await currentSession(req);
    clearCookie(res, SESSION_COOKIE);
    let redirect = '/';
    if (session && !missing.length) {
      try {
        const doc = await discover();
        if (doc.end_session_endpoint) {
          const url = new URL(doc.end_session_endpoint);
          url.searchParams.set('id_token_hint', session.idt);
          url.searchParams.set('post_logout_redirect_uri', `${config.publicUrl}/`);
          redirect = url.toString();
        }
      } catch (error) {
        console.error('[auth] logout discovery failed:', error.message);
      }
    }
    return res.json({ redirect });
  }

  function me(req, res) {
    res.json(req.user || { email: null, name: null });
  }

  return { requireAuth, login, callback, logout, me, missing };
}

module.exports = { createAuth, readConfig, missingConfig, safeReturnTo, SESSION_COOKIE, FLOW_COOKIE };
