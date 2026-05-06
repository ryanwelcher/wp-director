// @ts-check

const fs = require('fs');
const path = require('path');

function timestamp() {
  return new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Add a timestamp to an output directory name. Playwright test artifacts end in
 * `-chromium`; keep that suffix at the end so existing name cleanup still works.
 *
 * @param {string} dirname
 * @param {string} [stamp]
 * @returns {string}
 */
function timestampedDirname(dirname, stamp = timestamp()) {
  return dirname.endsWith('-chromium')
    ? dirname.replace(/-chromium$/, `-${stamp}-chromium`)
    : `${dirname}-${stamp}`;
}

/**
 * @param {string} targetDir
 * @returns {string}
 */
function uniqueDir(targetDir) {
  if (!fs.existsSync(targetDir)) return targetDir;

  const parent = path.dirname(targetDir);
  const base = path.basename(targetDir);
  let candidate = targetDir;
  let suffix = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(parent, `${base}-${suffix++}`);
  }

  return candidate;
}

module.exports = {
  timestamp,
  timestampedDirname,
  uniqueDir,
};
