/**
 * SofarDevices.test.js
 * The user's Spotter buoys. SOFAR Buoys layer, key validation. (CSV row 71)
 * The BFF forwards to api.sofarocean.com with the user's own SOFAR key from the
 * x-sofar-token header. Tests that need a real key use SOFAR_TOKEN from .env.
 *
 * API covered by test class:
 *  - GET /api/proxy/sofar/devices
 */
const {
  bffGet,
  validateStatus,
  ValidResponse,
  UnauthorizedResponse,
  NotFoundResponse,
} = require('../__fixtures__/RequestResponse.fixture');
const { sofarGet, testWithSofarKey } = require('../__fixtures__/Sofar.fixture');

describe('SOFAR Devices tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('SOFAR devices with no SOFAR key', async () => {
    const response = await sofarGet('/devices', null);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.error).toBe('Missing x-sofar-token header');
  });

  test('SOFAR devices with an invalid SOFAR key', async () => {
    const response = await sofarGet('/devices', 'not-a-real-key');
    validateStatus(response, UnauthorizedResponse);
    // This message comes from SOFAR itself
    expect(response.body.message).toBe('Authentication Failed');
  });

  /**
   * No login check bug (reported, fix pending):
   * The SOFAR proxy forwards requests to SOFAR without checking for a Drop Black login,
   * and forwards any path, not only the ones the app uses.
   */
  // TODO: API returns 200 with the buoy list when there is no Drop Black login
  test.skip('SOFAR devices with no Drop Black login', async () => {
    const response = await bffGet('/api/proxy/sofar/devices', null).set('x-sofar-token', process.env.SOFAR_TOKEN);
    validateStatus(response, UnauthorizedResponse);
  });

  // TODO: API forwards a path the app never calls; SOFAR answers with its own 404
  test.skip('SOFAR proxy with a path the app does not use', async () => {
    const response = await sofarGet('/devices/SPOT-31866C');
    validateStatus(response, NotFoundResponse);
    expect(response.body.error).toBeDefined();
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - the key's Spotter buoys are listed, each with a spotterId
   */
  testWithSofarKey('SOFAR devices for the test key', async () => {
    const response = await sofarGet('/devices');
    validateStatus(response, ValidResponse);

    const { devices } = response.body.data;
    expect(devices.length).toBeGreaterThan(0);
    devices.forEach((device) => {
      expect(device.spotterId).toMatch(/^SPOT-/);
      expect(typeof device.hullType).toBe('string');
    });
  });
});
