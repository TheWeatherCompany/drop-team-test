/**
 * GetAdminDesks.test.js
 * Audit list of all desks. Admin desk audit page. (CSV row 17)
 *
 * API covered by test class:
 *  - GET /api/admin/desks
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
} = require('../__fixtures__/RequestResponse.fixture');
const { getTestDesk } = require('../__fixtures__/Desk.fixture');

const path = '/api/admin/desks';

describe('Get Admin Desks tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get admin desks with no token', async () => {
    await handleErrors(path, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get admin desks with invalid token', async () => {
    await handleErrors(path, ForbiddenResponse, 'Failed to fetch desk audit list', 'bad-token');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is a list of desks with uid, name, visibility and access_count
   *   - list includes the test user's desk
   */
  test('Get admin desks for logged in admin', async () => {
    const testDesk = await getTestDesk();
    const response = await bffGet(path);
    validateStatus(response, ValidResponse);

    expect(Array.isArray(response.body)).toBe(true);
    response.body.forEach((desk) => {
      expect(typeof desk.uid).toBe('string');
      expect(typeof desk.name).toBe('string');
      expect(['restricted', 'org_wide']).toContain(desk.visibility);
      expect(typeof desk.access_count).toBe('number');
    });
    expect(response.body.map((d) => d.uid)).toContain(testDesk.deskUid);
  });
});
