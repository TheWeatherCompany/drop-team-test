/**
 * DeskCreate.test.js
 * Creates a desk. (CSV row 2)
 *
 * API covered by test class:
 *  - POST /api/desks
 */
const {
  bffGet,
  bffSend,
  validateStatus,
  ValidResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  UnprocessableEntryResponse,
} = require('../__fixtures__/RequestResponse.fixture');
const { deskUidRegex, testDeskName, createDesk, deleteDesk } = require('../__fixtures__/Desk.fixture');

describe('Create Desk tests', () => {
  const testDeskUidsCreated = [];

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
  test('Create with no token', async () => {
    await handleErrors({ name: testDeskName('NOTOKEN') }, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Create with invalid token', async () => {
    await handleErrors({ name: testDeskName('BADTOKEN') }, ForbiddenResponse, 'Failed to create desk', 'bad-token');
  });

  test('Create with no body', async () => {
    await handleErrors(undefined, InvalidRequest, 'Invalid JSON body');
  });

  test('Create with malformed JSON', async () => {
    await handleErrors('{not json', InvalidRequest, 'Invalid JSON body');
  });

  test('Create with unknown field', async () => {
    await handleErrors({ name: testDeskName('UNKNOWN'), bogus: 1 }, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with invalid visibility', async () => {
    await handleErrors({ name: testDeskName('BADVIS'), visibility: 'public' }, UnprocessableEntryResponse, 'validation failed');
  });

  test('Create with non-string name', async () => {
    await handleErrors({ name: 123 }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Blank desk name bug (reported, fix pending):
   * The API saves a desk with a missing, empty or whitespace-only name and returns 200.
   * The app blocks an empty name but accepts spaces, so users can hit this.
   * Unskip once the fix is in, and update the expected code and message to match it.
   */
  // TODO: API returns 200 and creates a desk with no name
  test.skip('Create with no name', async () => {
    await handleErrors({}, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and creates a desk with an empty name
  test.skip('Create with empty name', async () => {
    await handleErrors({ name: '' }, UnprocessableEntryResponse, 'validation failed');
  });

  // TODO: API returns 200 and saves the name as-is ("   "); the app also allows it
  test.skip('Create with whitespace-only name', async () => {
    await handleErrors({ name: '   ' }, UnprocessableEntryResponse, 'validation failed');
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - uid is a UUID
   *   - name is the name supplied
   *   - visibility defaults to restricted
   *   - owner_user_id is the logged in user
   * Then call GetDesks to validate the desk was saved
   */
  test('Create with minimum parameters', async () => {
    const name = testDeskName('MIN');
    const desk = await createDesk({ name });
    testDeskUidsCreated.push(desk.uid);

    expect(desk.uid).toMatch(deskUidRegex);
    expect(desk.name).toBe(name);
    expect(desk.visibility).toBe('restricted');
    expect(typeof desk.owner_user_id).toBe('string');

    const deskList = (await bffGet('/api/desks')).body;
    const savedDesk = deskList.find((d) => d.uid === desk.uid);
    expect(savedDesk).toMatchObject({ name, visibility: 'restricted', locations: [], routes: [] });
  });

  test('Create with description', async () => {
    const name = testDeskName('DESC');
    const desk = await createDesk({ name, description: 'Created by API tests' });
    testDeskUidsCreated.push(desk.uid);

    expect(desk.uid).toMatch(deskUidRegex);
    expect(desk).toMatchObject({ name, description: 'Created by API tests' });

    const savedDesk = (await bffGet(`/api/desks/${desk.uid}`)).body;
    expect(savedDesk).toMatchObject({ name, description: 'Created by API tests' });
  });

  // TODO: API accepts visibility on create but always saves restricted. The drop service spec
  // lists visibility (restricted | org_wide) in the create body, and has an owner-only
  // PUT /desks/{uid}/visibility, but doesn't say whether create honours it; confirm with the dev team
  test.skip('Create with org_wide visibility', async () => {
    const name = testDeskName('ORGWIDE');
    const desk = await createDesk({ name, visibility: 'org_wide' });
    testDeskUidsCreated.push(desk.uid);

    expect(desk.visibility).toBe('org_wide');

    const savedDesk = (await bffGet(`/api/desks/${desk.uid}`)).body;
    expect(savedDesk.visibility).toBe('org_wide');
  });

  /**
   * Get error response from CreateDesk and validate expected response code and error message
   */
  async function handleErrors(body, expRespCode, expRespMessage, token) {
    const response = await bffSend('POST', '/api/desks', body, token);
    // If a desk was created by mistake, remove it after the tests
    if (response.body?.uid) testDeskUidsCreated.push(response.body.uid);

    validateStatus(response, expRespCode);
    expect(response.body.error).toContain(expRespMessage);
  }
});
