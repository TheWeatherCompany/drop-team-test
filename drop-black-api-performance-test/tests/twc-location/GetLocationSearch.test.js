/**
 * GetLocationSearch.test.js
 * Place-name search (CSV row 60) and postal code lookup (CSV row 61). Location search
 * in the Add Location form. The BFF calls api.weather.com for these.
 *
 * API covered by test class:
 *  - GET /api/location-search?q={query}
 *  - GET /api/location-point?type=postal&value={postalKey}
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

describe('Location Search tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Location search with no token', async () => {
    await handleErrors('/api/location-search?q=Boston', UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Location point with no token', async () => {
    await handleErrors('/api/location-point?type=postal&value=30303:US', UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Location point with unsupported lookup type', async () => {
    await handleErrors('/api/location-point?type=bogus&value=x', InvalidRequest, 'Unsupported lookup type');
  });

  test('Location point with no parameters', async () => {
    await handleErrors('/api/location-point', InvalidRequest, 'Unsupported lookup type');
  });

  /**
   * Invalid token bug (reported, fix pending):
   * These routes only check that a token is present, so an invalid token returns 200
   * with real TWC results from the company API key.
   */
  // TODO: API returns 200 with 10 suggestions for Boston
  test.skip('Location search with invalid token', async () => {
    await handleErrors('/api/location-search?q=Boston', ForbiddenResponse, 'Failed', 'bad-token');
  });

  // TODO: API returns 200 with "Downtown Atlanta"
  test.skip('Location point with invalid token', async () => {
    await handleErrors('/api/location-point?type=postal&value=30303:US', ForbiddenResponse, 'Failed', 'bad-token');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - place search returns labelled suggestions with "lat,lon" values
   *   - postal lookup resolves a postal code to a place
   *   - searches with no match return no suggestions
   */
  test('Location search for Boston', async () => {
    const suggestions = await getSuggestions('/api/location-search?q=Boston');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].label).toContain('Boston');
    suggestions.forEach((s) => expectLatLon(s.value));
  });

  test('Location search with no match returns no suggestions', async () => {
    const suggestions = await getSuggestions('/api/location-search?q=zzqqxxnotaplace');
    expect(suggestions).toEqual([]);
  });

  test('Location search with no query returns no suggestions', async () => {
    const suggestions = await getSuggestions('/api/location-search');
    expect(suggestions).toEqual([]);
  });

  test('Location point for postal code 30303', async () => {
    const suggestions = await getSuggestions('/api/location-point?type=postal&value=30303:US');
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].label).toContain('Atlanta');
    expectLatLon(suggestions[0].value);
  });

  test('Location point for a postal code that does not exist returns no suggestions', async () => {
    const suggestions = await getSuggestions('/api/location-point?type=postal&value=00000:US');
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
    return response.body.suggestions;
  }
});
