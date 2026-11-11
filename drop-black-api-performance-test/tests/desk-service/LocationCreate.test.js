/**
 * LocationCreate.test.js
 * Creates a location. Add Location form. (CSV row 25)
 *
 * API covered by test class:
 *  - POST /api/locations
 */
const {
  bffGet,
  bffSend,
  validateStatus,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');
const {
  locationUidRegex,
  LatLngPosition,
  ICAOPosition,
  MGRSPosition,
  FullLocationFields,
  testLocationName,
  createLocation,
  deleteLocation,
} = require('../__fixtures__/Location.fixture');

describe('Create Location tests', () => {
  const testLocationUidsCreated = [];

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testLocationUidsCreated) {
      await deleteLocation(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   * the drop service gives for which field failed
   */
  test('Create with no token', async () => {
    await handleErrors({ name: testLocationName('NOTOKEN'), ...LatLngPosition }, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Create with invalid token', async () => {
    await handleErrors({ name: testLocationName('BADTOKEN'), ...LatLngPosition }, ForbiddenResponse, 'Failed to create location', null, 'bad-token');
  });

  test('Create with no body', async () => {
    await handleErrors(undefined, InvalidRequest, 'Invalid JSON body');
  });

  test('Create with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Create with unknown field', async () => {
    await handleErrors({ name: testLocationName('UNKNOWN'), ...LatLngPosition, bogus: 1 },
      UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  test('Create with non-string name', async () => {
    await handleErrors({ name: 123, ...LatLngPosition }, UnprocessableEntryResponse, 'validation failed', 'expected string');
  });

  test('Create with no position', async () => {
    await handleErrors({ name: testLocationName('NOPOS') },
      UnprocessableEntryResponse, 'validation failed', 'lat/lon or MGRS or ICAO required');
  });

  test('Create with latitude but no longitude', async () => {
    await handleErrors({ name: testLocationName('LATONLY'), latitude: 33.64 },
      UnprocessableEntryResponse, 'validation failed', 'lat/lon or MGRS or ICAO required');
  });

  test('Create with non-numeric latitude', async () => {
    await handleErrors({ name: testLocationName('LATSTRING'), latitude: '33.64', longitude: -84.43 },
      UnprocessableEntryResponse, 'validation failed', 'expected number');
  });

  test('Create with invalid ICAO format', async () => {
    await handleErrors({ name: testLocationName('BADICAO'), icao_code: 'XX' },
      UnprocessableEntryResponse, 'validation failed', 'invalid location ID');
  });

  test('Create with invalid MGRS', async () => {
    await handleErrors({ name: testLocationName('BADMGRS'), mgrs: 'garbage' },
      UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  // TODO: Unknown airport bug (reported, fix pending). API returns 200 and saves "ZZZZ";
  // the app does not allow it. Update expected code and message once fixed
  test.skip('Create with unknown ICAO airport', async () => {
    await handleErrors({ name: testLocationName('FAKEICAO'), icao_code: 'ZZZZ' }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Multiple positions bug (reported, fix pending):
   * The API saves a location with more than one position and returns 200.
   * The app does not allow it. Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves both KATL (Atlanta) and lat/lon 1,1 (off West Africa)
  test.skip('Create with ICAO code and latitude/longitude', async () => {
    await handleErrors({ name: testLocationName('ICAOLATLNG'), icao_code: 'KATL', latitude: 1, longitude: 1 },
      UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves both the MGRS grid reference and lat/lon 1,1
  test.skip('Create with MGRS and latitude/longitude', async () => {
    await handleErrors({ name: testLocationName('MGRSLATLNG'), ...MGRSPosition, latitude: 1, longitude: 1 },
      UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Invalid coordinates bug (reported, fix pending):
   * The API saves latitude outside -90..90, longitude outside -180..180, and some
   * invalid MGRS values, and returns 200. The app blocks all of them.
   * Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves latitude 91
  test.skip('Create with latitude out of range', async () => {
    await handleErrors({ name: testLocationName('BADLAT'), latitude: 91, longitude: 0 }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves longitude 181
  test.skip('Create with longitude out of range', async () => {
    await handleErrors({ name: testLocationName('BADLON'), latitude: 0, longitude: 181 }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves "18TWL84637ABCDE"
  test.skip('Create with MGRS with letters in the digits', async () => {
    await handleErrors({ name: testLocationName('MGRSLETTERS'), mgrs: '18TWL84637ABCDE' },
      UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  // TODO: API returns 200 and saves zone 0 (zones are 1-60)
  test.skip('Create with MGRS zone 0', async () => {
    await handleErrors({ name: testLocationName('MGRSZONE0'), mgrs: '00TWL8463709766' },
      UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  // TODO: API returns 200 and saves 9 digits each for easting/northing (max is 5)
  test.skip('Create with MGRS with too many digits', async () => {
    await handleErrors({ name: testLocationName('MGRSLONG'), mgrs: '18TWL846370976684637097' },
      UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  /**
   * Blank name bug (reported with desks and routes, fix pending):
   * The API saves a location with a missing, empty or whitespace-only name and returns 200.
   * The app blocks an empty name but accepts spaces, so users can hit this.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and creates a location with no name
  test.skip('Create with no name', async () => {
    await handleErrors({ ...LatLngPosition }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and creates a location with an empty name
  test.skip('Create with empty name', async () => {
    await handleErrors({ name: '', ...LatLngPosition }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   "); the app also allows it
  test.skip('Create with whitespace-only name', async () => {
    await handleErrors({ name: '   ', ...LatLngPosition }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid is a UUID
   *   - name and position are saved as supplied, for each position format
   * Then call GetLocation to validate the location was saved
   */
  test('Create with latitude/longitude', async () => {
    await createAndValidate({ name: testLocationName('LATLNG'), ...LatLngPosition });
  });

  test('Create with ICAO code', async () => {
    await createAndValidate({ name: testLocationName('ICAO'), ...ICAOPosition });
  });

  test('Create with MGRS', async () => {
    await createAndValidate({ name: testLocationName('MGRS'), ...MGRSPosition });
  });

  test('Create with all optional fields', async () => {
    await createAndValidate({ name: testLocationName('FULL'), ...FullLocationFields });
  });

  test('Created location appears in GetLocations', async () => {
    const location = await createAndValidate({ name: testLocationName('LIST'), ...LatLngPosition });
    const locationList = (await bffGet('/api/locations')).body;
    expect(locationList.map((l) => l.uid)).toContain(location.uid);
  });

  async function createAndValidate(fields) {
    const location = await createLocation(fields);
    testLocationUidsCreated.push(location.uid);

    expect(location.uid).toMatch(locationUidRegex);
    expect(location).toMatchObject(fields);

    const savedLocation = (await bffGet(`/api/locations/${location.uid}`)).body;
    expect(savedLocation).toMatchObject(fields);
    return savedLocation;
  }

  /**
   * Get error response from CreateLocation and validate expected response code, error message
   * and (optionally) the drop service's validation detail
   */
  async function handleErrors(body, expRespCode, expRespMessage, expDetail, token) {
    const response = await bffSend('POST', '/api/locations', body, token);
    // If a location was created by mistake, remove it after the tests
    if (response.body?.uid) testLocationUidsCreated.push(response.body.uid);

    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
    if (expDetail) {
      const details = response.body.upstream.errors.map((e) => e.message).join(' | ');
      expect(details).toContain(expDetail);
    }
  }
});
