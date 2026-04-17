// @ts-check
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const stepsDir = path.join(__dirname, '..', 'steps');

const stepFiles = fs.existsSync(stepsDir)
  ? fs.readdirSync(stepsDir).filter((f) => f.endsWith('.json'))
  : [];

for (const file of stepFiles) {
  const def = JSON.parse(fs.readFileSync(path.join(stepsDir, file), 'utf8'));

  test(def.name, async ({ page }) => {
    // Frame context stack: top of stack is the active locator context
    const frameStack = [page];
    const ctx = () => frameStack[frameStack.length - 1];

    for (const step of def.steps) {
      await test.step(step.action + (step.selector ? ` "${step.selector}"` : ''), async () => {
        switch (step.action) {
          case 'navigate':
            await page.goto(step.url, { waitUntil: step.waitUntil ?? 'load' });
            break;

          case 'click':
            await ctx().locator(step.selector).click();
            break;

          case 'fill':
            await ctx().locator(step.selector).fill(step.value);
            break;

          case 'type':
            await ctx().locator(step.selector).click();
            await page.keyboard.type(step.text, { delay: step.delay ?? 0 });
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
              'dashboard':   '/wp-admin/',
              'posts':       '/wp-admin/edit.php',
              'new-post':    '/wp-admin/post-new.php',
              'pages':       '/wp-admin/edit.php?post_type=page',
              'new-page':    '/wp-admin/post-new.php?post_type=page',
              'media':       '/wp-admin/upload.php',
              'comments':    '/wp-admin/edit-comments.php',
              'plugins':     '/wp-admin/plugins.php',
              'add-plugin':  '/wp-admin/plugin-install.php',
              'themes':      '/wp-admin/themes.php',
              'appearance':  '/wp-admin/themes.php',
              'widgets':     '/wp-admin/widgets.php',
              'menus':       '/wp-admin/nav-menus.php',
              'site-editor': '/wp-admin/site-editor.php',
              'customizer':  '/wp-admin/customize.php',
              'settings':    '/wp-admin/options-general.php',
              'users':       '/wp-admin/users.php',
              'profile':     '/wp-admin/profile.php',
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
            // Click the contenteditable directly to enter text editing mode (not just block selection mode)
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
            const lastBlock = editorFrame.locator('[data-block]').last();
            await lastBlock.click();
            await page.keyboard.press('End');
            await page.keyboard.press('Enter');
            await page.waitForTimeout(400);
            await page.keyboard.type(`/${shortName}`, { delay: 50 });
            await page.waitForTimeout(1000);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(600);
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

          default:
            throw new Error(`Unknown action: "${step.action}"`);
        }
      });
    }
  });
}
