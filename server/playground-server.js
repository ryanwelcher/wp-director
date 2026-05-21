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
 *   1. init()      — on server start; boots the first two slots with the default blueprint.
 *   2. acquire()   — before each recording; hands out a warm slot, expanding
 *                    the pool or rebooting on the slow path if needed.
 *   3. release()   — after each recording; kills + reboots the used slot with
 *                    the current blueprint so it is warm for the run after next.
 *   4. resetPool() — after Save/Reset of the blueprint; reboots every non-active slot.
 *
 * The caller (runner.js) passes `WP_DIRECTOR_PLAYGROUND_PORT=<port>` in the
 * Playwright env so playwright.config.js picks up the right baseURL.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const {
  RECORDING_PLAYGROUND_PORT_MIN,
  RECORDING_PLAYGROUND_PORT_MAX,
  DEFAULT_BLUEPRINT,
  GENERATED_BLUEPRINT,
} = require('./config');
const { killAndWait, startPlayground } = require('./playground');

const INITIAL_SLOT_COUNT = 2;
const MAX_SLOT_COUNT = RECORDING_PLAYGROUND_PORT_MAX - RECORDING_PLAYGROUND_PORT_MIN + 1;

// Hard deadline for killing an old process (covers SIGTERM grace + SIGKILL landing time).
const OLD_PROC_KILL_TIMEOUT_MS = 10_000;
// Delay before retrying a failed background boot (gives the OS time to release the port).
const BOOT_RETRY_DELAY_MS = 2_000;

/**
 * @typedef {'idle'|'booting'|'warm'|'active'} SlotStatus
 *
 * @typedef {Object} Slot
 * @property {number}             port
 * @property {import('child_process').ChildProcess|null} proc
 * @property {SlotStatus}         status
 * @property {Promise<void>|null} bootPromise
 * @property {number}             generation
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
    bootPromise: null,
    generation: -1,
    onData: null,
  };
}

/** @type {Slot[]} */
const slots = Array.from(
  { length: INITIAL_SLOT_COUNT },
  (_, index) => createSlot(RECORDING_PLAYGROUND_PORT_MIN + index)
);

// Flipped to false at the top of resetPool so /api/pool-status reflects
// "not ready" in the same tick a Save is processed, before slot state
// transitions are observable to a poll. Restored to true once at least one
// slot finishes booting.
let readyFlag = true;
let blueprintGeneration = 0;
let expansionBootPromise = null;

// Emits 'change' on every slot state transition and readyFlag flip. SSE
// subscribers in routes/blueprint.js push the new snapshot to clients on
// each event so the UI sees pool transitions in ~real time instead of
// waiting for the next poll.
const events = new EventEmitter();
events.setMaxListeners(0);

function emitChange() {
  events.emit('change', getStatus());
}

function acquireCancelledError() {
  const err = new Error('Pool acquire cancelled');
  err.code = 'POOL_ACQUIRE_CANCELLED';
  return err;
}

/**
 * @param {AbortSignal|undefined} signal
 */
function throwIfAcquireCancelled(signal) {
  if (signal?.aborted) throw acquireCancelledError();
}

/**
 * @param {AbortSignal|undefined} signal
 * @returns {Promise<void>}
 */
