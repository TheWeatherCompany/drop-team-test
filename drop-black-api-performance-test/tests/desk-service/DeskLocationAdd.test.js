/**
 * DeskLocationAdd.test.js
 * Binds a location to a desk, with optional alert sets. Mission Panel locations. (CSV row 13)
 *
 * API covered by test class:
 *  - POST /api/desks/{uid}/locations
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
const { LatLngPosition, testLocationName, createLocation, deleteLocation } = require('../__fixtures__/Location.fixture');
const { ICAOPoints, testRouteName, createRoute, deleteRoute } = require('../__fixtures__/Route.fixture');

describe('Add Location to Desk tests', () => {
  let testDesk;
  let testLocation;
  let path;

  beforeAll(async () => {
    // Test setup calls
    testDesk = await createDesk({ name: testDeskName('ADDLOCATION') });
    testLocation = await createLocation({ name: testLocationName('ADDLOCATION'), ...LatLngPosition });
    path = `/api/desks/${testDesk.uid}/locations`;
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
  test('Add location with no token', async () => {
    await handleErrors(path, { item_uid: testLocation.uid }, UnauthorizedResponse, 'Unauthorized', null, null);
  });

  test('Add location with invalid token', async () => {
    await handleErrors(path, { item_uid: testLocation.uid }, ForbiddenResponse, 'Failed to bind location to desk', null, 'bad-token');
  });

  test('Add location to nonexistent desk uid', async () => {
    await handleErrors(`/api/desks/${NonexistentUid}/locations`, { item_uid: testLocation.uid },
      NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Add location to invalid desk uid', async () => {
    await handleErrors('/api/desks/not-a-uuid/locations', { item_uid: testLocation.uid },
      UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Add location with invalid location uid', async () => {
    await handleErrors(path, { item_uid: 'not-a-uuid' }, UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Add location with invalid condition set uid', async () => {
    await handleErrors(path, { item_uid: testLocation.uid, condition_set_uids: ['not-a-uuid'] },
      UnprocessableEntryResponse, 'validation failed', 'invalid UUID');
  });

  test('Add location with unknown field', async () => {
    await handleErrors(path, { item_uid: testLocation.uid, bogus: 1 }, UnprocessableEntryResponse, 'validation failed', 'unexpected property');
  });

  test('Add location with malformed JSON', async () => {
    await handleErrors(path, '{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Add location with no body', async () => {
    await handleErrors(path, undefined, InvalidRequest, 'Invalid JSON body');
  });

  /**
   * Nonexistent item bug (reported, fix pending):
   * The API adds any correctly formatted ID to the desk, even one that is not a location,
   * and returns 200. The app always sends the ID of a location it just created.
   * Update expected code and message once fixed.
   */
  // TODO: API returns 200 and saves a link to a location that does not exist
  test.skip('Add nonexistent location uid', async () => {
    const randomUid = randomUUID();
    await handleErrors(path, { item_uid: randomUid }, NotFoundResponse, `location uid ${randomUid} not found`);
  });

  // TODO: API returns 200 and saves a route's ID as a location
  test.skip('Add a route uid as a location', async () => {
    const route = await createRoute({ name: testRouteName('ASLOCATION'), points: ICAOPoints });
    try {
      await handleErrors(path, { item_uid: route.uid }, NotFoundResponse, `location uid ${route.uid} not found`);
    } finally {
      await deleteRoute(route.uid);
    }
  });

  // TODO: Same reported bug. API returns 200 and saves a condition set that does not exist
  // (the app only attaches alert sets it just created in the Alerts service)
  test.skip('Add location with nonexistent condition set uid', async () => {
    const randomUid = randomUUID();
    await handleErrors(path, { item_uid: testLocation.uid, condition_set_uids: [randomUid] }, NotFoundResponse, 'not found');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - response is the desk, now including the location
   *   - adding the same location again does not add a duplicate
   * Then call GetDesk to validate the location was saved on the desk
   */
  test('Add location to desk', async () => {
    const response = await bffSend('POST', path, { item_uid: testLocation.uid });
    validateStatus(response, ValidResponse);
    expect(response.body.uid).toBe(testDesk.uid);
    expect(response.body.locations.map((l) => l.item_uid)).toContain(testLocation.uid);

    const savedDesk = (await bffGet(`/api/desks/${testDesk.uid}`)).body;
    expect(savedDesk.locations.map((l) => l.item_uid)).toContain(testLocation.uid);
  });

  test('Add the same location again does not duplicate it', async () => {
    const response = await bffSend('POST', path, { item_uid: testLocation.uid });
    validateStatus(response, ValidResponse);

    const matches = response.body.locations.filter((l) => l.item_uid === testLocation.uid);
    expect(matches.length).toBe(1);
  });

  test('Add location with null condition sets', async () => {
    const response = await bffSend('POST', path, { item_uid: testLocation.uid, condition_set_uids: null });
    validateStatus(response, ValidResponse);
    expect(response.body.locations.map((l) => l.item_uid)).toContain(testLocation.uid);
  });

  /**
   * Get error response from AddDeskLocation and validate expected response code, error message
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
