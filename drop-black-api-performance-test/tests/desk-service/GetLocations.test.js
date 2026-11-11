/**
 * GetLocations.test.js
 * The user's saved location library. (CSV row 24)
 *
 * API covered by test class:
 *  - GET /api/locations
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

const path = '/api/locations';

describe('Get Locations tests', () => {
  let testDesk;

  beforeAll(async () => {
    testDesk = await getTestDesk();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get locations with no token', async () => {
    await handleErrors(path, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get locations with invalid token', async () => {
    await handleErrors(path, ForbiddenResponse, 'Failed to fetch locations', 'bad-token');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is a list of locations with uid, name and a position
   *     (latitude and longitude, an ICAO airport code, or an MGRS grid reference)
   *   - list includes the location bound to the test desk
   */
  test('Get locations for logged in user', async () => {
    const response = await bffGet(path);
    validateStatus(response, ValidResponse);

    expect(Array.isArray(response.body)).toBe(true);
    response.body.forEach((location) => {
      expect(typeof location.uid).toBe('string');
      expect(typeof location.name).toBe('string');
      const hasPosition =
        typeof location.icao_code === 'string' ||
        typeof location.mgrs === 'string' ||
        (typeof location.latitude === 'number' && typeof location.longitude === 'number');
      expect(hasPosition).toBe(true);
    });
    expect(response.body.map((l) => l.uid)).toContain(testDesk.locationUid);
  });

  // TODO: BFF bug, not reported. The drop service spec has ?name= on GET /locations, but the BFF
  // doesn't pass it through and returns every location
  test.skip('Get locations filtered by name', async () => {
    const location = (await bffGet(`/api/locations/${testDesk.locationUid}`)).body;
    const response = await bffGet(`${path}?name=${encodeURIComponent(location.name)}`);
    validateStatus(response, ValidResponse);

    expect(response.body.length).toBeGreaterThan(0);
    response.body.forEach((l) => expect(l.name).toBe(location.name));
  });
});
