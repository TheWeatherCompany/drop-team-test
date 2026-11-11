const { randomUUID } = require('crypto');
const {
  bffSend,
  validateStatus,
  ValidResponse,
  ValidNoContentResponse,
} = require('./RequestResponse.fixture');

const routeUidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Atlanta to Boston, two hours apart, in each position format a route point can use
const ICAOPoints = [
  { icao: 'KATL', flight_level: 'FL300', timestamp: '2026-11-01T10:00:00Z' },
  { icao: 'KBOS', flight_level: 'FL300', timestamp: '2026-11-01T12:00:00Z' },
];
const MGRSPoints = [
  { mgrs: '18TWL8463709766', flight_level: 'FL010', timestamp: '2026-11-01T10:00:00Z' },
  { mgrs: '19TCG3033587466', flight_level: 'FL010', timestamp: '2026-11-01T12:00:00Z' },
];
const LatLngPoints = [
  { latitude: 33.64, longitude: -84.43, altitude: 10000, timestamp: '2026-11-01T10:00:00Z' },
  { latitude: 42.36, longitude: -71.01, altitude: 10000, timestamp: '2026-11-01T12:00:00Z' },
];

/**
 * Unique name for a route created by a test, e.g. TEST-API-EDIT-ROUTE-<uuid>.
 * The TEST-API- prefix makes leftover test routes easy to find and remove.
 */
function testRouteName(label) {
  return `TEST-API-${label}-ROUTE-${randomUUID()}`;
}

/**
 * Create a route and return it. Fields are passed straight through as the body,
 * e.g. { name, points, meta }.
 */
async function createRoute(fields) {
  const response = await bffSend('POST', '/api/routes', fields);
  validateStatus(response, ValidResponse);
  return response.body;
}

/**
 * Delete a route. Returns true when the BFF responds 204.
 */
async function deleteRoute(uid) {
  const response = await bffSend('DELETE', `/api/routes/${uid}`);
  validateStatus(response, ValidNoContentResponse, null);
  return response.status === ValidNoContentResponse;
}

module.exports = {
  routeUidRegex,
  ICAOPoints,
  MGRSPoints,
  LatLngPoints,
  testRouteName,
  createRoute,
  deleteRoute,
};
