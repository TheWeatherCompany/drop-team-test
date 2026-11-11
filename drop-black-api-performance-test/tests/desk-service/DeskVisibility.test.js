/**
 * DeskVisibility.test.js
 * Sets desk visibility to restricted or org-wide. Desk sharing. (CSV row 6)
 *
 * API covered by test class:
 *  - PUT /api/desks/{uid}/visibility
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

describe('Desk Visibility tests', () => {
  const testDeskUidsCreated = [];
  let testDesk;

  beforeAll(async () => {
    // Test setup calls
    testDesk = await createDesk({ name: testDeskName('VISIBILITY') });
    testDeskUidsCreated.push(testDesk.uid);
  });

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testDeskUidsCreated) {
      await deleteDesk(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Set visibility with no token', async () => {
    await handleErrors(testDesk.uid, { visibility: 'org_wide' }, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Set visibility with invalid token', async () => {
    await handleErrors(testDesk.uid, { visibility: 'org_wide' }, ForbiddenResponse, 'Failed to update desk visibility', 'bad-token');
  });

  test('Set visibility with no visibility', async () => {
    await handleErrors(testDesk.uid, {}, InvalidRequest, 'Invalid visibility');
  });

  test('Set visibility with invalid value', async () => {
    await handleErrors(testDesk.uid, { visibility: 'public' }, InvalidRequest, 'Invalid visibility');
  });

  test('Set visibility for nonexistent desk uid', async () => {
    await handleErrors(NonexistentUid, { visibility: 'restricted' }, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Set visibility for invalid desk uid', async () => {
    await handleErrors('not-a-uuid', { visibility: 'restricted' }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - visibility is the value supplied
   *   - name does not change
   * Then call GetDesk to validate the change was saved
   */
  test('Set visibility to org_wide', async () => {
    await setVisibilityAndValidate('org_wide');
  });

  test('Set visibility back to restricted', async () => {
    await setVisibilityAndValidate('restricted');
  });

  async function setVisibilityAndValidate(visibility) {
    const response = await bffSend('PUT', `/api/desks/${testDesk.uid}/visibility`, { visibility });
    validateStatus(response, ValidResponse);
    expect(response.body).toMatchObject({ uid: testDesk.uid, name: testDesk.name, visibility });

    const savedDesk = (await bffGet(`/api/desks/${testDesk.uid}`)).body;
    expect(savedDesk.visibility).toBe(visibility);
  }

  /**
   * Get error response from DeskVisibility and validate expected response code and error message
   */
  async function handleErrors(uid, body, expRespCode, expRespMessage, token) {
    const response = await bffSend('PUT', `/api/desks/${uid}/visibility`, body, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
