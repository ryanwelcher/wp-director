import browserSizePresets from '../../shared/browser-size-presets.json';

export const WP_SCREENS = {
  dashboard: 'Dashboard',
  posts: 'Posts',
  'new-post': 'new post editor',
  pages: 'Pages',
  'new-page': 'new page editor',
  media: 'Media Library',
  comments: 'Comments',
  plugins: 'Plugins',
  'add-plugin': 'Add New Plugin',
  themes: 'Themes',
  appearance: 'Appearance',
  widgets: 'Widgets',
  menus: 'Menus',
  'site-editor': 'Site Editor',
  customizer: 'Customizer',
  settings: 'Settings',
  users: 'Users',
  profile: 'Profile',
};

export const BROWSER_SIZE_PRESETS = browserSizePresets.map(({ label, width, height }) => ({
  label,
  value: `${width}x${height}`,
}));

export const DEFAULT_VIDEO_SIZE_VALUE = '1920x1080';

const MIN_VIDEO_SIZE = 320;
const MAX_VIDEO_SIZE = 7680;

let nextDirectionId = 1;

export function withDirectionId(direction) {
  return direction?._id ? direction : { ...direction, _id: `direction-${nextDirectionId++}` };
}

export function isDirectionResolved(direction) {
  const status = direction?._translation?.status;
  return status == null || status === 'resolved';
}

export function describePlain(step = {}) {
  switch (step.action) {
    case 'navigate': return `Go to ${step.url}`;
    case 'click': return `Click "${step.selector}"`;
    case 'fill': return `Type "${step.value}" into "${step.selector}"`;
    case 'type': return `Type "${step.text}" into "${step.selector}"`;
    case 'wait': return `Wait ${step.ms}ms`;
    case 'waitForSelector': return `Wait for "${step.selector}" to appear`;
    case 'screenshot': return `Take a screenshot${step.path != null ? ` (${step.path})` : ''}`;
    case 'scroll': return `Scroll to (${step.x ?? 0}, ${step.y ?? 0})`;
    case 'hover': return `Hover over "${step.selector}"`;
    case 'press': return `Press the ${step.key} key`;
    case 'frameLocator': return `Switch into frame "${step.selector}"`;
    case 'exitFrame': return 'Return to the main page';
    case 'wpNavigate': return `Go to ${WP_SCREENS[step.screen] ?? step.screen}`;
    case 'wpInstallPlugin': return `Install the ${step.slug} plugin${step.activate ? ' and activate it' : ''}`;
    case 'wpSelectBlock': return `Select the ${step.blockType} block`;
    case 'wpInsertBlock': return `Insert a ${step.blockType} block`;
    case 'wpDeleteBlock': return `Delete the ${step.blockType} block`;
    case 'wpCommandPalette': return step.command != null ? `Run command "${step.command}"` : 'Open the command palette';
    case 'wpSetPostTitle': return `Set the post title to "${step.title}"`;
    case 'wpSetBlockContent': return `Set ${step.blockType ? `${step.blockType} block` : 'block'} content to "${step.content}"`;
    default: return step.action ?? 'Unknown action';
  }
}

export function normalizeDirections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => withDirectionId(
    item?.label != null
      ? { ...item, actions: Array.isArray(item.actions) ? item.actions : [] }
      : { label: describePlain(item), actions: [item] }
  ));
}

export function directionsForJSON(directions) {
  return directions
    .filter(isDirectionResolved)
    .map(({ _id, _open, _fromIntent, _translation, _placeholders, _freeForm, alwaysRun, ...rest }) => rest);
}

export function directionsForRun(directions, alwaysRunIndices) {
  return directions.flatMap((direction, index) => {
    if (!isDirectionResolved(direction)) return [];

    const { _id, _open, _fromIntent, _translation, _placeholders, _freeForm, alwaysRun, ...cleanDirection } = direction;
    return [
      alwaysRunIndices.has(index)
        ? { ...cleanDirection, alwaysRun: true }
        : cleanDirection,
    ];
  });
}

export function flattenDirectionActions(actions = []) {
  return actions.flatMap((item) => (
    item?.label != null && Array.isArray(item.actions) ? item.actions : [item]
  ));
}

function parseSizeValue(value) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{2,5})x(\d{2,5})$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  if (value && typeof value === 'object') {
    return { width: Number(value.width), height: Number(value.height) };
  }

  return null;
}

function isValidSize(size) {
  return Number.isInteger(size?.width)
    && Number.isInteger(size?.height)
    && size.width >= MIN_VIDEO_SIZE
    && size.height >= MIN_VIDEO_SIZE
    && size.width <= MAX_VIDEO_SIZE
    && size.height <= MAX_VIDEO_SIZE;
}

export function isValidVideoSizeValue(value) {
  return isValidSize(parseSizeValue(value));
}

export function videoSizeFromValue(value) {
  const size = parseSizeValue(value);
  if (isValidSize(size)) return size;
  return videoSizeFromValue(DEFAULT_VIDEO_SIZE_VALUE);
}

export function videoSizeValueFromSize(value) {
  const size = parseSizeValue(value);
  if (isValidSize(size)) return `${size.width}x${size.height}`;
  return DEFAULT_VIDEO_SIZE_VALUE;
}

export function endPauseMs(value) {
  const seconds = parseFloat(value);
  return Number.isNaN(seconds) || seconds < 0 ? 2000 : Math.round(seconds * 1000);
}

export function errorMessage(err, fallback = 'Something went wrong') {
  return err instanceof Error ? err.message : fallback;
}
