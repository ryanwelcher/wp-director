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

let nextDirectionId = 1;

export function withDirectionId(direction) {
  return direction?._id ? direction : { ...direction, _id: `direction-${nextDirectionId++}` };
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
  return directions.map(({ _id, _open, _fromDirection, alwaysRun, ...rest }) => rest);
}

export function directionsForRun(directions, alwaysRunIndices) {
  return directionsForJSON(directions).map((direction, index) => (
    alwaysRunIndices.has(index) ? { ...direction, alwaysRun: true } : direction
  ));
}

export function flattenDirectionActions(actions = []) {
  return actions.flatMap((item) => (
    item?.label != null && Array.isArray(item.actions) ? item.actions : [item]
  ));
}

export function videoSizeFromValue(value) {
  const [width, height] = String(value || '1920x1080').split('x').map(Number);
  return { width, height };
}

export function endPauseMs(value) {
  const seconds = parseFloat(value);
  return Number.isNaN(seconds) || seconds < 0 ? 2000 : Math.round(seconds * 1000);
}

export function errorMessage(err, fallback = 'Something went wrong') {
  return err instanceof Error ? err.message : fallback;
}
