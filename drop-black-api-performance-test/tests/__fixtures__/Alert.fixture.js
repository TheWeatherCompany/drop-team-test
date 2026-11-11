const { randomUUID } = require('crypto');
const {
  bffSend,
  validateStatus,
  ValidResponse,
  ValidNoContentResponse,
} = require('./RequestResponse.fixture');

const conditionSetUidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// METAR temperature >= 100 °F at a location. Test alert sets are never attached
// to a desk, route or location, so they can't trigger real alerts.
const TemperatureCondition = {
  template_uid: 'metar_temperature',
  severity: 2,
  target: 'Location',
  inputs: [
    { name: 'comparison_func', value: 'GreaterThanOrEquals' },
    { name: 'threshold_unit', value: '°F' },
    { name: 'threshold_value', value: '100' },
  ],
};

/**
 * Unique name for an alert set created by a test, e.g. TEST-API-EDIT-ALERT-<uuid>.
 * The TEST-API- prefix makes leftover test alert sets easy to find and remove.
 */
function testAlertName(label) {
  return `TEST-API-${label}-ALERT-${randomUUID()}`;
}

/**
 * Body for a valid Drop Black alert set with one group holding the given conditions
 */
function alertSetBody(name, conditions = [TemperatureCondition]) {
  return {
    name,
    application: 'dropblack',
    condition_groups: [{ name: 'TEST group', enabled: true, conditions }],
  };
}

/**
 * Create an alert set and return it
 */
async function createConditionSet(body) {
  const response = await bffSend('POST', '/api/alerts/conditionSets', body);
  validateStatus(response, ValidResponse);
  return response.body;
}

/**
 * Delete an alert set. Returns true when the BFF responds 204.
 */
async function deleteConditionSet(uid) {
  const response = await bffSend('DELETE', `/api/alerts/conditionSets/${uid}`);
  validateStatus(response, ValidNoContentResponse, null);
  return response.status === ValidNoContentResponse;
}

module.exports = {
  conditionSetUidRegex,
  TemperatureCondition,
  testAlertName,
  alertSetBody,
  createConditionSet,
  deleteConditionSet,
};
