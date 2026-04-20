// @ts-check

/**
 * Video post-processing: convert Playwright's `video.webm` to MP4 (H.264 + AAC)
 * and optionally scale to a user-chosen size.
 *
 * Playwright records at the project viewport (1920×1080, see playwright.config.js)
 * and outputs WebM per-test. Most downstream tools (Keynote, Slack, QuickTime,
 * social) prefer MP4, so we always convert. If the user picked a non-1080p size
 * in the UI, we also scale with Lanczos to avoid the blocky output of the
 * default bilinear filter.
 *
 * ffmpeg is shipped via the `ffmpeg-static` npm package — no system install
 * required, which matters for the long-term goal of a distributable app.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { OUTPUT_DIR } = require('./config');

/**
 * @typedef {Object} VideoFile
 * @property {string} file  Absolute path to the video.
 * @property {'mp4'|'webm'} ext
 * @property {string} mime
 */

/**
 * @typedef {Object} VideoSize
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {(event: { type: 'stdout'|'stderr', text: string }) => void} Sender
 */

/**
 * Locate the most-recently-modified output directory that has a `video.webm`.
 * Playwright names dirs like `steps-runner-<test-name>-chromium`; we pick the
 * newest by mtime so the ffmpeg step operates on the test that just finished.
 *
 * @returns {string | null}  Directory name (not full path), or null if none found.
 */
function findNewestVideoDir() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const dirs = fs.readdirSync(OUTPUT_DIR)
    .filter(d => fs.existsSync(path.join(OUTPUT_DIR, d, 'video.webm')))
    .map(d => ({ d, mtime: fs.statSync(path.join(OUTPUT_DIR, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.d ?? null;
}

/**
 * Locate a video file inside an output directory, preferring MP4 over WebM
 * (MP4 only exists after a successful conversion). Returned shape includes
 * MIME + extension so callers can set Content-Type / Content-Disposition
 * without guessing.
 *
 * @param {string} dirname  Directory name inside OUTPUT_DIR.
 * @returns {VideoFile | null}
 */
function findVideoFile(dirname) {
  const mp4 = path.join(OUTPUT_DIR, dirname, 'video.mp4');
  if (fs.existsSync(mp4)) return { file: mp4, ext: 'mp4', mime: 'video/mp4' };
  const webm = path.join(OUTPUT_DIR, dirname, 'video.webm');
  if (fs.existsSync(webm)) return { file: webm, ext: 'webm', mime: 'video/webm' };
  return null;
}

/**
 * Convert the most recently finished WebM to MP4, optionally scaling.
 * No-op if no `video.webm` exists (e.g. test failed before video flushed).
 *
 * Resolves regardless of ffmpeg's exit code — we don't want conversion
 * failures to fail the whole run. On failure we delete the partial MP4 and
 * notify the caller via SSE; the WebM stays in place as a fallback.
 *
 * @param {VideoSize | null} videoSize  Target size; null or 1920×1080 → no scale.
 * @param {Sender} send                 SSE forwarder for ffmpeg output.
 * @returns {Promise<void>}
 */
function processVideo(videoSize, send) {
  return new Promise((resolve) => {
    const dirname = findNewestVideoDir();
    if (!dirname) return resolve();

    const inputPath  = path.join(OUTPUT_DIR, dirname, 'video.webm');
    const outputPath = path.join(OUTPUT_DIR, dirname, 'video.mp4');

    // Skip the scale filter entirely for 1080p (matches Playwright's native size)
    // to avoid a redundant re-encode pass at identical dimensions.
    const needsScale = videoSize && !(videoSize.width === 1920 && videoSize.height === 1080);
    const label = needsScale
      ? `Converting to MP4 and scaling to ${videoSize.width}×${videoSize.height}`
      : 'Converting to MP4';
    send({ type: 'stdout', text: `[ffmpeg] ${label}…\n` });

    const scaleFilter = needsScale
      ? [`-vf`, `scale=${videoSize.width}:${videoSize.height}:flags=lanczos`]
      : [];

    const ff = spawn(ffmpegPath, [
      '-i', inputPath,
      ...scaleFilter,
      // CRF 18 / preset slow = near-visually-lossless at reasonable filesize.
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-y', outputPath,
    ]);

    // ffmpeg writes everything to stderr by design; we tag it as stdout here
    // so the UI log panel doesn't style the progress output as errors.
    ff.stderr.on('data', (d) => send({ type: 'stdout', text: `[ffmpeg] ${d}` }));
    ff.on('close', (code) => {
      if (code === 0) {
        send({ type: 'stdout', text: '[ffmpeg] Done.\n' });
      } else {
        send({ type: 'stderr', text: `[ffmpeg] Conversion failed (exit ${code})\n` });
        try { fs.unlinkSync(outputPath); } catch {}
      }
      resolve();
    });
  });
}

module.exports = { findNewestVideoDir, findVideoFile, processVideo };
