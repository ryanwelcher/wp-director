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
