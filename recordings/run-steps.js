// @ts-check

/**
 * Shared step-execution logic for WP Director recordings.
 *
 * Used by both `actions-runner.spec.js` (Playwright test runner) and
 * `runPlaywrightApi` in `server/routes/runner.js` (Playwright library API).
 */

const { ensureOverlayHost, flashKey, formatKey, DEFAULT_HUD_POSITION } = require('./overlay');

const DEFAULT_HUD_SCALE = 1;

/**
 * Flash a key chip in the HUD then press the key. The pairing is always used
 * together — call sites should never call `page.keyboard.press` directly when
 * the press is meant to be visible in the recording.
 *
 * @param {import('@playwright/test').Page}                          page
 * @param {string}                                                   key       Playwright key string (e.g. `'Enter'`, `'Meta+K'`).
 * @param {{ hudScale?: number, hudPosition?: string }}              [settings]
 */
async function pressWithFlash(page, key, settings = {}) {
  await flashKey(page, formatKey(key), {
    scale: settings.hudScale ?? DEFAULT_HUD_SCALE,
    position: settings.hudPosition ?? DEFAULT_HUD_POSITION,
  });
  await page.keyboard.press(key);
}

const HIGHLIGHT_HOLD = 700;
const DEFAULT_END_PAUSE = 2000;
const DEFAULT_STEP_PAUSE = 0;
const DEFAULT_TYPING_DELAY = 100;

function settingMilliseconds(value, fallback, max = 10_000) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return fallback;
  return Math.max(0, Math.min(max, Math.round(milliseconds)));
}

function stepTypingDelay(step, settings, fallback = DEFAULT_TYPING_DELAY) {
  return step.delay ?? settings.typingDelay ?? fallback;
}

/**
 * Scroll `locator` into view, inject a pulsing blue ring around it for
 * `HIGHLIGHT_HOLD` ms, click it, then remove the ring.
 *
 * The ring is appended to a top-layer popover host (see `overlay.js`) so it
 * paints above any WordPress popover/modal/dropdown regardless of z-index or
 * stacking context.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<void>}
 */
async function highlightAndClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await ensureOverlayHost(page);
    await page.evaluate(({ cx, cy, d }) => {
      if (!document.getElementById('psdd-highlight-style')) {
        const style = document.createElement('style');
        style.id = 'psdd-highlight-style';
        style.textContent = `
          @keyframes psdd-pulse {
            0%,80%,100% { transform:scale(1);   opacity:1;   }
            20%,60%     { transform:scale(1.08); opacity:0.7; }
          }`;
        document.head.appendChild(style);
      }
      const ring = document.createElement('div');
      ring.id = 'psdd-click-ring';
      ring.style.cssText = `
        position:fixed;pointer-events:none;
        left:${cx - d / 2}px;top:${cy - d / 2}px;width:${d}px;height:${d}px;
        border:3px solid #3b82f6;border-radius:50%;
        box-shadow:0 0 12px rgba(59,130,246,.5);
        animation:psdd-pulse .9s ease-in-out;`;
      const host = document.getElementById('psdd-overlay-host');
      (host ?? document.body).appendChild(ring);
    }, {
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
      d: Math.max(box.width, box.height) + 24,
    });
  }
  await page.waitForTimeout(HIGHLIGHT_HOLD);
  await locator.click();
  await page.evaluate(() => document.getElementById('psdd-click-ring')?.remove());
}

/**
 * Scroll `locator` into view, click to focus it, then type `text`
 * character-by-character at `delay` ms per keystroke via `pressSequentially`.
 *
 * Focuses before typing so native `keydown`/`keyup` events fire correctly —
 * required by Gutenberg's rich-text editor which listens to keyboard events
 * to update its internal block state.
 *
 * @param {import('@playwright/test').Locator} locator
 * @param {string} text
 * @param {number} [delay] Milliseconds between keystrokes (default 100).
 * @returns {Promise<void>}
 */
async function typeSlow(locator, text, delay = 100) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await locator.pressSequentially(text, { delay });
}

