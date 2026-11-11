/**
 * GetLocation.test.js
 * One location's definition. (CSV row 26)
 *
 * API covered by test class:
 *  - GET /api/locations/{uid}
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

describe('Get Location tests', () => {
  let testDesk;

  beforeAll(async () => {
    testDesk = await getTestDesk();
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get location with no token', async () => {
    await handleErrors(`/api/locations/${testDesk.locationUid}`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get location with invalid token', async () => {
    await handleErrors(`/api/locations/${testDesk.locationUid}`, ForbiddenResponse, 'Failed to fetch location', 'bad-token');
  });

  test('Get nonexistent location uid', async () => {
    await handleErrors(`/api/locations/${NonexistentUid}`, NotFoundResponse, `location uid ${NonexistentUid} not found`);
  });

  test('Get invalid location uid', async () => {
    await handleErrors('/api/locations/not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid matches the requested location
   *   - location has a position: valid latitude and longitude, an ICAO airport code,
   *     or an MGRS grid reference
   */
  test('Get location for valid uid', async () => {
    const response = await bffGet(`/api/locations/${testDesk.locationUid}`);
    validateStatus(response, ValidResponse);

    const location = response.body;
    expect(location.uid).toBe(testDesk.locationUid);
    expect(typeof location.name).toBe('string');
    if (location.latitude !== undefined) {
      expect(location.latitude).toBeGreaterThanOrEqual(-90);
      expect(location.latitude).toBeLessThanOrEqual(90);
      expect(location.longitude).toBeGreaterThanOrEqual(-180);
      expect(location.longitude).toBeLessThanOrEqual(180);
    } else {
      expect(typeof location.icao_code === 'string' || typeof location.mgrs === 'string').toBe(true);
    }
  });
});
