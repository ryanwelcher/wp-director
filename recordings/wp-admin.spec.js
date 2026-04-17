// @ts-check
const { test, expect } = require('@playwright/test');

test('WordPress admin dashboard walkthrough', async ({ page }) => {

  await test.step('Open the dashboard', async () => {
    await page.goto('/wp-admin/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/Dashboard/);
    await page.waitForTimeout(800);
  });

  await test.step('Explore the admin menu', async () => {
    await page.locator('#menu-posts').hover();
    await page.waitForTimeout(600);

    await page.locator('#menu-appearance').hover();
    await page.waitForTimeout(600);

    await page.locator('#menu-plugins a').first().click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/Plugins/);
    await page.waitForTimeout(800);
  });

  await test.step('View the plugin list', async () => {
    await page.locator('tr[data-slug="hello-dolly"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
  });

  await test.step('Navigate to create a new post', async () => {
    await page.goto('/wp-admin/post-new.php', { waitUntil: 'domcontentloaded' });
    // Dismiss the "Welcome to the editor" modal — it blocks the title field
    const welcomeModal = page.locator('.edit-post-welcome-guide');
    await welcomeModal.waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForTimeout(800);
  });

  await test.step('Enter a post title', async () => {
    // Since WP 6.x, the editor canvas renders inside an iframe
    const editorFrame = page.frameLocator('iframe[name="editor-canvas"]');
    const titleField = editorFrame.locator('.wp-block-post-title');
    await titleField.click();
    await page.keyboard.type('My First Playground Post', { delay: 60 });
    await page.waitForTimeout(600);
  });

  await test.step('Add content to the post', async () => {
    // Press Enter from the title to create a new paragraph block, then type
    await page.keyboard.press('Enter');
    await page.keyboard.type('This post was created by Playwright recording a WordPress Playground site.', { delay: 40 });
    await page.waitForTimeout(600);
  });

  await test.step('Save the post as draft', async () => {
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.waitForTimeout(1000);
    await page.locator('.editor-post-saved-state').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(600);
  });

  await test.step('View all posts', async () => {
    await page.goto('/wp-admin/edit.php');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/Posts/);
    await expect(page.locator('a.row-title', { hasText: 'My First Playground Post' })).toBeVisible();
    await page.waitForTimeout(800);
  });
});
