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
const path = require('path');
const {
  RECORDING_PLAYGROUND_PORT_MIN,
  RECORDING_PLAYGROUND_PORT_MAX,
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

// Flipped to false at the top of warmAll so /api/pool-status reflects
// "not ready" in the same tick a Save is processed, before slot state
// transitions are observable to a poll. Restored to true once at least one
// slot finishes booting.
let readyFlag = true;

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
    if (slot.bootPromise === promise) slot.bootPromise = null;
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

  // Update state synchronously so callers that check status/pendingHash
  // immediately after calling _spawnSlot see the correct values.
  slot.proc = null;
  slot.status = 'booting';
  slot.blueprintHash = null;
  slot.pendingHash = hashBlueprint(blueprintPath);
  slot.onData = null;

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
      slot.pendingHash = null;
      slot.blueprintHash = null;
      if (slot.status !== 'booting') slot.status = 'idle';
      console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): process closed`);
    });
    slot.status = 'warm';
    slot.blueprintHash = slot.pendingHash;
    slot.pendingHash = null;
    readyFlag = true;
    console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): warm and ready`);
  })().catch((err) => {
    slot.proc = null;
    slot.status = 'idle';
    slot.pendingHash = null;
    console.error(`[Playground Pool] Slot ${index} (port ${slot.port}): boot failed —`, err.message);
    throw err;
  });
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
  console.log(`[Playground Pool] Initialising with ${path.basename(defaultBlueprintPath)} (${INITIAL_SLOT_COUNT} slots)`);
  bootSlotWithRetry(1, defaultBlueprintPath, `Slot 1 (port ${slots[1]?.port}) init`);
  await bootSlot(0, defaultBlueprintPath);
  console.log('[Playground Pool] Ready');
}

/**
 * Hand out a warm slot. Blueprint-agnostic: the caller (save/reset) is
 * responsible for ensuring slots are warmed with the current blueprint
 * before recordings are acquired.
 *
 * Resolution order:
 *   1. Any warm slot — mark active and return its port.
 *   2. Pool can grow — push a new slot, kick off its boot, then fall through.
 *   3. Boots in flight — race them all and retry from step 1.
 *   4. Pool full, nothing booting — reboot the first non-active slot
 *      synchronously and return it.
 *
 * @param {string} blueprintPath  Used only when this call has to reboot a slot itself.
 * @param {((event: {type:string,text:string}) => void)|null} [onData]
 * @returns {Promise<number>}  Port to pass via WP_DIRECTOR_PLAYGROUND_PORT.
 */
async function acquire(blueprintPath, onData = null) {
  while (true) {
    // 1. Warm slot available — claim it.
    for (const slot of slots) {
      if (slot.status !== 'warm') continue;
      slot.status = 'active';
      slot.onData = onData;
      console.log('[Playground Pool] Using warm playground', slot.port);
      return slot.port;
    }

    // 2. Grow the pool if we can, then fall through to wait for it.
    if (slots.length < MAX_SLOT_COUNT) {
      console.log('[Playground Pool] Expanding playground pool ...');
      const slot = createSlot(RECORDING_PLAYGROUND_PORT_MIN + slots.length);
      const index = slots.push(slot) - 1;
      bootSlotWithRetry(index, blueprintPath, `Expanded slot (port ${slot.port})`);
    }

    // 3. Race any in-flight boots and retry.
    const boots = slots.map(s => s.bootPromise).filter(Boolean);
    if (boots.length > 0) {
      console.log('[Playground Pool] Waiting for a playground to boot ...');
      await Promise.race(boots.map(p => p.catch(() => {})));
      continue;
    }

    // 4. No warm, no booting, pool full — reboot the first non-active slot.
    const targetIndex = slots.findIndex(s => s.status !== 'active');
    const idx = targetIndex === -1 ? 0 : targetIndex;
    const target = slots[idx];
    console.log(`[Playground Pool] Slow path — rebooting slot ${idx} (port ${target.port}) with ${path.basename(blueprintPath)}`);
    await bootSlot(idx, blueprintPath);
    target.status = 'active';
    target.onData = onData;
    return target.port;
  }
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
  console.log(`[Playground Pool] Slot ${index} (port ${port}): released — rebooting for next run`);
  // Clear onData so the background reboot's log output doesn't leak into
  // the just-finished request's SSE stream.
  slots[index].onData = null;
  bootSlotWithRetry(index, blueprintPath, `Slot ${index} (port ${port}) post-release reboot`);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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
    if (slot.bootPromise === promise) slot.bootPromise = null;
  });
  return promise;
}

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
  bootSlotWithRetry(index, blueprintPath, `Slot ${index} (port ${other.port}) background refresh`);
}

/**
 * Claim a warm slot with the given blueprint hash, mark it active, and kick
 * off background warming for another slot.
 *
 * @param {string} hash
 * @param {string} blueprintPath
 * @param {((event: {type:string,text:string}) => void)|null} onData
 * @param {string} logPrefix
 * @returns {number|null}
 */
function _claimWarmSlot(hash, blueprintPath, onData, logPrefix) {
  for (const slot of slots) {
    if (slot.status !== 'warm' || slot.blueprintHash !== hash) continue;
    slot.status = 'active';
    slot.onData = onData;
    console.log(logPrefix, slot.port);
    return slot.port;
  }
  return null;
}

/**
 * Kick off background boots for all non-active slots that are not already
 * warm or booting with this blueprint. Call after saving or resetting the
 * blueprint so slots are pre-warmed before the next recording is requested.
 *
 * @param {string} blueprintPath
 */
function warmAll(blueprintPath) {
  const hash = hashBlueprint(blueprintPath);
  const blueprint = path.basename(blueprintPath);
  console.log(`[Playground Pool] warmAll — re-warming slots with ${blueprint}`);

  let scheduledAny = false;
  slots.forEach((slot, index) => {
    if (slot.status === 'active') {
      console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): skipped (active)`);
      return;
    }
    if (slot.status === 'warm' && slot.blueprintHash === hash) {
      console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): already warm with this blueprint`);
      return;
    }
    if (slot.status === 'booting' && slot.pendingHash === hash) {
      console.log(`[Playground Pool] Slot ${index} (port ${slot.port}): already booting with this blueprint`);
      return;
    }
    scheduledAny = true;
    bootSlotWithRetry(index, blueprintPath, `Slot ${index} (port ${slot.port}) warm-all reboot`);
  });

  // Only mark the pool as not-ready if we actually rebooted something. Saving
  // with no real blueprint changes leaves slots warm — the UI must not be
  // stuck on "Configuring environment…" in that case.
  if (scheduledAny) readyFlag = false;
}

/**
 * Return pool status relative to `blueprintPath`.
 *
 * @param {string} blueprintPath
 * @returns {{ warm: number, booting: number, total: number, ready: boolean }}
 */
function getStatus(blueprintPath) {
  const hash = hashBlueprint(blueprintPath);
  let warm = 0;
  let booting = 0;
  for (const slot of slots) {
    if (slot.status === 'warm' && slot.blueprintHash === hash) warm++;
    else if (slot.status === 'booting' && slot.pendingHash === hash) booting++;
  }
  return { warm, booting, total: slots.length, ready: readyFlag && warm > 0 };
}

module.exports = { init, acquire, release, warmAll, getStatus };
