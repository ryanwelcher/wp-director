// @ts-check

/**
 * Video helpers.
 *
 * WebM is the canonical persisted artifact (captured directly by Playwright).
 * MP4 and downscaled WebM are produced on demand by ffmpeg and streamed to
 * the client — never written to disk.
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
 * @property {'webm'} ext
 * @property {string} mime
 */

/**
 * Locate the canonical WebM file inside an output directory. Returned shape
 * includes MIME + extension so callers can set Content-Type / Content-Disposition
 * without guessing.
 *
 * @param {string} dirname  Directory name inside OUTPUT_DIR.
 * @returns {VideoFile | null}
 */
function findVideoFile(dirname) {
  const webm = path.join(OUTPUT_DIR, dirname, 'video.webm');
  if (fs.existsSync(webm)) return { file: webm, ext: 'webm', mime: 'video/webm' };
  return null;
}

/**
 * Probe a video file for its width/height. Uses ffmpeg's stderr banner — we
 * don't ship ffprobe-static. Result is cached by absolute path + mtime so
 * repeated calls from `/api/recordings` are cheap.
 *
 * @param {string} filePath
 * @returns {Promise<{ width: number, height: number } | null>}
 */
const probeCache = new Map();
function probeVideoSize(filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return Promise.resolve(null); }
  const cacheKey = `${filePath}:${stat.mtimeMs}`;
  const cached = probeCache.get(cacheKey);
  if (cached) return cached;

  const promise = new Promise((resolve) => {
    const ff = spawn(ffmpegPath, ['-hide_banner', '-i', filePath]);
    let buf = '';
    ff.stderr.on('data', (d) => { buf += d.toString(); });
    ff.on('close', () => {
      // Match "Stream #0:0: Video: ... 1920x1080" — the first WxH near the
      // Video line. We avoid matching SAR/DAR ratios by anchoring on commas.
      const match = buf.match(/Video:[^\n]*?(\b\d{2,5})x(\d{2,5})\b/);
      if (!match) return resolve(null);
      resolve({ width: Number(match[1]), height: Number(match[2]) });
    });
    ff.on('error', () => resolve(null));
  });
  probeCache.set(cacheKey, promise);
  return promise;
}

/**
 * Spawn ffmpeg to transcode WebM → MP4 (H.264 + AAC), piping to a writable
 * stream. Optionally scales to a target size. The child is returned so the
 * caller can wire its exit to the response lifecycle.
 *
 * @param {string} inputPath
 * @param {{ width: number, height: number } | null} targetSize
 * @returns {import('child_process').ChildProcessWithoutNullStreams}
 */
function spawnMp4Transcode(inputPath, targetSize) {
  const scaleArgs = targetSize
    ? ['-vf', `scale=${targetSize.width}:${targetSize.height}:flags=lanczos`]
    : [];
  return spawn(ffmpegPath, [
    '-i', inputPath,
    ...scaleArgs,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k',
    // Required so MP4 atoms are streamable (moov before mdat).
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ]);
}

/**
 * Spawn ffmpeg to downscale a WebM to a smaller resolution, piping to stdout
 * in WebM container.
 *
 * @param {string} inputPath
 * @param {{ width: number, height: number }} targetSize
 */
function spawnWebmDownscale(inputPath, targetSize) {
  return spawn(ffmpegPath, [
    '-i', inputPath,
    '-vf', `scale=${targetSize.width}:${targetSize.height}:flags=lanczos`,
    '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0',
    '-c:a', 'libopus',
    '-f', 'webm',
    'pipe:1',
  ]);
}

module.exports = { findVideoFile, probeVideoSize, spawnMp4Transcode, spawnWebmDownscale };
