const { randomUUID } = require('crypto');
const {
  bffGet,
  bffSend,
  validateStatus,
  ValidResponse,
  ValidNoContentResponse,
} = require('./RequestResponse.fixture');

const deskUidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Unique name for a desk created by a test, e.g. TEST-API-EDIT-DESK-<uuid>.
 * The TEST-API- prefix makes leftover test desks easy to find and remove.
 */
function testDeskName(label) {
  return `TEST-API-${label}-DESK-${randomUUID()}`;
}

/**
 * Create a desk and return it. Fields are passed straight through as the body,
 * e.g. { name, description, visibility }.
 */
async function createDesk(fields) {
  const response = await bffSend('POST', '/api/desks', fields);
  validateStatus(response, ValidResponse);
  return response.body;
}

/**
 * Delete a desk. Returns true when the BFF responds 204.
 */
async function deleteDesk(uid) {
  const response = await bffSend('DELETE', `/api/desks/${uid}`);
  validateStatus(response, ValidNoContentResponse, null);
  return response.status === ValidNoContentResponse;
}

/**
 * Find a desk the test user can see that has at least one location and one
 * route, so every desk endpoint has real IDs to call. Looked up at run time
 * so nothing is hard-coded.
 */
async function getTestDesk() {
  const response = await bffGet('/api/desks');
  validateStatus(response, ValidResponse);

  const desk = response.body.find((d) => d.locations.length > 0 && d.routes.length > 0);
  if (!desk) {
    throw new Error('No desk with at least one location and one route was found for the test user');
  }

  return {
    deskUid: desk.uid,
    locationUid: desk.locations[0].item_uid,
    routeUid: desk.routes[0].item_uid,
  };
}

/**
 * Tomorrow's date as YYYY-MM-DD. Tomorrow is always inside the forecast window,
 * while "today" can have no hours left late in the day.
 */
function forecastDate() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = { deskUidRegex, testDeskName, createDesk, deleteDesk, getTestDesk, forecastDate };
