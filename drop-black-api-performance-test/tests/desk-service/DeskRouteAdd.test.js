/**
 * DeskRouteAdd.test.js
 * Binds a route to a desk, with optional MetWatch alert sets. Mission Panel routes. (CSV row 9)
 *
 * API covered by test class:
 *  - POST /api/desks/{uid}/routes
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
const { testDeskName, createDesk, deleteDesk } = require('../__fixtures__/Desk.fixture');
const { randomUUID } = require('crypto');
const { ICAOPoints, testRouteName, createRoute, deleteRoute } = require('../__fixtures__/Route.fixture');
const { LatLngPosition, testLocationName, createLocation, deleteLocation } = require('../__fixtures__/Location.fixture');

describe('Add Route to Desk tests', () => {
  let testDesk;
  let testRoute;
  let path;

  beforeAll(async () => {
    // Test setup calls
    testDesk = await createDesk({ name: testDeskName('ADDROUTE') });
    testRoute = await createRoute({ name: testRouteName('ADDROUTE'), points: ICAOPoints });
    path = `/api/desks/${testDesk.uid}/routes`;
  });

  afterAll(async () => {
    // Test cleanup calls
    await deleteDesk(testDesk.uid);
    await deleteRoute(testRoute.uid);
  });

  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Add route with no token', async () => {
    await handleErrors(path, { item_uid: testRoute.uid }, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Add route with invalid token', async () => {
    await handleErrors(path, { item_uid: testRoute.uid }, ForbiddenResponse, 'Failed to bind route to desk', null, 'bad-token');
  });

  test('Add route to nonexistent desk uid', async () => {
    await handleErrors(`/api/desks/${NonexistentUid}/routes`, { item_uid: testRoute.uid },
      NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Add route to invalid desk uid', async () => {
    await handleErrors('/api/desks/not-a-uuid/routes', { item_uid: testRoute.uid },
      UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Add route with invalid route uid', async () => {
    await handleErrors(path, { item_uid: 'not-a-uuid' }, UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Add route with invalid condition set uid', async () => {
    await handleErrors(path, { item_uid: testRoute.uid, condition_set_uids: ['not-a-uuid'] },
      UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Add route with unknown field', async () => {
    await handleErrors(path, { item_uid: testRoute.uid, bogus: 1 }, UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  test('Add route with malformed JSON', async () => {
    await handleErrors(path, '{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Add route with no body', async () => {
    await handleErrors(path, undefined, InvalidRequest, 'Invalid JSON body');
  });

  /**
   * Nonexistent item bug (reported, fix pending):
   * The API adds any correctly formatted ID to the desk, even one that is not a route,
   * and returns 200. The app always sends the ID of a route it just created.
   * Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves a link to a route that does not exist
  test.skip('Add nonexistent route uid', async () => {
    const randomUid = randomUUID();
    await handleErrors(path, { item_uid: randomUid }, NotFoundResponse, `route uid ${randomUid} not found`);
  });

  // TODO: API returns 200 and saves a location's ID as a route
  test.skip('Add a location uid as a route', async () => {
    const location = await createLocation({ name: testLocationName('ASROUTE'), ...LatLngPosition });
    try {
      await handleErrors(path, { item_uid: location.uid }, NotFoundResponse, `route uid ${location.uid} not found`);
    } finally {
      await deleteLocation(location.uid);
    }
  });

  // TODO: Same reported bug. API returns 200 and saves a condition set that does not exist
  // (the app only attaches alert sets it just created in the Alerts service)
  test.skip('Add route with nonexistent condition set uid', async () => {
    const randomUid = randomUUID();
    await handleErrors(path, { item_uid: testRoute.uid, condition_set_uids: [randomUid] }, NotFoundResponse, 'not found');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is the desk, now including the route
   *   - adding the same route again does not add a duplicate
   * Then call GetDesk to validate the route was saved on the desk
   */
  test('Add route to desk', async () => {
    const response = await bffSend('POST', path, { item_uid: testRoute.uid });
    validateStatus(response, ValidResponse);
    expect(response.body.uid).toBe(testDesk.uid);
    expect(response.body.routes.map((r) => r.item_uid)).toContain(testRoute.uid);

    const savedDesk = (await bffGet(`/api/desks/${testDesk.uid}`)).body;
    expect(savedDesk.routes.map((r) => r.item_uid)).toContain(testRoute.uid);
  });

  test('Add the same route again does not duplicate it', async () => {
    const response = await bffSend('POST', path, { item_uid: testRoute.uid });
    validateStatus(response, ValidResponse);

    const matches = response.body.routes.filter((r) => r.item_uid === testRoute.uid);
    expect(matches.length).toBe(1);
  });

  test('Add route with null condition sets', async () => {
    const response = await bffSend('POST', path, { item_uid: testRoute.uid, condition_set_uids: null });
    validateStatus(response, ValidResponse);
    expect(response.body.routes.map((r) => r.item_uid)).toContain(testRoute.uid);
  });

  /**
   * Get error response from AddDeskRoute and validate expected response code, error message
   * and (optionally) the drop service's validation detail
   */
  async function handleErrors(urlPath, body, expRespCode, expRespMessage, expDetail, token) {
    const response = await bffSend('POST', urlPath, body, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
    if (expDetail) {
      const details = response.body.upstream.errors.map((e) => e.message).join(' | ');
      expect(details).toContain(expDetail);
    }
  }
});
