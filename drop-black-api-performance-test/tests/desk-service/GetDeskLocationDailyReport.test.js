/**
 * GetDeskLocationDailyReport.test.js
 * Daily forecast for one location on one date. Location hourly detail. (CSV row 16)
 *
 * API covered by test class:
 *  - GET /api/desks/{uid}/locations/{location_uid}/daily-report?date={date}
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
const { getTestDesk, forecastDate } = require('../__fixtures__/Desk.fixture');

describe('Get Desk Location Daily Report tests', () => {
  let testDesk;
  let basePath;
  const date = forecastDate();

  beforeAll(async () => {
    testDesk = await getTestDesk();
    basePath = `/api/desks/${testDesk.deskUid}/locations/${testDesk.locationUid}/daily-report`;
  });

  /**
   * Negative Test Cases:
   * Validate response code and error message
   */
  test('Get daily report with no token', async () => {
    await handleErrors(`${basePath}?date=${date}`, UnauthorizedResponse, 'Unauthorized', null);
  });

  test('Get daily report with invalid token', async () => {
    await handleErrors(`${basePath}?date=${date}`, ForbiddenResponse, 'Failed to fetch location daily report', 'bad-token');
  });

  test('Get daily report with no date', async () => {
    await handleErrors(basePath, InvalidRequest, 'Invalid date');
  });

  test('Get daily report with invalid date format', async () => {
    await handleErrors(`${basePath}?date=not-a-date`, UnprocessableEntryResponse, 'date must be in YYYY-MM-DD format');
  });

  test('Get daily report for date outside the forecast', async () => {
    await handleErrors(`${basePath}?date=2020-01-01`, NotFoundResponse, 'no forecast hours for date 2020-01-01');
  });

  test('Get daily report for nonexistent desk uid', async () => {
    await handleErrors(
      `/api/desks/${NonexistentUid}/locations/${testDesk.locationUid}/daily-report?date=${date}`,
      NotFoundResponse,
      `desk uid ${NonexistentUid} not found`
    );
  });

  test('Get daily report for nonexistent location uid', async () => {
    await handleErrors(
      `/api/desks/${testDesk.deskUid}/locations/${NonexistentUid}/daily-report?date=${date}`,
      NotFoundResponse,
      `location uid ${NonexistentUid} not found on desk ${testDesk.deskUid}`
    );
  });

  /**
   * Positive Test Cases:
   * Validate response code and response objects
   *   - location_uid and date match the request
   *   - hours contain forecast entries with temperature and wind
   *   - sun_moon times are present
   */
  test('Get daily report for valid location and date', async () => {
    const response = await bffGet(`${basePath}?date=${date}`);
    validateStatus(response, ValidResponse);

    const report = response.body;
    expect(report.location_uid).toBe(testDesk.locationUid);
    expect(report.date).toBe(date);
    expect(typeof report.risk).toBe('number');
    expect(report.hours.length).toBeGreaterThan(0);
    report.hours.forEach((hour) => {
      expect(hour.valid_time_local.startsWith(date)).toBe(true);
      expect(typeof hour.temperature.value).toBe('number');
      expect(typeof hour.temperature.unit).toBe('string');
      expect(typeof hour.wind_speed.value).toBe('number');
      expect(typeof hour.wind_speed.unit).toBe('string');
    });
    expect(typeof report.sun_moon.sunrise_time_utc).toBe('number');
    expect(typeof report.sun_moon.sunset_time_utc).toBe('number');
  });
});
