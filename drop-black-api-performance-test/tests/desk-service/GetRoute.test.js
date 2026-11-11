/**
 * GetRoute.test.js
 * One route's definition. (CSV row 21)
 *
 * API covered by test class:
 *  - GET /api/routes/{uid}
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

describe('Get Route tests', () => {
  let testDesk;

  beforeAll(async () => {
    testDesk = await getTestDesk();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get route with no token', async () => {
    await handleErrors(`/api/routes/${testDesk.routeUid}`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get route with invalid token', async () => {
    await handleErrors(`/api/routes/${testDesk.routeUid}`, ForbiddenResponse, 'Failed to fetch route', 'bad-token');
  });

  test('Get nonexistent route uid', async () => {
    await handleErrors(`/api/routes/${NonexistentUid}`, NotFoundResponse, `route uid ${NonexistentUid} not found`);
  });

  test('Get invalid route uid', async () => {
    await handleErrors('/api/routes/not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid matches the requested route
   *   - each point has a flight level, timestamp and a position
   *     (an ICAO code, an MGRS grid reference, or latitude and longitude)
   */
  test('Get route for valid uid', async () => {
    const response = await bffGet(`/api/routes/${testDesk.routeUid}`);
    validateStatus(response, ValidResponse);

    const route = response.body;
    expect(route.uid).toBe(testDesk.routeUid);
    expect(typeof route.name).toBe('string');
    expect(route.points.length).toBeGreaterThan(0);
    route.points.forEach((point) => {
      const hasPosition =
        typeof point.icao === 'string' ||
        typeof point.mgrs === 'string' ||
        (typeof point.latitude === 'number' && typeof point.longitude === 'number');
      expect(hasPosition).toBe(true);
      expect(typeof point.flight_level).toBe('string');
      expect(typeof point.timestamp).toBe('string');
    });
  });
});
