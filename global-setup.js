// @ts-check
/**
 * Playwright globalSetup hook — runs once before the test suite starts.
 *
 * Server path (WP_DIRECTOR_SERVER=1): playground-server.js has already booted
 * both recording slots. Nothing to do here.
 *
 * CLI path (npm run record): delegates to playground-cli.js which picks a
 * free port, spawns a Playground instance, and waits for "Ready!".
 */
const cliPlayground = require('./server/playground-cli');

/** @returns {Promise<void>} */
module.exports = async function globalSetup() {
  if (process.env.WP_DIRECTOR_SERVER === '1') return;
  await cliPlayground.start();
};
