/**
 * GetFlightNotams.test.js
 * NOTAMs for a flight. NOTAMs page. (CSV row 45)
 *
 * API covered by test class:
 *  - GET /api/notams/flightnotams?departure={departure}&destination={destination}&flightnumber={flightnumber}&route={route}
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

const path = (query) => `/api/notams/flightnotams?${query}`;
const flight = 'departure=KATL&destination=KBOS&flightnumber=DAL123&route=KATL%20KBOS';

describe('Get Flight NOTAMs tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get flight NOTAMs with no token', async () => {
    await handleErrors(path(flight), UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get flight NOTAMs with invalid token', async () => {
    await handleErrors(path(flight), ForbiddenResponse, 'Failed to fetch flight NOTAMs', 'bad-token');
  });

  test('Get flight NOTAMs with no parameters', async () => {
    await handleErrors('/api/notams/flightnotams', InvalidRequest, 'Invalid ICAO code');
  });

  test('Get flight NOTAMs with no destination', async () => {
    await handleErrors(path('departure=KATL'), InvalidRequest, 'Invalid ICAO code');
  });

  test('Get flight NOTAMs with no flight number or route', async () => {
    await handleErrors(path('departure=KATL&destination=KBOS'), InvalidRequest, 'flightnumber and route are required');
  });

  test('Get flight NOTAMs with invalid destination', async () => {
    await handleErrors(path('departure=KATL&destination=XX&flightnumber=DAL123&route=KATL%20XX'),
      UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - NOTAMs for Atlanta to Boston include both airports
   */
  test('Get flight NOTAMs for KATL to KBOS', async () => {
    const response = await bffGet(path(flight));
    validateStatus(response, ValidResponse);

    const notams = response.body;
    expect(notams.length).toBeGreaterThan(0);
    notams.forEach((notam) => {
      expect(typeof notam.notamId).toBe('string');
      expect(typeof notam.notamText).toBe('string');
    });
    const airports = notams.map((n) => n.icaoIds).join(' ');
    expect(airports).toContain('KATL');
    expect(airports).toContain('KBOS');
  });
});
