// @ts-check
/**
 * Playwright globalTeardown hook — runs once after all tests finish.
 *
 * Server path (WP_DIRECTOR_SERVER=1): playground-server.js owns the Playground
 * lifecycle — return immediately so warm pool slots are not killed.
 *
 * CLI path: kills the non-detached Playground instance that global-setup.js
 * spawned via playground-cli.js.
 */
const cliPlayground = require('./src/playground-cli');

/** @returns {Promise<void>} */
module.exports = async function globalTeardown() {
  if (process.env.WP_DIRECTOR_SERVER === '1') return;
  cliPlayground.kill();
};
