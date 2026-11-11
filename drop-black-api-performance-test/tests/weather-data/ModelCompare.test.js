/**
 * ModelCompare.test.js
 * Side-by-side forecast model comparison. Bottom drawer Meteogram tab. (CSV row 31)
 * Read-only: POST is used to send options, nothing is saved.
 *
 * API covered by test class:
 *  - POST /api/modelcompare
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

const path = '/api/modelcompare';
// Atlanta
const point = { latitude: 33.64, longitude: -84.43 };
// London Heathrow, outside the CONUS-only HRRR domain
const londonPoint = { latitude: 51.47, longitude: -0.45 };

describe('Model Compare tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Model compare with no token', async () => {
    await handleErrors(point, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Model compare with invalid token', async () => {
    await handleErrors(point, ForbiddenResponse, 'Failed to fetch model comparison', null, 'bad-token');
  });

  test('Model compare with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Model compare with no latitude or longitude', async () => {
    await handleErrors({}, UnprocessableEntryResponse, 'validation failed', 'expected required property latitude to be present');
  });

  test('Model compare with latitude out of range', async () => {
    await handleErrors({ latitude: 91, longitude: 0 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 90');
  });

  test('Model compare with unknown model', async () => {
    await handleErrors({ ...point, models: ['zzz'] }, UnprocessableEntryResponse, 'unknown model: "zzz"');
  });

  test('Model compare with interval in days', async () => {
    await handleErrors({ ...point, interval: '1d' }, UnprocessableEntryResponse, 'invalid interval "1d"');
  });

  test('Model compare with invalid interval', async () => {
    await handleErrors({ ...point, interval: 'abc' }, UnprocessableEntryResponse, 'invalid interval "abc"');
  });

  test('Model compare with invalid from', async () => {
    await handleErrors({ ...point, from: 'bad' }, UnprocessableEntryResponse, 'validation failed', 'expected value to be one of');
  });

  test('Model compare with invalid interpolation', async () => {
    await handleErrors({ ...point, interpolation: { temperature: 'cubic' } }, UnprocessableEntryResponse, 'invalid interpolation "cubic"');
  });

  test('Model compare with unknown field', async () => {
    await handleErrors({ ...point, bogus: 1 }, UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - every model has an id and a series of forecast hours
   *   - models option limits the response to those models
   *   - regional models outside their domain are left out
   */
  test('Model compare with all models', async () => {
    const comparison = await getComparison(point);
    expect(comparison.models.length).toBeGreaterThan(0);
    comparison.models.forEach((model) => {
      expect(typeof model.modelId).toBe('string');
      expect(model.series.hours.length).toBeGreaterThan(0);
      expect(typeof model.series.hours[0].timestampMs).toBe('number');
    });
  });

  test('Model compare with chosen models', async () => {
    const comparison = await getComparison({ ...point, models: ['gfs', 'ecmwf'] });
    expect(comparison.models.length).toBeGreaterThan(0);
    comparison.models.forEach((model) => expect(['gfs', 'ecmwf']).toContain(model.modelId));
  });

  test('Model compare with interval and from options', async () => {
    const comparison = await getComparison({ ...point, models: ['gfs'], interval: '3h', from: 'newest' });
    expect(comparison.models.map((m) => m.modelId)).toEqual(['gfs']);
  });

  test('Model compare leaves out HRRR outside the US', async () => {
    const comparison = await getComparison({ ...londonPoint, models: ['hrrr'] });
    expect(comparison.models).toEqual([]);
  });

  async function getComparison(body) {
    const response = await bffSend('POST', path, body);
    validateStatus(response, ValidResponse);
    return response.body;
  }

  /**
   * Get error response from ModelCompare and validate expected response code, error message
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
