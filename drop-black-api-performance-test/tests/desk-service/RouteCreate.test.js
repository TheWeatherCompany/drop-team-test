/**
 * RouteCreate.test.js
 * Creates a route. Add Route form. (CSV row 20)
 *
 * API covered by test class:
 *  - POST /api/routes
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
  routeUidRegex,
  ICAOPoints,
  MGRSPoints,
  LatLngPoints,
  testRouteName,
  createRoute,
  deleteRoute,
} = require('../__fixtures__/Route.fixture');

describe('Create Route tests', () => {
  const testRouteUidsCreated = [];

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testRouteUidsCreated) {
      await deleteRoute(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   * the drop service gives for which field failed
   */
  test('Create with no token', async () => {
    await handleErrors({ name: testRouteName('NOTOKEN'), points: ICAOPoints }, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Create with invalid token', async () => {
    await handleErrors({ name: testRouteName('BADTOKEN'), points: ICAOPoints }, ForbiddenResponse, 'Failed to create route', null, 'bad-token');
  });

  test('Create with no body', async () => {
    await handleErrors(undefined, InvalidRequest, 'Invalid JSON body');
  });

  test('Create with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Create with unknown field', async () => {
    await handleErrors({ name: testRouteName('UNKNOWN'), points: ICAOPoints, bogus: 1 },
      UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  test('Create with non-string name', async () => {
    await handleErrors({ name: 123, points: ICAOPoints }, UnprocessableEntryResponse, 'validation failed', 'expected string');
  });

  test('Create with point missing timestamp', async () => {
    const points = [{ icao: 'KATL' }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('NOTIME'), points },
      UnprocessableEntryResponse, 'validation failed', 'expected required property timestamp to be present');
  });

  test('Create with point invalid timestamp', async () => {
    const points = [{ icao: 'KATL', timestamp: 'not-a-date' }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('BADTIME'), points },
      UnprocessableEntryResponse, 'validation failed', 'expected string to be RFC 3339 date-time');
  });

  test('Create with point missing position', async () => {
    const points = [{ timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('NOPOS'), points },
      UnprocessableEntryResponse, 'validation failed', 'lat/lon or MGRS or ICAO required');
  });

  test('Create with point latitude but no longitude', async () => {
    const points = [{ latitude: 33.64, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('LATONLY'), points },
      UnprocessableEntryResponse, 'validation failed', 'lat/lon or MGRS or ICAO required');
  });

  test('Create with point invalid ICAO format', async () => {
    const points = [{ icao: 'XX', timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('BADICAO'), points },
      UnprocessableEntryResponse, 'validation failed', 'invalid location ID');
  });

  test('Create with point invalid MGRS', async () => {
    const points = [{ mgrs: 'garbage', timestamp: MGRSPoints[0].timestamp }, MGRSPoints[1]];
    await handleErrors({ name: testRouteName('BADMGRS'), points },
      UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  test('Create with point invalid flight level', async () => {
    const points = [{ icao: 'KATL', flight_level: 'abc', timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('BADFL'), points },
      UnprocessableEntryResponse, 'validation failed', 'malformed flight level');
  });

  test('Create with point unknown field', async () => {
    const points = [{ ...ICAOPoints[0], bogus: 1 }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('PTUNKNOWN'), points },
      UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  // TODO: Unknown airport bug (reported, fix pending). API returns 200 and saves "ZZZZ";
  // the app blocks it with "Airport not found". Update expected code and message once fixed
  test.skip('Create with point unknown ICAO airport', async () => {
    const points = [{ icao: 'ZZZZ', timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('FAKEICAO'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Point time order bug (reported, fix pending):
   * The API saves points whose times go backwards or repeat and returns 200.
   * The app corrects the times itself. Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves KBOS 10:00 after KATL 12:00
  test.skip('Create with points out of time order', async () => {
    const points = [
      { icao: 'KATL', timestamp: '2026-11-01T12:00:00Z' },
      { icao: 'KBOS', timestamp: '2026-11-01T10:00:00Z' },
    ];
    await handleErrors({ name: testRouteName('REVERSED'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves two points at the same time
  test.skip('Create with points at the same time', async () => {
    const points = [
      { icao: 'KATL', timestamp: '2026-11-01T10:00:00Z' },
      { icao: 'KBOS', timestamp: '2026-11-01T10:00:00Z' },
    ];
    await handleErrors({ name: testRouteName('SAMETIME'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Route with no points bug (reported, fix pending):
   * The API saves a route with no points and returns 200.
   * The app always starts with one point and requires a coordinate.
   * Update expected code and message once fixed.
   */
  // TODO: API returns 200 and creates a route with no points
  test.skip('Create with no points', async () => {
    await handleErrors({ name: testRouteName('NOPOINTS') }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and creates a route with "points": []
  test.skip('Create with empty points list', async () => {
    await handleErrors({ name: testRouteName('EMPTYPOINTS'), points: [] }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Multiple positions on one point bug (reported, fix pending):
   * The API saves a point with more than one position (ICAO, MGRS, lat/lon) and returns 200.
   * The app rejects it with "Couldn't locate this point". Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves both KATL (Atlanta) and lat/lon 1,1 (off West Africa)
  test.skip('Create with point that has two positions', async () => {
    const points = [{ icao: 'KATL', latitude: 1, longitude: 1, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors({ name: testRouteName('TWOPOS'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves ICAO, MGRS and lat/lon on the same point
  test.skip('Create with point that has three positions', async () => {
    const points = [
      { icao: 'KATL', mgrs: MGRSPoints[0].mgrs, latitude: 1, longitude: 1, timestamp: ICAOPoints[0].timestamp },
      ICAOPoints[1],
    ];
    await handleErrors({ name: testRouteName('THREEPOS'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Missing flight level bug (reported, fix pending). API returns 200 and saves points
  // with no flight_level or altitude; the app shows "Flight level is required".
  // Update expected code and message once fixed
  test.skip('Create with points missing flight level', async () => {
    const points = ICAOPoints.map(({ flight_level, ...point }) => point);
    await handleErrors({ name: testRouteName('NOFL'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Invalid coordinates bug (reported, fix pending):
   * The API saves latitude outside -90..90, longitude outside -180..180, and some
   * invalid MGRS values, and returns 200. The app blocks all of them.
   * Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves latitude 91
  test.skip('Create with point latitude out of range', async () => {
    const points = [{ latitude: 91, longitude: 0, timestamp: LatLngPoints[0].timestamp }, LatLngPoints[1]];
    await handleErrors({ name: testRouteName('BADLAT'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves longitude 181
  test.skip('Create with point longitude out of range', async () => {
    const points = [{ latitude: 0, longitude: 181, timestamp: LatLngPoints[0].timestamp }, LatLngPoints[1]];
    await handleErrors({ name: testRouteName('BADLON'), points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves "18TWL84637ABCDE"
  test.skip('Create with point MGRS with letters in the digits', async () => {
    const points = [{ mgrs: '18TWL84637ABCDE', timestamp: MGRSPoints[0].timestamp }, MGRSPoints[1]];
    await handleErrors({ name: testRouteName('MGRSLETTERS'), points }, UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  // TODO: API returns 200 and saves zone 0 (zones are 1-60)
  test.skip('Create with point MGRS zone 0', async () => {
    const points = [{ mgrs: '00TWL8463709766', timestamp: MGRSPoints[0].timestamp }, MGRSPoints[1]];
    await handleErrors({ name: testRouteName('MGRSZONE0'), points }, UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  // TODO: API returns 200 and saves 9 digits each for easting/northing (max is 5)
  test.skip('Create with point MGRS with too many digits', async () => {
    const points = [{ mgrs: '18TWL846370976684637097', timestamp: MGRSPoints[0].timestamp }, MGRSPoints[1]];
    await handleErrors({ name: testRouteName('MGRSLONG'), points }, UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  /**
   * Blank name bug (reported with desks and locations, fix pending):
   * The API saves a route with a missing, empty or whitespace-only name and returns 200.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and creates a route with no name
  test.skip('Create with no name', async () => {
    await handleErrors({ points: ICAOPoints }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and creates a route with an empty name
  test.skip('Create with empty name', async () => {
    await handleErrors({ name: '', points: ICAOPoints }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   ")
  test.skip('Create with whitespace-only name', async () => {
    await handleErrors({ name: '   ', points: ICAOPoints }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid is a UUID
   *   - name and points are saved as supplied, for each position format
   * Then call GetRoute to validate the route was saved
   */
  test('Create with ICAO points', async () => {
    await createAndValidate({ name: testRouteName('ICAO'), points: ICAOPoints });
  });

  test('Create with MGRS points', async () => {
    await createAndValidate({ name: testRouteName('MGRS'), points: MGRSPoints });
  });

  test('Create with latitude/longitude points and altitude', async () => {
    await createAndValidate({ name: testRouteName('LATLNG'), points: LatLngPoints });
  });

  test('Create with a single point', async () => {
    await createAndValidate({ name: testRouteName('ONEPOINT'), points: [ICAOPoints[0]] });
  });

  test('Create with meta', async () => {
    const meta = [{ name: 'source', value: 'api-test' }];
    const route = await createAndValidate({ name: testRouteName('META'), points: ICAOPoints, meta });
    expect(route.meta).toEqual(meta);
  });

  test('Created route appears in GetRoutes', async () => {
    const route = await createAndValidate({ name: testRouteName('LIST'), points: ICAOPoints });
    const routeList = (await bffGet('/api/routes')).body;
    expect(routeList.map((r) => r.uid)).toContain(route.uid);
  });

  async function createAndValidate(fields) {
    const route = await createRoute(fields);
    testRouteUidsCreated.push(route.uid);

    expect(route.uid).toMatch(routeUidRegex);
    expect(route.name).toBe(fields.name);
    expect(route.points).toEqual(fields.points);

    const savedRoute = (await bffGet(`/api/routes/${route.uid}`)).body;
    expect(savedRoute.name).toBe(fields.name);
    expect(savedRoute.points).toEqual(fields.points);
    return savedRoute;
  }

  /**
   * Get error response from CreateRoute and validate expected response code, error message
   * and (optionally) the drop service's validation detail
   */
  async function handleErrors(body, expRespCode, expRespMessage, expDetail, token) {
    const response = await bffSend('POST', '/api/routes', body, token);
    // If a route was created by mistake, remove it after the tests
    if (response.body?.uid) testRouteUidsCreated.push(response.body.uid);

    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
    if (expDetail) {
      const details = response.body.upstream.errors.map((e) => e.message).join(' | ');
      expect(details).toContain(expDetail);
    }
  }
});
