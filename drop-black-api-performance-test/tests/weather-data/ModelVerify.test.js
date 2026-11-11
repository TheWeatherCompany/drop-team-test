/**
 * ModelVerify.test.js
 * Model forecast vs. observation verification. Bottom drawer Model Verification panel. (CSV row 32)
 * Read-only: POST is used to send options, nothing is saved.
 *
 * API covered by test class:
 *  - POST /api/modelverify
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

const path = '/api/modelverify';
// Atlanta, verified against the KATL METAR
const request = { latitude: 33.64, longitude: -84.43, icao: 'KATL', parameter: 'temperature' };

describe('Model Verify tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Model verify with no token', async () => {
    await handleErrors(request, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Model verify with invalid token', async () => {
    await handleErrors(request, ForbiddenResponse, 'Failed to fetch model verification', null, 'bad-token');
  });

  test('Model verify with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Model verify with empty body', async () => {
    await handleErrors({}, UnprocessableEntryResponse, 'validation failed', 'expected required property icao to be present');
  });

  test('Model verify with no ICAO', async () => {
    const { icao, ...body } = request;
    await handleErrors(body, UnprocessableEntryResponse, 'validation failed', 'expected required property icao to be present');
  });

  test('Model verify with no parameter', async () => {
    const { parameter, ...body } = request;
    await handleErrors(body, UnprocessableEntryResponse, 'validation failed', 'expected required property parameter to be present');
  });

  test('Model verify with unknown parameter', async () => {
    await handleErrors({ ...request, parameter: 'snowDepth' }, UnprocessableEntryResponse, 'validation failed', 'expected value to be one of');
  });

  test('Model verify with invalid ICAO format', async () => {
    await handleErrors({ ...request, icao: 'XX' }, UnprocessableEntryResponse, 'validation failed', 'invalid location ID');
  });

  test('Model verify with historyHours below 2', async () => {
    await handleErrors({ ...request, historyHours: 1 }, UnprocessableEntryResponse, 'validation failed', 'expected number >= 2');
  });

  test('Model verify with historyHours above 48', async () => {
    await handleErrors({ ...request, historyHours: 49 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 48');
  });

  test('Model verify with unknown model', async () => {
    await handleErrors({ ...request, models: ['zzz'] }, UnprocessableEntryResponse, 'unknown model: "zzz"');
  });

  test('Model verify with latitude out of range', async () => {
    await handleErrors({ ...request, latitude: 91 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 90');
  });

  test('Model verify with unknown field', async () => {
    await handleErrors({ ...request, bogus: 1 }, UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - observed series comes from the requested METAR station
   *   - one forecast series per model
   *   - a recommendation names the most accurate model
   *   - parameter, models and historyHours options change the response
   */
  test('Model verify temperature at KATL', async () => {
    const verification = await getVerification(request);
    expect(verification).toMatchObject({ parameter: 'temperature', unit: '°C' });
    expect(verification.observed.label).toBe('KATL');
    expect(verification.observed.points.length).toBeGreaterThan(0);
    expect(verification.models.length).toBeGreaterThan(0);
    verification.models.forEach((model) => {
      expect(typeof model.modelId).toBe('string');
      expect(Array.isArray(model.points)).toBe(true);
    });
    expect(verification.models.map((m) => m.modelId)).toContain(verification.recommendation.modelId);
  });

  test('Model verify wind speed with one model', async () => {
    const verification = await getVerification({ ...request, parameter: 'windSpeed', models: ['gfs'], historyHours: 2 });
    expect(verification).toMatchObject({ parameter: 'windSpeed', unit: 'kt' });
    expect(verification.models.map((m) => m.modelId)).toEqual(['gfs']);
  });

  test('Model verify with maximum history', async () => {
    const shortHistory = await getVerification({ ...request, historyHours: 2 });
    const verification = await getVerification({ ...request, historyHours: 48 });
    // More history means more observed points, starting further back
    expect(verification.observed.points.length).toBeGreaterThan(shortHistory.observed.points.length);
    expect(verification.observed.points[0].ms).toBeLessThan(shortHistory.observed.points[0].ms);
  });

  async function getVerification(body) {
    const response = await bffSend('POST', path, body);
    validateStatus(response, ValidResponse);
    return response.body;
  }

  /**
   * Get error response from ModelVerify and validate expected response code, error message
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
