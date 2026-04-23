// @ts-check

/**
 * Double-buffered WP Playground pool.
 *
 * Maintains two Playground instances on fixed ports so there is always a
 * warm (freshly-booted) instance ready for the next recording. While one
 * slot is being used for a recording the other is reset in the background,
 * eliminating the ~30 s Playground boot wait between consecutive runs.
 *
 * Port assignments:
 *   RECORDING_PLAYGROUND_1_PORT (9400) — slots[0]
 *   RECORDING_PLAYGROUND_2_PORT (9401) — slots[1]
 *
 * Typical lifecycle:
 *   1. init()    — on server start; boots both slots with the default blueprint.
 *   2. acquire() — before each recording; returns the warm port immediately
 *                  (or waits and boots on the slow path if the blueprint changed).
 *                  Also kicks off a background refresh of the other slot.
 *   3. release() — after each recording completes; kills + reboots the used
 *                  slot so it is warm for the run after next.
 *
 * The caller (runner.js) passes `WP_DIRECTOR_PLAYGROUND_PORT=<port>` in the
 * Playwright env so playwright.config.js picks up the right baseURL.
 */

const crypto = require('crypto');
const fs = require('fs');
const {
  RECORDING_PLAYGROUND_1_PORT,
  RECORDING_PLAYGROUND_2_PORT,
  RECORDING_1_PID_FILE,
  RECORDING_2_PID_FILE,
} = require('./config');
const { killPid, startPlayground } = require('./playground');

/**
 * @typedef {'idle'|'booting'|'warm'|'active'} SlotStatus
 *
 * @typedef {Object} Slot
 * @property {number}             port
 * @property {string}             pidFile
 * @property {SlotStatus}         status
 * @property {string|null}        blueprintHash  Hash of the blueprint the slot is warm with.
 * @property {string|null}        pendingHash    Hash of the blueprint currently being booted.
 * @property {Promise<void>|null} bootPromise
 * @property {((event: {type:string,text:string}) => void)|null} onData
 *   Current log callback. Set by acquire() when a slot is handed out; cleared
 *   by bootSlot() on each reboot. The process's stdout/stderr listeners
 *   delegate to this dynamically so the callback can be swapped between runs.
 */

/** @type {Slot[]} */
const slots = [
  {
    port: RECORDING_PLAYGROUND_1_PORT,
    pidFile: RECORDING_1_PID_FILE,
    status: 'idle',
    blueprintHash: null,
    pendingHash: null,
    bootPromise: null,
    onData: null,
  },
  {
    port: RECORDING_PLAYGROUND_2_PORT,
    pidFile: RECORDING_2_PID_FILE,
    status: 'idle',
    blueprintHash: null,
    pendingHash: null,
    bootPromise: null,
    onData: null,
  },
];

/**
 * MD5 hash of the blueprint file contents, used to detect when the active
 * blueprint has changed between runs. Falls back to the path itself if the
 * file cannot be read (e.g. default blueprint not yet written).
 *
 * @param {string} blueprintPath
 * @returns {string}
 */
function hashBlueprint(blueprintPath) {
  try {
    return crypto.createHash('md5').update(fs.readFileSync(blueprintPath)).digest('hex');
  } catch {
    return blueprintPath;
  }
}

/**
 * Kill whatever is running on `slots[index].port`, then spawn a fresh
 * Playground with the given blueprint. Updates slot status and hash fields
 * throughout. Returns a Promise that resolves when "Ready!" is seen on stdout.
 *
 * @param {number} index         Index into the `slots` array.
 * @param {string} blueprintPath
 * @returns {Promise<void>}
 */
function bootSlot(index, blueprintPath) {
  const slot = slots[index];
  killPid(slot.pidFile);
  slot.status = 'booting';
  slot.blueprintHash = null;
  slot.pendingHash = hashBlueprint(blueprintPath);
  slot.onDone = null;

  // Pass a dynamic wrapper so the process's stdout/stderr listeners always
  // delegate to slot.onData — even after acquire() swaps in a new callback.
  const promise = startPlayground({ port: slot.port, blueprintPath, pidFile: slot.pidFile, onData: (e) => slots[index]?.onData?.(e) })
    .then(() => {
      slot.status = 'warm';
      slot.blueprintHash = slot.pendingHash;
      slot.pendingHash = null;
      slot.bootPromise = null;
    })
    .catch((err) => {
      slot.status = 'idle';
      slot.pendingHash = null;
      slot.bootPromise = null;
      throw err;
    });

  slot.bootPromise = promise;
  return promise;
}

