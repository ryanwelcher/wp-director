// @ts-check
/**
 * Dynamic test suite for WP Director recordings.
 *
 * At collection time this file reads every `*.json` from `scripts/` and
 * registers one Playwright `test()` per file, keyed by `def.name`. Supports
 * two on-disk formats:
 *
 *  - Grouped (modern): `{ name, directions: [{ label, actions[] }, ...] }`
 *  - Flat (legacy):    `{ name, actions: [ actionObj, ... ] }`
 *
 * Both are normalised to a flat `actionObj[]` before execution. The test
 * name is used as the `--grep` pattern by `/api/run` and `/api/run/batch`,
 * so only the targeted recording runs when invoked from the UI.
 *
 * Helper functions `highlightAndClick` and `typeSlow` are thin wrappers
 * over Playwright primitives that add visual feedback appropriate for demo
 * recordings.
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HIGHLIGHT_HOLD = 1000;
const DEFAULT_END_PAUSE = 2000;

/**
 * Scroll `locator` into view, inject a pulsing blue ring around it for
 * `HIGHLIGHT_HOLD` ms, click it, then remove the ring.
 *
 * The ring is injected into the top-level page (not into any iframe) so it
 * renders above the editor-canvas iframe overlay. The animation is CSS
 * keyframe-based and inlined to avoid any stylesheet dependency.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<void>}
 */
