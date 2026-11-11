/**
 * ConditionSetCreate.test.js
 * Creates an alert set. (CSV row 36)
 *
 * API covered by test class:
 *  - POST /api/alerts/conditionSets
 */
const {
  bffGet,
  bffSend,
  validateStatus,
  InvalidRequest,
  ValidResponse,
  UnauthorizedResponse,
  ForbiddenResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');
const {
  conditionSetUidRegex,
  TemperatureCondition,
  testAlertName,
  alertSetBody,
  createConditionSet,
  deleteConditionSet,
} = require('../__fixtures__/Alert.fixture');

const path = '/api/alerts/conditionSets';

describe('Create Alert Condition Set tests', () => {
  const testAlertSetUidsCreated = [];

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
  test('Create with no token', async () => {
    await handleErrors(alertSetBody(testAlertName('NOTOKEN')), UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Create with invalid token', async () => {
    await handleErrors(alertSetBody(testAlertName('BADTOKEN')), ForbiddenResponse, 'Failed to create condition set', 'bad-token');
  });

  test('Create with no name', async () => {
    const { name, ...body } = alertSetBody('unused');
    await handleErrors(body, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with no condition groups', async () => {
    await handleErrors({ name: testAlertName('NOGROUPS'), application: 'dropblack' }, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with unknown template', async () => {
    const body = alertSetBody(testAlertName('BADTEMPLATE'), [{ ...TemperatureCondition, template_uid: 'zzz_template' }]);
    await handleErrors(body, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with invalid severity', async () => {
    const body = alertSetBody(testAlertName('BADSEVERITY'), [{ ...TemperatureCondition, severity: 9 }]);
    await handleErrors(body, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with invalid target', async () => {
    const body = alertSetBody(testAlertName('BADTARGET'), [{ ...TemperatureCondition, target: 'Mars' }]);
    await handleErrors(body, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with invalid comparison', async () => {
    const inputs = [{ name: 'comparison_func', value: 'Sideways' }, ...TemperatureCondition.inputs.slice(1)];
    const body = alertSetBody(testAlertName('BADCOMPARE'), [{ ...TemperatureCondition, inputs }]);
    await handleErrors(body, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with condition missing inputs', async () => {
    const { inputs, ...condition } = TemperatureCondition;
    await handleErrors(alertSetBody(testAlertName('NOINPUTS'), [condition]), UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with unknown field', async () => {
    await handleErrors({ ...alertSetBody(testAlertName('UNKNOWN')), bogus: 1 }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Blank name bug (reported with desks, routes and locations, fix pending):
   * The API saves an alert set with an empty or whitespace-only name and returns 200
   * (a missing name is rejected). The app blocks an empty name but accepts spaces.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and saves an alert set with an empty name
  test.skip('Create with empty name', async () => {
    await handleErrors(alertSetBody(''), UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   "); the app also allows it
  test.skip('Create with whitespace-only name', async () => {
    await handleErrors(alertSetBody('   '), UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Malformed JSON bug (reported, fix pending):
   * The alerts routes return 500 "Internal server error" for malformed or missing JSON.
   * Other BFF routes return 400 "Invalid JSON body".
   */
  // TODO: API returns 500 "Internal server error"
  test.skip('Create with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  // TODO: API returns 500 "Internal server error"
  test.skip('Create with no body', async () => {
    await handleErrors(undefined, InvalidRequest, 'Invalid JSON body');
  });

  /**
   * Non-numeric threshold bug (reported, fix pending):
   * The API saves a threshold_value that isn't a number and returns 200, so the alert
   * can never trigger. The app's threshold field only accepts numbers.
   */
  const withThreshold = (value) => [{
    ...TemperatureCondition,
    inputs: [...TemperatureCondition.inputs.slice(0, 2), { name: 'threshold_value', value }],
  }];

  // TODO: API returns 200 and saves "hot" (description: "...greater than or equal to hot °F")
  test.skip('Create with non-numeric threshold', async () => {
    await handleErrors(alertSetBody(testAlertName('THRESHTEXT'), withThreshold('hot')), UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves an empty threshold
  test.skip('Create with empty threshold', async () => {
    await handleErrors(alertSetBody(testAlertName('THRESHEMPTY'), withThreshold('')), UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Empty alert set bug (reported, fix pending):
   * The API saves an alert set with no groups, or a group with no conditions, and
   * returns 200. It can never trigger. The app can't save one without conditions.
   */
  // TODO: API returns 200 and saves an alert set with 0 groups
  test.skip('Create with empty condition groups', async () => {
    await handleErrors({ ...alertSetBody(testAlertName('NOGROUPLIST')), condition_groups: [] }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves a group with 0 conditions
  test.skip('Create with a group that has no conditions', async () => {
    await handleErrors(alertSetBody(testAlertName('EMPTYGROUP'), []), UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Other application bug (reported, fix pending):
   * The Drop Black BFF saves alert sets for another application ("groundops") or with no
   * application. Neither shows in Drop Black's alert list. Once fixed, the BFF should
   * either reject these (422) or save them as "dropblack"; either passes this check.
   */
  async function expectOnlyDropBlack(body) {
    const response = await bffSend('POST', path, body);
    if (response.body?.uid) testAlertSetUidsCreated.push(response.body.uid);
    if (response.status === UnprocessableEntryResponse) return;
    validateStatus(response, ValidResponse);
    expect(response.body.application).toBe('dropblack');
  }

  // TODO: API returns 200 and saves "application": "groundops"
  test.skip('Create for another application (groundops)', async () => {
    await expectOnlyDropBlack({ ...alertSetBody(testAlertName('GROUNDOPS')), application: 'groundops' });
  });

  // TODO: API returns 200 and saves the alert set with no application
  test.skip('Create with no application', async () => {
    const { application, ...body } = alertSetBody(testAlertName('NOAPP'));
    await expectOnlyDropBlack(body);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid is a UUID
   *   - name, application and the condition are saved as supplied
   *   - the service fills in a readable description for each condition
   * Then call GetConditionSet and GetConditionSets to validate it was saved
   */
  test('Create alert set with one condition', async () => {
    const name = testAlertName('CREATE');
    const set = await createConditionSet(alertSetBody(name));
    testAlertSetUidsCreated.push(set.uid);

    expect(set.uid).toMatch(conditionSetUidRegex);
    expect(set).toMatchObject({ name, application: 'dropblack', customer_id: expect.any(String) });
    const condition = set.condition_groups[0].conditions[0];
    expect(condition).toMatchObject(TemperatureCondition);
    expect(condition.description).toContain('METAR Temperature greater than or equal to 100 °F');

    const saved = (await bffGet(`${path}/${set.uid}`)).body;
    expect(saved).toMatchObject({ uid: set.uid, name });

    const list = (await bffGet(path)).body;
    expect(list.map((s) => s.uid)).toContain(set.uid);
  });

  test('Create alert set with several conditions', async () => {
    const windCondition = {
      ...TemperatureCondition,
      template_uid: 'metar_wind_speed',
      inputs: [
        { name: 'comparison_func', value: 'GreaterThanOrEquals' },
        { name: 'threshold_unit', value: 'kt' },
        { name: 'threshold_value', value: '50' },
      ],
    };
    const set = await createConditionSet(alertSetBody(testAlertName('MULTI'), [TemperatureCondition, windCondition]));
    testAlertSetUidsCreated.push(set.uid);

    expect(set.condition_groups[0].conditions.map((c) => c.template_uid)).toEqual(['metar_temperature', 'metar_wind_speed']);
  });

  /**
   * Get error response from CreateConditionSet and validate expected response code and error message
   */
  async function handleErrors(body, expRespCode, expRespMessage, token) {
    const response = await bffSend('POST', path, body, token);
    // If an alert set was created by mistake, remove it after the tests
    if (response.body?.uid) testAlertSetUidsCreated.push(response.body.uid);

    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
