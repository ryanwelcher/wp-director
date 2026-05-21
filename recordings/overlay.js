// @ts-check

/**
 * Shared top-layer overlay host for recording visualizations (highlight ring,
 * future key-press HUD, etc.).
 *
 * Uses the Popover API (`popover="manual"` + `.showPopover()`) so the host
 * renders in the browser's top layer — above any WordPress popover, modal, or
 * dropdown regardless of its z-index or stacking context. Children use
 * `position: fixed` with viewport coords as usual; top-layer affects painting,
 * not the containing block.
 */

/**
 * Idempotently inject the top-layer host on the page. Re-runs safely after
 * navigation (the host is wiped with the document).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function ensureOverlayHost(page) {
  await page.evaluate(() => {
    if (document.getElementById('psdd-overlay-host')) return;
    const host = document.createElement('div');
    host.id = 'psdd-overlay-host';
    host.setAttribute('popover', 'manual');
    host.style.cssText = `
      position:fixed;inset:0;margin:0;padding:0;border:0;
      width:100vw;height:100vh;
      background:transparent;pointer-events:none;overflow:visible;`;
    document.body.appendChild(host);
    host.showPopover();
  });
}

module.exports = { ensureOverlayHost };
