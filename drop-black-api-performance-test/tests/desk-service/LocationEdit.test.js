/**
 * LocationEdit.test.js
 * Edits a location. (CSV row 27)
 * PUT replaces the whole location, so it must always include a position.
 *
 * API covered by test class:
 *  - PUT /api/locations/{uid}
 */
const {
  bffGet,
  bffSend,
  validateStatus,
  ValidResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
  NonexistentUid,
} = require('../__fixtures__/RequestResponse.fixture');
const {
  LatLngPosition,
  ICAOPosition,
  testLocationName,
  createLocation,
  deleteLocation,
} = require('../__fixtures__/Location.fixture');

describe('Edit Location tests', () => {
  const testLocationUidsCreated = [];
  let locationToUpdate;

  beforeAll(async () => {
    // Test setup calls
    locationToUpdate = await createLocation({ name: testLocationName('EDIT'), ...LatLngPosition });
    testLocationUidsCreated.push(locationToUpdate.uid);
  });

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testLocationUidsCreated) {
      await deleteLocation(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Edit with no token', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, ...LatLngPosition }, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Edit with invalid token', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, ...LatLngPosition }, ForbiddenResponse, 'Failed to update location', null, 'bad-token');
  });

  test('Edit nonexistent location uid', async () => {
    await handleErrors(NonexistentUid, { name: testLocationName('NOTFOUND'), ...LatLngPosition },
      NotFoundResponse, `location uid ${NonexistentUid} not found`);
  });

  test('Edit invalid location uid', async () => {
    await handleErrors('not-a-uuid', { name: testLocationName('INVALID'), ...LatLngPosition },
      UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Edit with malformed JSON', async () => {
    await handleErrors(locationToUpdate.uid, '{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Edit with unknown field', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, ...LatLngPosition, bogus: 1 },
      UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  test('Edit with only a name (no position)', async () => {
    await handleErrors(locationToUpdate.uid, { name: testLocationName('NAMEONLY') },
      UnprocessableEntryResponse, 'validation failed', 'lat/lon or MGRS or ICAO required');

    // The rejected edit must not change the saved location
    const savedLocation = (await bffGet(`/api/locations/${locationToUpdate.uid}`)).body;
    expect(savedLocation).toMatchObject({ name: locationToUpdate.name, ...LatLngPosition });
  });

  // TODO: Unknown airport bug (reported, fix pending). API returns 200 and saves "ZZZZ";
  // the app does not allow it. Update expected code and message once fixed
  test.skip('Edit with unknown ICAO airport', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, icao_code: 'ZZZZ' }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Multiple positions bug (reported, fix pending). API returns 200 and saves both
  // KATL (Atlanta) and lat/lon 1,1 (off West Africa); the app does not allow it.
  // Update expected code and message once fixed
  test.skip('Edit with ICAO code and latitude/longitude', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, icao_code: 'KATL', latitude: 1, longitude: 1 },
      UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Invalid coordinates bug (reported, fix pending):
   * The API saves out-of-range latitude/longitude and some invalid MGRS values and
   * returns 200. The app blocks them. Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves latitude 91
  test.skip('Edit with latitude out of range', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, latitude: 91, longitude: 0 },
      UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves longitude 181
  test.skip('Edit with longitude out of range', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, latitude: 0, longitude: 181 },
      UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves "18TWL84637ABCDE"
  test.skip('Edit with MGRS with letters in the digits', async () => {
    await handleErrors(locationToUpdate.uid, { name: locationToUpdate.name, mgrs: '18TWL84637ABCDE' },
      UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  /**
   * Blank name bug (reported with desks and routes, fix pending):
   * The API saves an edit with an empty or whitespace-only name and returns 200.
   * The app blocks an empty name but accepts spaces, so users can hit this.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and clears the location's name
  test.skip('Edit with empty name', async () => {
    await handleErrors(locationToUpdate.uid, { name: '', ...LatLngPosition }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   "); the app also allows it
  test.skip('Edit with whitespace-only name', async () => {
    await handleErrors(locationToUpdate.uid, { name: '   ', ...LatLngPosition }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - name and position are updated
   *   - uid does not change
   * Then call GetLocation to validate the edit was saved
   */
  test('Edit name and latitude/longitude', async () => {
    const fields = { name: testLocationName('EDITED'), latitude: 40.64, longitude: -73.78 };
    await editAndValidate(fields);
  });

  test('Edit to change position from latitude/longitude to ICAO', async () => {
    const fields = { name: testLocationName('TOICAO'), ...ICAOPosition };
    const savedLocation = await editAndValidate(fields);
    expect(savedLocation.latitude).toBeUndefined();
    expect(savedLocation.longitude).toBeUndefined();
  });

  async function editAndValidate(fields) {
    const response = await bffSend('PUT', `/api/locations/${locationToUpdate.uid}`, fields);
    validateStatus(response, ValidResponse);
    expect(response.body).toMatchObject({ uid: locationToUpdate.uid, ...fields });

    const savedLocation = (await bffGet(`/api/locations/${locationToUpdate.uid}`)).body;
    expect(savedLocation).toMatchObject(fields);
    locationToUpdate = savedLocation;
    return savedLocation;
  }

  /**
   * Get error response from EditLocation and validate expected response code, error message
   * and (optionally) the drop service's validation detail
   */
  async function handleErrors(uid, body, expRespCode, expRespMessage, expDetail, token) {
    const response = await bffSend('PUT', `/api/locations/${uid}`, body, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
    if (expDetail) {
      const details = response.body.upstream.errors.map((e) => e.message).join(' | ');
      expect(details).toContain(expDetail);
    }
  }
});
