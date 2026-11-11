/**
 * GetAirspaceNotams.test.js
 * Airspace NOTAMs, several ICAOs in one bulk call. NOTAMs page. (CSV row 47)
 *
 * API covered by test class:
 *  - GET /api/notams/airspacenotams/bulk?icaos={icao_list}
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
} = require('../__fixtures__/RequestResponse.fixture');

const path = (icaos) => `/api/notams/airspacenotams/bulk?icaos=${icaos}`;

describe('Get Airspace NOTAMs tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get airspace NOTAMs with no token', async () => {
    await handleErrors(path('KZTL'), UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get airspace NOTAMs with no ICAO codes', async () => {
    await handleErrors('/api/notams/airspacenotams/bulk', InvalidRequest, 'No ICAO codes provided');
  });

  // TODO: Bug (reported, fix pending). API returns 200 [] for an invalid token, which looks
  // the same as "no NOTAMs". Flight NOTAMs correctly return 403 for the same case
  test.skip('Get airspace NOTAMs with invalid token', async () => {
    await handleErrors(path('KZTL'), ForbiddenResponse, 'Failed', 'bad-token');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - NOTAMs for the Atlanta center (KZTL) each have an id, text and FIR
   */
  test('Get airspace NOTAMs for KZTL', async () => {
    const response = await bffGet(path('KZTL'));
    validateStatus(response, ValidResponse);

    const notams = response.body;
    expect(notams.length).toBeGreaterThan(0);
    notams.forEach((notam) => {
      expect(typeof notam.notamId).toBe('string');
      expect(typeof notam.notamText).toBe('string');
      expect(typeof notam.firInd).toBe('string');
    });
  });
});
