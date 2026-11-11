const { randomUUID } = require('crypto');
const {
  bffSend,
  validateStatus,
  ValidResponse,
  ValidNoContentResponse,
} = require('./RequestResponse.fixture');

const locationUidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One position in each format a location can use
const LatLngPosition = { latitude: 33.64, longitude: -84.43 };
const ICAOPosition = { icao_code: 'KATL' };
const MGRSPosition = { mgrs: '18TWL8463709766' };

// Every optional descriptive field, for Boston Logan
const FullLocationFields = {
  description: 'Created by API tests',
  latitude: 42.36,
  longitude: -71.01,
  address: '1 Harborside Dr',
  city: 'Boston',
  country: 'United States',
  country_code: 'US',
  postal_code: '02128',
  iana_time_zone: 'America/New_York',
  iata_code: 'BOS',
  meta: [{ name: 'source', value: 'api-test' }],
};

/**
 * Unique name for a location created by a test, e.g. TEST-API-EDIT-LOCATION-<uuid>.
 * The TEST-API- prefix makes leftover test locations easy to find and remove.
 */
function testLocationName(label) {
  return `TEST-API-${label}-LOCATION-${randomUUID()}`;
}

/**
 * Create a location and return it. Fields are passed straight through as the body,
 * e.g. { name, latitude, longitude }.
 */
async function createLocation(fields) {
  const response = await bffSend('POST', '/api/locations', fields);
  validateStatus(response, ValidResponse);
  return response.body;
}

/**
 * Delete a location. Returns true when the BFF responds 204.
 */
async function deleteLocation(uid) {
  const response = await bffSend('DELETE', `/api/locations/${uid}`);
  validateStatus(response, ValidNoContentResponse, null);
  return response.status === ValidNoContentResponse;
}

module.exports = {
  locationUidRegex,
  LatLngPosition,
  ICAOPosition,
  MGRSPosition,
  FullLocationFields,
  testLocationName,
  createLocation,
  deleteLocation,
};
