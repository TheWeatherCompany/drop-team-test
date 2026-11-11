/**
 * GetDesks.test.js
 * Desk list. Mission Panel desk picker. (CSV row 1)
 *
 * API covered by test class:
 *  - GET /api/desks
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
} = require('../__fixtures__/RequestResponse.fixture');

const path = '/api/desks';

describe('Get Desks tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get desks with no token', async () => {
    await handleErrors(path, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get desks with invalid token', async () => {
    await handleErrors(path, ForbiddenResponse, 'Failed to fetch desks', 'bad-token');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is a list of desks
   *   - each desk has a uid, name, visibility, user_role, locations and routes
   */
  test('Get desks for logged in user', async () => {
    const response = await bffGet(path);
    validateStatus(response, ValidResponse);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    response.body.forEach((desk) => {
      expect(typeof desk.uid).toBe('string');
      expect(typeof desk.name).toBe('string');
      expect(['restricted', 'org_wide']).toContain(desk.visibility);
      expect(typeof desk.user_role).toBe('string');
      expect(Array.isArray(desk.locations)).toBe(true);
      expect(Array.isArray(desk.routes)).toBe(true);
    });
  });
});
