// @ts-check
/**
 * Dynamic test suite for WP Director recordings.
 *
 * At collection time this file reads every `*.json` from `scripts/` and
 * registers one Playwright `test()` per file, keyed by `def.name`. Supports
 * the current `directions` key plus legacy `actions`:
 *
 *  - Current: `{ name, directions: [{ label, actions[] }, ...], blueprint, recordingSettings }`
 *  - Legacy:  `{ name, actions: [ actionObj, ... ] }`
 *
 * Older root settings are intentionally ignored by `run-steps.js`; missing
 * `recordingSettings` values use current defaults.
 *
 * Step execution is handled by `run-steps.js`.
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { runSteps } = require('./run-steps');

const stepsDir = path.join(__dirname, '..', 'scripts');

const stepFiles = fs.existsSync(stepsDir)
  ? fs.readdirSync(stepsDir).filter((f) => f.endsWith('.json'))
  : [];

for (const file of stepFiles) {
  const def = JSON.parse(fs.readFileSync(path.join(stepsDir, file), 'utf8'));

  test(def.name, async ({ page }) => {
    await runSteps(page, def, async ( step, exec ) => await test.step( step.action + ( step.selector ? ` "${ step.selector }"` : '' ), exec ));
  });
}
