/**
 * DeskEdit.test.js
 * Edits a desk. (CSV row 4)
 * PUT replaces the whole desk, so any field left out of the body is cleared.
 *
 * API covered by test class:
 *  - PUT /api/desks/{uid}
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

describe('Edit Desk tests', () => {
  const testDeskUidsCreated = [];
  let deskToUpdate;

  beforeAll(async () => {
    // Test setup calls
    deskToUpdate = await createDesk({ name: testDeskName('EDIT'), description: 'Before edit' });
    testDeskUidsCreated.push(deskToUpdate.uid);
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
  test('Edit with no token', async () => {
    await handleErrors(deskToUpdate.uid, { name: deskToUpdate.name }, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Edit with invalid token', async () => {
    await handleErrors(deskToUpdate.uid, { name: deskToUpdate.name }, ForbiddenResponse, 'Failed to update desk', 'bad-token');
  });

  test('Edit nonexistent desk uid', async () => {
    await handleErrors(NonexistentUid, { name: testDeskName('NOTFOUND') }, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Edit invalid desk uid', async () => {
    await handleErrors('not-a-uuid', { name: testDeskName('INVALID') }, UnprocessableEntryResponse, 'validation failed');
  });

  test('Edit with malformed JSON', async () => {
    await handleErrors(deskToUpdate.uid, '{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Edit with unknown field', async () => {
    await handleErrors(deskToUpdate.uid, { name: deskToUpdate.name, bogus: 1 }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Blank desk name bug (reported, fix pending):
   * The API saves an edit with an empty or whitespace-only name and returns 200.
   * The app blocks an empty name but accepts spaces, so users can hit this.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and clears the desk's name
  test.skip('Edit with empty name', async () => {
    await handleErrors(deskToUpdate.uid, { name: '' }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   "); the app also allows it
  test.skip('Edit with whitespace-only name', async () => {
    await handleErrors(deskToUpdate.uid, { name: '   ' }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - name and description are updated
   *   - uid and owner do not change
   * Then call GetDesk to validate the edit was saved
   */
  test('Edit name and description', async () => {
    const name = testDeskName('EDITED');
    const response = await bffSend('PUT', `/api/desks/${deskToUpdate.uid}`, { name, description: 'After edit' });
    validateStatus(response, ValidResponse);

    expect(response.body).toMatchObject({
      uid: deskToUpdate.uid,
      owner_user_id: deskToUpdate.owner_user_id,
      name,
      description: 'After edit',
    });

    const savedDesk = (await bffGet(`/api/desks/${deskToUpdate.uid}`)).body;
    expect(savedDesk).toMatchObject({ name, description: 'After edit' });
  });

  test('Edit with only a name clears the description', async () => {
    const name = testDeskName('NAMEONLY');
    const response = await bffSend('PUT', `/api/desks/${deskToUpdate.uid}`, { name });
    validateStatus(response, ValidResponse);

    const savedDesk = (await bffGet(`/api/desks/${deskToUpdate.uid}`)).body;
    expect(savedDesk.name).toBe(name);
    expect(savedDesk.description).toBeUndefined();
  });

  /**
   * Get error response from EditDesk and validate expected response code and error message
   */
  async function handleErrors(uid, body, expRespCode, expRespMessage, token) {
    const response = await bffSend('PUT', `/api/desks/${uid}`, body, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
