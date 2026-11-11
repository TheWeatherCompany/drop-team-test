/**
 * ConditionSetDelete.test.js
 * Deletes an alert set. (CSV row 39)
 *
 * API covered by test class:
 *  - DELETE /api/alerts/conditionSets/{id}
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
const { testAlertName, alertSetBody, createConditionSet, deleteConditionSet } = require('../__fixtures__/Alert.fixture');

describe('Delete Alert Condition Set tests', () => {
  const testAlertSetUidsCreated = [];
  let setToDelete;

  beforeAll(async () => {
    // Test setup calls
    setToDelete = await createConditionSet(alertSetBody(testAlertName('DELETE')));
    testAlertSetUidsCreated.push(setToDelete.uid);
  });

  afterAll(async () => {
    // Test cleanup calls
    for (const uid of testAlertSetUidsCreated) {
      await deleteConditionSet(uid);
    }
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Delete with no token', async () => {
    await handleErrors(setToDelete.uid, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Delete with invalid token', async () => {
    await handleErrors(setToDelete.uid, ForbiddenResponse, 'Failed to delete condition set', 'bad-token');
  });

  test('Delete nonexistent alert set uid', async () => {
    await handleErrors(NonexistentUid, NotFoundResponse, 'Condition set not found');
  });

  test('Delete invalid alert set uid', async () => {
    await handleErrors('not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code
   *   - 204 with no body
   * Then validate the alert set is gone
   *   - GetConditionSet returns 404
   *   - it is not in GetConditionSets
   *   - deleting it again returns 404
   */
  test('Delete alert set', async () => {
    const response = await bffSend('DELETE', `/api/alerts/conditionSets/${setToDelete.uid}`);
    validateStatus(response, ValidNoContentResponse, null);
    testAlertSetUidsCreated.pop();

    const getResponse = await bffGet(`/api/alerts/conditionSets/${setToDelete.uid}`);
    validateStatus(getResponse, NotFoundResponse);

    const list = (await bffGet('/api/alerts/conditionSets')).body;
    expect(list.find((s) => s.uid === setToDelete.uid)).toBeUndefined();

    await handleErrors(setToDelete.uid, NotFoundResponse, 'Condition set not found');
  });

  /**
   * Get error response from DeleteConditionSet and validate expected response code and error message
   */
  async function handleErrors(uid, expRespCode, expRespMessage, token) {
    const response = await bffSend('DELETE', `/api/alerts/conditionSets/${uid}`, undefined, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
