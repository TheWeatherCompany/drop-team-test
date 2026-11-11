/**
 * ConditionSetEdit.test.js
 * Edits an alert set. (CSV row 38)
 * PUT replaces the whole alert set and requires condition_groups.
 *
 * API covered by test class:
 *  - PUT /api/alerts/conditionSets/{id}
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
const { testAlertName, alertSetBody, createConditionSet, deleteConditionSet } = require('../__fixtures__/Alert.fixture');

describe('Edit Alert Condition Set tests', () => {
  let setToUpdate;

  beforeAll(async () => {
    // Test setup calls
    setToUpdate = await createConditionSet(alertSetBody(testAlertName('EDIT')));
  });

  afterAll(async () => {
    // Test cleanup calls
    await deleteConditionSet(setToUpdate.uid);
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Edit with no token', async () => {
    await handleErrors(setToUpdate.uid, setToUpdate, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Edit with invalid token', async () => {
    await handleErrors(setToUpdate.uid, setToUpdate, ForbiddenResponse, 'Failed to update condition set', 'bad-token');
  });

  test('Edit nonexistent alert set uid', async () => {
    await handleErrors(NonexistentUid, { ...setToUpdate, uid: NonexistentUid }, NotFoundResponse, 'Condition set not found');
  });

  test('Edit invalid alert set uid', async () => {
    await handleErrors('not-a-uuid', setToUpdate, UnprocessableEntryResponse, 'validation failed');
  });

  test('Edit with only a name (no condition groups)', async () => {
    await handleErrors(setToUpdate.uid, { name: testAlertName('NAMEONLY') }, UnprocessableEntryResponse, 'validation failed');

    // The rejected edit must not change the saved alert set
    const saved = (await bffGet(`/api/alerts/conditionSets/${setToUpdate.uid}`)).body;
    expect(saved.name).toBe(setToUpdate.name);
  });

  /**
   * Blank name bug (reported with desks, routes and locations, fix pending):
   * The API saves an edit with an empty or whitespace-only name and returns 200.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and clears the alert set's name
  test.skip('Edit with empty name', async () => {
    await handleErrors(setToUpdate.uid, { ...setToUpdate, name: '' }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   "); the app also allows it
  test.skip('Edit with whitespace-only name', async () => {
    await handleErrors(setToUpdate.uid, { ...setToUpdate, name: '   ' }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Malformed JSON bug (reported, fix pending). API returns 500 "Internal server error";
  // other BFF routes return 400 "Invalid JSON body"
  test.skip('Edit with malformed JSON', async () => {
    await handleErrors(setToUpdate.uid, '{not json', InvalidRequest, 'Invalid JSON body');
  });

  // TODO: Non-numeric threshold bug (reported, fix pending). API returns 200 and saves "hot"
  test.skip('Edit with non-numeric threshold', async () => {
    const edited = JSON.parse(JSON.stringify(setToUpdate));
    edited.condition_groups[0].conditions[0].inputs.find((i) => i.name === 'threshold_value').value = 'hot';
    await handleErrors(setToUpdate.uid, edited, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: Empty alert set bug (reported, fix pending). API returns 200 and saves 0 groups
  test.skip('Edit to remove all condition groups', async () => {
    await handleErrors(setToUpdate.uid, { ...setToUpdate, condition_groups: [] }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - name and threshold are updated
   *   - uid does not change
   * Then call GetConditionSet to validate the edit was saved
   */
  test('Edit name and threshold', async () => {
    const current = (await bffGet(`/api/alerts/conditionSets/${setToUpdate.uid}`)).body;
    const name = testAlertName('EDITED');
    const edited = JSON.parse(JSON.stringify(current));
    edited.name = name;
    edited.condition_groups[0].conditions[0].inputs.find((i) => i.name === 'threshold_value').value = '110';

    const response = await bffSend('PUT', `/api/alerts/conditionSets/${setToUpdate.uid}`, edited);
    validateStatus(response, ValidResponse);
    expect(response.body).toMatchObject({ uid: setToUpdate.uid, name });

    const saved = (await bffGet(`/api/alerts/conditionSets/${setToUpdate.uid}`)).body;
    expect(saved.name).toBe(name);
    const threshold = saved.condition_groups[0].conditions[0].inputs.find((i) => i.name === 'threshold_value');
    expect(threshold.value).toBe('110');
    setToUpdate = saved;
  });

  /**
   * Get error response from EditConditionSet and validate expected response code and error message
   */
  async function handleErrors(uid, body, expRespCode, expRespMessage, token) {
    const response = await bffSend('PUT', `/api/alerts/conditionSets/${uid}`, body, token);
    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
