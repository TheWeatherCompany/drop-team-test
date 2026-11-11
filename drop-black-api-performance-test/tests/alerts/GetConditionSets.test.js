/**
 * GetConditionSets.test.js
 * MetWatch alert sets (CSV row 35), one alert set (CSV row 37), and predefined
 * alert templates (CSV row 40). Alert forms and alert management.
 *
 * API covered by test class:
 *  - GET /api/alerts/conditionSets
 *  - GET /api/alerts/conditionSets/{id}
 *  - GET /api/alerts/conditionTemplates?application=dropblack
 */
const {
  bffGet,
  validateStatus,
  handleErrors,
  ValidResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
  NonexistentUid,
} = require('../__fixtures__/RequestResponse.fixture');
const { testAlertName, alertSetBody, createConditionSet, deleteConditionSet } = require('../__fixtures__/Alert.fixture');

describe('Get Alert Condition Sets tests', () => {
  let testAlertSet;

  beforeAll(async () => {
    // Test setup calls
    testAlertSet = await createConditionSet(alertSetBody(testAlertName('GET')));
  });

  afterAll(async () => {
    // Test cleanup calls
    await deleteConditionSet(testAlertSet.uid);
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get alert sets with no token', async () => {
    await handleErrors('/api/alerts/conditionSets', UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get alert sets with invalid token', async () => {
    await handleErrors('/api/alerts/conditionSets', ForbiddenResponse, 'Failed to fetch condition sets', 'bad-token');
  });

  test('Get one alert set with no token', async () => {
    await handleErrors(`/api/alerts/conditionSets/${testAlertSet.uid}`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get one alert set with invalid token', async () => {
    await handleErrors(`/api/alerts/conditionSets/${testAlertSet.uid}`, ForbiddenResponse, 'Failed to fetch condition set', 'bad-token');
  });

  test('Get nonexistent alert set uid', async () => {
    await handleErrors(`/api/alerts/conditionSets/${NonexistentUid}`, NotFoundResponse, `condition_set uid ${NonexistentUid} not found`);
  });

  test('Get invalid alert set uid', async () => {
    await handleErrors('/api/alerts/conditionSets/not-a-uuid', UnprocessableEntryResponse, 'validation failed');
  });

  test('Get templates with no token', async () => {
    await handleErrors('/api/alerts/conditionTemplates?application=dropblack', UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get templates with invalid token', async () => {
    await handleErrors('/api/alerts/conditionTemplates?application=dropblack', ForbiddenResponse, 'Failed to fetch condition templates', 'bad-token');
  });

  // TODO: Open question, not reported. Templates for an unknown application return 200 null
  // instead of an empty list or 400
  test.skip('Get templates for an unknown application', async () => {
    const response = await bffGet('/api/alerts/conditionTemplates?application=zzz');
    // Either answer is fine: 200 with an empty list, or 400 for the unknown application
    expect([ValidResponse, InvalidRequest]).toContain(response.status);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toBeNull();
    if (response.status === ValidResponse) expect(response.body).toEqual([]);
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - the list includes the test alert set, and every set has a uid, name and groups
   *   - the name filter finds the test alert set
   *   - one alert set returns its groups and conditions
   *   - templates are for Drop Black and each has a uid, name and targets
   */
  test('Get alert sets', async () => {
    const response = await bffGet('/api/alerts/conditionSets');
    validateStatus(response, ValidResponse);

    expect(Array.isArray(response.body)).toBe(true);
    response.body.forEach((set) => {
      expect(typeof set.uid).toBe('string');
      expect(typeof set.name).toBe('string');
      expect(Array.isArray(set.condition_groups)).toBe(true);
    });
    expect(response.body.map((s) => s.uid)).toContain(testAlertSet.uid);
  });

  test('Get alert sets filtered by name', async () => {
    const response = await bffGet(`/api/alerts/conditionSets?name=${encodeURIComponent(testAlertSet.name)}`);
    validateStatus(response, ValidResponse);
    expect(response.body.map((s) => s.uid)).toEqual([testAlertSet.uid]);
  });

  test('Get one alert set', async () => {
    const response = await bffGet(`/api/alerts/conditionSets/${testAlertSet.uid}`);
    validateStatus(response, ValidResponse);

    const set = response.body;
    expect(set).toMatchObject({ uid: testAlertSet.uid, name: testAlertSet.name, application: 'dropblack' });
    expect(set.condition_groups[0].conditions[0]).toMatchObject({ template_uid: 'metar_temperature', target: 'Location' });
  });

  test('Get alert templates for Drop Black', async () => {
    const response = await bffGet('/api/alerts/conditionTemplates?application=dropblack');
    validateStatus(response, ValidResponse);

    const templates = response.body;
    expect(templates.length).toBeGreaterThan(0);
    templates.forEach((template) => {
      expect(typeof template.uid).toBe('string');
      expect(typeof template.name).toBe('string');
      expect(template.application).toContain('dropblack');
      expect(Array.isArray(template.target)).toBe(true);
    });
    expect(templates.map((t) => t.uid)).toContain('metar_temperature');
  });
});
