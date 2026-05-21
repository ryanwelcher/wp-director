// @ts-check

/**
 * Shared overlay helpers for WP Director recordings.
 *
 * Provides a single top-layer host element where overlays (key-press HUD,
 * future highlight ring, etc.) can append their nodes. The host uses the
 * Popover API in manual mode so it renders above WP popovers, modals, and
 * the editor iframe regardless of stacking context.
 */

const HOST_ID = 'psdd-overlay-host';
const STYLE_ID = 'psdd-overlay-style';
const KEYCAST_ID = 'psdd-keycast';

const OVERLAY_CSS = `
  #${HOST_ID} {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    pointer-events: none;
    overflow: visible;
  }
  #${KEYCAST_ID} {
    position: fixed;
    display: flex;
    gap: 8px;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  #${KEYCAST_ID}[data-pos="top-left"]      { top: 48px;    left: 48px;  }
  #${KEYCAST_ID}[data-pos="top-center"]    { top: 48px;    left: 50%; transform: translateX(-50%); }
  #${KEYCAST_ID}[data-pos="top-right"]     { top: 48px;    right: 48px; }
  #${KEYCAST_ID}[data-pos="bottom-left"]   { bottom: 48px; left: 48px;  }
  #${KEYCAST_ID}[data-pos="bottom-center"] { bottom: 48px; left: 50%; transform: translateX(-50%); }
  #${KEYCAST_ID}[data-pos="bottom-right"]  { bottom: 48px; right: 48px; }
  .psdd-keycast-chip {
    background: rgba(20, 20, 20, 0.88);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: calc(10px * var(--psdd-scale, 1));
    padding: calc(12px * var(--psdd-scale, 1)) calc(20px * var(--psdd-scale, 1));
    font-size: calc(24px * var(--psdd-scale, 1));
    font-weight: 600;
    letter-spacing: 0.5px;
    white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    animation: psdd-keycast-anim var(--psdd-hold, 1200ms) ease-out forwards;
  }
  @keyframes psdd-keycast-anim {
    0%   { opacity: 0; transform: translateY(8px); }
    10%  { opacity: 1; transform: translateY(0); }
    85%  { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-4px); }
  }
`;

const VALID_POSITIONS = new Set([
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]);
const DEFAULT_POSITION = 'bottom-center';

/**
 * Idempotently inject a single top-layer host element on the top-level page.
 *
 * Uses `popover="manual"` + `showPopover()` so the host enters the browser's
 * top layer, rendering above WP popovers, modals, and the editor iframe.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function ensureOverlayHost(page) {
  await page.evaluate(({ hostId, styleId, css }) => {
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      document.head.appendChild(style);
    }
    let host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement('div');
      host.id = hostId;
      host.setAttribute('popover', 'manual');
      document.body.appendChild(host);
    }
    try {
      if (!host.matches(':popover-open')) host.showPopover();
    } catch (_) {
      // Popover API unsupported or host detached — fall back to in-flow rendering.
    }
  }, { hostId: HOST_ID, styleId: STYLE_ID, css: OVERLAY_CSS });
}

/**
 * Append a transient key-press chip to the HUD.
 *
 * Chips stack horizontally; each one animates fade-in → hold → fade-out
 * and removes itself when the animation ends. Position and scale are applied
 * to the container on every call so they stay in sync if settings change.
 *
 * @param {import('@playwright/test').Page}                                                  page
 * @param {string}                                                                           label
 * @param {{ holdMs?: number, scale?: number, position?: string }}                           [opts]
 * @returns {Promise<void>}
 */
async function flashKey(page, label, { holdMs = 1200, scale = 1, position = DEFAULT_POSITION } = {}) {
  const pos = VALID_POSITIONS.has(position) ? position : DEFAULT_POSITION;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  await ensureOverlayHost(page);
  await page.evaluate(({ hostId, keycastId, text, ms, scaleVal, posVal }) => {
    const host = document.getElementById(hostId);
    if (!host) return;
    let container = document.getElementById(keycastId);
    if (!container) {
      container = document.createElement('div');
      container.id = keycastId;
      host.appendChild(container);
    }
    container.setAttribute('data-pos', posVal);
    container.style.setProperty('--psdd-scale', String(scaleVal));
    const chip = document.createElement('div');
    chip.className = 'psdd-keycast-chip';
    chip.style.setProperty('--psdd-hold', `${ms}ms`);
    chip.textContent = text;
    container.appendChild(chip);
    chip.addEventListener('animationend', () => chip.remove(), { once: true });
  }, { hostId: HOST_ID, keycastId: KEYCAST_ID, text: label, ms: holdMs, scaleVal: safeScale, posVal: pos });
}

const KEY_LABELS = {
  Meta: 'Cmd / Ctrl',
  Control: 'Ctrl',
  Alt: 'Option / Alt',
  Shift: 'Shift',
  Enter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Tab: 'Tab',
};

/**
 * Map a Playwright key string (or combo like `"Meta+K"`) to a display label.
 *
 * Unknown tokens pass through unchanged so single letters and unmapped keys
 * (e.g. `"K"`, `"ArrowDown"`) render as-is.
 *
 * @param {string} key
 * @returns {string}
 */
function formatKey(key) {
  return String(key)
    .split('+')
    .map((part) => KEY_LABELS[part] ?? part)
    .join(' + ');
}

module.exports = {
  ensureOverlayHost,
  flashKey,
  formatKey,
  HUD_POSITIONS: Array.from(VALID_POSITIONS),
  DEFAULT_HUD_POSITION: DEFAULT_POSITION,
};
