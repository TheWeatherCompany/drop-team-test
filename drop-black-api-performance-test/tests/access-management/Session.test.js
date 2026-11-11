/**
 * Session.test.js
 * Validates or extends the login session (CSV row 52), one user's identity (CSV row 56),
 * and soundings access. Auth.
 *
 * API covered by test class:
 *  - POST /api/auth/ams-session
 *  - GET  /api/auth/identity?id={id}
 *  - GET  /api/soundings/access
 *
 * Not covered here: logout, and the people management endpoints (create, edit,
 * delete and invite users), because they change real accounts.
 */
const {
  bffGet,
  bffSend,
  validateStatus,
  handleErrors,
  ValidResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');

const LOGIN_URL = process.env.LOGIN_URL || 'https://drop-acct-dev.weather.com/api/auth/login';

/**
 * Log in and return the session cookie the app uses to refresh the JWT
 */
async function loginSessionCookie() {
  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      application: 'dropblack',
      email: process.env.LOGIN_EMAIL,
      password: process.env.LOGIN_PASSWORD,
      mode: 'password',
    }),
  });
  expect(res.status).toBe(ValidResponse);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

describe('Session tests', () => {
  let sessionCookie;

  beforeAll(async () => {
    sessionCookie = await loginSessionCookie();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Refresh session with no session cookie', async () => {
    const response = await bffSend('POST', '/api/auth/ams-session', {}, null);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.active).toBe(false);
  });

  test('Refresh session with invalid session cookie', async () => {
    const badCookie = sessionCookie.replace(/=(.{6})/, '=XXXXXX');
    const response = await bffSend('POST', '/api/auth/ams-session', {}, null).set('Cookie', badCookie);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.active).toBe(false);
  });

  test('Get identity with no token', async () => {
    await handleErrors(`/api/auth/identity?id=${process.env.DROP_IDENTITY_ID}`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get identity with no id', async () => {
    await handleErrors('/api/auth/identity', InvalidRequest, 'Identity ID is required');
  });

  // TODO: Open question, not reported (needs an answer). This test FAILS ON PURPOSE.
  // Since 2026-11-11, GET /api/soundings/access returns the BFF's HTML 404 page for every
  // request, so the route is missing from the BFF. Removed, renamed or broken?
  // If removed, delete these tests and the Postman request; if renamed, update the path
  test('Get soundings access with no token', async () => {
    const response = await bffGet('/api/soundings/access', null);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.allowed).toBe(false);
  });

  /**
   * Identity error bug (reported, fix pending):
   * The identity route returns 200 {"roles": null} for an invalid token, an unknown ID
   * or an invalid ID, so every failure looks like "no roles".
   */
  // TODO: API returns 200 {"roles": null}
  test.skip('Get identity with invalid token', async () => {
    await handleErrors(`/api/auth/identity?id=${process.env.DROP_IDENTITY_ID}`, ForbiddenResponse, 'Failed', 'bad-token');
  });

  // TODO: API returns 200 {"roles": null}
  test.skip('Get identity for an unknown id', async () => {
    const response = await bffGet('/api/auth/identity?id=3b9830df-0000-0000-0000-000000000000');
    validateStatus(response, NotFoundResponse);
  });

  // TODO: API returns 200 {"roles": null}
  test.skip('Get identity for an invalid id', async () => {
    const response = await bffGet('/api/auth/identity?id=not-a-uuid');
    validateStatus(response, UnprocessableEntryResponse);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - refreshing with the session cookie returns an active session and a new JWT
   *   - identity returns the user's email, customer and roles
   *   - soundings access returns allowed true or false
   */
  test('Refresh session with session cookie', async () => {
    const response = await bffSend('POST', '/api/auth/ams-session', {}, null).set('Cookie', sessionCookie);
    validateStatus(response, ValidResponse);
    expect(response.body.active).toBe(true);
    expect(response.body.jwt.split('.').length).toBe(3);
    expect(new Date(response.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test('Get own identity', async () => {
    const response = await bffGet(`/api/auth/identity?id=${process.env.DROP_IDENTITY_ID}`);
    validateStatus(response, ValidResponse);

    const identity = response.body;
    expect(identity.id).toBe(process.env.DROP_IDENTITY_ID);
    expect(identity.email.toLowerCase()).toBe(process.env.LOGIN_EMAIL.toLowerCase());
    expect(typeof identity.customer_id).toBe('string');
    expect(Array.isArray(identity.roles)).toBe(true);
    // The app treats drop.global.<customer>.admin as an admin
    identity.roles.forEach((role) => expect(role).toMatch(/^drop\./));
  });

  // TODO: Open question, not reported (needs an answer). This test FAILS ON PURPOSE.
  // Same as "Get soundings access with no token" above: the route returns the BFF's HTML 404 page
  test('Get soundings access', async () => {
    const response = await bffGet('/api/soundings/access');
    validateStatus(response, ValidResponse);
    expect(typeof response.body.allowed).toBe('boolean');
  });
});