function waitForPoolChange(signal) {
  throwIfAcquireCancelled(signal);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      events.off('change', onChange);
      signal?.removeEventListener('abort', onAbort);
    };
    const onChange = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(acquireCancelledError());
    };

    events.once('change', onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Kill whatever is running on `slots[index].port`, then spawn a fresh
 * Playground with the given blueprint. Returns a Promise that resolves when
 * "Ready!" is seen on stdout.
 *
 * Idempotent: if a boot is already in flight for this slot (including the
 * retry-delay window inside bootSlotWithRetry), the existing bootPromise is
 * returned instead of spawning a second `npx @wp-playground/cli`.
 *
 * @param {number} index         Index into the `slots` array.
 * @param {string} blueprintPath
 * @returns {Promise<void>}
 */
function bootSlot(index, blueprintPath) {
  const slot = slots[index];
  if (slot.bootPromise) return slot.bootPromise;

  const promise = _spawnSlot(index, blueprintPath);
  slot.bootPromise = promise;
  promise.catch(() => {}).then(() => {
    if (slot.bootPromise === promise) {
      slot.bootPromise = null;
      emitChange();
      if (slot.status === 'warm' && slot.generation !== blueprintGeneration) {
        bootSlotWithRetry(index, currentBlueprintPath(), `Slot ${index} (port ${slot.port}) stale boot refresh`);
      }
    }
  });
  return promise;
}

/**
 * Actual spawn work for a slot. Does NOT manage `slot.bootPromise` — the
 * caller (bootSlot or bootSlotWithRetry) is responsible for the lock so it
 * can be held across multiple spawn attempts.
 *
 * @param {number} index
 * @param {string} blueprintPath
 * @returns {Promise<void>}
 */
function _spawnSlot(index, blueprintPath) {
  const slot = slots[index];
  const oldProc = slot.proc;
  const slotGeneration = blueprintGeneration;

  // Update state synchronously so callers that check status immediately
  // after calling _spawnSlot see the correct values.
  slot.proc = null;
  slot.status = 'booting';
  slot.onData = null;
  emitChange();

  console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): booting with ${path.basename(blueprintPath)}...`);

  return (async () => {
    // Wait for the old process to fully exit before binding the same port.
    // killAndWait sends SIGTERM then escalates to SIGKILL after 5s if needed.
    // The outer race enforces a hard 10s ceiling in case even SIGKILL is slow.
    if (oldProc) {
      await Promise.race([
        killAndWait(oldProc),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Slot ${index}: old process did not exit within ${OLD_PROC_KILL_TIMEOUT_MS}ms`)),
            OLD_PROC_KILL_TIMEOUT_MS
          )
        ),
      ]);
      console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): old process exited, starting new one...`);
    }

    // Pass a dynamic wrapper so the process's stdout/stderr listeners always
    // delegate to slot.onData — even after acquire() swaps in a new callback.
    const proc = await startPlayground({ port: slot.port, blueprintPath, onData: (e) => slots[index]?.onData?.(e) });

    slot.proc = proc;
    proc.on('close', () => {
      if (slot.proc !== proc) return;
      slot.proc = null;
      if (slot.status !== 'booting') {
        slot.status = 'idle';
        emitChange();
      }
      console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): process closed`);
    });
    slot.status = 'warm';
    slot.generation = slotGeneration;
    readyFlag = true;
    emitChange();
    console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): warm and ready`);
  })().catch((err) => {
    slot.proc = null;
    slot.status = 'idle';
    emitChange();
    console.error(`[Playground Pool] Slot ${index} (port ${slot.port}): boot failed —`, err.message);
    throw err;
  });
}

/**
 * Boot both slots with `defaultBlueprintPath`. Slot 0 is awaited first so any
 * first-run file downloads are cached before slot 1 starts, preventing a race
 * where both processes write the same .partial file simultaneously. Resolves
 * once slot 0 is warm (or rejects if slot 0 fails). Slot 1 then warms
 * silently in the background — if it fails only a console warning is emitted.
 *
 * @param {string} defaultBlueprintPath
 * @returns {Promise<void>}
 */
async function init(defaultBlueprintPath) {
  console.log(`[Playground Pool] Initialising with ${path.basename(defaultBlueprintPath)} (${INITIAL_SLOT_COUNT} slots)`);
  await bootSlot(0, defaultBlueprintPath);
  bootSlotWithRetry(1, defaultBlueprintPath, `Slot 1 (port ${slots[1]?.port}) init`);
  console.log('[Playground Pool] Ready');
}

/**
 * Hand out a warm slot. Blueprint-agnostic: the caller (save/reset) is
 * responsible for ensuring slots are warmed with the current blueprint
 * before recordings are acquired.
 *
 * Resolution order:
 *   1. Any warm slot — mark active and return its port.
 *   2. Pool can grow — add one slot and wait for the next pool change.
 *   3. Any boot in flight — wait for it instead of expanding per request.
 *   4. Idle/crashed slot — reboot it and wait.
 *   5. Pool full and all slots active — wait for a release.
 *
 * @param {string} blueprintPath  Used only when this call has to reboot a slot itself.
 * @param {((event: {type:string,text:string}) => void)|null} [onData]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<number>}  Port to pass via WP_DIRECTOR_PLAYGROUND_PORT.
 */
async function acquire(blueprintPath, onData = null, options = {}) {
  const { signal } = options;

  while (true) {
    throwIfAcquireCancelled(signal);

    // 1. Warm slot available — claim it.
    for (const slot of slots) {
      if (slot.status !== 'warm') continue;
      if (slot.generation !== blueprintGeneration) continue;
      slot.status = 'active';
      slot.onData = onData;
      emitChange();
      console.log('[Playground Pool] Using warm playground', slot.port);
      return slot.port;
    }

    // 2. Grow by one when a run is waiting and no slot is immediately usable.
    // Only one expansion boot may be in flight at a time; regular slot reboots
    // should not block the pool from growing, but repeated wait-loop wakeups
    // should not fan out to every remaining port either.
    if (slots.length < MAX_SLOT_COUNT && !expansionBootPromise) {
      console.log('[Playground Pool] Expanding playground pool ...');
      const slot = createSlot(RECORDING_PLAYGROUND_PORT_MIN + slots.length);
      const index = slots.push(slot) - 1;
      const promise = bootSlotWithRetry(index, blueprintPath, `Expanded slot (port ${slot.port})`);
      expansionBootPromise = promise;
      promise.finally(() => {
        if (expansionBootPromise === promise) expansionBootPromise = null;
      });
      await waitForPoolChange(signal);
      continue;
    }

    // 3. Existing boot work wins after one expansion has been started. This
    // keeps repeated Preview/Stop clicks from expanding the pool while the new
    // instance is already warming.
    if (slots.some(s => s.bootPromise)) {
      console.log('[Playground Pool] Waiting for a playground to boot ...');
      await waitForPoolChange(signal);
      continue;
    }

    // 4. Reboot stale warm slots or idle slots left by failed boots/process exits.
    const staleIndex = slots.findIndex(s => s.status === 'warm' && s.generation !== blueprintGeneration);
    if (staleIndex !== -1) {
      const slot = slots[staleIndex];
      console.log(`[Playground Pool] Rebooting stale slot ${staleIndex} (port ${slot.port}) with ${path.basename(blueprintPath)}`);
      bootSlotWithRetry(staleIndex, blueprintPath, `Stale slot ${staleIndex} (port ${slot.port}) reboot`);
      await waitForPoolChange(signal);
      continue;
    }

    const idleIndex = slots.findIndex(s => s.status === 'idle');
    if (idleIndex !== -1) {
      const slot = slots[idleIndex];
      console.log(`[Playground Pool] Rebooting idle slot ${idleIndex} (port ${slot.port}) with ${path.basename(blueprintPath)}`);
      bootSlotWithRetry(idleIndex, blueprintPath, `Idle slot ${idleIndex} (port ${slot.port}) reboot`);
      await waitForPoolChange(signal);
      continue;
    }

    // 5. Full pool, all active. Wait until a run releases a slot.
    console.log('[Playground Pool] Waiting for an active playground to be released ...');
    await waitForPoolChange(signal);
  }
}

/**
 * Mark the slot at `port` as done. Slots are only rebooted after actual use
 * or when they were warmed against an older blueprint generation.
 *
 * @param {number} port  Port returned by acquire().
 * @param {{ used?: boolean }} [options]
 */
function release(port, options = {}) {
  const { used = true } = options;
  const index = slots.findIndex(s => s.port === port);
  if (index === -1) return;

  // Clear onData so the background reboot's log output doesn't leak into
  // the just-finished request's SSE stream.
  slots[index].onData = null;

  if (!used && slots[index].status === 'active' && slots[index].proc && slots[index].generation === blueprintGeneration) {
    slots[index].status = 'warm';
    readyFlag = true;
    emitChange();
    console.log(`[Playground Pool] Slot ${index} (port ${port}): released unused — keeping warm`);
    return;
  }

  console.log(`[Playground Pool] Slot ${index} (port ${port}): released${used ? '' : ' after blueprint change'} — rebooting for next run`);
  bootSlotWithRetry(index, currentBlueprintPath(), `Slot ${index} (port ${port}) post-release reboot`);
}

/**
 * Resolve the active blueprint at call time — the UI-customised generated
 * blueprint if one exists, otherwise the bundled default.
 *
 * @returns {string}
 */
function currentBlueprintPath() {
  return fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;
}

/**
 * Boot a slot, retrying once after a short delay if the first attempt fails.
 * Used for background boots only — the slow-path in acquire() propagates
 * errors directly to the caller and does not use this wrapper.
 *
 * @param {number} index
 * @param {string} blueprintPath
 * @param {string} logContext   Short label for error messages.
 * @returns {Promise<void>}
 */
function bootSlotWithRetry(index, blueprintPath, logContext) {
  const slot = slots[index];
  if (slot.bootPromise) return slot.bootPromise;

  const promise = (async () => {
    try {
      await _spawnSlot(index, blueprintPath);
    } catch (err) {
      console.warn(`[Playground Pool] ${logContext} — first attempt failed (${err.message}), retrying in ${BOOT_RETRY_DELAY_MS}ms...`);
      await new Promise(r => setTimeout(r, BOOT_RETRY_DELAY_MS));
      try {
        await _spawnSlot(index, blueprintPath);
      } catch (retryErr) {
        console.error(`[Playground Pool] ${logContext} — retry also failed:`, retryErr.message);
      }
    }
  })();

  slot.bootPromise = promise;
  promise.catch(() => {}).then(() => {
    if (slot.bootPromise === promise) {
      slot.bootPromise = null;
      emitChange();
      if (slot.status === 'warm' && slot.generation !== blueprintGeneration) {
        bootSlotWithRetry(index, currentBlueprintPath(), `Slot ${index} (port ${slot.port}) stale boot refresh`);
      }
    }
  });
  return promise;
}

/**
 * Reboot every non-active slot with the given blueprint. Called after the
 * UI saves or resets the blueprint — the UI gates Save/Reset behind real
 * form-state changes, so no hash check is needed here.
 *
 * Active slots keep running their current recording; they pick up the new
 * blueprint when they reboot via release().
 *
 * @param {string} blueprintPath
 */
function resetPool(blueprintPath) {
  blueprintGeneration += 1;
  readyFlag = false;
  emitChange();
  console.log(`[Playground Pool] resetPool — rebooting slots with ${path.basename(blueprintPath)}`);
  slots.forEach((slot, index) => {
    if (slot.status === 'active') {
      console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): skipped (active)`);
      return;
    }
    bootSlotWithRetry(index, blueprintPath, `Slot ${index} (port ${slot.port}) resetPool reboot`);
  });
}

/**
 * @returns {{
 *   warm: number,
 *   booting: number,
 *   total: number,
 *   ready: boolean,
 *   slots: Array<{ index: number, port: number, status: SlotStatus }>
 * }}
 */
function getStatus() {
  let warm = 0;
  let booting = 0;
  for (const slot of slots) {
    if (slot.status === 'warm' && slot.generation === blueprintGeneration) warm++;
    else if (slot.status === 'booting') booting++;
  }
  return {
    warm,
    booting,
    total: slots.length,
    ready: readyFlag && warm > 0,
    slots: slots.map((slot, index) => ({
      index,
      port: slot.port,
      status: slot.status,
    })),
  };
}

module.exports = { init, acquire, release, resetPool, getStatus, events };
