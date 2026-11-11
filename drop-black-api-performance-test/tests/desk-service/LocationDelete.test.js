/**
 * LocationDelete.test.js
 * Deletes a location. (CSV row 28)
 *
 * API covered by test class:
 *  - DELETE /api/locations/{uid}
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
const { LatLngPosition, testLocationName, createLocation, deleteLocation } = require('../__fixtures__/Location.fixture');

describe('Delete Location tests', () => {
  const testLocationUidsCreated = [];
  let locationToDelete;

  beforeAll(async () => {
    // Test setup calls
    locationToDelete = await createLocation({ name: testLocationName('DELETE'), ...LatLngPosition });
    testLocationUidsCreated.push(locationToDelete.uid);
  });

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testLocationUidsCreated) {
      await deleteLocation(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Delete with no token', async () => {
    await handleErrors(locationToDelete.uid, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Delete with invalid token', async () => {
    await handleErrors(locationToDelete.uid, ForbiddenResponse, 'Failed to delete location', 'bad-token');
  });

  test('Delete invalid location uid', async () => {
    await handleErrors('not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Not reported yet; revisit with the sharing work. Same as DELETE /routes/{uid}:
  // API returns 500 "unexpected error occurred" for a location that does not exist
  test.skip('Delete nonexistent location uid', async () => {
    await handleErrors(NonexistentUid, NotFoundResponse, `location uid ${NonexistentUid} not found`);
  });

  /**
   * Positive Test Cases:
   * Validate response code
   *   - 204 with no body
   * Then validate the location is gone
   *   - GetLocation returns 404
   *   - location is not in GetLocations
   */
  test('Delete location', async () => {
    const response = await bffSend('DELETE', `/api/locations/${locationToDelete.uid}`);
    validateStatus(response, ValidNoContentResponse, null);
    testLocationUidsCreated.pop();

    const getResponse = await bffGet(`/api/locations/${locationToDelete.uid}`);
    validateStatus(getResponse, NotFoundResponse);

    const locationList = (await bffGet('/api/locations')).body;
    expect(locationList.find((l) => l.uid === locationToDelete.uid)).toBeUndefined();
  });

  /**
   * Get error response from DeleteLocation and validate expected response code and error message
   */
  async function handleErrors(uid, expRespCode, expRespMessage, token) {
    const response = await bffSend('DELETE', `/api/locations/${uid}`, undefined, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
