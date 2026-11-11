/**
 * Builds postman/collections/Drop Black BFF API.postman_collection.json
 * Run with: yarn postman:build
 *
 * Layout matches avn-api-tests' Maverick BFF collection: folders follow the URL
 * path, every request uses {{baseUrl}}, and bearer auth is set once on the
 * collection with {{JWT}}. A Login request fills {{JWT}} for you.
 *
 * Requests that create or edit data only ever touch throwaway TEST-API-POSTMAN-*
 * items, never real desks or routes.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'collections', 'Drop Black BFF API.postman_collection.json');

// ---------- script snippets ----------

// Saves the JWT from the login response into {{JWT}}
const saveJwt = [
  'const body = pm.response.json();',
  "pm.test('Login succeeded', () => pm.expect(pm.response.code).to.eql(200));",
  "if (body.jwt) pm.collectionVariables.set('JWT', body.jwt);",
  "if (body.identity) pm.collectionVariables.set('identityId', body.identity.id);",
];

// Picks the first desk with a location and a route, like the Jest tests do
const saveTestDesk = [
  'const desks = pm.response.json();',
  'const desk = Array.isArray(desks) && desks.find((d) => d.locations.length && d.routes.length);',
  'if (desk) {',
  "  pm.collectionVariables.set('deskUid', desk.uid);",
  "  pm.collectionVariables.set('locationUid', desk.locations[0].item_uid);",
  "  pm.collectionVariables.set('routeUid', desk.routes[0].item_uid);",
  '}',
];

// Tomorrow as YYYY-MM-DD for the daily report
const setForecastDate = [
  "pm.collectionVariables.set('forecastDate', new Date(Date.now() + 864e5).toISOString().slice(0, 10));",
];

const saveCreated = (variable) => [
  'const body = pm.response.json();',
  `if (body.uid) pm.collectionVariables.set('${variable}', body.uid);`,
];

// Shared helpers for the Known bugs requests: send a request with the current token
const sendHelper = [
  'const send = (method, url, body) => new Promise((resolve, reject) => pm.sendRequest({',
  '  url: pm.collectionVariables.get(\'baseUrl\') + url, method,',
  "  header: { Authorization: 'Bearer ' + pm.collectionVariables.get('JWT'), 'Content-Type': 'application/json' },",
  "  body: body ? { mode: 'raw', raw: JSON.stringify(body) } : undefined,",
  '}, (err, res) => (err ? reject(err) : resolve(res))));',
];

// Bug request tests: fail today, pass once the bug is fixed
const expectRejected = (what) => [
  `pm.test('Fixed: API rejects ${what} (expected 4xx, bug returns 200)', () => {`,
  '  pm.expect(pm.response.code).to.be.within(400, 499);',
  '});',
];

// Bug request tests that need one exact status code once fixed
const expectRejectedWith = (code, what) => [
  `pm.test('Fixed: API rejects ${what} with ${code}', () => {`,
  `  pm.expect(pm.response.code).to.eql(${code});`,
  '});',
];

// Fixed when the alert set is rejected (422) or saved as a Drop Black alert set
const expectOnlyDropBlack = [
  "pm.test('Fixed: only Drop Black alert sets can be created (422, or saved as dropblack)', () => {",
  "  if (pm.response.code === 422) return;",
  "  pm.expect(pm.response.json().application).to.eql('dropblack');",
  "});",
];

// Delete anything a bug request created by mistake, so nothing is left behind
const cleanupCreated = (kind) => [
  ...sendHelper,
  'const body = pm.response.json();',
  `if (body.uid) send('DELETE', '/api/${kind}/' + body.uid);`,
];

// Create a throwaway item before an edit bug request, and delete it after
const setupThrowaway = (kind, variable, createBody) => [
  ...sendHelper,
  `send('POST', '/api/${kind}', ${createBody}).then((res) => pm.collectionVariables.set('${variable}', res.json().uid));`,
];
const deleteThrowaway = (kind, variable) => [
  ...sendHelper,
  `send('DELETE', '/api/${kind}/' + pm.collectionVariables.get('${variable}'));`,
];

// Before "Add <kind> to a test desk": create a throwaway desk and a route or location to put on it.
// prefix names the variables used: 'bind' for the api folder, 'bugBind' for Known bugs, so
// sending a Known bugs request between Add and Remove doesn't overwrite the api folder's IDs
const setupBindTest = (kind, createBody, prefix = 'bind') => [
  ...sendHelper,
  "send('POST', '/api/desks', { name: 'TEST-API-POSTMAN-BIND-DESK-' + Date.now() })",
  `  .then((res) => pm.collectionVariables.set('${prefix}DeskUid', res.json().uid))`,
  `  .then(() => send('POST', '/api/${kind}', ${createBody}))`,
  `  .then((res) => pm.collectionVariables.set('${prefix}ItemUid', res.json().uid));`,
];
// After "Remove <kind> from the test desk": delete the throwaway desk and item
const cleanupBindTest = (kind, prefix = 'bind') => [
  ...sendHelper,
  `send('DELETE', '/api/desks/' + pm.collectionVariables.get('${prefix}DeskUid'))`,
  `  .then(() => send('DELETE', '/api/${kind}/' + pm.collectionVariables.get('${prefix}ItemUid')));`,
];

// Current Lab wants whole-hour UTC times with no milliseconds
const setClabTimes = [
  "const hour = Math.floor(Date.now() / 3600000) * 3600000;",
  "const iso = (ms) => new Date(ms).toISOString().replace(/\\.\\d+Z$/, 'Z');",
  "pm.collectionVariables.set('clabStart', iso(hour));",
  "pm.collectionVariables.set('clabEnd', iso(hour + 3600000));",
];

// Before "Edit created alert set": load it and rename it, since PUT needs the full alert set
const loadAlertForEdit = [
  ...sendHelper,
  "send('GET', '/api/alerts/conditionSets/' + pm.collectionVariables.get('createdAlertUid')).then((res) => {",
  "  const set = res.json();",
  "  set.name = 'TEST-API-POSTMAN-ALERT-EDITED-' + Date.now();",
  "  pm.collectionVariables.set('alertEditBody', JSON.stringify(set));",
  "});",
];

// ---------- request builders ----------

function request(name, method, urlPath, { body, query, description, prerequest, test, noauth, badToken } = {}) {
  const raw = `{{baseUrl}}${urlPath}${query ? '?' + query.map(([k, v]) => `${k}=${v}`).join('&') : ''}`;
  const item = {
    name,
    request: {
      method,
      header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      url: {
        raw,
        host: ['{{baseUrl}}'],
        path: urlPath.split('/').filter(Boolean),
        ...(query ? { query: query.map(([key, value]) => ({ key, value })) } : {}),
      },
      ...(description ? { description } : {}),
      ...(noauth ? { auth: { type: 'noauth' } } : {}),
      ...(badToken ? { auth: { type: 'bearer', bearer: [{ key: 'token', value: 'bad-token', type: 'string' }] } } : {}),
      ...(body !== undefined ? { body: { mode: 'raw', raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } } : {}),
    },
  };
  const event = [];
  if (prerequest) event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: prerequest } });
  if (test) event.push({ listen: 'test', script: { type: 'text/javascript', exec: test } });
  if (event.length) item.event = event;
  return item;
}

const folder = (name, item, description) => ({ name, ...(description ? { description } : {}), item });

// Login goes to the account host ({{loginUrl}}), not {{baseUrl}}, and sends no token
function loginRequest() {
  const item = request('Login', 'POST', '', {
    body: { application: 'dropblack', email: '{{email}}', password: '{{password}}', mode: 'password' },
    description: 'Logs in and saves the JWT into {{JWT}}. Lasts 10 minutes.',
    test: saveJwt,
    noauth: true,
  });
  item.request.url = { raw: '{{loginUrl}}', host: ['{{loginUrl}}'] };
  return item;
}

// ---------- sample data ----------

const deskName = 'TEST-API-POSTMAN-DESK-{{$guid}}';
const routeName = 'TEST-API-POSTMAN-ROUTE-{{$guid}}';
const ICAOPoints = [
  { icao: 'KATL', flight_level: 'FL300', timestamp: '2026-11-01T10:00:00Z' },
  { icao: 'KBOS', flight_level: 'FL300', timestamp: '2026-11-01T12:00:00Z' },
];
const throwawayDesk = "{ name: 'TEST-API-POSTMAN-BUG-DESK-' + Date.now() }";
const throwawayLocation = "{ name: 'TEST-API-POSTMAN-BUG-LOCATION-' + Date.now(), latitude: 33.64, longitude: -84.43 }";
const throwawayRoute =`{ name: 'TEST-API-POSTMAN-BUG-ROUTE-' + Date.now(), points: ${JSON.stringify(ICAOPoints)} }`;

// ---------- collection ----------

const collection = {
  info: {
    name: 'Drop Black BFF API',
    description: [
      'Drop Black BFF requests (desk service), matching avn-api-tests\' Maverick BFF collection.',
      '',
      'Setup: in the collection Variables tab, fill in the Current value of email and password',
      '(leave Initial value blank so your password is never shared or exported).',
      'Then send auth > Login. The JWT lasts 10 minutes, so send Login again when requests return 401/403.',
      '',
      'Send desks > List desks once to fill deskUid, locationUid and routeUid.',
      'Create requests save the new uid, so Edit and Delete act on the item you just created.',
      'Known bugs requests clean up after themselves. Their Test Results fail until the bug is fixed.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{JWT}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'https://drop-black-dev.vercel.weather.com' },
    { key: 'loginUrl', value: 'https://drop-acct-dev.weather.com/api/auth/login' },
    { key: 'email', value: '' },
    { key: 'password', value: '' },
    { key: 'JWT', value: '' },
    { key: 'deskUid', value: '' },
    { key: 'locationUid', value: '' },
    { key: 'routeUid', value: '' },
    { key: 'createdDeskUid', value: '' },
    { key: 'createdRouteUid', value: '' },
    { key: 'createdLocationUid', value: '' },
    { key: 'bugDeskUid', value: '' },
    { key: 'bugRouteUid', value: '' },
    { key: 'bugLocationUid', value: '' },
    { key: 'bindDeskUid', value: '' },
    { key: 'bindItemUid', value: '' },
    { key: 'bugBindDeskUid', value: '' },
    { key: 'bugBindItemUid', value: '' },
    { key: 'identityId', value: '' },
    { key: 'createdAlertUid', value: '' },
    { key: 'alertEditBody', value: '' },
    { key: 'clabStart', value: '' },
    { key: 'clabEnd', value: '' },
    { key: 'sofarToken', value: '' },
    { key: 'spotterId', value: '' },
    { key: 'forecastDate', value: '' },
  ],
  item: [
    folder('auth', [loginRequest()]),
    folder('Desk service', [
      folder('api', [
        folder('desks', [
          request('List desks', 'GET', '/api/desks', {
            description: 'CSV row 1. Also saves deskUid, locationUid and routeUid from the first desk with a location and a route.',
            test: saveTestDesk,
          }),
          request('Create desk', 'POST', '/api/desks', {
            body: { name: deskName, description: 'Created from Postman' },
            description: 'CSV row 2. Saves the new uid into {{createdDeskUid}}. Delete it with Delete desk when done.',
            test: saveCreated('createdDeskUid'),
          }),
          folder('{uid}', [
            request('Get desk', 'GET', '/api/desks/{{deskUid}}', { description: 'CSV row 3.' }),
            request('Edit created desk', 'PUT', '/api/desks/{{createdDeskUid}}', {
              body: { name: 'TEST-API-POSTMAN-DESK-EDITED-{{$guid}}', description: 'Edited from Postman' },
              description: 'CSV row 4. Edits the desk from Create desk. PUT replaces the whole desk; fields left out are cleared.',
            }),
            request('Set created desk visibility', 'PUT', '/api/desks/{{createdDeskUid}}/visibility', {
              body: { visibility: 'org_wide' },
              description: 'CSV row 6. restricted or org_wide.',
            }),
            request('Delete created desk', 'DELETE', '/api/desks/{{createdDeskUid}}', {
              description: 'CSV row 5. Deletes the desk from Create desk. Returns 204.',
            }),
            request('Routes report', 'GET', '/api/desks/{{deskUid}}/routes/report', { description: 'CSV row 11.' }),
            request('Route features', 'GET', '/api/desks/{{deskUid}}/routes/{{routeUid}}/features', { description: 'CSV row 12.' }),
            request('Locations report', 'GET', '/api/desks/{{deskUid}}/locations/report', { description: 'CSV row 15.' }),
            request('Location daily report', 'GET', '/api/desks/{{deskUid}}/locations/{{locationUid}}/daily-report', {
              query: [['date', '{{forecastDate}}']],
              description: 'CSV row 16. date is set to tomorrow automatically.',
              prerequest: setForecastDate,
            }),
            folder('routes', [
              request('Add route to a test desk', 'POST', '/api/desks/{{bindDeskUid}}/routes', {
                body: { item_uid: '{{bindItemUid}}' },
                description: 'CSV row 9. Creates a throwaway desk and route first, then adds the route to it. Send "Remove route from the test desk" next to clean up.',
                prerequest: setupBindTest('routes', throwawayRoute),
              }),
              request('Remove route from the test desk', 'DELETE', '/api/desks/{{bindDeskUid}}/routes/{{bindItemUid}}', {
                description: 'CSV row 10. Removes the route added by "Add route to a test desk", then deletes the throwaway desk and route.',
                test: cleanupBindTest('routes'),
              }),
            ]),
            folder('locations', [
              request('Add location to a test desk', 'POST', '/api/desks/{{bindDeskUid}}/locations', {
                body: { item_uid: '{{bindItemUid}}' },
                description: 'CSV row 13. Creates a throwaway desk and location first, then adds the location to it. Send "Remove location from the test desk" next to clean up.',
                prerequest: setupBindTest('locations', throwawayLocation),
              }),
              request('Remove location from the test desk', 'DELETE', '/api/desks/{{bindDeskUid}}/locations/{{bindItemUid}}', {
                description: 'CSV row 14. Removes the location added by "Add location to a test desk", then deletes the throwaway desk and location.',
                test: cleanupBindTest('locations'),
              }),
            ]),
          ]),
        ]),
        folder('admin', [
          folder('desks', [
            request('List all desks (admin)', 'GET', '/api/admin/desks', { description: 'CSV row 17.' }),
            request('Desk access detail (admin)', 'GET', '/api/admin/desks/{{deskUid}}', { description: 'CSV row 18.' }),
          ]),
        ]),
        folder('routes', [
          request('List routes', 'GET', '/api/routes', { description: 'CSV row 19.' }),
          request('Create route', 'POST', '/api/routes', {
            body: { name: routeName, points: ICAOPoints },
            description: 'CSV row 20. Saves the new uid into {{createdRouteUid}}. Delete it with Delete route when done.',
            test: saveCreated('createdRouteUid'),
          }),
          folder('{uid}', [
            request('Get route', 'GET', '/api/routes/{{routeUid}}', { description: 'CSV row 21.' }),
            request('Edit created route', 'PUT', '/api/routes/{{createdRouteUid}}', {
              body: { name: 'TEST-API-POSTMAN-ROUTE-EDITED-{{$guid}}', points: ICAOPoints },
              description: 'CSV row 22. Edits the route from Create route. PUT replaces the whole route.',
            }),
            request('Delete created route', 'DELETE', '/api/routes/{{createdRouteUid}}', {
              description: 'CSV row 23. Deletes the route from Create route. Returns 204.',
            }),
          ]),
        ]),
        folder('locations', [
          request('List locations', 'GET', '/api/locations', { description: 'CSV row 24.' }),
          request('Create location', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', latitude: 33.64, longitude: -84.43 },
            description: 'CSV row 25. Needs latitude/longitude, icao_code or mgrs. Saves the new uid into {{createdLocationUid}}. Delete it with Delete location when done.',
            test: saveCreated('createdLocationUid'),
          }),
          folder('{uid}', [
            request('Get location', 'GET', '/api/locations/{{locationUid}}', { description: 'CSV row 26.' }),
            request('Edit created location', 'PUT', '/api/locations/{{createdLocationUid}}', {
              body: { name: 'TEST-API-POSTMAN-LOCATION-EDITED-{{$guid}}', icao_code: 'KATL' },
              description: 'CSV row 27. Edits the location from Create location. PUT replaces the whole location and must include a position.',
            }),
            request('Delete created location', 'DELETE', '/api/locations/{{createdLocationUid}}', {
              description: 'CSV row 28. Deletes the location from Create location. Returns 204.',
            }),
          ]),
        ]),
      ]),
      folder('Known bugs', [
        folder('Blank names', [
          request('Create desk with empty name', 'POST', '/api/desks', {
            body: { name: '' }, test: [...expectRejected('an empty desk name'), ...cleanupCreated('desks')],
          }),
          request('Create desk with whitespace-only name', 'POST', '/api/desks', {
            body: { name: '   ' }, test: [...expectRejected('a whitespace-only desk name'), ...cleanupCreated('desks')],
          }),
          request('Edit desk with whitespace-only name', 'PUT', '/api/desks/{{bugDeskUid}}', {
            body: { name: '   ' },
            prerequest: setupThrowaway('desks', 'bugDeskUid', throwawayDesk),
            test: [...expectRejected('a whitespace-only desk name'), ...deleteThrowaway('desks', 'bugDeskUid')],
          }),
          request('Create route with empty name', 'POST', '/api/routes', {
            body: { name: '', points: ICAOPoints }, test: [...expectRejected('an empty route name'), ...cleanupCreated('routes')],
          }),
          request('Create route with whitespace-only name', 'POST', '/api/routes', {
            body: { name: '   ', points: ICAOPoints }, test: [...expectRejected('a whitespace-only route name'), ...cleanupCreated('routes')],
          }),
          request('Edit route with whitespace-only name', 'PUT', '/api/routes/{{bugRouteUid}}', {
            body: { name: '   ', points: ICAOPoints },
            prerequest: setupThrowaway('routes', 'bugRouteUid', throwawayRoute),
            test: [...expectRejected('a whitespace-only route name'), ...deleteThrowaway('routes', 'bugRouteUid')],
          }),
          request('Create location with empty name', 'POST', '/api/locations', {
            body: { name: '', latitude: 33.64, longitude: -84.43 }, test: [...expectRejected('an empty location name'), ...cleanupCreated('locations')],
          }),
          request('Create location with whitespace-only name', 'POST', '/api/locations', {
            body: { name: '   ', latitude: 33.64, longitude: -84.43 }, test: [...expectRejected('a whitespace-only location name'), ...cleanupCreated('locations')],
          }),
          request('Edit location with whitespace-only name', 'PUT', '/api/locations/{{bugLocationUid}}', {
            body: { name: '   ', latitude: 33.64, longitude: -84.43 },
            prerequest: setupThrowaway('locations', 'bugLocationUid', throwawayLocation),
            test: [...expectRejected('a whitespace-only location name'), ...deleteThrowaway('locations', 'bugLocationUid')],
          }),
        ], 'Desk, route and location create and edit accept a missing, empty or whitespace-only name. The app blocks empty but allows spaces.'),
        folder('Unknown airport ICAO', [
          request('Create route with unknown ICAO', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ icao: 'ZZZZ', timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]] },
            test: [...expectRejected('an unknown airport'), ...cleanupCreated('routes')],
          }),
          request('Edit route with unknown ICAO', 'PUT', '/api/routes/{{bugRouteUid}}', {
            body: { name: routeName, points: [{ icao: 'ZZZZ', timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]] },
            prerequest: setupThrowaway('routes', 'bugRouteUid', throwawayRoute),
            test: [...expectRejected('an unknown airport'), ...deleteThrowaway('routes', 'bugRouteUid')],
          }),
          request('Create location with unknown ICAO', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', icao_code: 'ZZZZ' },
            test: [...expectRejected('an unknown airport'), ...cleanupCreated('locations')],
          }),
          request('Edit location with unknown ICAO', 'PUT', '/api/locations/{{bugLocationUid}}', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', icao_code: 'ZZZZ' },
            prerequest: setupThrowaway('locations', 'bugLocationUid', throwawayLocation),
            test: [...expectRejected('an unknown airport'), ...deleteThrowaway('locations', 'bugLocationUid')],
          }),
        ], 'Route and location create and edit save "ZZZZ". The app blocks it ("Airport not found" on routes).'),
        folder('Route points out of time order', [
          request('Create route with points out of order', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ icao: 'KATL', timestamp: '2026-11-01T12:00:00Z' }, { icao: 'KBOS', timestamp: '2026-11-01T10:00:00Z' }] },
            test: [...expectRejected('points out of time order'), ...cleanupCreated('routes')],
          }),
          request('Create route with points at the same time', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ icao: 'KATL', timestamp: '2026-11-01T10:00:00Z' }, { icao: 'KBOS', timestamp: '2026-11-01T10:00:00Z' }] },
            test: [...expectRejected('points at the same time'), ...cleanupCreated('routes')],
          }),
          request('Edit route with points out of order', 'PUT', '/api/routes/{{bugRouteUid}}', {
            body: { name: routeName, points: [{ icao: 'KATL', timestamp: '2026-11-01T12:00:00Z' }, { icao: 'KBOS', timestamp: '2026-11-01T10:00:00Z' }] },
            prerequest: setupThrowaway('routes', 'bugRouteUid', throwawayRoute),
            test: [...expectRejected('points out of time order'), ...deleteThrowaway('routes', 'bugRouteUid')],
          }),
        ], 'Create and edit save points whose times go backwards or repeat. The app corrects the times itself.'),
        folder('Route with no points', [
          request('Create route with no points', 'POST', '/api/routes', {
            body: { name: routeName }, test: [...expectRejected('a route with no points'), ...cleanupCreated('routes')],
          }),
          request('Create route with empty points list', 'POST', '/api/routes', {
            body: { name: routeName, points: [] }, test: [...expectRejected('a route with no points'), ...cleanupCreated('routes')],
          }),
          request('Edit route to have no points', 'PUT', '/api/routes/{{bugRouteUid}}', {
            body: { name: routeName },
            prerequest: setupThrowaway('routes', 'bugRouteUid', throwawayRoute),
            test: [...expectRejected('a route with no points'), ...deleteThrowaway('routes', 'bugRouteUid')],
          }),
        ], 'Create and edit save a route with no points. The app always requires at least one point.'),
        folder('Multiple positions on one point', [
          request('Create route with point that has two positions', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ icao: 'KATL', latitude: 1, longitude: 1, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]] },
            test: [...expectRejected('a point with two positions'), ...cleanupCreated('routes')],
          }),
          request('Create route with point that has three positions', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ icao: 'KATL', mgrs: '18TWL8463709766', latitude: 1, longitude: 1, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]] },
            test: [...expectRejected('a point with three positions'), ...cleanupCreated('routes')],
          }),
          request('Edit route with point that has two positions', 'PUT', '/api/routes/{{bugRouteUid}}', {
            body: { name: routeName, points: [{ icao: 'KATL', latitude: 1, longitude: 1, timestamp: ICAOPoints[0].timestamp }, ICAOPoints[1]] },
            prerequest: setupThrowaway('routes', 'bugRouteUid', throwawayRoute),
            test: [...expectRejected('a point with two positions'), ...deleteThrowaway('routes', 'bugRouteUid')],
          }),
          request('Create location with ICAO code and lat/lon', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', icao_code: 'KATL', latitude: 1, longitude: 1 },
            test: [...expectRejected('a location with two positions'), ...cleanupCreated('locations')],
          }),
          request('Create location with MGRS and lat/lon', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', mgrs: '18TWL8463709766', latitude: 1, longitude: 1 },
            test: [...expectRejected('a location with two positions'), ...cleanupCreated('locations')],
          }),
          request('Edit location with ICAO code and lat/lon', 'PUT', '/api/locations/{{bugLocationUid}}', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', icao_code: 'KATL', latitude: 1, longitude: 1 },
            prerequest: setupThrowaway('locations', 'bugLocationUid', throwawayLocation),
            test: [...expectRejected('a location with two positions'), ...deleteThrowaway('locations', 'bugLocationUid')],
          }),
        ], 'Route points and locations save more than one position (ICAO, MGRS, lat/lon). The app shows "Couldn\'t locate this point".'),
        folder('Missing flight level', [
          request('Create route with points missing flight level', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ icao: 'KATL', timestamp: ICAOPoints[0].timestamp }, { icao: 'KBOS', timestamp: ICAOPoints[1].timestamp }] },
            test: [...expectRejected('points with no flight level'), ...cleanupCreated('routes')],
          }),
          request('Edit route with points missing flight level', 'PUT', '/api/routes/{{bugRouteUid}}', {
            body: { name: routeName, points: [{ icao: 'KATL', timestamp: ICAOPoints[0].timestamp }, { icao: 'KBOS', timestamp: ICAOPoints[1].timestamp }] },
            prerequest: setupThrowaway('routes', 'bugRouteUid', throwawayRoute),
            test: [...expectRejected('points with no flight level'), ...deleteThrowaway('routes', 'bugRouteUid')],
          }),
        ], 'Create and edit save points with no flight_level or altitude. The app shows "Flight level is required".'),
        folder('Invalid coordinates', [
          request('Create location with latitude 91', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', latitude: 91, longitude: 0 },
            test: [...expectRejected('latitude 91'), ...cleanupCreated('locations')],
          }),
          request('Create location with longitude 181', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', latitude: 0, longitude: 181 },
            test: [...expectRejected('longitude 181'), ...cleanupCreated('locations')],
          }),
          request('Create location with MGRS letters in the digits', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', mgrs: '18TWL84637ABCDE' },
            test: [...expectRejected('MGRS 18TWL84637ABCDE'), ...cleanupCreated('locations')],
          }),
          request('Create location with MGRS zone 0', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', mgrs: '00TWL8463709766' },
            test: [...expectRejected('MGRS zone 0'), ...cleanupCreated('locations')],
          }),
          request('Create location with MGRS too many digits', 'POST', '/api/locations', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', mgrs: '18TWL846370976684637097' },
            test: [...expectRejected('MGRS with 9+9 digits'), ...cleanupCreated('locations')],
          }),
          request('Edit location with latitude 91', 'PUT', '/api/locations/{{bugLocationUid}}', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', latitude: 91, longitude: 0 },
            prerequest: setupThrowaway('locations', 'bugLocationUid', throwawayLocation),
            test: [...expectRejected('latitude 91'), ...deleteThrowaway('locations', 'bugLocationUid')],
          }),
          request('Edit location with MGRS letters in the digits', 'PUT', '/api/locations/{{bugLocationUid}}', {
            body: { name: 'TEST-API-POSTMAN-LOCATION-{{$guid}}', mgrs: '18TWL84637ABCDE' },
            prerequest: setupThrowaway('locations', 'bugLocationUid', throwawayLocation),
            test: [...expectRejected('MGRS 18TWL84637ABCDE'), ...deleteThrowaway('locations', 'bugLocationUid')],
          }),
          request('Create route with point latitude 91', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ latitude: 91, longitude: 0, flight_level: 'FL010', timestamp: ICAOPoints[0].timestamp }] },
            test: [...expectRejected('latitude 91'), ...cleanupCreated('routes')],
          }),
          request('Create route with point MGRS letters in the digits', 'POST', '/api/routes', {
            body: { name: routeName, points: [{ mgrs: '18TWL84637ABCDE', flight_level: 'FL010', timestamp: ICAOPoints[0].timestamp }] },
            test: [...expectRejected('MGRS 18TWL84637ABCDE'), ...cleanupCreated('routes')],
          }),
          request('Edit route with point latitude 91', 'PUT', '/api/routes/{{bugRouteUid}}', {
            body: { name: routeName, points: [{ latitude: 91, longitude: 0, flight_level: 'FL010', timestamp: ICAOPoints[0].timestamp }] },
            prerequest: setupThrowaway('routes', 'bugRouteUid', throwawayRoute),
            test: [...expectRejected('latitude 91'), ...deleteThrowaway('routes', 'bugRouteUid')],
          }),
        ], 'Locations and route points save latitude outside -90..90, longitude outside -180..180, and some invalid MGRS values (letters in digits, zone 0, too many digits). The app blocks them. Valid limits (90, 180 / -90, -180) must keep working.'),
        folder('Nonexistent item added to desk', [
          request('Add random ID as a route', 'POST', '/api/desks/{{bugBindDeskUid}}/routes', {
            body: { item_uid: '{{$guid}}' },
            prerequest: setupBindTest('routes', throwawayRoute, 'bugBind'),
            test: [...expectRejected('a route ID that does not exist'), ...cleanupBindTest('routes', 'bugBind')],
          }),
          request('Add a location ID as a route', 'POST', '/api/desks/{{bugBindDeskUid}}/routes', {
            body: { item_uid: '{{bugBindItemUid}}' },
            prerequest: setupBindTest('locations', throwawayLocation, 'bugBind'),
            test: [...expectRejected('a location ID added as a route'), ...cleanupBindTest('locations', 'bugBind')],
          }),
          request('Add random ID as a location', 'POST', '/api/desks/{{bugBindDeskUid}}/locations', {
            body: { item_uid: '{{$guid}}' },
            prerequest: setupBindTest('locations', throwawayLocation, 'bugBind'),
            test: [...expectRejected('a location ID that does not exist'), ...cleanupBindTest('locations', 'bugBind')],
          }),
          request('Add a route ID as a location', 'POST', '/api/desks/{{bugBindDeskUid}}/locations', {
            body: { item_uid: '{{bugBindItemUid}}' },
            prerequest: setupBindTest('routes', throwawayRoute, 'bugBind'),
            test: [...expectRejected('a route ID added as a location'), ...cleanupBindTest('routes', 'bugBind')],
          }),
          request('Add route with nonexistent condition set', 'POST', '/api/desks/{{bugBindDeskUid}}/routes', {
            body: { item_uid: '{{bugBindItemUid}}', condition_set_uids: ['{{$guid}}'] },
            prerequest: setupBindTest('routes', throwawayRoute, 'bugBind'),
            test: [...expectRejected('a condition set that does not exist'), ...cleanupBindTest('routes', 'bugBind')],
          }),
          request('Add location with nonexistent condition set', 'POST', '/api/desks/{{bugBindDeskUid}}/locations', {
            body: { item_uid: '{{bugBindItemUid}}', condition_set_uids: ['{{$guid}}'] },
            prerequest: setupBindTest('locations', throwawayLocation, 'bugBind'),
            test: [...expectRejected('a condition set that does not exist'), ...cleanupBindTest('locations', 'bugBind')],
          }),
        ], 'Adding a route or location to a desk accepts any correctly formatted ID, including one that belongs to nothing or to the wrong kind of item, and condition set IDs that do not exist. Each request uses its own throwaway desk.'),
      ], 'One request per filed bug. Each cleans up anything it creates. Test Results fail until the bug is fixed.'),
    ], 'Desk service: desks, routes, locations, and adding them to desks (CSV rows 1-28).'),
    folder('Weather data', [
      folder('api', [
        folder('airgram', [
          request('Airgram', 'POST', '/api/airgram', {
            body: { latitude: 33.64, longitude: -84.43, model: 'mpas', hoursBack: 6, hoursForward: 48 },
            description: 'CSV row 29. Read-only. model mpas (default), gfs or ecmwf; hoursBack 0-24; hoursForward 1-120.',
          }),
        ]),
        folder('maritimemeteogram', [
          request('Maritime meteogram', 'POST', '/api/maritimemeteogram', {
            body: { latitude: 40, longitude: -60 },
            description: 'CSV row 30. Read-only. Inland points return the timeline with null marine values.',
          }),
        ]),
        folder('modelcompare', [
          request('Model compare', 'POST', '/api/modelcompare', {
            body: { latitude: 33.64, longitude: -84.43, models: ['gfs', 'ecmwf'], interval: '1h' },
            description: 'CSV row 31. Read-only. Leave models empty to compare all; interval is a Go duration (1h, 30m, 3h; no days).',
          }),
        ]),
        folder('modelverify', [
          request('Model verify', 'POST', '/api/modelverify', {
            body: { latitude: 33.64, longitude: -84.43, icao: 'KATL', parameter: 'temperature', historyHours: 10 },
            description: 'CSV row 32. Read-only. parameter: temperature, temperatureDewPoint, windSpeed, windGust, windDirection, relativeHumidity, pressureAltimeter, visibility, ceiling or qpf. historyHours 2-48.',
          }),
        ]),
        folder('neareststations', [
          request('Nearest stations', 'GET', '/api/neareststations', {
            query: [['latitude', '33.75'], ['longitude', '-84.39'], ['limit', '3']],
            description: 'CSV row 33. limit 1-25, default 3.',
          }),
        ]),
      ]),
    ], 'Weather data: airgram, maritime meteogram, model compare, model verify and nearest stations (CSV rows 29-33). All read-only.'),
    folder('Illumination', [
      folder('api', [
        folder('illumination', [
          request('Illumination', 'GET', '/api/illumination', {
            query: [['latitude', '33.64'], ['longitude', '-84.43'], ['start_date', '{{forecastDate}}'], ['end_date', '{{forecastDate}}']],
            description: 'CSV row 34. Read-only. Dates are YYYY-MM-DD, at most 60 days apart; the dates are set to tomorrow automatically.',
            prerequest: setForecastDate,
          }),
        ]),
      ]),
    ], 'Illumination: sun and moon data for a point and date range (CSV row 34).'),
    folder('Alerts', [
      folder('api', [
        folder('alerts', [
          folder('conditionSets', [
            request('List alert sets', 'GET', '/api/alerts/conditionSets', { description: 'CSV row 35. Add ?name= to filter by name.' }),
            request('Create alert set', 'POST', '/api/alerts/conditionSets', {
              body: { name: 'TEST-API-POSTMAN-ALERT-{{$guid}}', application: 'dropblack', condition_groups: [{ name: 'TEST group', enabled: true, conditions: [{ template_uid: 'metar_temperature', severity: 2, target: 'Location', inputs: [{ name: 'comparison_func', value: 'GreaterThanOrEquals' }, { name: 'threshold_unit', value: '°F' }, { name: 'threshold_value', value: '100' }] }] }] },
              description: 'CSV row 36. Saves the new uid into {{createdAlertUid}}. Not attached to any desk, so it never fires. Delete it with Delete created alert set when done.',
              test: saveCreated('createdAlertUid'),
            }),
            folder('{id}', [
              request('Get created alert set', 'GET', '/api/alerts/conditionSets/{{createdAlertUid}}', { description: 'CSV row 37.' }),
              {
                ...request('Edit created alert set', 'PUT', '/api/alerts/conditionSets/{{createdAlertUid}}', {
                  body: {},
                  description: 'CSV row 38. Loads the alert set from Create alert set and renames it. PUT replaces the whole alert set.',
                  prerequest: loadAlertForEdit,
                }),
              },
              request('Delete created alert set', 'DELETE', '/api/alerts/conditionSets/{{createdAlertUid}}', {
                description: 'CSV row 39. Deletes the alert set from Create alert set. Returns 204.',
              }),
            ]),
          ]),
          folder('conditionTemplates', [
            request('Alert templates', 'GET', '/api/alerts/conditionTemplates', {
              query: [['application', 'dropblack']],
              description: 'CSV row 40.',
            }),
          ]),
        ]),
      ]),
      folder('Known bugs', [
        folder('Blank names', [
          request('Create alert set with empty name', 'POST', '/api/alerts/conditionSets', {
            body: { name: '', application: 'dropblack', condition_groups: [{ name: 'TEST group', enabled: true, conditions: [{ template_uid: 'metar_temperature', severity: 2, target: 'Location', inputs: [{ name: 'comparison_func', value: 'GreaterThanOrEquals' }, { name: 'threshold_unit', value: '°F' }, { name: 'threshold_value', value: '100' }] }] }] },
            test: [...expectRejected('an empty alert set name'), ...cleanupCreated('alerts/conditionSets')],
          }),
          request('Create alert set with whitespace-only name', 'POST', '/api/alerts/conditionSets', {
            body: { name: '   ', application: 'dropblack', condition_groups: [{ name: 'TEST group', enabled: true, conditions: [{ template_uid: 'metar_temperature', severity: 2, target: 'Location', inputs: [{ name: 'comparison_func', value: 'GreaterThanOrEquals' }, { name: 'threshold_unit', value: '°F' }, { name: 'threshold_value', value: '100' }] }] }] },
            test: [...expectRejected('a whitespace-only alert set name'), ...cleanupCreated('alerts/conditionSets')],
          }),
        ], 'Alert set create accepts an empty or whitespace-only name (a missing name is rejected). Part of the blank-name bug with desks, routes and locations.'),
        folder('Malformed JSON returns 500', [
          request('Create alert set with malformed JSON', 'POST', '/api/alerts/conditionSets', {
            body: '{not json', test: [...expectRejectedWith(400, 'malformed JSON')],
          }),
        ], 'Alerts return 500 "Internal server error" for malformed or missing JSON. Other BFF routes return 400 "Invalid JSON body".'),
        folder('Non-numeric threshold', [
          request('Create alert set with threshold "hot"', 'POST', '/api/alerts/conditionSets', {
            body: { name: 'TEST-API-POSTMAN-ALERT-{{$guid}}', application: 'dropblack', condition_groups: [{ name: 'TEST group', enabled: true, conditions: [{ template_uid: 'metar_temperature', severity: 2, target: 'Location', inputs: [{ name: 'comparison_func', value: 'GreaterThanOrEquals' }, { name: 'threshold_unit', value: '°F' }, { name: 'threshold_value', value: 'hot' }] }] }] },
            test: [...expectRejected('a threshold that is not a number'), ...cleanupCreated('alerts/conditionSets')],
          }),
        ], 'Alerts accept a threshold_value that is not a number ("hot", "", "-"), so the alert can never trigger. The app only allows numbers.'),
        folder('Empty alert sets', [
          request('Create alert set with no groups', 'POST', '/api/alerts/conditionSets', {
            body: { name: 'TEST-API-POSTMAN-ALERT-{{$guid}}', application: 'dropblack', condition_groups: [] },
            test: [...expectRejected('an alert set with no groups'), ...cleanupCreated('alerts/conditionSets')],
          }),
          request('Create alert set with an empty group', 'POST', '/api/alerts/conditionSets', {
            body: { name: 'TEST-API-POSTMAN-ALERT-{{$guid}}', application: 'dropblack', condition_groups: [{ name: 'TEST group', enabled: true, conditions: [] }] },
            test: [...expectRejected('a group with no conditions'), ...cleanupCreated('alerts/conditionSets')],
          }),
        ], 'Alerts accept an alert set with no groups or a group with no conditions, so it can never trigger. The app requires conditions.'),
        folder('Other application allowed', [
          request('Create alert set for groundops', 'POST', '/api/alerts/conditionSets', {
            body: { name: 'TEST-API-POSTMAN-ALERT-{{$guid}}', application: 'groundops', condition_groups: [{ name: 'TEST group', enabled: true, conditions: [{ template_uid: 'metar_temperature', severity: 2, target: 'Location', inputs: [{ name: 'comparison_func', value: 'GreaterThanOrEquals' }, { name: 'threshold_unit', value: '°F' }, { name: 'threshold_value', value: '100' }] }] }] },
            test: [...expectOnlyDropBlack, ...cleanupCreated('alerts/conditionSets')],
          }),
          request('Create alert set with no application', 'POST', '/api/alerts/conditionSets', {
            body: { name: 'TEST-API-POSTMAN-ALERT-{{$guid}}', condition_groups: [{ name: 'TEST group', enabled: true, conditions: [{ template_uid: 'metar_temperature', severity: 2, target: 'Location', inputs: [{ name: 'comparison_func', value: 'GreaterThanOrEquals' }, { name: 'threshold_unit', value: '°F' }, { name: 'threshold_value', value: '100' }] }] }] },
            test: [...expectOnlyDropBlack, ...cleanupCreated('alerts/conditionSets')],
          }),
        ], 'The Drop Black BFF saves alert sets for another application (groundops) or with no application; neither shows in Drop Black. Fixed when these are rejected (422) or saved as dropblack.'),
      ]),
    ], 'Alerts: MetWatch alert sets and templates (CSV rows 35-40).'),
    folder('Airport weather', [
      folder('api', [
        folder('airport-wx', [
          request('TAF history', 'GET', '/api/airport-wx/tafshistory', { query: [['icao', 'KATL'], ['count', '4']], description: 'CSV row 42.' }),
          request('METAR history', 'GET', '/api/airport-wx/metarshistory', { query: [['icao', 'KATL'], ['count', '8']], description: 'CSV row 43.' }),
          request('Surrounding METARs', 'GET', '/api/airport-wx/surroundingmetars', {
            query: [['latitude', '33.64'], ['longitude', '-84.43'], ['radius', '50'], ['limit', '5']],
            description: 'CSV row 44.',
          }),
        ]),
      ]),
    ], 'Airport weather: TAFs and METARs (CSV rows 42-44). TAF forecast (row 41) returns 404 through the BFF; see open questions.'),
    folder('NOTAM', [
      folder('api', [
        folder('notams', [
          request('Flight NOTAMs', 'GET', '/api/notams/flightnotams', {
            query: [['departure', 'KATL'], ['destination', 'KBOS'], ['flightnumber', 'DAL123'], ['route', 'KATL KBOS']],
            description: 'CSV row 45. departure, destination, flightnumber and route are all required.',
          }),
          request('Airport NOTAMs', 'GET', '/api/notams/airportnotams/bulk', { query: [['icaos', 'KATL,KBOS']], description: 'CSV row 46.' }),
          request('Airspace NOTAMs', 'GET', '/api/notams/airspacenotams/bulk', { query: [['icaos', 'KZTL']], description: 'CSV row 47.' }),
        ]),
      ]),
      folder('Known bugs', [
        folder('Invalid token returns empty list', [
          request('Airport NOTAMs with invalid token', 'GET', '/api/notams/airportnotams/bulk', {
            query: [['icaos', 'KATL']], test: expectRejected('an invalid login token'), badToken: true,
          }),
          request('Airspace NOTAMs with invalid token', 'GET', '/api/notams/airspacenotams/bulk', {
            query: [['icaos', 'KZTL']], test: expectRejected('an invalid login token'), badToken: true,
          }),
        ], 'Airport and airspace NOTAM lookups return 200 [] for an invalid token, which looks like "no NOTAMs". Flight NOTAMs correctly return 403.'),
      ]),
    ], 'NOTAM: flight, airport and airspace NOTAMs (CSV rows 45-47).'),
    folder('Nav data', [
      folder('api', [
        folder('airports', [
          request('Airport by code', 'GET', '/api/airports', { query: [['q', 'KATL'], ['limit', '5']], description: 'CSV row 48. q takes an ICAO, IATA or FAA code.' }),
          request('Airports by ICAO list', 'GET', '/api/airports', { query: [['icaos', 'KATL,KBOS,EGLL']], description: 'CSV row 48. Several airports at once.' }),
        ]),
      ]),
    ], 'Nav data: airport lookup (CSV row 48).'),
    folder('CMAN buoys', [
      folder('api', [
        folder('cman', [
          request('CMAN sites', 'GET', '/api/cman', { description: 'CSV row 49.' }),
          request('One CMAN site', 'GET', '/api/cman/AAMC1', { description: 'CSV row 50. Site IDs are case sensitive (AAMC1, not aamc1).' }),
        ]),
      ]),
    ], 'CMAN buoys: coastal buoy stations (CSV rows 49-50).'),
    folder('Ship reports', [
      folder('api', [
        folder('ship-reports', [request('Ship reports', 'GET', '/api/ship-reports', { description: 'CSV row 51.' })]),
      ]),
    ], 'Ship reports: ship weather observations (CSV row 51).'),
    folder('Access management', [
      folder('api', [
        folder('auth', [
          request('Identity', 'GET', '/api/auth/identity', {
            query: [['id', '{{identityId}}']],
            description: 'CSV row 56. identityId is saved by auth > Login.',
          }),
        ]),
        folder('soundings', [request('Soundings access', 'GET', '/api/soundings/access', { description: 'Whether the user can open Soundings.' })]),
      ]),
      folder('Known bugs', [
        folder('Identity errors return roles null', [
          request('Identity with invalid token', 'GET', '/api/auth/identity', {
            query: [['id', '{{identityId}}']], test: expectRejected('an invalid login token'), badToken: true,
          }),
          request('Identity for an unknown id', 'GET', '/api/auth/identity', {
            query: [['id', '3b9830df-0000-0000-0000-000000000000']], test: expectRejected('an identity ID that does not exist'),
          }),
          request('Identity for an invalid id', 'GET', '/api/auth/identity', {
            query: [['id', 'not-a-uuid']], test: expectRejected('an invalid identity ID'),
          }),
        ], 'Identity returns 200 {"roles": null} for an invalid token, unknown ID or invalid ID instead of 403 / 404 / 422.'),
      ]),
    ], 'Access management: identity and soundings access. Session refresh (row 52) needs the login cookie, which Postman keeps after auth > Login. Logout and people management (rows 53-59) are left out because they change real accounts.'),
    folder('TWC location', [
      folder('api', [
        request('Location search', 'GET', '/api/location-search', { query: [['q', 'Boston']], description: 'CSV row 60. The BFF calls api.weather.com.' }),
        request('Location point (postal code)', 'GET', '/api/location-point', {
          query: [['type', 'postal'], ['value', '30303:US']],
          description: 'CSV row 61. type must be postal.',
        }),
      ]),
      folder('Known bugs', [
        folder('Invalid token accepted', [
          request('Location search with invalid token', 'GET', '/api/location-search', {
            query: [['q', 'Boston']], test: expectRejected('an invalid login token'), badToken: true,
          }),
          request('Location point with invalid token', 'GET', '/api/location-point', {
            query: [['type', 'postal'], ['value', '30303:US']], test: expectRejected('an invalid login token'), badToken: true,
          }),
        ], 'Security: location search and location point only check that a token is present. Any Bearer value returns real TWC results.'),
      ]),
    ], 'TWC location: place and postal code search through the BFF (CSV rows 60-61). Rows 62-68 are called from the browser straight to api.weather.com, not through the BFF.'),
    folder('Current Lab', [
      folder('api', [
        folder('proxy', [
          folder('clab', [
            request('Gridded files', 'POST', '/api/proxy/clab/gridded-files', {
              body: { file_format: 'json', region: 'delmarva_peninsula', product: 'currents_surface', start_time: '{{clabStart}}', end_time: '{{clabEnd}}' },
              description: 'CSV row 69. Uses the company Current Lab account; keep requests small. Times are set to the current hour automatically.',
              prerequest: setClabTimes,
            }),
            request('Drift forward', 'POST', '/api/proxy/clab/drift-forward', {
              body: { start_time: '{{clabStart}}', start_lat: 38, start_lon: -74.7, duration_hours: 2, region: 'delmarva_peninsula', wind_drift_factor: 0, source_currents: 'auto', source_wind: 'auto' },
              description: 'CSV row 70. Uses the company Current Lab account; keep drifts short.',
              prerequest: setClabTimes,
            }),
          ]),
        ]),
      ]),
      folder('Known bugs', [
        folder('Invalid token accepted', [
          request('Gridded files with invalid token', 'POST', '/api/proxy/clab/gridded-files', {
            body: { file_format: 'json', region: 'delmarva_peninsula', product: 'currents_surface', start_time: '{{clabStart}}', end_time: '{{clabEnd}}' },
            prerequest: setClabTimes,
            test: expectRejected('an invalid login token'),
            badToken: true,
          }),
          request('Drift forward with invalid token', 'POST', '/api/proxy/clab/drift-forward', {
            body: { start_time: '{{clabStart}}', start_lat: 38, start_lon: -74.7, duration_hours: 2, region: 'delmarva_peninsula', wind_drift_factor: 0, source_currents: 'auto', source_wind: 'auto' },
            prerequest: setClabTimes,
            test: expectRejected('an invalid login token'),
            badToken: true,
          }),
        ], 'Security: the Current Lab proxy only checks that a token is present. Any Bearer value returns real data from the company Current Lab account.'),
      ]),
    ], 'Current Lab: ocean currents and drift through the BFF proxy (CSV rows 69-70).'),
    folder('SOFAR', [
      folder('api', [
        folder('proxy', [
          folder('sofar', [
            {
              ...request('SOFAR devices', 'GET', '/api/proxy/sofar/devices', {
                description: 'CSV row 71. Put your own SOFAR API key in the sofarToken variable (Current value only). Saves the first buoy into {{spotterId}}.',
                test: ["const d = pm.response.json().data;", "if (d && d.devices && d.devices.length) pm.collectionVariables.set('spotterId', d.devices[0].spotterId);"],
              }),
            },
            request('SOFAR latest data', 'GET', '/api/proxy/sofar/latest-data', {
              query: [['spotterId', '{{spotterId}}'], ['includeWindData', 'true']],
              description: 'CSV row 72. Send SOFAR devices first to fill spotterId.',
            }),
            request('SOFAR wave data', 'GET', '/api/proxy/sofar/wave-data', {
              query: [['spotterId', '{{spotterId}}'], ['limit', '144'], ['includeWindData', 'true']],
              description: 'CSV row 73. Send SOFAR devices first to fill spotterId.',
            }),
          ]),
        ]),
      ]),
      folder('Known bugs', [
        folder('No login check', [
          request('SOFAR devices with no Drop Black login', 'GET', '/api/proxy/sofar/devices', {
            noauth: true, test: expectRejected('a request with no Drop Black login'),
          }),
        ], 'Security: the SOFAR proxy needs no Drop Black login and forwards any path to SOFAR. Needs sofarToken set.'),
      ]),
    ], 'SOFAR: Spotter buoys through the BFF proxy (CSV rows 71-73). Needs your own SOFAR API key.'),
  ],
};

// Requests that need settings request() does not cover
(function patch(items) {
  for (const it of items) {
    if (it.item) { patch(it.item); continue; }
    if (it.name === "Edit created alert set") {
      it.request.body = { mode: "raw", raw: "{{alertEditBody}}", options: { raw: { language: "json" } } };
      it.request.header = [{ key: "Content-Type", value: "application/json" }];
    }
    if (it.name.startsWith("SOFAR ")) it.request.header = [{ key: "x-sofar-token", value: "{{sofarToken}}" }];
  }
})(collection.item);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(collection, null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
