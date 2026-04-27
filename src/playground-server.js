// @ts-check

/**
 * Expandable WP Playground pool.
 *
 * Starts with two Playground instances and can grow to five across the
 * recording port range so there is usually a warm (freshly-booted) instance
 * ready for the next recording. While one slot is being used for a recording
 * another is reset in the background, eliminating the ~30 s Playground boot
 * wait between consecutive runs on the common path.
 *
 * Port range:
 *   RECORDING_PLAYGROUND_PORT_MIN..RECORDING_PLAYGROUND_PORT_MAX (9406-9410)
 *
 * Typical lifecycle:
 *   1. init()    — on server start; boots the first two slots with the default blueprint.
 *   2. acquire() — before each recording; returns the warm port immediately
 *                  (or expands / waits / reboots on the slow path if the
 *                  blueprint changed). Also kicks off a background refresh of
 *                  another slot.
 *   3. release() — after each recording completes; kills + reboots the used
 *                  slot so it is warm for the run after next.
 *
 * The caller (runner.js) passes `WP_DIRECTOR_PLAYGROUND_PORT=<port>` in the
 * Playwright env so playwright.config.js picks up the right baseURL.
 */

const crypto = require('crypto');
const fs = require('fs');
const {
  RECORDING_PLAYGROUND_PORT_MIN,
  RECORDING_PLAYGROUND_PORT_MAX,
} = require('./config');
const { killProcess, startPlayground } = require('./playground');

const INITIAL_SLOT_COUNT = 2;
const MAX_SLOT_COUNT = RECORDING_PLAYGROUND_PORT_MAX - RECORDING_PLAYGROUND_PORT_MIN + 1;

/**
 * @typedef {'idle'|'booting'|'warm'|'active'} SlotStatus
 *
 * @typedef {Object} Slot
 * @property {number}             port
 * @property {import('child_process').ChildProcess|null} proc
 * @property {SlotStatus}         status
 * @property {string|null}        blueprintHash  Hash of the blueprint the slot is warm with.
 * @property {string|null}        pendingHash    Hash of the blueprint currently being booted.
 * @property {Promise<void>|null} bootPromise
 * @property {((event: {type:string,text:string}) => void)|null} onData
 *   Current log callback. Set by acquire() when a slot is handed out; cleared
 *   by bootSlot() on each reboot. The process's stdout/stderr listeners
 *   delegate to this dynamically so the callback can be swapped between runs.
 */

/**
 * @param {number} port
 * @returns {Slot}
 */
function createSlot(port) {
  return {
    port,
    proc: null,
    status: 'idle',
    blueprintHash: null,
    pendingHash: null,
    bootPromise: null,
    onData: null,
  };
}

/** @type {Slot[]} */
const slots = Array.from(
  { length: INITIAL_SLOT_COUNT },
  (_, index) => createSlot(RECORDING_PLAYGROUND_PORT_MIN + index)
);

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
  killProcess(slot.proc);
  slot.proc = null;
  slot.status = 'booting';
  slot.blueprintHash = null;
  slot.pendingHash = hashBlueprint(blueprintPath);
  slot.onDone = null;

  // Pass a dynamic wrapper so the process's stdout/stderr listeners always
  // delegate to slot.onData — even after acquire() swaps in a new callback.
  const promise = startPlayground({ port: slot.port, blueprintPath, onData: (e) => slots[index]?.onData?.(e) })
    .then((proc) => {
      slot.proc = proc;
      proc.on('close', () => {
        if (slot.proc !== proc) return;
        slot.proc = null;
        slot.bootPromise = null;
        slot.pendingHash = null;
        slot.blueprintHash = null;
        if (slot.status !== 'booting') slot.status = 'idle';
      });
      slot.status = 'warm';
      slot.blueprintHash = slot.pendingHash;
      slot.pendingHash = null;
      slot.bootPromise = null;
    })
    .catch((err) => {
      slot.proc = null;
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
    console.error('[Playground Pool] Recording slot 1 (port', slots[1]?.port, ') failed to start:', err.message);
  });
  await bootSlot(0, defaultBlueprintPath);
}

/**
 * Return the port of a warm slot that matches `blueprintPath`.
 *
 * Resolution order:
 *   Fast   — a slot is already warm with the matching blueprint; return immediately.
 *   Medium — if the pool is already full, a slot is booting with the matching
 *             blueprint; await whichever one finishes first.
 *   Slow   — no matching slot; either allocate a new port (until the range is
 *             full) or reboot the first non-active slot synchronously.
 *
 * Immediately after acquiring, kicks off a background refresh of another
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
      _refreshAnother(slot.port, blueprintPath);
      console.log('[Playground Pool] Using warm playground', slot.port);
      return slot.port;
    }
  }

  // If the pool can still grow, prefer allocating another slot instead of
  // waiting for or replacing an existing one.
  if (slots.length < MAX_SLOT_COUNT) {
    console.log('[Playground Pool] Expanding playground pool ...');
    const slot = createSlot(RECORDING_PLAYGROUND_PORT_MIN + slots.length);
    const index = slots.push(slot) - 1;
    try {
      await bootSlot(index, blueprintPath);
    } catch (err) {
      if (slots[index] === slot) slots.splice(index, 1);
      throw err;
    }
    slot.status = 'active';
    slot.onData = onData;
    _refreshAnother(slot.port, blueprintPath);
    console.log('[Playground Pool] Expanded playground pool to port', slot.port);
    return slot.port;
  }

  // Medium path — once all five ports are in use, race any matching boots so
  // whichever finishes first can be used immediately.
  const matchingBoots = slots.filter(
    s => s.status === 'booting' && s.pendingHash === hash && s.bootPromise
  );
  if (matchingBoots.length > 0) {
    console.log('[Playground Pool] Waiting for a playground to boot ...');
    await Promise.race(matchingBoots.map(s => s.bootPromise.catch(() => {})));
    for (const slot of slots) {
      if (slot.status === 'warm' && slot.blueprintHash === hash) {
        slot.status = 'active';
        slot.onData = onData;
        _refreshAnother(slot.port, blueprintPath);
        console.log('[Playground Pool] Using booted playground', slot.port);
        return slot.port;
      }
    }
  }

  // Slow path — the pool is full and no matching slot is immediately usable,
  // so reboot the first non-active slot and wait for it.
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
  _refreshAnother(target.port, blueprintPath);
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
  // Clear onData so the background reboot's log output doesn't leak into
  // the just-finished request's SSE stream.
  slots[index].onData = null;
  bootSlot(index, blueprintPath).catch((err) => {
    console.error('[Playground Pool] Post-recording slot refresh failed (port', port, '):', err.message);
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * If another slot is not already warm (or booting) with the same blueprint,
 * kick off a background refresh now so it is ready before the next recording.
 *
 * @param {number} usedPort
 * @param {string} blueprintPath
 */
function _refreshAnother(usedPort, blueprintPath) {
  const hash = hashBlueprint(blueprintPath);
  const index = slots.findIndex(s =>
    s.port !== usedPort &&
    s.status !== 'active' &&
    !(s.status === 'warm' && s.blueprintHash === hash) &&
    !(s.status === 'booting' && s.pendingHash === hash)
  );
  if (index === -1) return;
  const other = slots[index];
  bootSlot(index, blueprintPath).catch((err) => {
    console.error('[Playground Pool] Background slot refresh failed (port', other.port, '):', err.message);
  });
}

module.exports = { init, acquire, release };
