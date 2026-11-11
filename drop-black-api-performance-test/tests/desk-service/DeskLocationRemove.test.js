/**
 * DeskLocationRemove.test.js
 * Unbinds a location from a desk. (CSV row 14)
 *
 * API covered by test class:
 *  - DELETE /api/desks/{uid}/locations/{location_uid}
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
const { LatLngPosition, testLocationName, createLocation, deleteLocation } = require('../__fixtures__/Location.fixture');

describe('Remove Location from Desk tests', () => {
  let testDesk;
  let testLocation;
  let path;

  beforeAll(async () => {
    // Test setup calls: a desk with one location on it
    testDesk = await createDesk({ name: testDeskName('REMOVELOCATION') });
    testLocation = await createLocation({ name: testLocationName('REMOVELOCATION'), ...LatLngPosition });
    const response = await bffSend('POST', `/api/desks/${testDesk.uid}/locations`, { item_uid: testLocation.uid });
    validateStatus(response, ValidResponse);
    path = `/api/desks/${testDesk.uid}/locations/${testLocation.uid}`;
  });

  afterAll(async () => {
    // Test cleanup calls
    await deleteDesk(testDesk.uid);
    await deleteLocation(testLocation.uid);
  });

  /**
   * Negative Test Cases:
   * Validate response code, error message and, for validation errors, the detail
   */
  test('Remove location with no token', async () => {
    await handleErrors(path, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Remove location with invalid token', async () => {
    await handleErrors(path, ForbiddenResponse, 'Failed to unbind location from desk', null, 'bad-token');
  });

  test('Remove location from nonexistent desk uid', async () => {
    await handleErrors(`/api/desks/${NonexistentUid}/locations/${testLocation.uid}`, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Remove location from invalid desk uid', async () => {
    await handleErrors(`/api/desks/not-a-uuid/locations/${testLocation.uid}`, UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Remove location with invalid location uid', async () => {
    await handleErrors(`/api/desks/${testDesk.uid}/locations/not-a-uuid`, UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is the desk, no longer including the location
   * Then validate
   *   - GetDesk no longer lists the location
   *   - the location itself still exists in the location library
   */
  test('Remove location from desk', async () => {
    const response = await bffSend('DELETE', path);
    validateStatus(response, ValidResponse);
    expect(response.body.uid).toBe(testDesk.uid);
    expect(response.body.locations.map((l) => l.item_uid)).not.toContain(testLocation.uid);

    const savedDesk = (await bffGet(`/api/desks/${testDesk.uid}`)).body;
    expect(savedDesk.locations.map((l) => l.item_uid)).not.toContain(testLocation.uid);

    const libraryLocation = await bffGet(`/api/locations/${testLocation.uid}`);
    validateStatus(libraryLocation, ValidResponse);
  });

  /**
   * Get error response from RemoveDeskLocation and validate expected response code, error message
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
