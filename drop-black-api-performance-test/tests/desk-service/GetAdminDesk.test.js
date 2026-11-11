/**
 * GetAdminDesk.test.js
 * Who has access to one desk. Admin desk audit detail. (CSV row 18)
 *
 * API covered by test class:
 *  - GET /api/admin/desks/{uid}
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
  NonexistentUid,
} = require('../__fixtures__/RequestResponse.fixture');
const { getTestDesk } = require('../__fixtures__/Desk.fixture');

describe('Get Admin Desk tests', () => {
  let testDesk;

  beforeAll(async () => {
    testDesk = await getTestDesk();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get admin desk with no token', async () => {
    await handleErrors(`/api/admin/desks/${testDesk.deskUid}`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get admin desk with invalid token', async () => {
    await handleErrors(`/api/admin/desks/${testDesk.deskUid}`, ForbiddenResponse, 'Failed to fetch desk access detail', 'bad-token');
  });

  test('Get admin desk for nonexistent uid', async () => {
    await handleErrors(`/api/admin/desks/${NonexistentUid}`, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Get admin desk for invalid uid', async () => {
    await handleErrors('/api/admin/desks/not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid matches the requested desk
   *   - permissions list each user's role and who granted it
   *     (permissions is null, not [], when the desk is shared with no one)
   */
  test('Get admin desk for valid uid', async () => {
    const response = await bffGet(`/api/admin/desks/${testDesk.deskUid}`);
    validateStatus(response, ValidResponse);

    const desk = response.body;
    expect(desk.uid).toBe(testDesk.deskUid);
    expect(typeof desk.access_count).toBe('number');
    expect(desk.permissions === null || Array.isArray(desk.permissions)).toBe(true);
    (desk.permissions ?? []).forEach((permission) => {
      expect(typeof permission.user_id).toBe('string');
      expect(typeof permission.role).toBe('string');
      expect(typeof permission.granted_by_user_id).toBe('string');
    });
  });
});
