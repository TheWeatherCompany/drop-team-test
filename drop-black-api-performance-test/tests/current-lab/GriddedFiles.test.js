/**
 * GriddedFiles.test.js
 * Gridded ocean-current file manifest. Current Lab currents layer. (CSV row 69)
 * The BFF calls api.current-lab.com with the company's Current Lab key, so
 * requests are kept small (one hour of one region).
 *
 * API covered by test class:
 *  - POST /api/proxy/clab/gridded-files
 */
const {
  bffSend,
  validateStatus,
  handleErrors,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');

const path = '/api/proxy/clab/gridded-files';

// Current Lab wants times with no milliseconds, e.g. 2026-11-01T10:00:00Z
const isoHour = (hoursFromNow) => {
  const hour = Math.floor(Date.now() / 3600000) + hoursFromNow;
  return new Date(hour * 3600000).toISOString().replace(/\.\d+Z$/, 'Z');
};

const request = () => ({
  file_format: 'json',
  region: 'delmarva_peninsula',
  product: 'currents_surface',
  start_time: isoHour(0),
  end_time: isoHour(1),
});

describe('Current Lab Gridded Files tests', () => {
  /**
   * Negative Test Cases:
   * Validate response code and error message. Errors after the login check come
   * from Current Lab, which uses { detail, code } instead of { error }.
   */
  test('Gridded files with no token', async () => {
    const response = await bffSend('POST', path, request(), null);
    validateStatus(response, UnauthorizedResponse);
    expect(response.body.error).toBe('Unauthorized');
  });

  test('Gridded files with no body fields', async () => {
    await handleCurrentLabErrors({}, UnprocessableEntryResponse, 'validation_error', "Missing required field 'region'");
  });

  test('Gridded files with unknown product', async () => {
    await handleCurrentLabErrors({ ...request(), product: 'zzz' }, UnprocessableEntryResponse, 'validation_error', "Invalid value for 'product'");
  });

  test('Gridded files with region the account cannot use', async () => {
    await handleCurrentLabErrors({ ...request(), region: 'mars' }, ForbiddenResponse, 'permissions_error', "Account does not have access to region 'mars'");
  });

  test('Gridded files with end_time before start_time', async () => {
    await handleCurrentLabErrors({ ...request(), start_time: isoHour(2), end_time: isoHour(0) },
      UnprocessableEntryResponse, 'validation_error', 'end_time must be after start_time');
  });

  test('Gridded files for a time with no data', async () => {
    await handleCurrentLabErrors({ ...request(), start_time: '2020-01-01T00:00:00Z', end_time: '2020-01-01T01:00:00Z' },
      NotFoundResponse, 'no_data_found', 'No data found');
  });

  test('Gridded files with malformed JSON', async () => {
    await handleCurrentLabErrors('{not json', UnprocessableEntryResponse, 'validation_error', 'JSON decode error');
  });

  // TODO: Security bug (reported, fix pending). The proxy only checks that a token is present,
  // so an invalid token returns 200 with real data from the company Current Lab account
  test.skip('Gridded files with invalid token', async () => {
    const response = await bffSend('POST', path, request(), 'bad-token');
    validateStatus(response, ForbiddenResponse);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - meta describes the region, product and its u/v current variables
   */
  test('Gridded files for one hour of Delmarva surface currents', async () => {
    const response = await bffSend('POST', path, request());
    validateStatus(response, ValidResponse);

    const { meta } = response.body;
    expect(meta).toMatchObject({ region: 'delmarva_peninsula', product: 'currents_surface', file_format: 'json' });
    expect(meta.variables).toEqual(expect.arrayContaining(['u', 'v']));
    expect(meta.total_files).toBeGreaterThan(0);
    expect(meta.bounding_box.length).toBe(4);
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
