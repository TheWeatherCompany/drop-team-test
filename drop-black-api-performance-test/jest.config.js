module.exports = {
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // Logs in once before any test runs and saves the JWT for the tests to use
  globalSetup: '<rootDir>/globalSetup.js',
  testTimeout: 30000,
  verbose: true,
};
