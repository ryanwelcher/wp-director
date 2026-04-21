// @ts-check
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const HIGHLIGHT_HOLD = 1000;

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

    // Support both grouped format ({ label, actions[] }) and legacy flat/steps format
    const rawActions = def.actions ?? def.steps ?? [];
    const flatActions = rawActions.flatMap(s => s.actions ?? s.steps ?? [s]);

    let stepIndex = 0;
    for (const step of flatActions) {
      console.log(`STEP_START:${stepIndex}`);
      await test.step(step.action + (step.selector ? ` "${step.selector}"` : ''), async () => {
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

          case 'wpNavigate': {
            const screens = {
              'dashboard':            '/wp-admin/',
              'posts':                '/wp-admin/edit.php',
              'new-post':             '/wp-admin/post-new.php',
              'pages':                '/wp-admin/edit.php?post_type=page',
              'new-page':             '/wp-admin/post-new.php?post_type=page',
              'media':                '/wp-admin/upload.php',
              'comments':             '/wp-admin/edit-comments.php',
              'plugins':              '/wp-admin/plugins.php',
              'add-plugin':           '/wp-admin/plugin-install.php',
              'themes':               '/wp-admin/themes.php',
              'appearance':           '/wp-admin/themes.php',
              'widgets':              '/wp-admin/widgets.php',
              'menus':                '/wp-admin/nav-menus.php',
              'site-editor':          '/wp-admin/site-editor.php',
              'site-editor-templates':'/wp-admin/site-editor.php?path=/wp_template',
              'site-editor-patterns': '/wp-admin/site-editor.php?path=/patterns',
              'site-editor-pages':    '/wp-admin/site-editor.php?path=/page',
              'site-editor-styles':   '/wp-admin/site-editor.php?path=/wp_global_styles',
              'customizer':           '/wp-admin/customize.php',
              'settings':             '/wp-admin/options-general.php',
              'users':                '/wp-admin/users.php',
              'profile':              '/wp-admin/profile.php',
            };
            const url = screens[step.screen] ?? `/wp-admin/${step.screen}`;
            await page.goto(url, { waitUntil: step.waitUntil ?? 'domcontentloaded' });
            await page.waitForTimeout(500);
            if (step.screen === 'new-post' || step.screen === 'new-page') {
              const dialog = page.locator('.components-modal__screen-overlay');
              try {
                await dialog.waitFor({ state: 'visible', timeout: 5_000 });
                await page.locator('.components-modal__header button[aria-label="Close"]').click();
                await dialog.waitFor({ state: 'hidden', timeout: 3_000 });
              } catch {
                // no dialog appeared, continue
              }
            }
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
            const titleLocator = editorFrame.locator('.wp-block-post-title');
            await titleLocator.waitFor({ state: 'visible', timeout: 30_000 });
            await titleLocator.click();
            await titleLocator.pressSequentially(step.title, { delay: step.delay ?? 100 });
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
            await targetLocator.click();
            await page.keyboard.press('Control+a');
            await targetLocator.pressSequentially(step.content, { delay: step.delay ?? 100 });
            await page.waitForTimeout(300);
            break;
          }

          case 'wpSelectBlock': {
            const blockType = step.blockType.includes('/') ? step.blockType : `core/${step.blockType}`;
            const index = step.index ?? 0;
            const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
            const block = editorFrame.locator(`[data-type="${blockType}"]`).nth(index);
            await block.waitFor({ state: 'visible', timeout: 10_000 });
            const editable = block.locator('[contenteditable="true"]');
            await editable.click();
            await editorFrame.locator('.is-selected [contenteditable="true"]').waitFor({ state: 'visible', timeout: 5_000 });
            await page.waitForTimeout(100);
            break;
          }

          case 'wpCommandPalette': {
            await page.keyboard.press('Meta+k');
            await page.waitForTimeout(500);
            if (step.command) {
              await page.keyboard.type(step.command, { delay: 40 });
              await page.waitForTimeout(600);
              await page.keyboard.press('Enter');
              await page.waitForTimeout(500);
            }
            break;
          }

          case 'wpInsertBlock': {
            const shortName = step.blockType.includes('/')
              ? step.blockType.split('/')[1]
              : step.blockType;
            const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
            const appender = editorFrame.getByRole('button', { name: 'Add default block' });
            await appender.waitFor({ state: 'visible', timeout: 10_000 });
            await appender.click();
            await page.keyboard.type(`/${shortName}`, { delay: 50 });
            const option = page.getByRole('option', { name: new RegExp(shortName, 'i') });
            await option.waitFor({ state: 'visible', timeout: 5_000 });
            await option.click();
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

          case 'wpOpenBlockInserter': {
            await page.getByRole('button', { name: 'Block Inserter', exact: true }).click();
            await page.waitForTimeout(400);
            break;
          }

          case 'wpInsertBlockFromPanel': {
            const inserterBtn = page.getByRole('button', { name: 'Block Inserter', exact: true });
            await highlightAndClick(page, inserterBtn);
            await page.waitForTimeout(400);
            const blockLibrary = page.getByRole('region', { name: 'Block Library' });
            await blockLibrary.waitFor({ state: 'visible', timeout: 10_000 });
            const searchBox = blockLibrary.getByRole('searchbox', { name: 'Search' });
            await searchBox.click();
            await searchBox.pressSequentially(step.blockType, { delay: step.delay ?? 100 });
            await page.waitForTimeout(400);
            const option = page.getByRole('option', { name: step.blockType, exact: true });
            await option.waitFor({ timeout: 5_000 });
            await highlightAndClick(page, option);
            await page.waitForTimeout(400);
            break;
          }

          case 'wpAdminMenuClick': {
            const menuItem = page.locator('#adminmenu a').filter({ hasText: step.item });
            await menuItem.first().click();
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(500);
            break;
          }

          case 'wpBlockToolbar': {
            const toolbar = page.getByRole('toolbar', { name: 'Block tools' });
            await toolbar.getByRole('button', { name: step.button }).click();
            await page.waitForTimeout(300);
            break;
          }

          case 'wpToggleInspector': {
            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            await page.waitForTimeout(400);
            break;
          }

          case 'wpInspectorTab': {
            await page.getByRole('tab', { name: step.tab }).click();
            await page.waitForTimeout(300);
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

          case 'wpOpenListView': {
            await page.getByRole('button', { name: 'Document Overview' }).click();
            await page.waitForTimeout(400);
            break;
          }

          default:
            throw new Error(`Unknown action: "${step.action}"`);
        }
      });
      stepIndex++;
    }
  });
}
