/**
 * MaritimeMeteogram.test.js
 * Marine meteogram data (waves, seas). Bottom drawer Maritime tab. (CSV row 30)
 * Read-only: POST is used to send options, nothing is saved.
 *
 * API covered by test class:
 *  - POST /api/maritimemeteogram
 */
const {
  bffSend,
  validateStatus,
  ValidResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');

const path = '/api/maritimemeteogram';
// Open Atlantic, south of Nova Scotia
const oceanPoint = { latitude: 40, longitude: -60 };
// Atlanta, far from the sea
const inlandPoint = { latitude: 33.64, longitude: -84.43 };

describe('Maritime Meteogram tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Maritime meteogram with no token', async () => {
    await handleErrors(oceanPoint, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Maritime meteogram with invalid token', async () => {
    await handleErrors(oceanPoint, ForbiddenResponse, 'Failed to fetch maritime meteogram', null, 'bad-token');
  });

  test('Maritime meteogram with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Maritime meteogram with no latitude or longitude', async () => {
    await handleErrors({}, UnprocessableEntryResponse, 'validation failed', 'expected required property latitude to be present');
  });

  test('Maritime meteogram with no longitude', async () => {
    await handleErrors({ latitude: 40 }, UnprocessableEntryResponse, 'validation failed', 'expected required property longitude to be present');
  });

  test('Maritime meteogram with latitude out of range', async () => {
    await handleErrors({ latitude: 91, longitude: 0 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 90');
  });

  test('Maritime meteogram with longitude out of range', async () => {
    await handleErrors({ latitude: 0, longitude: 181 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 180');
  });

  test('Maritime meteogram with unknown field', async () => {
    await handleErrors({ ...oceanPoint, bogus: 1 }, UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - ocean point returns a GFS wave forecast with sea state, combined sea height and wind
   *     (swell height can be null at hours with no swell)
   *   - inland point returns the same timeline with no marine values (null)
   */
  test('Maritime meteogram for an ocean point', async () => {
    const meteogram = await getMeteogram(oceanPoint);
    expect(meteogram).toMatchObject({ ...oceanPoint, model: 'gfs' });
    expect(typeof meteogram.runTimeMs).toBe('number');
    expect(meteogram.columns.length).toBeGreaterThan(0);
    meteogram.columns.forEach((column) => {
      expect(typeof column.timestampMs).toBe('number');
      expect(typeof column.seaStateWmo).toBe('number');
      expect(typeof column.combinedHeightFt).toBe('number');
      expect(typeof column.windSpeedKt).toBe('number');
      // Swell and wind waves are parts of the combined sea; either can be missing (null)
      // at hours when that part isn't present
      expect(column.swellHeightFt === null || typeof column.swellHeightFt === 'number').toBe(true);
    });
    expect(meteogram.columns.some((c) => typeof c.swellHeightFt === 'number')).toBe(true);
  });

  test('Maritime meteogram for an inland point has no marine values', async () => {
    const meteogram = await getMeteogram(inlandPoint);
    expect(meteogram.columns.length).toBeGreaterThan(0);
    meteogram.columns.forEach((column) => {
      expect(column.combinedHeightFt).toBeNull();
      expect(column.swellHeightFt).toBeNull();
    });
  });

  async function getMeteogram(body) {
    const response = await bffSend('POST', path, body);
    validateStatus(response, ValidResponse);
    return response.body;
  }

  /**
   * Get error response from MaritimeMeteogram and validate expected response code, error message
   * and (optionally) the drop service's validation detail
   */
  async function handleErrors(body, expRespCode, expRespMessage, expDetail, token) {
    const response = await bffSend('POST', path, body, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
    if (expDetail) {
      const details = response.body.upstream.errors.map((e) => e.message).join(' | ');
      expect(details).toContain(expDetail);
    }
  }
});
