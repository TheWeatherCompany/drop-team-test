/**
 * Airgram.test.js
 * Airgram (vertical wind/temperature profile) data for a point. Bottom drawer and single-site radar toolbar. (CSV row 29)
 * Read-only: POST is used to send options, nothing is saved.
 *
 * API covered by test class:
 *  - POST /api/airgram
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

const path = '/api/airgram';
// Atlanta
const point = { latitude: 33.64, longitude: -84.43 };

describe('Airgram tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Airgram with no token', async () => {
    await handleErrors(point, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Airgram with invalid token', async () => {
    await handleErrors(point, ForbiddenResponse, 'Failed to fetch airgram profile', null, 'bad-token');
  });

  test('Airgram with no body', async () => {
    await handleErrors(undefined, InvalidRequest, 'Invalid JSON body');
  });

  test('Airgram with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Airgram with no latitude or longitude', async () => {
    await handleErrors({}, UnprocessableEntryResponse, 'validation failed', 'expected required property latitude to be present');
  });

  test('Airgram with no longitude', async () => {
    await handleErrors({ latitude: 33.64 }, UnprocessableEntryResponse, 'validation failed', 'expected required property longitude to be present');
  });

  test('Airgram with non-numeric latitude', async () => {
    await handleErrors({ latitude: '33.64', longitude: -84.43 }, UnprocessableEntryResponse, 'validation failed', 'expected number');
  });

  test('Airgram with latitude out of range', async () => {
    await handleErrors({ latitude: 91, longitude: 0 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 90');
  });

  test('Airgram with longitude out of range', async () => {
    await handleErrors({ latitude: 0, longitude: 181 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 180');
  });

  test('Airgram with unknown model', async () => {
    await handleErrors({ ...point, model: 'zzz' }, UnprocessableEntryResponse, 'validation failed', 'expected value to be one of');
  });

  test('Airgram with hoursBack above 24', async () => {
    await handleErrors({ ...point, hoursBack: 25 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 24');
  });

  test('Airgram with hoursForward below 1', async () => {
    await handleErrors({ ...point, hoursForward: 0 }, UnprocessableEntryResponse, 'validation failed', 'expected number >= 1');
  });

  test('Airgram with hoursForward above 120', async () => {
    await handleErrors({ ...point, hoursForward: 121 }, UnprocessableEntryResponse, 'validation failed', 'expected number <= 120');
  });

  test('Airgram with level above the FL500 ceiling', async () => {
    await handleErrors({ ...point, levelsMb: [7] }, UnprocessableEntryResponse, 'invalid levels: 7 mb');
  });

  test('Airgram with unknown field', async () => {
    await handleErrors({ ...point, bogus: 1 }, UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - default model is mpas
   *   - every column has a time and one entry per level, with temperature and wind
   *   - model, hours, levels and times options change the response
   */
  test('Airgram with defaults', async () => {
    const airgram = await getAirgram(point);
    expect(airgram).toMatchObject({ ...point, model: 'mpas' });
    expect(airgram.levelsMb.length).toBeGreaterThan(0);
    expect(airgram.columns.length).toBeGreaterThan(0);
    airgram.columns.forEach((column) => {
      expect(typeof column.timestampMs).toBe('number');
      expect(column.levels.length).toBe(airgram.levelsMb.length);
      column.levels.forEach((level) => {
        expect(airgram.levelsMb).toContain(level.pressureMb);
        expect(level).toHaveProperty('temperatureC');
        expect(level).toHaveProperty('windSpeedKt');
        expect(level).toHaveProperty('windDirectionDeg');
      });
    });
  });

  test.each(['gfs', 'ecmwf'])('Airgram with model %s', async (model) => {
    const airgram = await getAirgram({ ...point, model });
    expect(airgram.model).toBe(model);
    expect(airgram.columns.length).toBeGreaterThan(0);
  });

  test('Airgram with hoursBack 0 and hoursForward 1', async () => {
    const airgram = await getAirgram({ ...point, hoursBack: 0, hoursForward: 1 });
    expect(airgram.columns.length).toBe(2);
  });

  test('Airgram with chosen levels', async () => {
    const airgram = await getAirgram({ ...point, levelsMb: [500, 250] });
    expect(airgram.levelsMb.length).toBeGreaterThan(0);
    airgram.levelsMb.forEach((level) => expect([500, 250]).toContain(level));
  });

  test('Airgram with one chosen time', async () => {
    const airgram = await getAirgram({ ...point, times: [Date.now()] });
    expect(airgram.columns.length).toBe(1);
  });

  async function getAirgram(body) {
    const response = await bffSend('POST', path, body);
    validateStatus(response, ValidResponse);
    return response.body;
  }

  /**
   * Get error response from Airgram and validate expected response code, error message
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
