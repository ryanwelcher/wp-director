// @ts-check
const { test, expect } = require('@playwright/test');

test('WordPress frontend walkthrough', async ({ page }) => {

  await test.step('Visit the homepage', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/My Playground Site/);
    await page.waitForTimeout(800);
  });

  await test.step('Scroll through the homepage', async () => {
    await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(600);
  });

  await test.step('Navigate to the About Us page', async () => {
    const aboutLink = page.getByRole('link', { name: 'About Us' });
    const hasLink = await aboutLink.count();

    if (hasLink > 0) {
      await aboutLink.first().click();
    } else {
      await page.goto('/?page_id=2');
    }

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
  });

  await test.step('Scroll through the About Us page', async () => {
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(600);
  });

  await test.step('Navigate back to the homepage', async () => {
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(/My Playground Site/);
    await page.waitForTimeout(800);
  });

  await test.step('Take an explicit screenshot of the homepage', async () => {
    await page.screenshot({ path: 'output/wp-homepage.png', fullPage: true });
  });
});
