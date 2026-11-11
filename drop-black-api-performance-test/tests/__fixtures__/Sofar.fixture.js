const { bffGet } = require('./RequestResponse.fixture');

/**
 * GET a SOFAR proxy path with the SOFAR key from .env (SOFAR_TOKEN).
 * The BFF forwards it to api.sofarocean.com in the x-sofar-token header.
 */
function sofarGet(path, sofarToken = process.env.SOFAR_TOKEN) {
  const req = bffGet(`/api/proxy/sofar${path}`);
  if (sofarToken) req.set('x-sofar-token', sofarToken);
  return req;
}

// Tests that need a real SOFAR key are skipped when SOFAR_TOKEN is not in .env
const testWithSofarKey = process.env.SOFAR_TOKEN ? test : test.skip;

module.exports = { sofarGet, testWithSofarKey };
