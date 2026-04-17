// @ts-check
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const stepsDir = path.join(__dirname, '..', 'steps');
const PREVIEW_PATH = path.join(__dirname, '..', 'public', 'preview.png');

const stepFiles = fs.existsSync(stepsDir)
  ? fs.readdirSync(stepsDir).filter((f) => f.endsWith('.json'))
  : [];

for (const file of stepFiles) {
  const def = JSON.parse(fs.readFileSync(path.join(stepsDir, file), 'utf8'));

  test(def.name, async ({ page }) => {
    // Frame context stack: top of stack is the active locator context
    const frameStack = [page];
    const ctx = () => frameStack[frameStack.length - 1];

    async function capturePreview() {
      try { await page.screenshot({ path: PREVIEW_PATH }); } catch {}
    }

    for (const step of def.steps) {
      await test.step(step.action + (step.selector ? ` "${step.selector}"` : ''), async () => {
        switch (step.action) {
          case 'navigate':
            await page.goto(step.url, { waitUntil: step.waitUntil ?? 'load' });
            await capturePreview();
            break;

          case 'click':
            await ctx().locator(step.selector).click();
            await capturePreview();
            break;

          case 'fill':
            await ctx().locator(step.selector).fill(step.value);
            await capturePreview();
            break;

          case 'type':
            await ctx().locator(step.selector).click();
            await page.keyboard.type(step.text, { delay: step.delay ?? 0 });
            await capturePreview();
            break;

          case 'wait':
            await page.waitForTimeout(step.ms);
            await capturePreview();
            break;

          case 'waitForSelector':
            await ctx().locator(step.selector).waitFor({ state: 'visible', timeout: step.timeout ?? 30_000 });
            await capturePreview();
            break;

          case 'screenshot': {
            const screenshotPath = step.path ?? `output/${def.name}-${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath });
            await capturePreview();
            break;
          }

          case 'scroll':
            await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x: step.x ?? 0, y: step.y ?? 0 });
            await capturePreview();
            break;

          case 'hover':
            await ctx().locator(step.selector).hover();
            await capturePreview();
            break;

          case 'press':
            await page.keyboard.press(step.key);
            await capturePreview();
            break;

          case 'frameLocator':
            frameStack.push(page.frameLocator(step.selector));
            await capturePreview();
            break;

          case 'exitFrame':
            if (frameStack.length > 1) frameStack.pop();
            await capturePreview();
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
            await capturePreview();
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
            await capturePreview();
            break;
          }

          case 'wpSetPostTitle': {
            const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
            await editorFrame.locator('.wp-block-post-title').waitFor({ state: 'visible', timeout: 30_000 });
            await editorFrame.locator('.wp-block-post-title').click();
            await editorFrame.locator('.wp-block-post-title').fill(step.title);
            await page.waitForTimeout(300);
            await capturePreview();
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
            await capturePreview();
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
            await capturePreview();
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
            await capturePreview();
            break;
          }

          case 'wpInsertBlock': {
            const shortName = step.blockType.includes('/')
              ? step.blockType.split('/')[1]
              : step.blockType;
            const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
            const contentBlocks = editorFrame.locator('[data-block]:not([data-type="core/post-title"])');
            const blockCount = await contentBlocks.count();
            if (blockCount === 0) {
              // No content blocks — press Enter from the title to land in the content area
              await editorFrame.locator('[data-type="core/post-title"]').click();
              await page.keyboard.press('End');
              await page.keyboard.press('Enter');
              await page.waitForTimeout(400);
            } else {
              const lastBlock = contentBlocks.last();
              const lastText = (await lastBlock.textContent().catch(() => 'x')).trim();
              if (lastText !== '') {
                // Block has content — append a new empty block after it
                await lastBlock.click();
                await page.waitForTimeout(200);
                await page.keyboard.press('End');
                await page.keyboard.press('Enter');
                await page.waitForTimeout(400);
              } else {
                // Empty block — focus its contenteditable directly so page.keyboard works
                const editable = lastBlock.locator('[contenteditable="true"]');
                await editable.evaluate(el => el.focus());
                await page.waitForTimeout(200);
              }
            }
            await page.keyboard.type(`/${shortName}`, { delay: 50 });
            await page.waitForTimeout(1000);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(600);
            await capturePreview();
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
            await capturePreview();
            break;
          }

          default:
            throw new Error(`Unknown action: "${step.action}"`);
        }
      });
    }
  });
}
