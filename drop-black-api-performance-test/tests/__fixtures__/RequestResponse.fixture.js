const request = require('supertest');

const BFF_URL = process.env.BFF_URL || 'https://drop-black-dev.vercel.weather.com';

// response codes
const ValidResponse = 200;
const ValidNoContentResponse = 204;
const InvalidRequest = 400;
const UnauthorizedResponse = 401;
const ForbiddenResponse = 403;
const NotFoundResponse = 404;
const UnprocessableEntryResponse = 422;

// response types
const JSONContentType = 'application/json';

// A well-formed UUID that does not belong to any desk, location or route
const NonexistentUid = '00000000-0000-0000-0000-000000000000';

/**
 * Send a GET request to the BFF. Uses the JWT from globalSetup unless a token is
 * passed in. Pass null to send no Authorization header at all.
 */
function bffGet(path, token = process.env.DROP_JWT) {
  const req = request(BFF_URL).get(path);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

/**
 * Send a POST, PUT or DELETE request to the BFF with an optional JSON body.
 * A string body is sent as-is, so malformed JSON can be tested.
 * Token works the same as bffGet.
 */
function bffSend(method, path, body, token = process.env.DROP_JWT) {
  const req = request(BFF_URL)[method.toLowerCase()](path).set('Content-Type', JSONContentType);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

/**
 * Validate response status and header match supplied values.
 * Pass contentType null for responses with no body (204).
 */
function validateStatus(response, code, contentType = JSONContentType) {
  // Show original error from response.
  if (response.status !== code && response?.body) {
    console.error(response.body);
  }
  expect(response.status).toBe(code);
  // The BFF returns its HTML app page (200) for routes it does not know, so
  // checking the content type stops that from passing as a good response.
  if (contentType) {
    expect(response.headers['content-type']).toContain(contentType);
  }
}

/**
 * Get an error response from the BFF and validate the expected response code
 * and error message. The BFF puts the message in { error: "..." }.
 */
async function handleErrors(path, expRespCode, expRespMessage, token) {
  const response = await bffGet(path, token);
  validateStatus(response, expRespCode);
  expect(response.body.error).toContain(expRespMessage);
}

module.exports = {
  BFF_URL,
  ValidResponse,
  ValidNoContentResponse,
  InvalidRequest,
  UnauthorizedResponse,
  ForbiddenResponse,
  NotFoundResponse,
  UnprocessableEntryResponse,
  JSONContentType,
  NonexistentUid,
  bffGet,
  bffSend,
  validateStatus,
  handleErrors,
};
