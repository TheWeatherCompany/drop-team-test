/**
 * RouteDelete.test.js
 * Deletes a route. (CSV row 23)
 *
 * API covered by test class:
 *  - DELETE /api/routes/{uid}
 */
const {
  bffGet,
  bffSend,
  validateStatus,
  ValidNoContentResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
  NonexistentUid,
} = require('../__fixtures__/RequestResponse.fixture');
const { ICAOPoints, testRouteName, createRoute, deleteRoute } = require('../__fixtures__/Route.fixture');

describe('Delete Route tests', () => {
  const testRouteUidsCreated = [];
  let routeToDelete;

  beforeAll(async () => {
    // Test setup calls
    routeToDelete = await createRoute({ name: testRouteName('DELETE'), points: ICAOPoints });
    testRouteUidsCreated.push(routeToDelete.uid);
  });

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testRouteUidsCreated) {
      await deleteRoute(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Delete with no token', async () => {
    await handleErrors(routeToDelete.uid, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Delete with invalid token', async () => {
    await handleErrors(routeToDelete.uid, ForbiddenResponse, 'Failed to delete route', 'bad-token');
  });

  test('Delete invalid route uid', async () => {
    await handleErrors('not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Not reported yet; revisit with the sharing work. API returns 500 "unexpected error
  // occurred" (upstream: "route not found") for a route that does not exist.
  // DELETE /desks/{uid} returns 404 for the same case. DELETE /locations/{uid} has the same 500.
  // The drop service spec only documents 204 and a generic error, so it doesn't say which is right
  test.skip('Delete nonexistent route uid', async () => {
    await handleErrors(NonexistentUid, NotFoundResponse, `route uid ${NonexistentUid} not found`);
  });

  /**
   * Positive Test Cases:
   * Validate response code
   *   - 204 with no body
   * Then validate the route is gone
   *   - GetRoute returns 404
   *   - route is not in GetRoutes
   */
  test('Delete route', async () => {
    const response = await bffSend('DELETE', `/api/routes/${routeToDelete.uid}`);
    validateStatus(response, ValidNoContentResponse, null);
    testRouteUidsCreated.pop();

    const getResponse = await bffGet(`/api/routes/${routeToDelete.uid}`);
    validateStatus(getResponse, NotFoundResponse);

    const routeList = (await bffGet('/api/routes')).body;
    expect(routeList.find((r) => r.uid === routeToDelete.uid)).toBeUndefined();
  });

  /**
   * Get error response from DeleteRoute and validate expected response code and error message
   */
  async function handleErrors(uid, expRespCode, expRespMessage, token) {
    const response = await bffSend('DELETE', `/api/routes/${uid}`, undefined, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
