/**
 * GetDesk.test.js
 * One desk's metadata and its route and location bindings. (CSV row 3)
 *
 * API covered by test class:
 *  - GET /api/desks/{uid}
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

describe('Get Desk tests', () => {
  let testDesk;

  beforeAll(async () => {
    testDesk = await getTestDesk();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get desk with no token', async () => {
    await handleErrors(`/api/desks/${testDesk.deskUid}`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get desk with invalid token', async () => {
    await handleErrors(`/api/desks/${testDesk.deskUid}`, ForbiddenResponse, 'Failed to fetch desk', 'bad-token');
  });

  test('Get nonexistent desk uid', async () => {
    await handleErrors(`/api/desks/${NonexistentUid}`, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Get invalid desk uid', async () => {
    await handleErrors('/api/desks/not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid matches the requested desk
   *   - locations and routes contain the desk's bindings
   */
  test('Get desk for valid uid', async () => {
    const response = await bffGet(`/api/desks/${testDesk.deskUid}`);
    validateStatus(response, ValidResponse);

    const desk = response.body;
    expect(desk.uid).toBe(testDesk.deskUid);
    expect(typeof desk.name).toBe('string');
    expect(['restricted', 'org_wide']).toContain(desk.visibility);
    expect(desk.locations.map((l) => l.item_uid)).toContain(testDesk.locationUid);
    expect(desk.routes.map((r) => r.item_uid)).toContain(testDesk.routeUid);
  });
});