/**
 * Boot both slots with `defaultBlueprintPath` in parallel. Resolves once
 * slot 0 is warm (or rejects if slot 0 fails). Slot 1 boots silently in the
 * background — if it fails only a console warning is emitted.
 *
 * @param {string} defaultBlueprintPath
 * @returns {Promise<void>}
 */
async function init(defaultBlueprintPath) {
  bootSlot(1, defaultBlueprintPath).catch((err) => {
    console.error('[Playground Pool] Recording slot 1 (port', RECORDING_PLAYGROUND_2_PORT, ') failed to start:', err.message);
  });
  await bootSlot(0, defaultBlueprintPath);
}

/**
 * Return the port of a warm slot that matches `blueprintPath`.
 *
 * Resolution order:
 *   Fast   — a slot is already warm with the matching blueprint; return immediately.
 *   Medium — a slot is booting with the matching blueprint; await it.
 *   Slow   — no matching slot; reboot the first non-active slot synchronously
 *             (same latency as before the pool existed, but only on blueprint change).
 *
 * Immediately after acquiring, kicks off a background refresh of the other
 * slot so it is warm before the next recording is requested.
 *
 * @param {string} blueprintPath
 * @param {((event: {type:string,text:string}) => void)|null} [onData]
 * @returns {Promise<number>}  Port to pass via WP_DIRECTOR_PLAYGROUND_PORT.
 */
async function acquire(blueprintPath, onData = null) {
  const hash = hashBlueprint(blueprintPath);

  // Fast path — warm slot already has the right blueprint.
  for (const slot of slots) {
    if (slot.status === 'warm' && slot.blueprintHash === hash) {
      slot.status = 'active';
      slot.onData = onData;
      _refreshOther(slot.port, blueprintPath);
      console.log('[Playground Pool] Using warm playground', slot.port);
      return slot.port;
    }
  }

  // Medium path — one or more slots are booting with the matching blueprint.
  // Race them so whichever finishes first is used, rather than always waiting
  // for slot 0 even if slot 1 boots sooner.
  const matchingBoots = slots.filter(
    s => s.status === 'booting' && s.pendingHash === hash && s.bootPromise
  );
  if (matchingBoots.length > 0) {
    console.log('[Playground Pool] Waiting for a playground to boot ...');
    await Promise.race(matchingBoots.map(s => s.bootPromise.catch(() => {})));
    // Re-check fast path: whichever slot won the race is now warm.
    for (const slot of slots) {
      if (slot.status === 'warm' && slot.blueprintHash === hash) {
        slot.status = 'active';
        slot.onData = onData;
        _refreshOther(slot.port, blueprintPath);
        console.log('[Playground Pool] Using booted playground', slot.port);
        return slot.port;
      }
    }
  }

  // Slow path — blueprint changed (or pool not yet initialised). Reboot the
  // first non-active slot and wait for it.
  const targetIndex = slots.findIndex(s => s.status !== 'active');
  const idx = targetIndex === -1 ? 0 : targetIndex;
  const target = slots[idx];

  if (target.status === 'booting') {
    // Let the current boot finish before overriding (avoids port conflicts).
    try { await target.bootPromise; } catch {}
  }

  await bootSlot(idx, blueprintPath);
  target.status = 'active';
  target.onData = onData;
  _refreshOther(target.port, blueprintPath);
  console.log('[Playground Pool] Rebooting playground', target.port);
  return target.port;
}

/**
 * Mark the slot at `port` as done and start rebooting it in the background
 * so it is warm for the run after next. Should be called after the recording
 * that used this port has completed.
 *
 * @param {number} port          Port returned by acquire().
 * @param {string} blueprintPath Blueprint the recording ran with.
 */
function release(port, blueprintPath) {
  const index = slots.findIndex(s => s.port === port);
  if (index === -1) return;
  console.log('[Playground Pool] Releasing playground', port);
  bootSlot(index, blueprintPath).catch((err) => {
    console.error('[Playground Pool] Post-recording slot refresh failed (port', port, '):', err.message);
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * If the slot at the OTHER port is not already warm (or booting) with the
 * same blueprint, kick off a background refresh now so it is ready before
 * the next recording.
 *
 * @param {number} usedPort
 * @param {string} blueprintPath
 */
function _refreshOther(usedPort, blueprintPath) {
  const index = slots.findIndex(s => s.port !== usedPort);
  if (index === -1) return;
  const other = slots[index];
  const hash = hashBlueprint(blueprintPath);
  if (other.status === 'warm'    && other.blueprintHash === hash) return;
  if (other.status === 'booting' && other.pendingHash   === hash) return;
  bootSlot(index, blueprintPath).catch((err) => {
    console.error('[Playground Pool] Background slot refresh failed (port', other.port, '):', err.message);
  });
}

module.exports = { init, acquire, release };
