/**
 * GetDeskRoutesReport.test.js
 * Weather forecast report for every route on a desk. Weather-colorized route cards. (CSV row 11)
 *
 * API covered by test class:
 *  - GET /api/desks/{uid}/routes/report
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  NonexistentUid,
} = require('../__fixtures__/RequestResponse.fixture');
const { getTestDesk } = require('../__fixtures__/Desk.fixture');

describe('Get Desk Routes Report tests', () => {
  let testDesk;

  beforeAll(async () => {
    testDesk = await getTestDesk();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get routes report with no token', async () => {
    await handleErrors(`/api/desks/${testDesk.deskUid}/routes/report`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get routes report with invalid token', async () => {
    await handleErrors(`/api/desks/${testDesk.deskUid}/routes/report`, ForbiddenResponse, 'Failed to fetch routes report', 'bad-token');
  });

  test('Get routes report for nonexistent desk uid', async () => {
    await handleErrors(`/api/desks/${NonexistentUid}/routes/report`, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - desk_uid matches the requested desk
   *   - report includes the desk's route, with origin and destination
   */
  test('Get routes report for valid desk uid', async () => {
    const response = await bffGet(`/api/desks/${testDesk.deskUid}/routes/report`);
    validateStatus(response, ValidResponse);

    const report = response.body;
    expect(report.desk_uid).toBe(testDesk.deskUid);
    expect(Array.isArray(report.routes)).toBe(true);

    const route = report.routes.find((r) => r.route_uid === testDesk.routeUid);
    expect(route).toBeDefined();
    expect(typeof route.origin.timestamp).toBe('string');
    expect(typeof route.destination.timestamp).toBe('string');
    expect(new Date(route.destination.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(route.origin.timestamp).getTime());
  });
});
