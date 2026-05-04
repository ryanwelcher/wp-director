// @ts-check

/**
 * Playwright owns and clears its configured outputDir on each `playwright test`
 * run. Keep that disposable directory separate from WP Director's durable
 * recordings directory, then copy completed recording artifacts into durable
 * locations during global teardown.
 */

const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, PLAYWRIGHT_OUTPUT_DIR } = require('./config');
const { timestampedDirname, uniqueDir } = require('./output-paths');

/** @param {string} dir */
function findVideoDirs(dir) {
  if (!fs.existsSync(dir)) return [];

  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (!entry.isDirectory()) continue;

    if (fs.existsSync(path.join(entryPath, 'video.webm'))) {
      found.push(entryPath);
      continue;
    }

    found.push(...findVideoDirs(entryPath));
  }

  return found;
}

/**
 * @param {{ sourceDir?: string, outputDir?: string, log?: (message: string) => void }} [options]
 * @returns {number} Number of recording directories promoted.
 */
function promotePlaywrightRecordings(options = {}) {
  const sourceDir = options.sourceDir ?? PLAYWRIGHT_OUTPUT_DIR;
  const outputDir = options.outputDir ?? OUTPUT_DIR;
  const log = options.log ?? console.log;
  const videoDirs = findVideoDirs(sourceDir);

  if (!videoDirs.length) return 0;
  fs.mkdirSync(outputDir, { recursive: true });

  for (const videoDir of videoDirs) {
    const dirname = timestampedDirname(path.basename(videoDir));
    const target = uniqueDir(path.join(outputDir, dirname));
    fs.cpSync(videoDir, target, { recursive: true });
    log(`[recordings] Preserved ${path.relative(outputDir, target)}`);
  }

  return videoDirs.length;
}

module.exports = {
  promotePlaywrightRecordings,
};
