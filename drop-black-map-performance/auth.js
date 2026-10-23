const crypto = require('crypto');

// Hosted-login gate for the config builder, mirroring drop-black's BED-499 flow:
// the hosted login app (bedrock-account-ui) sets a shared .weather.com session cookie, and
// Bedrock Access Management (AMS) tells us whether that cookie is a live session.
// Anyone who can sign in to Drop gets in — there is no per-feature permission check.

const DEFAULT_APPLICATION = 'dropblack';
const CACHE_TTL_MS = 30 * 1000;

function trimSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function readConfig(env = process.env) {
  return {
    disabled: env.AUTH_DISABLED === 'true',
    application: (env.AMS_APPLICATION || DEFAULT_APPLICATION).trim(),
    amsHost: trimSlash(env.AMS_BASE_URL || env.ACCESS_MANAGEMENT_HOST),
    accountAppUrl: trimSlash(env.ACCOUNT_APP_URL || env.NEXT_PUBLIC_ACCOUNT_APP_URL),
    // Where this app is reachable. Used to build return_to so a spoofed Host header can't redirect elsewhere.
    publicUrl: trimSlash(env.APP_PUBLIC_URL),
  };
}

// Fail closed: a deploy missing any of these must not silently serve the app unauthenticated.
function missingConfig(config) {
  if (config.disabled) return [];
  return [
    ['AMS_BASE_URL (or ACCESS_MANAGEMENT_HOST)', config.amsHost],
    ['ACCOUNT_APP_URL', config.accountAppUrl],
    ['APP_PUBLIC_URL', config.publicUrl],
  ].filter(([, value]) => !value).map(([name]) => name);
}

function buildLoginUrl(config, returnPath) {
  const url = new URL('/auth/login', config.accountAppUrl);
  url.searchParams.set('application', config.application);
  url.searchParams.set('return_to', `${config.publicUrl}${returnPath}`);
  return url.toString();
}

function createAuth(config, { fetchImpl = fetch, now = Date.now } = {}) {
  const missing = missingConfig(config);
  const cache = new Map();

  function amsHeaders(req) {
    return {
      'Content-Type': 'application/json',
      Cookie: req.headers.cookie || '',
      'X-Application': config.application,
    };
  }

  // Resolves to 'active' | 'inactive' | 'error' (AMS unreachable / misbehaving).
  async function checkSession(req) {
    const cookie = req.headers.cookie || '';
    if (!cookie) return 'inactive';

    const key = crypto.createHash('sha256').update(cookie).digest('hex');
    const hit = cache.get(key);
    if (hit && hit > now()) return 'active';
    cache.delete(key);

    try {
      const response = await fetchImpl(`${config.amsHost}/authentication/session`, {
        method: 'POST',
        headers: amsHeaders(req),
      });
      if (response.status === 401 || response.status === 403) return 'inactive';
      if (!response.ok) {
        console.error(`[auth] AMS responded ${response.status} from ${config.amsHost}/authentication/session`);
        return 'error';
      }
      const body = await response.json();
      if (!body || body.active !== true) return 'inactive';
      cache.set(key, now() + CACHE_TTL_MS);
      return 'active';
    } catch (error) {
      console.error('[auth] session check failed:', error.message);
      return 'error';
    }
  }

  function requireAuth(req, res, next) {
    if (config.disabled) return next();
    if (missing.length) {
      console.error(`[auth] not configured, refusing request. Missing: ${missing.join(', ')}`);
      return res.status(503).json({ error: 'Authentication is not configured' });
    }

    checkSession(req).then((result) => {
      if (result === 'active') return next();
      const isApi = req.path.startsWith('/api/');
      if (result === 'error') {
        // Don't bounce to login on an AMS outage: the user may be signed in and would loop.
        return isApi
          ? res.status(503).json({ error: 'Authentication service unavailable' })
          : res.status(503).type('text').send('Authentication service unavailable. Try again shortly.');
      }
      if (isApi) return res.status(401).json({ error: 'Not signed in' });
      return res.redirect(302, buildLoginUrl(config, req.originalUrl));
    }).catch(next);
  }

  // POST /auth/logout: revoke the AMS session and pass its cookie-clearing Set-Cookie headers back.
  async function logout(req, res) {
    if (config.disabled || missing.length) return res.status(204).end();
    try {
      const response = await fetchImpl(`${config.amsHost}/authentication/logout`, {
        method: 'POST',
        headers: amsHeaders(req),
      });
      cache.clear();
      if (!response.ok) return res.status(response.status).end();
      const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
      for (const cookie of setCookies) res.append('Set-Cookie', cookie);
      return res.status(204).end();
    } catch (error) {
      console.error('[auth] logout failed:', error.message);
      return res.status(500).json({ error: 'logout failed' });
    }
  }

  return { requireAuth, logout, missing };
}

module.exports = { createAuth, readConfig, missingConfig, buildLoginUrl };
