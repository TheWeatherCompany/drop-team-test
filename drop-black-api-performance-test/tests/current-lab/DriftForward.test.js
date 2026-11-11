/**
 * DriftForward.test.js
 * Forward drift prediction. Current Lab drift tool. (CSV row 70)
 * The BFF calls api.current-lab.com with the company's Current Lab key, so the
 * drift is kept short (2 hours, one particle).
 *
 * API covered by test class:
 *  - POST /api/proxy/clab/drift-forward
 */
const {
  bffSend,
  validateStatus,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');

const path = '/api/proxy/clab/drift-forward';

const isoHour = () => new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString().replace(/\.\d+Z$/, 'Z');

// Off the Delmarva Peninsula, the app's default drift start point
const request = () => ({
  start_time: isoHour(),
  start_lat: 38,
  start_lon: -74.7,
  duration_hours: 2,
  region: 'delmarva_peninsula',
  wind_drift_factor: 0,
  source_currents: 'auto',
  source_wind: 'auto',
});

describe('Current Lab Drift Forward tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message. Errors after the login check come
   * from Current Lab, which uses { detail, code } instead of { error }.
   */
  test('Drift with no token', async () => {
    const response = await bffSend('POST', path, request(), null);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.error).toBe('Unauthorized');
  });

  test('Drift with no body fields', async () => {
    await handleCurrentLabErrors({}, UnprocessableEntryResponse, 'validation_error', "Missing required field 'start_time'");
  });

  test('Drift starting outside the region', async () => {
    await handleCurrentLabErrors({ ...request(), start_lat: 33.64, start_lon: -84.43 },
      UnprocessableEntryResponse, 'location_out_of_range', "outside configured bounds for region 'delmarva_peninsula'");
  });

  test('Drift with latitude out of range', async () => {
    await handleCurrentLabErrors({ ...request(), start_lat: 91 }, UnprocessableEntryResponse, 'validation_error', 'Latitude 91.0 not in range -90 to 90');
  });

  test('Drift with zero duration', async () => {
    await handleCurrentLabErrors({ ...request(), duration_hours: 0 }, UnprocessableEntryResponse, 'validation_error', 'Duration must be non-zero');
  });

  test('Drift in a region the account cannot use', async () => {
    await handleCurrentLabErrors({ ...request(), region: 'mars' }, ForbiddenResponse, 'permissions_error', "Account does not have access to region 'mars'");
  });

  // TODO: Security bug (reported, fix pending). The proxy only checks that a token is present,
  // so an invalid token returns 200 with real data from the company Current Lab account
  test.skip('Drift with invalid token', async () => {
    const response = await bffSend('POST', path, request(), 'bad-token');
    validateStatus(response, ForbiddenResponse);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - meta echoes the region and particle count
   *   - one particle path comes back
   */
  test('Drift for 2 hours off Delmarva', async () => {
    const response = await bffSend('POST', path, request());
    validateStatus(response, ValidResponse);

    const { meta, particles } = response.body;
    expect(meta).toMatchObject({ region: 'delmarva_peninsula', total_particles: 1 });
    expect(Array.isArray(particles)).toBe(true);
    expect(particles.length).toBe(1);
  });

  /**
   * Get error response from Current Lab and validate expected response code, error code and message
   */
  async function handleCurrentLabErrors(body, expRespCode, expCode, expDetail) {
    const response = await bffSend('POST', path, body);
    validateStatus(response, expRespCode);
    expect(response.body.code).toBe(expCode);
    // One problem is described in detail; several are listed in errors[]
    const messages = [response.body.detail, ...(response.body.errors || []).map((e) => e.message)].join(' | ');
    expect(messages).toContain(expDetail);
  }
});
