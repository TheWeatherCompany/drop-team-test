/**
 * GetDeskLocationsReport.test.js
 * Forecast report for every location on a desk. Location cards. (CSV row 15)
 *
 * API covered by test class:
 *  - GET /api/desks/{uid}/locations/report
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

describe('Get Desk Locations Report tests', () => {
  let testDesk;

  beforeAll(async () => {
    testDesk = await getTestDesk();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get locations report with no token', async () => {
    await handleErrors(`/api/desks/${testDesk.deskUid}/locations/report`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get locations report with invalid token', async () => {
    await handleErrors(`/api/desks/${testDesk.deskUid}/locations/report`, ForbiddenResponse, 'Failed to fetch locations report', 'bad-token');
  });

  test('Get locations report for nonexistent desk uid', async () => {
    await handleErrors(`/api/desks/${NonexistentUid}/locations/report`, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - desk_uid matches the requested desk
   *   - report includes the desk's location, with daily forecast entries
   */
  test('Get locations report for valid desk uid', async () => {
    const response = await bffGet(`/api/desks/${testDesk.deskUid}/locations/report`);
    validateStatus(response, ValidResponse);

    const report = response.body;
    expect(report.desk_uid).toBe(testDesk.deskUid);
    expect(Array.isArray(report.locations)).toBe(true);

    const location = report.locations.find((l) => l.location_uid === testDesk.locationUid);
    expect(location).toBeDefined();
    expect(location.daily.length).toBeGreaterThan(0);
  });
});