/**
 * Execute a single action step.
 *
 * @param {object}                                                       step       Action step object.
 * @param {import('@playwright/test').Page}                              page       Top-level Playwright page.
 * @param {Array<import('@playwright/test').Page|import('@playwright/test').FrameLocator>} frameStack Frame context stack; top is the active locator context.
 * @param {() => import('@playwright/test').Page|import('@playwright/test').FrameLocator} ctx        Returns the active frame context.
 * @param {import('@playwright/test').Locator}                           sidebar    Editor settings region locator.
 * @param {{ typingDelay: number }}                                      settings   Runtime recording settings.
 * @returns {Promise<void>}
 */
async function runStep(step, page, frameStack, ctx, sidebar, settings = { typingDelay: DEFAULT_TYPING_DELAY }) {
  const sidebarWasOpen = await sidebar.isVisible();
  switch (step.action) {
    case 'navigate':
      await page.goto(step.url, { waitUntil: step.waitUntil ?? 'load' });
      break;

    case 'click':
      await ctx().locator(step.selector).click();
      break;

    case 'highlightClick':
      await highlightAndClick(page, ctx().locator(step.selector));
      break;

    case 'fill':
      await ctx().locator(step.selector).fill(step.value);
      break;

    case 'type':
      await ctx().locator(step.selector).click();
      await page.keyboard.type(step.text, { delay: step.delay ?? settings.typingDelay ?? 0 });
      break;

    case 'slowType':
      await typeSlow(ctx().locator(step.selector), step.text, stepTypingDelay(step, settings));
      break;

    case 'wait':
      await page.waitForTimeout(step.ms);
      break;

    case 'waitForSelector':
      await ctx().locator(step.selector).waitFor({ state: 'visible', timeout: step.timeout ?? 30_000 });
      break;

    case 'screenshot': {
      const screenshotPath = step.path ?? `output/${def.name}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath });
      break;
    }

    case 'scroll':
      await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x: step.x ?? 0, y: step.y ?? 0 });
      break;

    case 'hover':
      await ctx().locator(step.selector).hover();
      break;

    case 'press':
    case 'pressKey':
      await pressWithFlash(page, step.key, settings);
      break;

    case 'frameLocator':
      frameStack.push(page.frameLocator(step.selector));
      break;

    case 'exitFrame':
      if (frameStack.length > 1) frameStack.pop();
      break;

    case 'tryClick': {
      try {
        const loc = step.role
          ? ctx().getByRole(step.role, { name: step.name, exact: step.exact ?? true })
          : ctx().locator(step.selector);
        await loc.waitFor({ state: 'visible', timeout: step.timeout ?? 3_000 });
        await loc.click();
      } catch { /* element not present, continue */ }
      break;
    }

    case 'wpInstallPlugin': {
      await page.goto('/wp-admin/plugin-install.php', { waitUntil: 'domcontentloaded' });
      const pluginSearchInput = page.locator('#search-plugins');
      await pluginSearchInput.waitFor({ state: 'visible' });
      await typeSlow(pluginSearchInput, step.slug, stepTypingDelay(step, settings));
      // #search-submit is hide-if-js — WP debounces an AJAX search on keyup
      // from #search-plugins, so the install button appears without a submit click.
      const installBtn = page.locator(`.plugin-card-${step.slug} .install-now`);
      await installBtn.waitFor({ timeout: 15_000 });
      await highlightAndClick(page, installBtn);
      const activateBtn = page.locator(`.plugin-card-${step.slug} .activate-now`);
      await activateBtn.waitFor({ timeout: 30_000 });
      if (step.activate) {
        await highlightAndClick(page, activateBtn);
        await page.waitForLoadState('domcontentloaded');
      }
      break;
    }

    case 'wpInstallTheme': {
      const displayName = step.name ??
        step.slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      await page.goto('/wp-admin/theme-install.php', { waitUntil: 'domcontentloaded' });
      const searchInput = page.locator('#wp-filter-search-input');
      await searchInput.waitFor({ state: 'visible' });
      await typeSlow(searchInput, step.slug, stepTypingDelay(step, settings));
      const themeInstallBtn = page.locator(`[aria-label="Install ${displayName}"]`);
      await themeInstallBtn.waitFor({ timeout: 15_000 });
      await themeInstallBtn.hover();
      await highlightAndClick(page, themeInstallBtn);
      const themeActivateBtn = page.locator(`[aria-label="Activate ${displayName}"]`);
      await themeActivateBtn.waitFor({ timeout: 30_000 });
      if (step.activate) {
        await highlightAndClick(page, themeActivateBtn);
        await page.waitForLoadState('domcontentloaded');
      }
      break;
    }

    case 'wpSetPostTitle': {
      const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
      const titleLocator = editorFrame.locator('.wp-block-post-title');
      await titleLocator.waitFor({ state: 'visible', timeout: 30_000 });
      if (step.programmatic) {
        await titleLocator.fill(step.title);
      } else {
        await typeSlow(titleLocator, step.title, stepTypingDelay(step, settings));
      }
      break;
    }

    case 'wpSetBlockContent': {
      const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
      await editorFrame.locator('.wp-block-post-title').waitFor({ state: 'visible', timeout: 30_000 });
      let targetLocator;
      if (step.blockType) {
        const shortName = step.blockType.includes('/')
          ? step.blockType.split('/')[1]
          : step.blockType;
        targetLocator = editorFrame.locator(`.wp-block-${shortName}[contenteditable="true"]`).nth(step.index ?? 0);
      } else {
        targetLocator = editorFrame.locator('[contenteditable="true"]:not(.wp-block-post-title)').last();
      }
      await targetLocator.waitFor({ state: 'visible', timeout: 10_000 });
      const replace = step.replace !== false;
      const delay = stepTypingDelay(step, settings);
      await targetLocator.scrollIntoViewIfNeeded();
      await targetLocator.click({ clickCount: replace ? 3 : 1 });
      await targetLocator.pressSequentially(step.content, { delay });
      break;
    }

    case 'wpSelectBlock': {
      const blockType = step.blockType.includes('/') ? step.blockType : `core/${step.blockType}`;
      const index = step.index ?? 0;
      const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
      const block = editorFrame.locator(`[data-type="${blockType}"]`).nth(index);
      await block.waitFor({ state: 'visible', timeout: 10_000 });
      await block.click();
      await block.and(editorFrame.locator('.is-selected')).waitFor({ state: 'visible', timeout: 5_000 });
      break;
    }

    case 'wpInsertBlock': {
      const shortName = step.blockType.includes('/')
        ? step.blockType.split('/')[1]
        : step.blockType;
      const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');

      // Insert an empty paragraph programmatically at the target position, then
      // click it to focus. Avoids the DOM appender race and the unreliable
      // "click + Enter to split" fallback, both of which produced
      // mid-word block splits when Gutenberg's internal selection state
      // didn't match the DOM selection.
      const newClientId = await page.evaluate((idx) => {
        const newBlock = wp.blocks.createBlock('core/paragraph');
        const order = wp.data.select('core/block-editor').getBlockOrder();
        const position = idx !== undefined && idx >= 0 ? idx + 1 : order.length;
        wp.data.dispatch('core/block-editor').insertBlock(newBlock, position);
        return newBlock.clientId;
      }, step.afterIndex);
      const newBlockEl = editorFrame.locator(`[data-block="${newClientId}"]`);
      await newBlockEl.waitFor({ state: 'visible', timeout: 5_000 });
      await newBlockEl.click();

      // Paragraph is the default block — no slash command needed
      if (shortName !== 'paragraph') {
        await page.keyboard.type(`/${shortName}`, { delay: 50 });
        const displayName = shortName.replace(/-/g, ' ');
        const option = page.getByRole('option', { name: new RegExp(`^${displayName}$`, 'i') });
        await option.waitFor({ state: 'visible', timeout: 5_000 });
        await option.click();
        await pressWithFlash(page, 'Enter', settings);
        // Wait for the autocomplete to close — confirms the block was inserted
        // and the editor is settled before the next step runs.
        await option.waitFor({ state: 'hidden', timeout: 5_000 });
      }
      break;
    }

    case 'wpInsertBlockProgrammatic': {
      const blockType = step.blockType.includes('/')
        ? step.blockType
        : `core/${step.blockType}`;
      await page.waitForFunction(() => window?.wp?.blocks && window?.wp?.data);
      await page.evaluate(({ bType, attrs }) => {
        const block = wp.blocks.createBlock(bType, attrs || {});
        wp.data.dispatch('core/block-editor').insertBlock(block);
      }, { bType: blockType, attrs: step.attributes ?? {} });
      break;
    }

    case 'wpDeleteBlock': {
      const blockType = step.blockType.includes('/') ? step.blockType : `core/${step.blockType}`;
      const index = step.index ?? 0;
      const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
      const blocks = editorFrame.locator(`[data-type="${blockType}"]`);
      const target = blocks.nth(index);
      const beforeCount = await blocks.count();
      await target.click();
      await target.and(editorFrame.locator('.is-selected')).waitFor({ state: 'visible', timeout: 5_000 });
      await pressWithFlash(page, 'Escape', settings);
      await pressWithFlash(page, 'Backspace', settings);
      if (beforeCount > 0) {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline && (await blocks.count()) >= beforeCount) {
          await page.waitForTimeout(50);
        }
      }
      break;
    }

    case 'wpSiteEditorSave': {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const publishPanel = page.getByRole('region', { name: 'Editor publish' });
      await publishPanel.waitFor({ state: 'visible', timeout: 10_000 });
      await publishPanel.getByRole('button', { name: 'Save', exact: true }).click();
      await publishPanel.waitFor({ state: 'hidden', timeout: 10_000 });
      break;
    }

    case 'wpInsertBlockFromPanel': {
      await page.getByRole('button', { name: 'Block Inserter', exact: true }).click();
      const blockLibrary = page.getByRole('region', { name: 'Block Library' });
      await blockLibrary.waitFor({ state: 'visible', timeout: 10_000 });
      await blockLibrary.getByRole('searchbox', { name: 'Search' }).fill(step.blockType);
      const option = page.getByRole('option', { name: step.blockType, exact: true });
      await option.waitFor({ timeout: 5_000 });
      await option.click();
      break;
    }

    case 'wpInspectorPanel': {
      const sidebar = page.getByRole('region', { name: 'Editor settings' });
      try {
        await sidebar.waitFor({ state: 'visible', timeout: 3_000 });
      } catch {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await sidebar.waitFor({ state: 'visible', timeout: 5_000 });
      }
      await sidebar.getByRole('button', { name: step.panel }).click();
      break;
    }

    case 'wpAdminMenuClick': {
      // Try top-level items first (.wp-menu-name ignores update count badges).
      // Fall back to submenu items (e.g. "Updates" under "Dashboard").
      const topLevel = page
        .locator('#adminmenu > li')
        .filter({ has: page.locator(`.wp-menu-name:text-is("${step.item}")`) })
        .locator('> a')
        .first();
      const subLevel = page.locator(
        `#adminmenu .wp-submenu li a:text-is("${step.item}")`
      ).first();
      const topCount = await topLevel.count();
      const subCount = await subLevel.count();

      if ( topCount === 0 && subCount > 0 ) {
        const parentMenuItem = page
          .locator('#adminmenu > li')
          .filter({ has: page.locator(`.wp-submenu li a:text-is("${step.item}")`) })
          .locator('> a')
          .first();
        await parentMenuItem.hover();
      }

      const menuLink = topCount > 0 ? topLevel : subLevel;
      await highlightAndClick(page, menuLink);
      await page.waitForLoadState('domcontentloaded');
      break;
    }

    case 'wpEditorWPMenuClick': {
      // Click the WordPress logo button at the top-left of the block editor.
      await highlightAndClick(page, page.getByRole('button', { name: 'WordPress', exact: true }));
      break;
    }

    case 'wpEditorToggleFullscreen': {
      // Open Editor Options → Preferences and set the Fullscreen mode checkbox.
      // Pass `enable: false` to turn fullscreen off (reveals the WP admin sidebar).
      const optionsBtn = page.getByRole('button', { name: 'Options', exact: true });
      await highlightAndClick(page, optionsBtn);
      const prefsItem = page.getByRole('menuitem', { name: 'Preferences' });
      await prefsItem.waitFor({ state: 'visible', timeout: 5_000 });
      await prefsItem.click();
      const modal = page.getByRole('dialog', { name: 'Preferences' });
      await modal.waitFor({ state: 'visible', timeout: 5_000 });
      const toggle = modal.getByRole('checkbox', { name: 'Fullscreen mode' });
      await toggle.waitFor({ timeout: 3_000 });
      const shouldEnable = step.enable !== false;
      if (shouldEnable !== await toggle.isChecked()) {
        await toggle.click();
      }
      await modal.getByRole('button', { name: 'Close' }).click();
      await modal.waitFor({ state: 'hidden', timeout: 5_000 });
      break;
    }

    case 'wpOpenOptionsMenu': {
      const btn = ctx().locator(step.selector);
      const expanded = await btn.getAttribute('aria-expanded');
      if (expanded !== 'true') {
        await highlightAndClick(page, btn);
        await page.locator('.components-dropdown-menu__menu[role="menu"]').waitFor({ state: 'visible', timeout: 5_000 });
      }
      break;
    }

    default:
      throw new Error(`Unknown action: "${step.action}"`);
  }

  // If the sidebar was open before this action and has since closed, reopen it —
  // but only if the Settings button is still on the page (i.e. we're still in the editor).
  if (sidebarWasOpen && !(await sidebar.isVisible())) {
    const settingsBtn = page.getByRole('button', { name: 'Settings', exact: true });
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click();
      await sidebar.waitFor({ state: 'visible', timeout: 5_000 });
    }
  }
}

