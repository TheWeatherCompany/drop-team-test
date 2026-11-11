/**
 * DeskDelete.test.js
 * Deletes a desk. (CSV row 5)
 *
 * API covered by test class:
 *  - DELETE /api/desks/{uid}
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
const { testDeskName, createDesk, deleteDesk } = require('../__fixtures__/Desk.fixture');

describe('Delete Desk tests', () => {
  const testDeskUidsCreated = [];
  let deskToDelete;

  beforeAll(async () => {
    // Test setup calls
    deskToDelete = await createDesk({ name: testDeskName('DELETE') });
    testDeskUidsCreated.push(deskToDelete.uid);
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
  test('Delete with no token', async () => {
    await handleErrors(deskToDelete.uid, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Delete with invalid token', async () => {
    await handleErrors(deskToDelete.uid, ForbiddenResponse, 'Failed to delete desk', 'bad-token');
  });

  test('Delete nonexistent desk uid', async () => {
    await handleErrors(NonexistentUid, NotFoundResponse, `desk uid ${NonexistentUid} not found`);
  });

  test('Delete invalid desk uid', async () => {
    await handleErrors('not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code
   *   - 204 with no body
   * Then validate the desk is gone
   *   - GetDesk returns 404
   *   - desk is not in GetDesks
   *   - deleting it again returns 404
   */
  test('Delete desk', async () => {
    const response = await bffSend('DELETE', `/api/desks/${deskToDelete.uid}`);
    validateStatus(response, ValidNoContentResponse, null);
    testDeskUidsCreated.pop();

    const getResponse = await bffGet(`/api/desks/${deskToDelete.uid}`);
    validateStatus(getResponse, NotFoundResponse);

    const deskList = (await bffGet('/api/desks')).body;
    expect(deskList.find((d) => d.uid === deskToDelete.uid)).toBeUndefined();

    await handleErrors(deskToDelete.uid, NotFoundResponse, `desk uid ${deskToDelete.uid} not found`);
  });

  /**
   * Get error response from DeleteDesk and validate expected response code and error message
   */
  async function handleErrors(uid, expRespCode, expRespMessage, token) {
    const response = await bffSend('DELETE', `/api/desks/${uid}`, undefined, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
