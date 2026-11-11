/**
 * SofarLatestData.test.js
 * Latest wave and wind data for one buoy. SOFAR Buoys layer. (CSV row 72)
 *
 * API covered by test class:
 *  - GET /api/proxy/sofar/latest-data?spotterId={spotterId}&includeWindData=true
 */
const { validateStatus, ValidResponse, InvalidRequest, UnauthorizedResponse } = require('../__fixtures__/RequestResponse.fixture');
const { sofarGet, testWithSofarKey } = require('../__fixtures__/Sofar.fixture');

describe('SOFAR Latest Data tests', () => {
  let spotterId;

  beforeAll(async () => {
    // Test setup calls: use the first buoy on the test key
    if (!process.env.SOFAR_TOKEN) return;
    const response = await sofarGet('/devices');
    validateStatus(response, ValidResponse);
    spotterId = response.body.data.devices[0].spotterId;
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message (messages come from SOFAR)
   */
  test('Latest data with no SOFAR key', async () => {
    const response = await sofarGet('/latest-data?spotterId=SPOT-0000', null);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.error).toBe('Missing x-sofar-token header');
  });

  testWithSofarKey('Latest data with no spotterId', async () => {
    const response = await sofarGet('/latest-data');
    validateStatus(response, InvalidRequest);
    expect(response.body.message).toBe('spotterId is missing');
  });

  testWithSofarKey('Latest data for an unknown spotter', async () => {
    const response = await sofarGet('/latest-data?spotterId=SPOT-0000');
    validateStatus(response, InvalidRequest);
    expect(response.body.message).toBe('Device not found');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - data is for the requested buoy
   *   - waves and wind readings are included, with wave height, period and position
   */
  testWithSofarKey('Latest data with wind for a buoy', async () => {
    const response = await sofarGet(`/latest-data?spotterId=${encodeURIComponent(spotterId)}&includeWindData=true`);
    validateStatus(response, ValidResponse);

    const { data } = response.body;
    expect(data.spotterId).toBe(spotterId);
    expect(data.waves.length).toBeGreaterThan(0);
    expect(Array.isArray(data.wind)).toBe(true);
    data.waves.forEach((wave) => {
      expect(typeof wave.significantWaveHeight).toBe('number');
      expect(typeof wave.peakPeriod).toBe('number');
      expect(typeof wave.timestamp).toBe('string');
      expect(typeof wave.latitude).toBe('number');
      expect(typeof wave.longitude).toBe('number');
    });
  });
});
