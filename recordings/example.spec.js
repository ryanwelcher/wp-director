// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Example recording: walks through playwright.dev
 * Replace the steps below with your own site and interactions.
 */
test('record site walkthrough', async ({ page }) => {
  // Step 1: Navigate to the site
  await test.step('Navigate to homepage', async () => {
    await page.goto('https://playwright.dev');
    await expect(page).toHaveTitle(/Playwright/);
  });

  // Step 2: Interact with the page
  await test.step('Click Get Started', async () => {
    await page.getByRole('link', { name: 'Get started' }).first().click();
    await page.waitForLoadState('networkidle');
  });

  // Step 3: Take an explicit screenshot at this point
  await test.step('Screenshot the docs page', async () => {
    await page.screenshot({ path: 'output/docs-page.png', fullPage: true });
  });

  // Step 4: Search for something
  await test.step('Open search', async () => {
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByPlaceholder('Search docs').fill('video');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'output/search-results.png' });
  });
});