/**
 * Execute all actions from a step definition against `page`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} def         Parsed step-definition JSON.
 * @param {((step: object, fn: () => Promise<void>) => Promise<void>)|null} [runner]
 *   Optional wrapper called around each step, receiving the step object and an
 *   async executor — e.g. Playwright's `test.step()` for named reporting.
 *   When null, steps run unwrapped.
 * @param {((index: number, total: number) => void)|null} [onStepStart]
 *   Called before each direction group begins executing, with its original
 *   index in the full actions array and the total group count.
 * @returns {Promise<void>}
 */
async function runSteps(page, def, runner = null, onStepStart = null) {
  // Frame context stack: top of stack is the active locator context
  const frameStack = [page];
  const ctx = () => frameStack[frameStack.length - 1];
  const sidebar = page.getByRole('region', { name: 'Editor settings' });
  const recordingSettings = def.recordingSettings && typeof def.recordingSettings === 'object'
    ? def.recordingSettings
    : {};
  const hudScale = Number.isFinite(Number(recordingSettings.hudScale)) && Number(recordingSettings.hudScale) > 0
    ? Number(recordingSettings.hudScale)
    : DEFAULT_HUD_SCALE;
  const settings = {
    stepPause: settingMilliseconds(recordingSettings.stepPause, DEFAULT_STEP_PAUSE),
    typingDelay: settingMilliseconds(recordingSettings.typingDelay, DEFAULT_TYPING_DELAY, 1000),
    hudScale,
    hudPosition: recordingSettings.hudPosition ?? DEFAULT_HUD_POSITION,
  };

  // Support grouped direction format plus legacy flat actions.
  const allActions = def.actions ?? def.directions ?? [];
  const total = allActions.length;

  // Preserve original indices through the startFrom filter so the UI can
  // highlight the correct direction group regardless of what was skipped.
  let toRun = allActions.map((group, i) => ({ group, origIndex: i }));
  if (def.startFrom != null && def.startFrom > 0) {
    const pinned   = toRun.slice(0, def.startFrom).filter(({ group: g }) => g.alwaysRun);
    const fromHere = toRun.slice(def.startFrom);
    toRun = [...pinned, ...fromHere];
  }

  for (const [groupIndex, { group, origIndex }] of toRun.entries()) {
    onStepStart?.(origIndex, total);
    const groupSteps = group.actions ?? group.steps ?? [group];
    for (const step of groupSteps) {
      await (
        runner
        ? runner(step, async () => await runStep(step, page, frameStack, ctx, sidebar, settings))
        : runStep(step, page, frameStack, ctx, sidebar, settings)
      );
    }
    const isLastGroup = groupIndex === toRun.length - 1;
    if (!isLastGroup && settings.stepPause > 0) {
      await page.waitForTimeout(settings.stepPause);
    }
  }

  await page.waitForTimeout(settingMilliseconds(recordingSettings.endPause, DEFAULT_END_PAUSE));
}

module.exports = { runStep, runSteps };
