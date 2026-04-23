// @ts-check

/**
 * Shared in-memory state for the CLI Playground instance.
 *
 * Both `global-setup.js` and `global-teardown.js` import this module.
 * Because Node caches modules within a process, they share the same object,
 * which lets global-setup store the child process reference and global-teardown
 * retrieve and kill it — without writing a PID file.
 */

/** @type {import('child_process').ChildProcess | null} */
let proc = null;

module.exports = {
  /** @param {import('child_process').ChildProcess} p */
  set: (p) => { proc = p; },

  /** @returns {import('child_process').ChildProcess | null} */
  get: () => proc,

  kill: () => {
    if (!proc) return;
    try { proc.kill('SIGTERM'); } catch {}
    proc = null;
  },
};
