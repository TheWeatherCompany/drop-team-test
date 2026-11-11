# Drop Black API Tests 🔌

Jest + Supertest tests for the Drop Black API. Every request goes through the
Drop Black BFF (https://drop-black-dev.vercel.weather.com/api/*), the same way the
app calls it. Each test checks the status code, the content type and the shape of
the response. Negative tests (bad tokens, bad input) sit next to the positive ones.

The layout and style mirror `avn-api-tests`, the Maverick API test repo. When adding
something new, check how that repo does it first.

Despite the folder name, these are functional tests, not load tests.

## 📋 Contents

- [Project files](#-project-files)
- [Prerequisites](#-prerequisites)
- [Quick start](#-quick-start)
- [What's covered](#-whats-covered)
- [Skipped tests and known bugs](#-skipped-tests-and-known-bugs)
- [Test data](#-test-data)
- [Postman collection](#-postman-collection)
- [Writing a new test](#-writing-a-new-test)
- [Troubleshooting](#-troubleshooting)

---

## 📁 Project files

| File | What it is |
|---|---|
| `tests/<service>/*.test.js` | The tests. There's one folder per backend service and one file per endpoint. |
| `tests/__fixtures__/` | Shared helpers: request and response checks, plus create/delete helpers for desks, routes, locations, alert sets and SOFAR |
| `globalSetup.js` | Logs in once before the run and shares the JWT with every test |
| `jest.config.js` | Jest settings (30 s timeout per test) |
| `postman/build-collection.js` | Builds the Postman collection (`yarn postman:build`) |
| `postman/collections/` | The built Postman collection, ready to import |
| `.env.example` | Blank login template. Copy it to `.env`. |
| `.env` | Your Drop Black login. Never commit it. |

---

## 🔧 Prerequisites

1. **Node.js** 18 or newer. Check with `node --version`.

2. **Yarn 1**. This project uses Yarn, not npm or pnpm:
   ```bash
   corepack enable
   ```
   Check with `yarn --version`. It should print 1.22.x.

3. **Packages**, installed from this folder:
   ```bash
   yarn install
   ```

4. **A Drop Black login** in a file named `.env` in this folder:
   ```bash
   cp .env.example .env
   ```
   Then fill in the two fields:
   ```env
   LOGIN_EMAIL=your.drop.black.login@example.com
   LOGIN_PASSWORD=your_password_here
   ```
   ⚠️ Drop Black has its **own accounts** (`drop-acct-dev.weather.com`). A Maverick
   login won't work.

   `.env` can also hold these optional settings:

   | Variable | What it does |
   |---|---|
   | `BFF_URL` | Sends the tests to a different BFF host, e.g. `https://black-ui-drop.dev.bedrock.weather.com` (VPN only). The default is the dev Vercel URL. |
   | `LOGIN_URL` | A different login endpoint. The default is `https://drop-acct-dev.weather.com/api/auth/login`. |
   | `SOFAR_TOKEN` | A SOFAR API key. Without one, the SOFAR tests that need it are skipped. |

   `.env` holds only URLs, logins and keys. Test data such as desk IDs is looked up
   while the tests run (see [Test data](#-test-data)).

---

## 🚀 Quick start

```bash
cd drop-black-api-performance-test
yarn test                     # everything
yarn test:desk-service        # one service
yarn jest tests/notam/GetAirportNotams.test.js   # one file
yarn jest -t "invalid token"  # tests whose name matches
```

A full run takes about 20 seconds. Jest lists every test as it runs, and skipped tests
show as `skipped`.

**The login lasts 10 minutes.** `globalSetup.js` logs in once, and the JWT expires
10 minutes later. If a long run starts failing partway through with 403s, run the
failing folder again on its own.

### Scripts

| Script | Folder |
|---|---|
| `yarn test` | All tests |
| `yarn test:desk-service` | Desks, the route library, the location library, and adding/removing items on a desk |
| `yarn test:weather-data` | Airgram, maritime meteogram, model compare, model verify, nearest stations |
| `yarn test:illumination` | Sun and moon illumination |
| `yarn test:alerts` | Alert condition sets and templates |
| `yarn test:airport-weather` | METAR and TAF history, surrounding METARs, TAF forecast |
| `yarn test:notam` | Airport, airspace and flight NOTAMs |
| `yarn test:nav-data` | Airports |
| `yarn test:cman-buoys` | CMAN sites |
| `yarn test:ship-reports` | Ship reports |
| `yarn test:access-management` | Session and identity |
| `yarn test:twc-location` | Location search and location point |
| `yarn test:current-lab` | Gridded files and drift forecast |
| `yarn test:sofar` | SOFAR buoy proxy |
| `yarn postman:build` | Rebuild the Postman collection |

---

## 🧪 What's covered

Each test file starts with a header that names the endpoint(s) it covers and gives a
"CSV row" number, which refers to the team's endpoint spreadsheet.

The tests in each file are grouped the same way:

1. **Negative tests**: no token (401), a bad token (403), missing or invalid
   parameters (400/422), and nonexistent IDs (404). Each test checks the status and the
   error message.
2. **Positive tests**: valid requests. Each test checks the status, that the response is
   JSON, and the fields the app relies on.

Every check confirms the response is JSON, not just that it returned 200.
For a route the BFF doesn't have, it returns its HTML app page with a 200, so a
status-only check would pass when it shouldn't. `validateStatus()` in
`RequestResponse.fixture.js` handles this.

---

## ⏭️ Skipped tests and known bugs

About one test in five is a `test.skip`. Each one is a case where the API does
something we think is wrong. The test is written for the **correct** behavior, so it
fails today and should pass once the bug is fixed.

Every skipped test has a `TODO` comment above it that says what the API does today.
Many comments start with a label:

| Label | Meaning |
|---|---|
| **`<Name>` bug (reported, fix pending)** | Filed with the team, e.g. "Security bug" or "Unknown airport bug". Unskip it when the fix ships. |
| **Same reported bug** | Another case of the reported bug named in a nearby comment |
| **BFF bug, not reported** / **Likely bug, not reported** / **Not reported yet** | We think it's a bug, but it hasn't been filed yet |
| **Open question, not reported** | We're not sure it's a bug, so it hasn't been filed yet |
| No label | The comment just describes what the API currently does |

To list them all:
```bash
grep -rn -B3 "test.skip" tests
```

**When a fix ships**, change `test.skip` back to `test`, run the file, and update the
expected status and message to match the real fix if it differs.

---

## 🗂️ Test data

- **Nothing is hard-coded or set in `.env`.** Desk, route and location IDs come from
  your account during the run. For example, `Desk.fixture.js` picks the first desk that
  has both a location and a route. Your login needs at least one desk like that.
- **Tests that create data** (desks, routes, locations, alert sets) name it
  `TEST-API-<LABEL>-<TYPE>-<uuid>` and delete it in `afterAll`. If a run is stopped
  partway, search the app for `TEST-API-` to find anything left behind and delete it.
- **These tests change shared dev data.** Run them against dev only.
- **Never attach real alert condition sets to desks in a test.** That could turn on real
  alerting.

---

## 📮 Postman collection

`postman/collections/Drop Black BFF API.postman_collection.json` has the same endpoints
for exploring by hand, except two that are only in Jest: session refresh
(`POST /api/auth/ams-session`) and TAF forecast (`GET /api/airport-wx/tafforecast`).
Its folders mirror the test folders. Each service has an `api/`
subfolder, and some also have a `Known bugs/` subfolder (Desk service, Alerts, NOTAM,
Access management, TWC location, Current Lab and SOFAR). Not every skipped Jest test
has a matching `Known bugs` request.

1. Import the JSON file into Postman.
2. In the collection's **Variables** tab, fill in the **Current value** of `email` and
   `password` (leave Initial value blank so your password is never exported). Then send
   **auth → Login**.
   This fills in `{{JWT}}`, which every other request uses.
3. **List desks** fills in `{{deskUid}}`, `{{locationUid}}` and `{{routeUid}}` for the
   requests that need them.

Requests that create or edit data only touch throwaway `TEST-API-POSTMAN-*` items.
The `Known bugs` requests fail today and pass once the bug is fixed, the same way the
skipped Jest tests do.

The collection is generated. **Edit `postman/build-collection.js`, not the JSON**, then
run `yarn postman:build`.

---

## ✏️ Writing a new test

1. Put it in `tests/<service>/`, with one file per endpoint, named after the action
   (`GetDesks.test.js`, `RouteCreate.test.js`). If you add a new service folder, add a
   `test:<service>` script to `package.json`.
2. Start with a header comment that lists the endpoints the file covers.
3. Use the helpers in `__fixtures__/RequestResponse.fixture.js`:
   - `bffGet(path, token)` and `bffSend(method, path, body, token)` send the request
     with the shared JWT. Pass `'bad-token'` to test a bad token, or `null` to send no
     token.
   - `validateStatus(response, code)` checks the status and that the response is JSON.
   - `handleErrors(path, code, message, token)` checks a GET error response: the
     status, that it's JSON, and that `error` contains the message. `token` is optional.
     For requests with a body, most test files define their own local `handleErrors`
     at the top of the file (e.g. `handleErrors(uid, body, code, message, detail, token)`).
     Copy the one from a similar file.
   - `testWithSofarKey(...)` from `Sofar.fixture.js` works like `test(...)` but skips
     the test when `SOFAR_TOKEN` isn't set. Use it, with `sofarGet(path)`, for SOFAR
     proxy tests that need a real SOFAR key.
   - Use the named status codes (`ValidResponse`, `UnprocessableEntryResponse`…), not
     bare numbers.
4. Look up IDs at run time, and clean up anything you create in `afterAll`.
5. Write negative tests next to the positive ones. If the API gets one wrong, use
   `test.skip` with a `TODO` that says what it does today.
6. Add the endpoint to `postman/build-collection.js`, then run `yarn postman:build`.

---

## 🔍 Troubleshooting

**The two "Get soundings access" tests fail**
This is expected for now. Since 2026-11-11 the BFF has no `/api/soundings/access` route,
so it returns its HTML 404 page. Nobody has said yet whether the route was removed, renamed or
is broken, so the tests are left failing on purpose until someone answers. See the
`TODO` in `tests/access-management/Session.test.js`.

**"Set LOGIN_EMAIL and LOGIN_PASSWORD in .env"**
`.env` is missing, or isn't in this folder. It must sit next to `globalSetup.js`.

**"Login failed: 4xx …"**
The email or password is wrong, or it's a Maverick login. Drop Black accounts are separate.

**Lots of 403s late in a run**
The 10-minute JWT expired. Run the failing folder again on its own.

**A test fails because the content type is `text/html`**
The BFF doesn't have that route. It returned its app page instead of JSON. Check
the path, or check whether the route was removed from the BFF.

**"No desk with at least one location and one route was found for the test user"**
Your account needs a desk with at least one location and one route on it. Create one
in the app.

**SOFAR tests skipped**
Add `SOFAR_TOKEN` to `.env`.

**`BFF_URL` set to a `bedrock.weather.com` host and every request times out**
Those hosts are only reachable on the VPN.
