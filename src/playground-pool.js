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
 *   RECORDING_PLAYGROUND_1_PORT (9400) — slot 1
 *   RECORDING_PLAYGROUND_2_PORT (9401) — slot 2
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

/** @type {Slot} */
const slot1 = {
  port: RECORDING_PLAYGROUND_1_PORT,
  pidFile: RECORDING_1_PID_FILE,
  status: 'idle',
  blueprintHash: null,
  pendingHash: null,
  bootPromise: null,
  onData: null,
};

/** @type {Slot} */
const slot2 = {
  port: RECORDING_PLAYGROUND_2_PORT,
  pidFile: RECORDING_2_PID_FILE,
  status: 'idle',
  blueprintHash: null,
  pendingHash: null,
  bootPromise: null,
  onData: null,
};

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
 * Kill whatever is running on `slot.port`, then spawn a fresh Playground
 * with the given blueprint. Updates slot status and hash fields throughout.
 * Returns a Promise that resolves when "Ready!" is seen on stdout.
 *
 * @param {Slot} slot
 * @param {string} blueprintPath
 * @param {((event: {type:string,text:string}) => void)|null} [onData]
 * @returns {Promise<void>}
 */
function bootSlot(slot, blueprintPath, onData = null) {
  killPid(slot.pidFile);
  slot.status = 'booting';
  slot.blueprintHash = null;
  slot.pendingHash = hashBlueprint(blueprintPath);
  slot.onData = onData;

  // Pass a dynamic wrapper so the process's stdout/stderr listeners always
  // delegate to slot.onData — even after acquire() swaps in a new callback.
  const promise = startPlayground({ port: slot.port, blueprintPath, pidFile: slot.pidFile, onData: (e) => slot.onData?.(e) })
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
 * slot A is warm (or rejects if slot A fails). Slot B boots silently in the
 * background — if it fails only a console warning is emitted.
 *
 * @param {string} defaultBlueprintPath
 * @returns {Promise<void>}
 */
async function init(defaultBlueprintPath) {
  bootSlot(slot2, defaultBlueprintPath).catch((err) => {
    console.error('[Pool] Recording slot 2 (port', RECORDING_PLAYGROUND_2_PORT, ') failed to start:', err.message);
  });
  await bootSlot(slot1, defaultBlueprintPath);
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
  for (const slot of [slot1, slot2]) {
    if (slot.status === 'warm' && slot.blueprintHash === hash) {
      slot.status = 'active';
      slot.onData = onData;
      _refreshOther(slot.port, blueprintPath);
      console.log('[Pool] Using warm slot', slot.port);
      return slot.port;
    }
  }

  // Medium path — one or more slots are booting with the matching blueprint.
  // Race them so whichever finishes first is used, rather than always waiting
  // for slot 1 even if slot 2 boots sooner.
  const matchingBoots = [slot1, slot2].filter(
    s => s.status === 'booting' && s.pendingHash === hash && s.bootPromise
  );
  if (matchingBoots.length > 0) {
    await Promise.race(matchingBoots.map(s => s.bootPromise.catch(() => {})));
    // Re-check fast path: whichever slot won the race is now warm.
    for (const slot of [slot1, slot2]) {
      if (slot.status === 'warm' && slot.blueprintHash === hash) {
        slot.status = 'active';
        slot.onData = onData;
        _refreshOther(slot.port, blueprintPath);
        console.log('[Pool] Using medium slot', slot.port);
        return slot.port;
      }
    }
  }

  // Slow path — blueprint changed (or pool not yet initialised). Reboot the
  // first non-active slot and wait for it.
  const target = [slot1, slot2].find(s => s.status !== 'active') ?? slot1;
  if (target.status === 'booting') {
    // Let the current boot finish before overriding (avoids port conflicts).
    try { await target.bootPromise; } catch {}
    // If the boot we just awaited produced the right blueprint, use it as-is.
    if (target.status === 'warm' && target.blueprintHash === hash) {
      target.status = 'active';
      target.onData = onData;
      _refreshOther(target.port, blueprintPath);
      console.log('[Pool] Using slow slot (blueprint matched after wait)', target.port);
      return target.port;
    }
  }
  onData?.({ type: 'stdout', text: '[Playground] Starting WP Playground with updated blueprint…\n' });
  await bootSlot(target, blueprintPath, onData);
  target.status = 'active';
  _refreshOther(target.port, blueprintPath);
  console.log('[Pool] Using slow slot', target.port);
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
  const used = _slotForPort(port);
  if (!used) return;
  bootSlot(used, blueprintPath).catch((err) => {
    console.error('[Pool] Post-recording slot refresh failed (port', port, '):', err.message);
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** @param {number} port @returns {Slot|undefined} */
function _slotForPort(port) {
  return [slot1, slot2].find(s => s.port === port);
}

/**
 * If the slot at the OTHER port is not already warm (or booting) with the
 * same blueprint, kick off a background refresh now so it is ready before
 * the next recording.
 *
 * @param {number} usedPort
 * @param {string} blueprintPath
 */
function _refreshOther(usedPort, blueprintPath) {
  const other = usedPort === RECORDING_PLAYGROUND_1_PORT ? slot2 : slot1;
  const hash = hashBlueprint(blueprintPath);
  if (other.status === 'warm'    && other.blueprintHash === hash) return;
  if (other.status === 'booting' && other.pendingHash   === hash) return;
  bootSlot(other, blueprintPath).catch((err) => {
    console.error('[Pool] Background slot refresh failed (port', other.port, '):', err.message);
  });
}

module.exports = { init, acquire, release };
