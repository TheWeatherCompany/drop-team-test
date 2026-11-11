/**
 * GetDeskRouteFeatures.test.js
 * Weather features along one route. Map overlay. (CSV row 12)
 *
 * API covered by test class:
 *  - GET /api/desks/{uid}/routes/{route_uid}/features
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  NonexistentUid,
} = require('../__fixtures__/RequestResponse.fixture');
const { getTestDesk } = require('../__fixtures__/Desk.fixture');

describe('Get Desk Route Features tests', () => {
  let testDesk;
  let path;

  beforeAll(async () => {
    testDesk = await getTestDesk();
    path = `/api/desks/${testDesk.deskUid}/routes/${testDesk.routeUid}/features`;
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get route features with no token', async () => {
    await handleErrors(path, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get route features with invalid token', async () => {
    await handleErrors(path, ForbiddenResponse, 'Failed to fetch route features', 'bad-token');
  });

  test('Get route features for nonexistent desk uid', async () => {
    await handleErrors(
      `/api/desks/${NonexistentUid}/routes/${testDesk.routeUid}/features`,
      NotFoundResponse,
      `desk uid ${NonexistentUid} not found`
    );
  });

  test('Get route features for nonexistent route uid', async () => {
    await handleErrors(
      `/api/desks/${testDesk.deskUid}/routes/${NonexistentUid}/features`,
      NotFoundResponse,
      `route uid ${NonexistentUid} not found on desk ${testDesk.deskUid}`
    );
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is a GeoJSON FeatureCollection
   *   - each feature is a line or point for the requested route, with a risk
   */
  test('Get route features for valid desk and route uid', async () => {
    const response = await bffGet(path);
    validateStatus(response, ValidResponse);

    const collection = response.body;
    expect(collection.type).toBe('FeatureCollection');
    expect(collection.features.length).toBeGreaterThan(0);
    collection.features.forEach((feature) => {
      expect(feature.type).toBe('Feature');
      expect(['LineString', 'Point']).toContain(feature.geometry.type);
      expect(feature.geometry.coordinates.length).toBeGreaterThan(0);
      expect(feature.properties.route_uid).toBe(testDesk.routeUid);
      expect(typeof feature.properties.risk).toBe('number');
    });
  });
});
