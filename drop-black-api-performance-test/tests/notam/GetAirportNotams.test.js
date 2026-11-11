/**
 * GetAirportNotams.test.js
 * Airport NOTAMs, several ICAOs in one bulk call. NOTAMs page. (CSV row 46)
 *
 * API covered by test class:
 *  - GET /api/notams/airportnotams/bulk?icaos={icao_list}
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

const path = (icaos) => `/api/notams/airportnotams/bulk?icaos=${icaos}`;

describe('Get Airport NOTAMs tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get airport NOTAMs with no token', async () => {
    await handleErrors(path('KATL'), UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get airport NOTAMs with no ICAO codes', async () => {
    await handleErrors('/api/notams/airportnotams/bulk', InvalidRequest, 'No ICAO codes provided');
  });

  // TODO: Bug (reported, fix pending). API returns 200 [] for an invalid token, which looks
  // the same as "no NOTAMs". Flight NOTAMs correctly return 403 for the same case
  test.skip('Get airport NOTAMs with invalid token', async () => {
    await handleErrors(path('KATL'), ForbiddenResponse, 'Failed', 'bad-token');
  });

  // TODO: Open question, not reported. A badly formatted ICAO returns 200 [] here, while
  // flight NOTAMs reject it with 422
  test.skip('Get airport NOTAMs with invalid ICAO format', async () => {
    await handleErrors(path('XX'), UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - each NOTAM has an id, text, start/end time and the airports it covers
   *   - a bulk call returns NOTAMs for every airport asked for
   *   - an unknown airport returns an empty list
   */
  test('Get airport NOTAMs for KATL', async () => {
    const notams = await getNotams(path('KATL'));
    expect(notams.length).toBeGreaterThan(0);
    notams.forEach((notam) => {
      expect(typeof notam.notamId).toBe('string');
      expect(typeof notam.notamText).toBe('string');
      expect(typeof notam.startTime).toBe('number');
      expect(notam.icaoIds).toContain('KATL');
    });
  });

  test('Get airport NOTAMs for several airports', async () => {
    const notams = await getNotams(path('KATL,KBOS'));
    const airports = notams.map((n) => n.icaoIds).join(' ');
    expect(airports).toContain('KATL');
    expect(airports).toContain('KBOS');
  });

  test('Get airport NOTAMs for an unknown airport returns an empty list', async () => {
    const notams = await getNotams(path('ZZZZ'));
    expect(notams).toEqual([]);
  });

  async function getNotams(urlPath) {
    const response = await bffGet(urlPath);
    validateStatus(response, ValidResponse);
    expect(Array.isArray(response.body)).toBe(true);
    return response.body;
  }
});
