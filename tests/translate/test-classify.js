#!/usr/bin/env node
// @ts-check

/**
 * Classification regression suite.
 *
 * Reads `classification-goldens.json` next to this script and asserts each
 * entry classifies to the expected intent id(s) and key slot values. Runs
 * against the live Anthropic API — no caching — so re-running costs real
 * tokens and ~30 s of wall time.
 *
 * Only slots listed in `expected` are checked. Extra slots the model adds
 * are ignored, which keeps the suite focused on what we actually care about
 * (id + the slot extractions that matter for downstream expansion) rather
 * than over-specifying.
 *
 * Usage:
 *   node tests/translate/test-classify.js
 *   node tests/translate/test-classify.js --only "install plugin"
 *
 * Exits 0 on success, 1 on any failure.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { classify } = require('../../server/intents/classify');

const GOLDENS_PATH = path.join(__dirname, 'classification-goldens.json');

function parseArgs(argv) {
  const args = { only: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--only') {
      args.only = argv[++i] || null;
    } else if (token.startsWith('--only=')) {
      args.only = token.slice('--only='.length);
    }
  }
  return args;
}

function loadGoldens() {
  const raw = fs.readFileSync(GOLDENS_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Compare what the classifier returned against the expected entry. Returns
 * an array of failure messages — empty means pass.
 *
 * @param {{ intents: Array<{ id: string, slots: Record<string, unknown> }>, unmatched?: string }} actual
 * @param {Array<{ id: string, slots?: Record<string, unknown> }>} expected
 * @returns {string[]}
 */
function diff(actual, expected) {
  const failures = [];
  const actualIntents = actual.intents || [];

  if (expected.length === 0) {
    // We expect the unmatched fallback; reject anything the model emitted.
    if (actualIntents.length > 0) {
      failures.push(`expected unmatched; got ${actualIntents.length} intent(s): ${actualIntents.map((i) => i.id).join(', ')}`);
    }
    return failures;
  }

  if (actualIntents.length !== expected.length) {
    failures.push(`expected ${expected.length} intent(s), got ${actualIntents.length}: ${actualIntents.map((i) => i.id).join(', ') || '(none)'}`);
    return failures;
  }

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const got = actualIntents[i];
    if (got.id !== exp.id) {
      failures.push(`intent[${i}]: expected id "${exp.id}", got "${got.id}"`);
      continue;
    }
    const expSlots = exp.slots || {};
    for (const [slot, value] of Object.entries(expSlots)) {
      const gotValue = got.slots?.[slot];
      if (!slotMatches(gotValue, value)) {
        failures.push(`intent[${i}] "${got.id}": slot "${slot}" expected ${JSON.stringify(value)}, got ${JSON.stringify(gotValue)}`);
      }
    }
  }
  return failures;
}

function slotMatches(actual, expected) {
  if (typeof expected === 'string' && typeof actual === 'string') {
    // Slug-style comparisons (plugin/theme slugs, color names) are forgiving
    // about case and whitespace — the expander normalizes downstream.
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return actual === expected;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set; cannot run live classification.');
    process.exit(1);
  }

  const { only } = parseArgs(process.argv.slice(2));
  const goldens = loadGoldens();
  const filtered = only
    ? goldens.filter((g) => g.name.includes(only) || g.command.includes(only))
    : goldens;

  if (filtered.length === 0) {
    console.error(only ? `No goldens matched --only "${only}"` : 'No goldens found');
    process.exit(1);
  }

  console.log(`Running ${filtered.length} classification golden(s)...\n`);

  let passed = 0;
  /** @type {Array<{ name: string, failures: string[] }>} */
  const failed = [];

  for (const golden of filtered) {
    const startedAt = Date.now();
    let actual;
    try {
      actual = await classify(golden.command);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ name: golden.name, failures: [`classify() threw: ${message}`] });
      console.log(`  FAIL  ${golden.name} (threw)`);
      continue;
    }
    const failures = diff(actual, golden.expected);
    const elapsed = `${Math.round((Date.now() - startedAt) / 100) / 10}s`;
    if (failures.length === 0) {
      passed += 1;
      console.log(`  PASS  ${golden.name} (${elapsed})`);
    } else {
      failed.push({ name: golden.name, failures });
      console.log(`  FAIL  ${golden.name} (${elapsed})`);
    }
  }

  console.log(`\n${passed}/${filtered.length} passed`);

  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const { name, failures } of failed) {
      console.log(`  ${name}`);
      for (const f of failures) console.log(`    - ${f}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
