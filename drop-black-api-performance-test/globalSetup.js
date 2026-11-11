require('dotenv').config({ path: `${__dirname}/.env` });

const LOGIN_URL = process.env.LOGIN_URL || 'https://drop-acct-dev.weather.com/api/auth/login';

// Logs in with the email and password from .env and stores the JWT in
// process.env.DROP_JWT. The JWT lasts 10 minutes, which is enough for a short run.
module.exports = async () => {
  const { LOGIN_EMAIL, LOGIN_PASSWORD } = process.env;
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    throw new Error('Set LOGIN_EMAIL and LOGIN_PASSWORD in .env (copy .env.example)');
  }

  const res = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      application: 'dropblack',
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD,
      mode: 'password',
    }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }

  const { jwt, identity } = await res.json();
  if (!jwt) throw new Error('Login response had no jwt');

  process.env.DROP_JWT = jwt;
  // The logged-in user's identity, used by the access management tests
  process.env.DROP_IDENTITY_ID = identity.id;
};
