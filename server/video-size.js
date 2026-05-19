// @ts-check

const VIDEO_SIZE_PRESETS = Object.freeze([
  Object.freeze({ width: 1280, height: 720 }),
  Object.freeze({ width: 1920, height: 1080 }),
  Object.freeze({ width: 2560, height: 1440 }),
  Object.freeze({ width: 3840, height: 2160 }),
]);

const DEFAULT_VIDEO_SIZE = VIDEO_SIZE_PRESETS[1];
const MAX_SCREENCAST_WIDTH = 1280;
const MIN_VIDEO_SIZE = 320;
const MAX_VIDEO_SIZE = 7680;

function cloneSize(size) {
  return { width: size.width, height: size.height };
}

function sizeKey(size) {
  return `${size.width}x${size.height}`;
}

function parseVideoSize(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  if (value && typeof value === 'object') {
    return { width: Number(value.width), height: Number(value.height) };
  }

  return null;
}

function isValidVideoSize(size) {
  return Number.isInteger(size?.width)
    && Number.isInteger(size?.height)
    && size.width >= MIN_VIDEO_SIZE
    && size.height >= MIN_VIDEO_SIZE
    && size.width <= MAX_VIDEO_SIZE
    && size.height <= MAX_VIDEO_SIZE;
}

function normalizeVideoSize(value, fallback = DEFAULT_VIDEO_SIZE) {
  const parsed = parseVideoSize(value);
  if (!isValidVideoSize(parsed)) {
    return fallback ? cloneSize(fallback) : null;
  }

  const preset = VIDEO_SIZE_PRESETS.find((size) => (
    size.width === parsed.width && size.height === parsed.height
  ));
  return preset ? cloneSize(preset) : cloneSize(parsed);
}

function videoSizeFromEnv() {
  return normalizeVideoSize(process.env.WP_DIRECTOR_VIDEO_SIZE);
}

function screencastSizeForVideoSize(videoSize) {
  const size = normalizeVideoSize(videoSize);
  if (size.width <= MAX_SCREENCAST_WIDTH) return size;

  const ratio = MAX_SCREENCAST_WIDTH / size.width;
  return {
    width: MAX_SCREENCAST_WIDTH,
    height: Math.round(size.height * ratio),
  };
}

module.exports = {
  DEFAULT_VIDEO_SIZE,
  VIDEO_SIZE_PRESETS,
  normalizeVideoSize,
  screencastSizeForVideoSize,
  sizeKey,
  videoSizeFromEnv,
};
