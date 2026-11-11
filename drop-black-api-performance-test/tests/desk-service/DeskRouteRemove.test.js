/**
 * DeskRouteRemove.test.js
 * Unbinds a route from a desk. (CSV row 10)
 *
 * API covered by test class:
 *  - DELETE /api/desks/{uid}/routes/{route_uid}
 */
const {
  bffGet,
  bffSend,
  validateStatus,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
  NonexistentUid,
} = require('../__fixtures__/RequestResponse.fixture');
const { testDeskName, createDesk, deleteDesk } = require('../__fixtures__/Desk.fixture');
const { ICAOPoints, testRouteName, createRoute, deleteRoute } = require('../__fixtures__/Route.fixture');

describe('Remove Route from Desk tests', () => {
  let testDesk;
  let testRoute;
  let path;

  beforeAll(async () => {
    // Test setup calls: a desk with one route on it
    testDesk = await createDesk({ name: testDeskName('REMOVEROUTE') });
    testRoute = await createRoute({ name: testRouteName('REMOVEROUTE'), points: ICAOPoints });
    const response = await bffSend('POST', `/api/desks/${testDesk.uid}/routes`, { item_uid: testRoute.uid });
    validateStatus(response, ValidResponse);
    path = `/api/desks/${testDesk.uid}/routes/${testRoute.uid}`;
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
  test('Remove route with no token', async () => {
    await handleErrors(path, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Remove route with invalid token', async () => {
    await handleErrors(path, ForbiddenResponse, 'Failed to unbind route from desk', null, 'bad-token');
  });

  test('Remove route from nonexistent desk uid', async () => {
    await handleErrors(`/api/desks/${NonexistentUid}/routes/${testRoute.uid}`, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Remove route from invalid desk uid', async () => {
    await handleErrors(`/api/desks/not-a-uuid/routes/${testRoute.uid}`, UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Remove route with invalid route uid', async () => {
    await handleErrors(`/api/desks/${testDesk.uid}/routes/not-a-uuid`, UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is the desk, no longer including the route
   * Then validate
   *   - GetDesk no longer lists the route
   *   - the route itself still exists in the route library
   */
  test('Remove route from desk', async () => {
    const response = await bffSend('DELETE', path);
    validateStatus(response, ValidResponse);
    expect(response.body.uid).toBe(testDesk.uid);
    expect(response.body.routes.map((r) => r.item_uid)).not.toContain(testRoute.uid);

    const savedDesk = (await bffGet(`/api/desks/${testDesk.uid}`)).body;
    expect(savedDesk.routes.map((r) => r.item_uid)).not.toContain(testRoute.uid);

    const libraryRoute = await bffGet(`/api/routes/${testRoute.uid}`);
    validateStatus(libraryRoute, ValidResponse);
  });

  /**
   * Get error response from RemoveDeskRoute and validate expected response code, error message
   * and (optionally) the drop service's validation detail
   */
  async function handleErrors(urlPath, expRespCode, expRespMessage, expDetail, token) {
    const response = await bffSend('DELETE', urlPath, undefined, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
    if (expDetail) {
      const details = response.body.upstream.errors.map((e) => e.message).join(' | ');
      expect(details).toContain(expDetail);
    }
  }
});
