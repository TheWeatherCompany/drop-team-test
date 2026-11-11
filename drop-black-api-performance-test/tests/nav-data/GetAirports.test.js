/**
 * GetAirports.test.js
 * Airport reference points by ICAO, IATA or FAA code. Location picker and search
 * coordinate correction. (CSV row 48)
 *
 * API covered by test class:
 *  - GET /api/airports?q={code}&limit={limit}
 *  - GET /api/airports?icaos={icao_list}
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

describe('Get Airports tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get airports with no token', async () => {
    await handleErrors('/api/airports?q=KATL', UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get airports with invalid token', async () => {
    await handleErrors('/api/airports?q=KATL', ForbiddenResponse, 'Failed to fetch airports', 'bad-token');
  });

  test('Get airports with no q or icaos', async () => {
    await handleErrors('/api/airports', InvalidRequest, 'q or icaos is required');
  });

  test('Get airports with non-numeric limit', async () => {
    await handleErrors('/api/airports?q=KATL&limit=abc', UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - ICAO, IATA and FAA codes all find the airport
   *   - each suggestion has a label, "lat,lon" value and codes
   *   - icaos looks up several airports at once
   *   - an unknown code returns no suggestions
   */
  test('Get airport by ICAO code', async () => {
    const [airport] = await getSuggestions('/api/airports?q=KATL');
    expect(airport).toMatchObject({ id: 'airport:KATL', icao: 'KATL', iata: 'ATL', faa: 'ATL' });
    expect(airport.label).toContain('ATLANTA');
    expectLatLon(airport.value);
  });

  test('Get airport by IATA code', async () => {
    const suggestions = await getSuggestions('/api/airports?q=ATL');
    expect(suggestions.map((s) => s.icao)).toContain('KATL');
  });

  test('Get airport by FAA code', async () => {
    const suggestions = await getSuggestions('/api/airports?q=PDK');
    expect(suggestions.map((s) => s.icao)).toContain('KPDK');
  });

  test('Get airport with a lowercase code', async () => {
    const suggestions = await getSuggestions('/api/airports?q=katl');
    expect(suggestions.map((s) => s.icao)).toContain('KATL');
  });

  test('Get airport with limit 1', async () => {
    const suggestions = await getSuggestions('/api/airports?q=KATL&limit=1');
    expect(suggestions.length).toBe(1);
  });

  test('Get several airports by ICAO list', async () => {
    const suggestions = await getSuggestions('/api/airports?icaos=KATL,KBOS,EGLL');
    expect(suggestions.map((s) => s.icao).sort()).toEqual(['EGLL', 'KATL', 'KBOS']);
    suggestions.forEach((s) => expectLatLon(s.value));
  });

  test('Get airport with an unknown code returns no suggestions', async () => {
    const suggestions = await getSuggestions('/api/airports?q=ZZZZ');
    expect(suggestions).toEqual([]);
  });

  function expectLatLon(value) {
    const [lat, lon] = value.split(',').map(Number);
    expect(lat).toBeGreaterThanOrEqual(-90);
    expect(lat).toBeLessThanOrEqual(90);
    expect(lon).toBeGreaterThanOrEqual(-180);
    expect(lon).toBeLessThanOrEqual(180);
  }

  async function getSuggestions(path) {
    const response = await bffGet(path);
    validateStatus(response, ValidResponse);
    expect(Array.isArray(response.body.suggestions)).toBe(true);
    return response.body.suggestions;
  }
});
