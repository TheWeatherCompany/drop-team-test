/**
 * GetNearestStations.test.js
 * Nearest observation stations to a point. Model Verification observation source menu. (CSV row 33)
 *
 * API covered by test class:
 *  - GET /api/neareststations?latitude={latitude}&longitude={longitude}&limit={limit}
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

// Atlanta, which has several METAR stations close by
const point = 'latitude=33.75&longitude=-84.39';
const path = `/api/neareststations?${point}`;

describe('Get Nearest Stations tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get nearest stations with no token', async () => {
    await handleErrors(path, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get nearest stations with invalid token', async () => {
    await handleErrors(path, ForbiddenResponse, 'Failed to fetch nearest stations', 'bad-token');
  });

  test('Get nearest stations with no latitude or longitude', async () => {
    await handleErrors('/api/neareststations', InvalidRequest, 'latitude and longitude are required');
  });

  test('Get nearest stations with no longitude', async () => {
    await handleErrors('/api/neareststations?latitude=33.75', InvalidRequest, 'latitude and longitude are required');
  });

  test('Get nearest stations with non-numeric latitude', async () => {
    await handleErrors('/api/neareststations?latitude=abc&longitude=-84.39', UnprocessableEntryResponse, 'validation failed');
  });

  test('Get nearest stations with latitude out of range', async () => {
    await handleErrors('/api/neareststations?latitude=999&longitude=-84.39', UnprocessableEntryResponse, 'validation failed');
  });

  test('Get nearest stations with limit below 1', async () => {
    await handleErrors(`${path}&limit=0`, UnprocessableEntryResponse, 'validation failed');
  });

  test('Get nearest stations with limit above 25', async () => {
    await handleErrors(`${path}&limit=26`, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - default returns 3 stations
   *   - limit controls how many stations come back
   *   - each station has an ICAO code, distance and coordinates
   *   - stations are sorted closest first
   */
  test('Get nearest stations with default limit', async () => {
    const response = await bffGet(path);
    validateStatus(response, ValidResponse);

    const { stations } = response.body;
    expect(stations.length).toBe(3);
    stations.forEach((station) => {
      expect(typeof station.icao).toBe('string');
      expect(typeof station.distanceMiles).toBe('number');
      expect(typeof station.latitude).toBe('number');
      expect(typeof station.longitude).toBe('number');
    });
  });

  test('Get nearest stations with limit of 1', async () => {
    const response = await bffGet(`${path}&limit=1`);
    validateStatus(response, ValidResponse);

    expect(response.body.stations.length).toBe(1);
  });

  test('Get nearest stations with max limit of 25, sorted closest first', async () => {
    const response = await bffGet(`${path}&limit=25`);
    validateStatus(response, ValidResponse);

    const distances = response.body.stations.map((s) => s.distanceMiles);
    expect(distances.length).toBe(25);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });
});
