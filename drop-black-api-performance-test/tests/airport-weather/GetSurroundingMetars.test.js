/**
 * GetSurroundingMetars.test.js
 * METARs from airports near a point. (CSV row 44)
 *
 * API covered by test class:
 *  - GET /api/airport-wx/surroundingmetars?latitude={latitude}&longitude={longitude}&radius={radius}&limit={limit}
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');

const path = (query) => `/api/airport-wx/surroundingmetars?${query}`;
// Atlanta
const point = 'latitude=33.64&longitude=-84.43';

describe('Get Surrounding METARs tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get surrounding METARs with no token', async () => {
    await handleErrors(path(`${point}&radius=50&limit=5`), UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get surrounding METARs with invalid token', async () => {
    await handleErrors(path(`${point}&radius=50&limit=5`), ForbiddenResponse, 'Failed to fetch surrounding METARs', 'bad-token');
  });

  test('Get surrounding METARs with no latitude', async () => {
    await handleErrors(path('longitude=-84.43'), InvalidRequest, 'latitude and longitude are required');
  });

  test('Get surrounding METARs with latitude out of range', async () => {
    await handleErrors(path('latitude=91&longitude=0'), UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - limit caps how many airports come back
   *   - each METAR has an airport code, issue time and raw text
   *   - a point in the open ocean returns an empty list
   */
  test('Get surrounding METARs near Atlanta', async () => {
    const metars = await getMetars(`${point}&radius=50&limit=5`);
    expect(metars.length).toBeGreaterThan(0);
    expect(metars.length).toBeLessThanOrEqual(5);
    metars.forEach((metar) => {
      expect(metar.ICAO).toMatch(/^[A-Z0-9]{3,4}$/);
      expect(typeof metar.IssueTime).toBe('string');
      // Raw text can start with the station ("KATL 23...") or the report type ("METAR KMGE 23...")
      expect(metar.METARawText).toContain(metar.ICAO);
    });
  });

  test('Get surrounding METARs in the open ocean returns an empty list', async () => {
    const metars = await getMetars('latitude=0&longitude=-30&radius=10&limit=5');
    expect(metars).toEqual([]);
  });

  async function getMetars(query) {
    const response = await bffGet(path(query));
    validateStatus(response, ValidResponse);
    return response.body.METARDisplayData;
  }
});
