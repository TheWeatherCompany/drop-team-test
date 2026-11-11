/**
 * SofarWaveData.test.js
 * Historical wave data for one buoy. SOFAR Buoys layer. (CSV row 73)
 * The app asks with includeWindData=true first and falls back to the same request
 * without it if that fails.
 *
 * API covered by test class:
 *  - GET /api/proxy/sofar/wave-data?spotterId={spotterId}&limit={limit}&includeWindData=true
 */
const { validateStatus, ValidResponse, InvalidRequest, UnauthorizedResponse } = require('../__fixtures__/RequestResponse.fixture');
const { sofarGet, testWithSofarKey } = require('../__fixtures__/Sofar.fixture');

describe('SOFAR Wave Data tests', () => {
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
  test('Wave data with no SOFAR key', async () => {
    const response = await sofarGet('/wave-data?spotterId=SPOT-0000&limit=5', null);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.error).toBe('Missing x-sofar-token header');
  });

  testWithSofarKey('Wave data for an unknown spotter', async () => {
    const response = await sofarGet('/wave-data?spotterId=SPOT-0000&limit=5');
    validateStatus(response, InvalidRequest);
    expect(response.body.message).toBe('Device not found');
  });

  testWithSofarKey('Wave data with non-numeric limit', async () => {
    const response = await sofarGet(`/wave-data?spotterId=${encodeURIComponent(spotterId)}&limit=abc`);
    validateStatus(response, InvalidRequest);
    expect(response.body.message).toContain('Invalid parameter limit');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - data is for the requested buoy, with a list of waves (and wind when asked for)
   *   - the waves list can be empty when the buoy has not reported recently
   */
  testWithSofarKey('Wave data with wind for a buoy', async () => {
    const response = await sofarGet(`/wave-data?spotterId=${encodeURIComponent(spotterId)}&limit=5&includeWindData=true`);
    validateStatus(response, ValidResponse);

    const { data } = response.body;
    expect(data.spotterId).toBe(spotterId);
    expect(Array.isArray(data.waves)).toBe(true);
    expect(data.waves.length).toBeLessThanOrEqual(5);
    expect(Array.isArray(data.wind)).toBe(true);
  });

  testWithSofarKey('Wave data without wind (the app fallback)', async () => {
    const response = await sofarGet(`/wave-data?spotterId=${encodeURIComponent(spotterId)}&limit=5`);
    validateStatus(response, ValidResponse);

    expect(response.body.data.spotterId).toBe(spotterId);
    expect(Array.isArray(response.body.data.waves)).toBe(true);
  });
});
