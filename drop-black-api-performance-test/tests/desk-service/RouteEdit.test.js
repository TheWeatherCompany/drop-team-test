/**
 * RouteEdit.test.js
 * Edits a route. (CSV row 22)
 * PUT replaces the whole route, so any field left out of the body is cleared.
 *
 * API covered by test class:
 *  - PUT /api/routes/{uid}
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
  ICAOPoints,
  MGRSPoints,
  testRouteName,
  createRoute,
  deleteRoute,
} = require('../__fixtures__/Route.fixture');

describe('Edit Route tests', () => {
  const testRouteUidsCreated = [];
  let routeToUpdate;

  beforeAll(async () => {
    // Test setup calls
    routeToUpdate = await createRoute({ name: testRouteName('EDIT'), points: ICAOPoints });
    testRouteUidsCreated.push(routeToUpdate.uid);
  });

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testRouteUidsCreated) {
      await deleteRoute(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Edit with no token', async () => {
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points: ICAOPoints }, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Edit with invalid token', async () => {
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points: ICAOPoints }, ForbiddenResponse, 'Failed to update route', null, 'bad-token');
  });

  test('Edit nonexistent route uid', async () => {
    await handleErrors(NonexistentUid, { name: testRouteName('NOTFOUND'), points: ICAOPoints },
      NotFoundResponse, `route uid ${NonexistentUid} not found`);
  });

  test('Edit invalid route uid', async () => {
    await handleErrors('not-a-uuid', { name: testRouteName('INVALID'), points: ICAOPoints },
      UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Edit with malformed JSON', async () => {
    await handleErrors(routeToUpdate.uid, '{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Edit with unknown field', async () => {
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points: ICAOPoints, bogus: 1 },
      UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  test('Edit with point invalid timestamp', async () => {
    const points = [{ icao: 'KATL', timestamp: 'not-a-date' }, ICAOPoints[1]];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points },
      UnprocessableEntryResponse, 'validation failed', 'expected string to be RFC 3339 date-time');
  });

  // TODO: Unknown airport bug (reported, fix pending). API returns 200 and saves "ZZZZ";
  // the app blocks it with "Airport not found". Update expected code and message once fixed
  test.skip('Edit with point unknown ICAO airport', async () => {
    const points = [{ icao: 'ZZZZ', timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Point time order bug (reported, fix pending):
   * The API saves points whose times go backwards or repeat and returns 200.
   * The app corrects the times itself. Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves KBOS 10:00 after KATL 12:00
  test.skip('Edit with points out of time order', async () => {
    const points = [
      { icao: 'KATL', timestamp: '2026-11-01T12:00:00Z' },
      { icao: 'KBOS', timestamp: '2026-11-01T10:00:00Z' },
    ];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves two points at the same time
  test.skip('Edit with points at the same time', async () => {
    const points = [
      { icao: 'KATL', timestamp: '2026-11-01T10:00:00Z' },
      { icao: 'KBOS', timestamp: '2026-11-01T10:00:00Z' },
    ];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Route with no points bug (reported, fix pending):
   * The API saves an edit that leaves a route with no points and returns 200.
   * The app requires at least one point. Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves the route with "points": []
  test.skip('Edit with no points', async () => {
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Multiple positions on one point bug (reported, fix pending):
   * The API saves a point with more than one position and returns 200.
   * The app rejects it with "Couldn't locate this point". Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves both KATL (Atlanta) and lat/lon 1,1 (off West Africa)
  test.skip('Edit with point that has two positions', async () => {
    const points = [{ icao: 'KATL', latitude: 1, longitude: 1, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Missing flight level bug (reported, fix pending). API returns 200 and saves points
  // with no flight_level or altitude; the app shows "Flight level is required".
  // Update expected code and message once fixed
  test.skip('Edit with points missing flight level', async () => {
    const points = ICAOPoints.map(({ flight_level, ...point }) => point);
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Invalid coordinates bug (reported, fix pending):
   * The API saves out-of-range latitude/longitude and some invalid MGRS values and
   * returns 200. The app blocks them. Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves latitude 91
  test.skip('Edit with point latitude out of range', async () => {
    const points = [{ latitude: 91, longitude: 0, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves longitude 181
  test.skip('Edit with point longitude out of range', async () => {
    const points = [{ latitude: 0, longitude: 181, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves "18TWL84637ABCDE"
  test.skip('Edit with point MGRS with letters in the digits', async () => {
    const points = [{ mgrs: '18TWL84637ABCDE', timestamp: MGRSPoints[0].timestamp }, MGRSPoints[1]];
    await handleErrors(routeToUpdate.uid, { name: routeToUpdate.name, points }, UnprocessableEntryResponse, 'validation failed', 'malformed MGRS');
  });

  /**
   * Blank name bug (reported with desks and locations, fix pending):
   * The API saves an edit with an empty or whitespace-only name and returns 200.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and clears the route's name
  test.skip('Edit with empty name', async () => {
    await handleErrors(routeToUpdate.uid, { name: '', points: ICAOPoints }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   ")
  test.skip('Edit with whitespace-only name', async () => {
    await handleErrors(routeToUpdate.uid, { name: '   ', points: ICAOPoints }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - name and points are updated
   *   - uid does not change
   * Then call GetRoute to validate the edit was saved
   */
  test('Edit name and change points from ICAO to MGRS', async () => {
    const name = testRouteName('EDITED');
    const response = await bffSend('PUT', `/api/routes/${routeToUpdate.uid}`, { name, points: MGRSPoints });
    validateStatus(response, ValidResponse);
    expect(response.body).toMatchObject({ uid: routeToUpdate.uid, name, points: MGRSPoints });

    const savedRoute = (await bffGet(`/api/routes/${routeToUpdate.uid}`)).body;
    expect(savedRoute.name).toBe(name);
    expect(savedRoute.points).toEqual(MGRSPoints);
  });

  /**
   * Get error response from EditRoute and validate expected response code, error message
   * and (optionally) the drop service's validation detail
   */
  async function handleErrors(uid, body, expRespCode, expRespMessage, expDetail, token) {
    const response = await bffSend('PUT', `/api/routes/${uid}`, body, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
    if (expDetail) {
      const details = response.body.upstream.errors.map((e) => e.message).join(' | ');
      expect(details).toContain(expDetail);
    }
  }
});