async function highlightAndClick(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
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
        position:fixed;z-index:999998;pointer-events:none;
        left:${cx - d / 2}px;top:${cy - d / 2}px;width:${d}px;height:${d}px;
        border:3px solid #3b82f6;border-radius:50%;
        box-shadow:0 0 12px rgba(59,130,246,.5);
        animation:psdd-pulse .9s ease-in-out;`;
      document.body.appendChild(ring);
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

const stepsDir = path.join(__dirname, '..', 'scripts');

const stepFiles = fs.existsSync(stepsDir)
  ? fs.readdirSync(stepsDir).filter((f) => f.endsWith('.json'))
  : [];

for (const file of stepFiles) {
  const def = JSON.parse(fs.readFileSync(path.join(stepsDir, file), 'utf8'));

  test(def.name, async ({ page }) => {
    // Frame context stack: top of stack is the active locator context
    const frameStack = [page];
    const ctx = () => frameStack[frameStack.length - 1];
    const sidebar = page.getByRole('region', { name: 'Editor settings' });

    // Support both grouped format ({ label, actions[] }) and legacy flat/steps format
    const rawActions = def.actions ?? def.steps ?? [];
    const flatActions = rawActions.flatMap(s => s.actions ?? s.steps ?? [s]);

    for (const step of flatActions) {
      await test.step(step.action + (step.selector ? ` "${step.selector}"` : ''), async () => {
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
            await page.keyboard.type(step.text, { delay: step.delay ?? 0 });
            break;

          case 'slowType':
            await typeSlow(ctx().locator(step.selector), step.text, step.delay ?? 100);
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
            await page.keyboard.press(step.key);
            break;

          case 'frameLocator':
            frameStack.push(page.frameLocator(step.selector));
            break;

          case 'exitFrame':
            if (frameStack.length > 1) frameStack.pop();
            break;

          case 'tryClick': {
            try {
              await ctx().locator(step.selector).waitFor({ state: 'visible', timeout: step.timeout ?? 3_000 });
              await ctx().locator(step.selector).click();
            } catch { /* element not present, continue */ }
            break;
          }

          case 'wpInstallPlugin': {
            await page.goto('/wp-admin/plugin-install.php', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(500);
            await page.locator('#search-plugins').fill(step.slug);
            await page.keyboard.press('Enter');
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(800);
            const installBtn = page.locator(`.plugin-card-${step.slug} .install-now`);
            await installBtn.waitFor({ timeout: 15_000 });
            await installBtn.click();
            await page.locator(`.plugin-card-${step.slug} .activate-now`).waitFor({ timeout: 30_000 });
            await page.waitForTimeout(600);
            if (step.activate) {
              await page.locator(`.plugin-card-${step.slug} .activate-now`).click();
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(800);
            }
            break;
          }

          case 'wpSetPostTitle': {
            const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
            await editorFrame.locator('.wp-block-post-title').waitFor({ state: 'visible', timeout: 30_000 });
            await editorFrame.locator('.wp-block-post-title').click();
            await editorFrame.locator('.wp-block-post-title').fill(step.title);
            await page.waitForTimeout(300);
            break;
          }

          case 'wpSetPostContent': {
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
            await targetLocator.fill(step.content);
            await page.waitForTimeout(300);
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
            await page.waitForTimeout(400);
            break;
          }

          case 'wpInsertBlock': {
            const shortName = step.blockType.includes('/')
              ? step.blockType.split('/')[1]
              : step.blockType;
            const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');

            if (step.afterIndex !== undefined && step.afterIndex >= 0) {
              // Insert an empty paragraph at the exact position and use its clientId
              // to click it directly — avoids focus/keyboard state issues entirely.
              const newClientId = await page.evaluate((idx) => {
                const newBlock = wp.blocks.createBlock('core/paragraph');
                wp.data.dispatch('core/block-editor').insertBlock(newBlock, idx + 1);
                return newBlock.clientId;
              }, step.afterIndex);
              await page.waitForTimeout(300);
              const newBlockEl = editorFrame.locator(`[data-block="${newClientId}"]`);
              await newBlockEl.waitFor({ state: 'visible', timeout: 5_000 });
              await newBlockEl.click();
            } else {
              // Insert at the end
              const appender = editorFrame.getByRole('button', { name: 'Add default block' });
              try {
                await appender.waitFor({ state: 'visible', timeout: 3_000 });
                await appender.click();
              } catch {
                // No appender — move cursor to absolute end of last text block, then Enter if it has content
                const lastEditable = editorFrame.locator('[contenteditable="true"]:not(.wp-block-post-title)').last();
                await lastEditable.click();
                const isEmpty = (await lastEditable.textContent()) === '';
                if (!isEmpty) {
                  await lastEditable.evaluate(el => {
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    range.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                  });
                  await page.keyboard.press('Enter');
                }
              }
            }

            // Paragraph is the default block — no slash command needed
            if (shortName !== 'paragraph') {
              await page.keyboard.type(`/${shortName}`, { delay: 50 });
              const displayName = shortName.replace(/-/g, ' ');
              const option = page.getByRole('option', { name: new RegExp(`^${displayName}$`, 'i') });
              await option.waitFor({ state: 'visible', timeout: 5_000 });
              await option.click();
              await page.keyboard.press('Enter');
            }
            await page.waitForTimeout(400);
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
            await editorFrame.locator(`[data-type="${blockType}"]`).nth(index).click();
            await page.waitForTimeout(200);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
            await page.keyboard.press('Backspace');
            await page.waitForTimeout(300);
            break;
          }

          case 'wpSiteEditorSave': {
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForTimeout(500);
            const publishPanel = page.getByRole('region', { name: 'Editor publish' });
            await publishPanel.waitFor({ state: 'visible', timeout: 10_000 });
            await publishPanel.getByRole('button', { name: 'Save', exact: true }).click();
            await page.waitForTimeout(800);
            break;
          }

          case 'wpInsertBlockFromPanel': {
            await page.getByRole('button', { name: 'Block Inserter', exact: true }).click();
            await page.waitForTimeout(400);
            const blockLibrary = page.getByRole('region', { name: 'Block Library' });
            await blockLibrary.waitFor({ state: 'visible', timeout: 10_000 });
            await blockLibrary.getByRole('searchbox', { name: 'Search' }).fill(step.blockType);
            await page.waitForTimeout(400);
            const option = page.getByRole('option', { name: step.blockType, exact: true });
            await option.waitFor({ timeout: 5_000 });
            await option.click();
            await page.waitForTimeout(400);
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
            await page.waitForTimeout(300);
            break;
          }

          default:
            throw new Error(`Unknown action: "${step.action}"`);
        }

        // If the sidebar was open before this action and has since closed, reopen it.
        if (sidebarWasOpen && !(await sidebar.isVisible())) {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await sidebar.waitFor({ state: 'visible', timeout: 5_000 });
        }
      });
    }

    await page.waitForTimeout(def.endPause ?? DEFAULT_END_PAUSE);
  });
}
