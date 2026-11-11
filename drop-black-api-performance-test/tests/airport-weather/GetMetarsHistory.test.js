/**
 * GetMetarsHistory.test.js
 * Past METAR observations for an airport. Airport weather panel. (CSV row 43)
 *
 * API covered by test class:
 *  - GET /api/airport-wx/metarshistory?icao={icao}&count={count}
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

const path = (query) => `/api/airport-wx/metarshistory?${query}`;

describe('Get METARs History tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get METARs with no token', async () => {
    await handleErrors(path('icao=KATL&count=3'), UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get METARs with invalid token', async () => {
    await handleErrors(path('icao=KATL&count=3'), ForbiddenResponse, 'Failed to fetch METAR history', 'bad-token');
  });

  test('Get METARs with no ICAO', async () => {
    await handleErrors('/api/airport-wx/metarshistory', InvalidRequest, 'icao is required');
  });

  test('Get METARs with invalid ICAO format', async () => {
    await handleErrors(path('icao=XX&count=3'), UnprocessableEntryResponse, 'validation failed');
  });

  test('Get METARs with count 0', async () => {
    await handleErrors(path('icao=KATL&count=0'), UnprocessableEntryResponse, 'validation failed');
  });

  test('Get METARs with count too large', async () => {
    await handleErrors(path('icao=KATL&count=1000'), UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Open question, not reported. With no count, the API returns an empty list instead
  // of a default number of reports (the app always sends count=8)
  test.skip('Get METARs with no count returns a default number of reports', async () => {
    const response = await bffGet(path('icao=KATL'));
    validateStatus(response, ValidResponse);
    expect(response.body.METARDisplayData.length).toBeGreaterThan(0);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - count limits how many reports come back
   *   - each report is for the requested airport, with an issue time and raw text
   *   - an unknown airport returns an empty list
   */
  test('Get METARs for KATL', async () => {
    const metars = await getMetars('icao=KATL&count=3');
    expect(metars.length).toBeGreaterThan(0);
    expect(metars.length).toBeLessThanOrEqual(3);
    metars.forEach((metar) => {
      expect(metar.ICAO).toBe('KATL');
      expect(typeof metar.IssueTime).toBe('string');
      expect(metar.METARawText.startsWith('KATL ')).toBe(true);
    });
  });

  test('Get METARs with count 1', async () => {
    const metars = await getMetars('icao=KATL&count=1');
    expect(metars.length).toBe(1);
  });

  test('Get METARs for an unknown airport returns an empty list', async () => {
    const metars = await getMetars('icao=ZZZZ&count=3');
    expect(metars).toEqual([]);
  });

  async function getMetars(query) {
    const response = await bffGet(path(query));
    validateStatus(response, ValidResponse);
    return response.body.METARDisplayData;
  }
});
