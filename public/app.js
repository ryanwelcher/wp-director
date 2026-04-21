// @ts-check

// ── Steps elements ────────────────────────────────────────────────────────────
const commandInput = document.getElementById('command-input');
const addBtn = document.getElementById('add-btn');
const stepList = document.getElementById('step-list');
const stepCount = document.getElementById('step-count');
/** @type {HTMLTextAreaElement} */
const jsonPreview = /** @type {any} */ (document.getElementById('json-preview'));
const jsonError = document.getElementById('json-error');
const emptyHint = document.getElementById('empty-hint');
const clearBtn = document.getElementById('clear-btn');
const nameInput = document.getElementById('name-input');
const recordBtn = document.getElementById('record-btn');
const previewBtn = document.getElementById('preview-btn');
const stopBtn = document.getElementById('stop-btn');
const statusEl = document.getElementById('status');

// ── Blueprint elements ────────────────────────────────────────────────────────
const blueprintTestBtn = document.getElementById('blueprint-test-btn');
const blueprintResetBtn = document.getElementById('blueprint-reset-btn');
/** @type {HTMLTextAreaElement} */
const blueprintPreview = /** @type {any} */ (document.getElementById('blueprint-preview'));
const blueprintError = document.getElementById('blueprint-error');
const blueprintBadge = document.getElementById('blueprint-badge');

// ── Log elements ──────────────────────────────────────────────────────────────
/** @type {HTMLDetailsElement} */
const logPanel = /** @type {any} */ (document.getElementById('log-panel'));
const logOutput = document.getElementById('log-output');
const logBadge = document.getElementById('log-badge');

// ── Preview elements ──────────────────────────────────────────────────────────
const previewPanel       = document.getElementById('preview-panel');
const previewImg         = document.getElementById('preview-img');
const previewPlaceholder = document.getElementById('preview-placeholder');
previewImg.addEventListener('error', () => { previewImg.src = ''; });


// ── Steps view toggle elements ────────────────────────────────────────────────
const directionsViewToggle = document.getElementById('directions-view-toggle');
const directionsJsonView = document.getElementById('directions-json-view');

// ── Saved Scripts elements ────────────────────────────────────────────────────
const saveBtn = document.getElementById('save-btn');
const exportTxtBtn = document.getElementById('export-txt-btn');
const savedScriptsList = document.getElementById('saved-scripts-list');
const savedCountBadge = document.getElementById('saved-count-badge');
const selectAllCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('select-all-scripts'));
const selectedCountEl = document.getElementById('selected-count');
const recordAllBtn = document.getElementById('record-all-btn');

// ── Directions elements ───────────────────────────────────────────────────────
const directionsList = document.getElementById('directions-list');
const directionsCountBadge = document.getElementById('directions-count-badge');
const directionInsertBottom = document.getElementById('direction-insert-bottom');

// ── Video size ────────────────────────────────────────────────────────────────
const sizeOpts = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.size-opt'));

sizeOpts.forEach((btn) => {
  btn.addEventListener('click', () => {
    sizeOpts.forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
    });
  });
});

function getVideoSize() {
  const active = /** @type {HTMLButtonElement} */ (document.querySelector('.size-opt.active'));
  const [w, h] = (active?.dataset.size ?? '1920x1080').split('x').map(Number);
  return { width: w, height: h };
}

// ── Recordings elements ───────────────────────────────────────────────────────
const recordingsList = document.getElementById('recordings-list');
const recordingsCountBadge = document.getElementById('recordings-count-badge');

// ── Right sidebar ─────────────────────────────────────────────────────────────
const rightSidebar = document.getElementById('right-sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const mainContent = document.querySelector('.main-content');

function positionSidebar() {
  const headerHeight = document.querySelector('header').offsetHeight;
  rightSidebar.style.top = headerHeight + 'px';
  rightSidebar.style.height = `calc(100vh - ${headerHeight}px)`;
}

positionSidebar();

sidebarToggle.addEventListener('click', () => {
  const isOpen = rightSidebar.classList.toggle('open');
  mainContent.classList.toggle('sidebar-open', isOpen);
  sidebarToggle.setAttribute('aria-expanded', String(isOpen));
});

// ── Preview screencast ────────────────────────────────────────────────────────
/** @type {EventSource|null} */
let screencastSource = null;

function startScreencast() {
  if (screencastSource) return;
  previewPlaceholder.textContent = 'Connecting to browser…';
  previewPanel.classList.add('polling');

  screencastSource = new EventSource('/api/screencast');
  screencastSource.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'frame') {
      previewImg.src = `data:image/jpeg;base64,${msg.data}`;
      previewPlaceholder.hidden = true;
      previewImg.hidden = false;
    }
  };
  screencastSource.onerror = () => {};
}

function stopScreencast() {
  if (screencastSource) { screencastSource.close(); screencastSource = null; }
  previewPanel.classList.remove('polling');
  previewPlaceholder.textContent = 'No preview yet.';
  previewPlaceholder.hidden = false;
  previewImg.hidden = true;
  previewImg.src = '';
}

// ── State ─────────────────────────────────────────────────────────────────────
/** @type {Array<object>} */
let directions = [];
/** @type {object|null} */
let blueprint = null;
/** @type {object|null} */
let defaultBlueprint = null;
let updatingDirectionsFromCode = false;
let updatingBlueprintFromCode = false;
/** @type {string[]} */
let selectedScripts = [];
/** @type {Array<{name: string, filename: string, stepCount: number}>} */
let savedScripts = [];
/** @type {Array<{name: string, filename: string, actionCount: number, builtin: boolean}>} */
let libraryEntries = [];
/** @type {Record<number, string>} Maps direction group index → accumulated stderr for that step */
let stepErrors = {};
/** Flat action index of the most recently started step during a run */
let currentFlatStep = -1;
/** @type {Record<number, Array<object>>} Maps direction group index → pending AI suggestion */
let pendingSuggestions = {};

// ── Step error helpers ────────────────────────────────────────────────────────
function flatIndexToGroupIndex(flatIdx) {
  let count = 0;
  for (let i = 0; i < directions.length; i++) {
    count += (directions[i].actions ?? []).length;
    if (flatIdx < count) return i;
  }
  return -1;
}

// ── Step descriptions ─────────────────────────────────────────────────────────
const WP_SCREENS = {
  dashboard: 'Dashboard', posts: 'Posts', 'new-post': 'new post editor',
  pages: 'Pages', 'new-page': 'new page editor', media: 'Media Library',
  comments: 'Comments', plugins: 'Plugins', 'add-plugin': 'Add New Plugin',
  themes: 'Themes', appearance: 'Appearance', widgets: 'Widgets',
  menus: 'Menus', 'site-editor': 'Site Editor', customizer: 'Customizer',
  settings: 'Settings', users: 'Users', profile: 'Profile',
};

function ea(val) {
  return String(val ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function describePlain(step) {
  switch (step.action) {
    case 'navigate':        return `Go to ${step.url}`;
    case 'click':           return `Click "${step.selector}"`;
    case 'fill':            return `Type "${step.value}" into "${step.selector}"`;
    case 'type':            return `Type "${step.text}" into "${step.selector}"`;
    case 'wait':            return `Wait ${step.ms}ms`;
    case 'waitForSelector': return `Wait for "${step.selector}" to appear`;
    case 'screenshot':      return `Take a screenshot${step.path != null ? ` (${step.path})` : ''}`;
    case 'scroll':          return `Scroll to (${step.x ?? 0}, ${step.y ?? 0})`;
    case 'hover':           return `Hover over "${step.selector}"`;
    case 'press':           return `Press the ${step.key} key`;
    case 'frameLocator':    return `Switch into frame "${step.selector}"`;
    case 'exitFrame':       return 'Return to the main page';
    case 'wpNavigate':      return `Go to ${WP_SCREENS[step.screen] ?? step.screen}`;
    case 'wpInstallPlugin': return `Install the ${step.slug} plugin${step.activate ? ' and activate it' : ''}`;
    case 'wpSelectBlock':   return `Select the ${step.blockType} block`;
    case 'wpInsertBlock':   return `Insert a ${step.blockType} block`;
    case 'wpDeleteBlock':   return `Delete the ${step.blockType} block`;
    case 'wpCommandPalette':return step.command != null ? `Run command "${step.command}"` : 'Open the command palette';
    case 'wpSetPostTitle':  return `Set the post title to "${step.title}"`;
    case 'wpSetPostContent':return `Set ${step.blockType ? step.blockType + ' block' : 'block'} content to "${step.content}"`;
    default:                return step.action;
  }
}

/** Ensure loaded directions are in grouped format { label, actions[] }. */
function normalizeActions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(s => s.label != null ? s : { label: describePlain(s), actions: [s] });
}

// ── Direction picker ──────────────────────────────────────────────────────────
/** @type {HTMLElement|null} */
let activePicker = null;

function closeDirectionPicker() {
  if (activePicker) { activePicker.remove(); activePicker = null; }
}

function showDirectionPicker(actionIndex, anchorEl) {
  closeDirectionPicker();
  if (!libraryEntries.length) return;

  // actionIndex === null means append to end (no above/below toggle needed)
  const hasPosition = actionIndex !== null;
  let insertAbove = false; // default: below

  const picker = document.createElement('div');
  picker.className = 'direction-picker';

  function buildPicker() {
    picker.innerHTML = `
      ${hasPosition ? `
        <div class="direction-picker-position">
          <button class="direction-picker-pos-btn${!insertAbove ? ' active' : ''}" data-pos="below">&#8595; Below</button>
          <button class="direction-picker-pos-btn${insertAbove ? ' active' : ''}" data-pos="above">&#8593; Above</button>
        </div>
        <div class="direction-picker-divider"></div>
      ` : ''}
      ${libraryEntries.map(e =>
        `<button class="direction-picker-item${e.builtin ? ' direction-picker-item--builtin' : ''}" data-filename="${e.filename}">${e.name}</button>`
      ).join('')}
    `;

    if (hasPosition) {
      picker.querySelectorAll('.direction-picker-pos-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          insertAbove = /** @type {HTMLElement} */(btn).dataset.pos === 'above';
          buildPicker();
        });
      });
    }

    picker.querySelectorAll('.direction-picker-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = actionIndex === null
          ? directions.length
          : (insertAbove ? actionIndex : actionIndex + 1);
        insertDirection(/** @type {HTMLElement} */(btn).dataset.filename, idx);
        closeDirectionPicker();
      });
    });
  }

  buildPicker();
  document.body.appendChild(picker);

  const rect = anchorEl.getBoundingClientRect();
  const pickerW = 220;
  let left = rect.left + window.scrollX;
  if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
  picker.style.top = `${rect.bottom + window.scrollY + 4}px`;
  picker.style.left = `${left}px`;

  activePicker = picker;
  setTimeout(() => document.addEventListener('click', closeDirectionPicker, { once: true }), 0);
}

// ── Render ────────────────────────────────────────────────────────────────────
let draggingIndex = null;

function renderDirectionList() {
  stepList.innerHTML = '';
  emptyHint.style.display = directions.length ? 'none' : '';
  recordBtn.disabled = directions.length === 0;
  previewBtn.disabled = directions.length === 0;
  saveBtn.disabled = directions.length === 0;
  exportTxtBtn.disabled = directions.length === 0;
  stepCount.textContent = `(${directions.length})`;

  directions.forEach((group, i) => {
    const isOpen = !!group._open;
    const innerActions = group.actions ?? [];
    const hasError = !!stepErrors[i];
    const hasSuggestion = !!pendingSuggestions[i];

    const li = document.createElement('li');
    li.className = 'direction-group' + (hasError ? ' has-error' : '');
    li.draggable = true;

    const innerHTML = isOpen && innerActions.length > 0
      ? `<ul class="direction-inner-list">${innerActions.map(s => `<li class="direction-inner-item">${ea(describePlain(s))}</li>`).join('')}</ul>`
      : '';

    const errorBadge = hasError
      ? `<span class="step-error-badge" title="${ea(stepErrors[i])}">&#9888; Error</span>
         <button class="direction-refine" data-group="${i}">Refine with AI</button>`
      : '';

    const errorPanel = hasError
      ? `<div class="error-panel"><pre class="error-text">${ea(stepErrors[i])}</pre></div>`
      : '';

    const suggestionPanel = hasSuggestion
      ? `<div class="refine-suggestion">
           <div class="refine-suggestion-label">AI suggestion: <strong>${ea(pendingSuggestions[i].label)}</strong></div>
           <ul class="refine-suggestion-actions">${(pendingSuggestions[i].actions ?? []).map(s => `<li>${ea(describePlain(s))}</li>`).join('')}</ul>
           <div class="refine-suggestion-buttons">
             <button class="direction-accept-suggestion primary">Accept</button>
             <button class="direction-discard-suggestion secondary">Discard</button>
           </div>
         </div>`
      : '';

    li.innerHTML = `
      <div class="direction-group-header">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="index">${i + 1}</span>
        <input class="direction-label-input" data-group="${i}" value="${ea(group.label)}" title="Edit label">
        <button class="direction-toggle" aria-expanded="${isOpen}" title="${isOpen ? 'Collapse' : 'Expand'} Playwright steps">${isOpen ? '▼' : '▶'}</button>
        <button class="direction-insert" title="Insert direction">+</button>
        ${!group._fromDirection ? '<button class="direction-save" title="Save as direction">&#128204;</button>' : ''}
        <button class="direction-delete" title="Delete step">✕</button>
        ${errorBadge}
      </div>
      ${innerHTML}
      ${errorPanel}
      ${suggestionPanel}
    `;

    li.querySelector('.direction-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      directions[i]._open = !directions[i]._open;
      renderDirectionList();
    });

    li.querySelector('.direction-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      directions.splice(i, 1);
      renderDirections();
    });

    li.querySelector('.direction-insert').addEventListener('click', (e) => {
      e.stopPropagation();
      showDirectionPicker(i, /** @type {HTMLElement} */(e.currentTarget));
    });

    li.querySelector('.direction-save')?.addEventListener('click', (e) => {
      e.stopPropagation();
      saveDirection(i);
    });

    li.querySelector('.direction-label-input').addEventListener('change', (e) => {
      directions[i].label = /** @type {HTMLInputElement} */(e.target).value;
      renderJSON();
    });

    li.querySelector('.direction-refine')?.addEventListener('click', (e) => {
      e.stopPropagation();
      refineStep(i);
    });

    li.querySelector('.direction-accept-suggestion')?.addEventListener('click', (e) => {
      e.stopPropagation();
      acceptSuggestion(i);
    });

    li.querySelector('.direction-discard-suggestion')?.addEventListener('click', (e) => {
      e.stopPropagation();
      discardSuggestion(i);
    });

    li.addEventListener('dragstart', (e) => {
      if (/** @type {HTMLElement} */(e.target).tagName === 'INPUT') { e.preventDefault(); return; }
      draggingIndex = i;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
      draggingIndex = null;
      stepList.querySelectorAll('li').forEach(el => el.classList.remove('dragging', 'drag-over'));
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggingIndex === null || draggingIndex === i) return;
      stepList.querySelectorAll('li').forEach(el => el.classList.remove('drag-over'));
      li.classList.add('drag-over');
    });

    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggingIndex === null || draggingIndex === i) return;
      const moved = directions.splice(draggingIndex, 1)[0];
      directions.splice(i, 0, moved);
      renderDirections();
    });

    stepList.appendChild(li);
  });

  // Bottom insert button — appends to end, no above/below needed
  directionInsertBottom.innerHTML = '<button class="direction-insert-plus direction-insert-plus--bottom" title="Insert direction">+ Insert direction</button>';
  directionInsertBottom.querySelector('.direction-insert-plus').addEventListener('click', (e) => {
    e.stopPropagation();
    showDirectionPicker(null, /** @type {HTMLElement} */(e.currentTarget));
  });
}

function directionsForJSON() {
  // eslint-disable-next-line no-unused-vars
  return directions.map(({ _open, _fromDirection, ...rest }) => rest);
}

function renderJSON() {
  updatingDirectionsFromCode = true;
  jsonPreview.value = JSON.stringify(directionsForJSON(), null, 2);
  updatingDirectionsFromCode = false;
  jsonPreview.classList.remove('invalid');
  jsonError.classList.add('hidden');
}

function renderDirections() {
  renderDirectionList();
  renderJSON();
  directionsJsonView.textContent = JSON.stringify(directionsForJSON(), null, 2);
  const hasSteps = directions.length > 0;
  directionsViewToggle.hidden = !hasSteps;
  if (!hasSteps) {
    stepList.style.display = '';
    directionsJsonView.style.display = 'none';
    directionsViewToggle.textContent = 'Show JSON';
  }
}

// ── Steps view toggle ─────────────────────────────────────────────────────────
directionsViewToggle.addEventListener('click', () => {
  const listVisible = stepList.style.display !== 'none';
  stepList.style.display = listVisible ? 'none' : '';
  directionsJsonView.style.display = listVisible ? 'block' : 'none';
  directionsViewToggle.textContent = listVisible ? 'Show Actions' : 'Show JSON';
});

function renderBlueprint() {
  updatingBlueprintFromCode = true;
  blueprintPreview.value = blueprint ? JSON.stringify(blueprint, null, 2) : '';
  updatingBlueprintFromCode = false;
  blueprintPreview.classList.remove('invalid');
  blueprintError.classList.add('hidden');
  const isModified = defaultBlueprint && JSON.stringify(blueprint) !== JSON.stringify(defaultBlueprint);
  blueprintBadge.classList.toggle('hidden', !isModified);
}

// ── Status helpers ────────────────────────────────────────────────────────────
function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
  el.classList.remove('hidden');
  if (!isError) setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── JSON edit handlers ────────────────────────────────────────────────────────
function onDirectionsEdit() {
  if (updatingDirectionsFromCode) return;
  try {
    const parsed = JSON.parse(jsonPreview.value);
    if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
    directions = normalizeActions(parsed);
    renderDirectionList();
    jsonPreview.classList.remove('invalid');
    jsonError.classList.add('hidden');
  } catch (err) {
    jsonPreview.classList.add('invalid');
    jsonError.textContent = err.message;
    jsonError.classList.remove('hidden');
  }
}

function onBlueprintEdit() {
  if (updatingBlueprintFromCode) return;
  const val = blueprintPreview.value.trim();
  if (!val) {
    blueprint = defaultBlueprint;
    blueprintPreview.classList.remove('invalid');
    blueprintError.classList.add('hidden');
    blueprintBadge.classList.add('hidden');
    return;
  }
  try {
    blueprint = JSON.parse(val);
    blueprintPreview.classList.remove('invalid');
    blueprintError.classList.add('hidden');
    const isModified = defaultBlueprint && JSON.stringify(blueprint) !== JSON.stringify(defaultBlueprint);
    blueprintBadge.classList.toggle('hidden', !isModified);
  } catch (err) {
    blueprintPreview.classList.add('invalid');
    blueprintError.textContent = err.message;
    blueprintError.classList.remove('hidden');
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────
async function addCommand() {
  const command = commandInput.value.trim();
  if (!command) return;

  addBtn.disabled = true;
  commandInput.disabled = true;
  setStatus(statusEl, 'Translating…');

  try {
    const flatHistory = directions.flatMap(g => g.actions ?? []);
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, history: flatHistory }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Translation failed');
    directions.push(...data.directions);
    renderDirections();
    commandInput.value = '';
    setStatus(statusEl, `Added ${data.directions.length} direction${data.directions.length !== 1 ? 's' : ''}`);
  } catch (err) {
    setStatus(statusEl, err.message, true);
  } finally {
    addBtn.disabled = false;
    commandInput.disabled = false;
    commandInput.focus();
  }
}

function resetBlueprint() {
  blueprint = defaultBlueprint;
  renderBlueprint();
}

async function testBlueprint() {
  if (!blueprint) return;
  blueprintTestBtn.disabled = true;
  blueprintTestBtn.textContent = 'Starting…';

  try {
    const res = await fetch('/api/preview-blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprint }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start preview');
    window.open(data.url, '_blank');
  } catch (err) {
    blueprintError.textContent = err.message;
    blueprintError.classList.remove('hidden');
    setTimeout(() => blueprintError.classList.add('hidden'), 5000);
  } finally {
    blueprintTestBtn.disabled = false;
    blueprintTestBtn.innerHTML = '&#9654; Test in Playground';
  }
}

function setRunning(running) {
  recordBtn.hidden = running;
  previewBtn.hidden = running;
  stopBtn.hidden = !running;
}

async function streamRun(fetchPromise, { onDone }) {
  logOutput.textContent = '';
  logPanel.open = true;
  logBadge.textContent = 'recording';
  logBadge.classList.remove('hidden');
  setRunning(true);
  startScreencast();

  // Reset per-run error state
  stepErrors = {};
  pendingSuggestions = {};
  currentFlatStep = -1;
  renderDirectionList();

  const res = await fetchPromise;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Accumulate all output since the last STEP_START marker — attributed to
  // currentFlatStep when the run exits with a non-zero code.
  let stepOutputBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop();

    for (const event of events) {
      const line = event.replace(/^data: /, '').trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'stdout' || msg.type === 'stderr') {
          logOutput.textContent += msg.text;
          logOutput.scrollTop = logOutput.scrollHeight;

          // Track which flat step is executing; reset buffer on each new step
          const stepMarker = msg.text.match(/STEP_START:(\d+)/);
          if (stepMarker) {
            currentFlatStep = parseInt(stepMarker[1], 10);
            stepOutputBuffer = '';
          } else {
            stepOutputBuffer += msg.text;
          }
        } else if (msg.type === 'done') {
          stopScreencast();
          setRunning(false);
          if (msg.stopped) {
            logOutput.textContent += '\n--- Stopped ---\n';
            logBadge.textContent = 'stopped';
            logBadge.className = 'badge badge-fail';
          } else {
            logOutput.textContent += `\n--- Done (exit ${msg.code}) ---\n`;
            logBadge.textContent = msg.code === 0 ? 'complete' : 'failed';
            logBadge.className = 'badge' + (msg.code === 0 ? ' badge-pass' : ' badge-fail');
            // On failure, associate buffered output with the step that was running
            if (msg.code !== 0 && currentFlatStep >= 0 && stepOutputBuffer.trim()) {
              const groupIdx = flatIndexToGroupIndex(currentFlatStep);
              if (groupIdx >= 0) stepErrors[groupIdx] = stepOutputBuffer;
            }
          }
          if (Object.keys(stepErrors).length > 0) renderDirectionList();
          onDone(msg);
        }
      } catch {}
    }
  }
}

async function runActions() {
  const name = nameInput.value.trim() || `recording-${Date.now()}`;
  await streamRun(
    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, actions: directionsForJSON(), blueprint, videoSize: getVideoSize() }),
    }),
    { onDone: (msg) => { if (!msg.stopped) loadRecordings(); } }
  );
}

async function runPreview() {
  const name = nameInput.value.trim() || `preview-${Date.now()}`;
  await streamRun(
    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, actions: directionsForJSON(), blueprint, videoSize: null, preview: true }),
    }),
    { onDone: () => {} }
  );
}

// ── Saved Scripts ─────────────────────────────────────────────────────────────
function renderBatchControls() {
  selectedCountEl.textContent = `${selectedScripts.length} selected`;
  recordAllBtn.disabled = selectedScripts.length === 0;
  const total = savedScripts.length;
  selectAllCheckbox.checked = total > 0 && selectedScripts.length === total;
  selectAllCheckbox.indeterminate = selectedScripts.length > 0 && selectedScripts.length < total;
}

function renderSavedScripts(recordings) {
  savedScripts = recordings;
  selectedScripts = selectedScripts.filter(n => recordings.some(s => s.name === n));

  savedCountBadge.textContent = recordings.length.toString();
  savedCountBadge.classList.toggle('hidden', recordings.length === 0);

  if (!recordings.length) {
    savedScriptsList.innerHTML = '<p class="hint">No scripts saved yet.</p>';
    renderBatchControls();
    return;
  }

  savedScriptsList.innerHTML = '';
  for (const recording of recordings) {
    const div = document.createElement('div');
    div.className = 'saved-script-item';
    div.innerHTML = `
      <input type="checkbox" class="script-checkbox" data-name="${recording.name}"${selectedScripts.includes(recording.name) ? ' checked' : ''}>
      <span class="script-name">${recording.name}</span>
      <span class="script-meta">${recording.directionCount} direction${recording.directionCount !== 1 ? 's' : ''}</span>
      <button class="script-load-btn secondary" data-name="${recording.name}">Load</button>
      <button class="script-delete-btn danger" data-name="${recording.name}" data-filename="${recording.filename}">Delete</button>
    `;
    savedScriptsList.appendChild(div);
  }

  savedScriptsList.querySelectorAll('.script-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const name = /** @type {HTMLInputElement} */ (cb).dataset.name;
      if (/** @type {HTMLInputElement} */ (cb).checked) {
        if (!selectedScripts.includes(name)) selectedScripts.push(name);
      } else {
        selectedScripts = selectedScripts.filter(n => n !== name);
      }
      renderBatchControls();
    });
  });

  savedScriptsList.querySelectorAll('.script-load-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = /** @type {HTMLElement} */ (btn).dataset.name;
      const recording = savedScripts.find(s => s.name === name);
      if (!recording) return;
      directions = normalizeActions(recording.directions ?? recording.actions ?? recording.steps ?? []);
      nameInput.value = recording.name;
      renderDirections();
      setStatus(statusEl, `Loaded "${name}"`);
    });
  });

  savedScriptsList.querySelectorAll('.script-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const filename = /** @type {HTMLElement} */ (btn).dataset.filename;
      const name = /** @type {HTMLElement} */ (btn).dataset.name;
      try {
        const res = await fetch(`/api/scripts/${filename}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        selectedScripts = selectedScripts.filter(n => n !== name);
        await loadSavedScripts();
      } catch (err) {
        setStatus(statusEl, err.message, true);
      }
    });
  });

  renderBatchControls();
}

async function loadSavedScripts() {
  try {
    const res = await fetch('/api/scripts');
    const data = await res.json();
    renderSavedScripts(data.scripts ?? []);
  } catch {}
}

// ── Directions ────────────────────────────────────────────────────────────────
function renderDirectionLibrary(entries) {
  libraryEntries = entries;

  directionsCountBadge.textContent = entries.length.toString();
  directionsCountBadge.classList.toggle('hidden', entries.length === 0);

  if (!entries.length) {
    directionsList.innerHTML = '<p class="hint">No directions yet.</p>';
    return;
  }

  directionsList.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = `direction-item${entry.builtin ? ' direction-item--builtin' : ''}`;
    div.innerHTML = `
      <span class="direction-name">${entry.name}</span>
      <span class="direction-meta">${entry.directionCount} step${entry.directionCount !== 1 ? 's' : ''}</span>
      ${entry.builtin ? '<span class="direction-builtin-badge" title="Built-in direction">&#128274;</span>' : `<button class="direction-delete-btn danger" data-filename="${entry.filename}" data-name="${entry.name}">Delete</button>`}
    `;
    directionsList.appendChild(div);
  }

  directionsList.querySelectorAll('.direction-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const filename = /** @type {HTMLElement} */ (btn).dataset.filename;
      const name = /** @type {HTMLElement} */ (btn).dataset.name;
      try {
        const res = await fetch(`/api/directions/${filename}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        setStatus(statusEl, `Deleted direction "${name}"`);
        await loadDirectionLibrary();
      } catch (err) {
        setStatus(statusEl, err.message, true);
      }
    });
  });
}

async function loadDirectionLibrary() {
  try {
    const res = await fetch('/api/directions');
    const data = await res.json();
    renderDirectionLibrary(data.directions ?? []);
  } catch {}
}

async function insertDirection(filename, insertIndex) {
  try {
    const res = await fetch(`/api/directions/${filename}`);
    if (!res.ok) throw new Error('Could not load direction');
    const data = await res.json();
    const flatSteps = (data.actions ?? []).flatMap(g =>
      g.label != null && Array.isArray(g.actions) ? g.actions : [g]
    );
    const idx = insertIndex != null ? insertIndex : directions.length;
    directions.splice(idx, 0, { label: data.name, actions: flatSteps, _fromDirection: true });
    renderDirections();
    setStatus(statusEl, `Inserted "${data.name}"`);
  } catch (err) {
    setStatus(statusEl, err.message, true);
  }
}

async function saveDirection(groupIndex) {
  const group = groupIndex != null ? [directions[groupIndex]] : directions;
  if (!group.length) return;
  const name = groupIndex != null ? directions[groupIndex].label : (nameInput.value.trim() || `direction-${Date.now()}`);
  if (!name) return;
  try {
    const res = await fetch('/api/directions/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, actions: group }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    setStatus(statusEl, `Saved direction "${name}"`);
    await loadDirectionLibrary();
  } catch (err) {
    setStatus(statusEl, err.message, true);
  }
}

// ── Recordings ────────────────────────────────────────────────────────────────
function renderRecordings(recordings) {
  recordingsCountBadge.textContent = recordings.length.toString();
  recordingsCountBadge.classList.toggle('hidden', recordings.length === 0);

  if (!recordings.length) {
    recordingsList.innerHTML = '<p class="hint">No recordings yet — run a script to generate a video.</p>';
    return;
  }

  recordingsList.innerHTML = '';
  for (const rec of recordings) {
    const div = document.createElement('div');
    div.className = 'recording-item';
    const mb = (rec.size / (1024 * 1024)).toFixed(1);
    div.innerHTML = `
      <span class="recording-item-name">${rec.name}</span>
      <span class="recording-item-meta">${mb} MB</span>
      <button class="recording-preview-btn secondary" data-dirname="${rec.dirname}">Preview</button>
      <a class="recording-download-btn secondary" href="/api/recordings/${rec.dirname}/video" download="${rec.slug ?? rec.dirname}.${rec.ext ?? 'mp4'}">Download</a>
    `;
    const previewBtn = div.querySelector('.recording-preview-btn');
    previewBtn.addEventListener('click', () => {
      const existing = div.querySelector('.recording-video-wrapper');
      if (existing) { existing.remove(); previewBtn.textContent = 'Preview'; return; }
      const wrapper = document.createElement('div');
      wrapper.className = 'recording-video-wrapper';
      wrapper.innerHTML = `<video controls src="/api/recordings/${rec.dirname}/video" preload="metadata"></video>`;
      div.appendChild(wrapper);
      previewBtn.textContent = 'Hide';
    });
    recordingsList.appendChild(div);
  }
}

async function loadRecordings() {
  try {
    const res = await fetch('/api/recordings');
    const data = await res.json();
    renderRecordings(data.recordings ?? []);
  } catch {}
}

async function saveScript() {
  const name = nameInput.value.trim() || `recording-${Date.now()}`;
  saveBtn.disabled = true;
  try {
    const res = await fetch('/api/scripts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, directions: directionsForJSON() }),
    });
    if (!res.ok) throw new Error('Save failed');
    setStatus(statusEl, `Saved "${name}"`);
    await loadSavedScripts();
  } catch (err) {
    setStatus(statusEl, err.message, true);
  } finally {
    saveBtn.disabled = directions.length === 0;
    exportTxtBtn.disabled = directions.length === 0;
  }
}

async function recordAll() {
  logOutput.textContent = '';
  logPanel.open = true;
  logBadge.textContent = 'recording';
  logBadge.classList.remove('hidden');
  recordAllBtn.disabled = true;
  setRunning(true);
  startScreencast();

  const res = await fetch('/api/run/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: selectedScripts, blueprint, videoSize: getVideoSize() }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop();

    for (const event of events) {
      const line = event.replace(/^data: /, '').trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'stdout' || msg.type === 'stderr') {
          logOutput.textContent += msg.text;
          logOutput.scrollTop = logOutput.scrollHeight;
        } else if (msg.type === 'done') {
          stopScreencast();
          setRunning(false);
          logOutput.textContent += msg.stopped ? '\n--- Stopped ---\n' : `\n--- Done (exit ${msg.code}) ---\n`;
          logBadge.textContent = msg.stopped ? 'stopped' : (msg.code === 0 ? 'complete' : 'failed');
          logBadge.className = 'badge' + (msg.stopped || msg.code !== 0 ? ' badge-fail' : ' badge-pass');
          logBadge.classList.remove('hidden');
          recordAllBtn.disabled = selectedScripts.length === 0;
          if (!msg.stopped) loadRecordings();
        }
      } catch {}
    }
  }
}

function exportTxt() {
  const name = nameInput.value.trim() || 'recording';
  const lines = directions.map((g, i) => `${i + 1}. ${g.label}`);
  const text = `${name}\n${'─'.repeat(name.length)}\n\n${lines.join('\n')}\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `${name}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── AI step refinement ────────────────────────────────────────────────────────
async function refineStep(groupIdx) {
  const group = directions[groupIdx];
  const errorText = stepErrors[groupIdx];
  if (!group || !errorText) return;

  const history = directions.flatMap(g => g.actions ?? []);
  let refineBtn = stepList.querySelector(`.direction-refine[data-group="${groupIdx}"]`);
  if (refineBtn) { refineBtn.disabled = true; refineBtn.textContent = 'Asking Claude…'; }

  try {
    const res = await fetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: group.actions, error: errorText, history }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Refinement failed');
    const suggestion = data.directions?.[0];
    if (!suggestion) throw new Error('No suggestion returned');
    pendingSuggestions[groupIdx] = suggestion;
    renderDirectionList();
  } catch (err) {
    setStatus(statusEl, err.message, true);
    if (refineBtn) { refineBtn.disabled = false; refineBtn.textContent = 'Refine with AI'; }
  }
}

function acceptSuggestion(groupIdx) {
  if (!pendingSuggestions[groupIdx]) return;
  directions[groupIdx] = { ...pendingSuggestions[groupIdx], _open: directions[groupIdx]._open };
  delete stepErrors[groupIdx];
  delete pendingSuggestions[groupIdx];
  renderDirections();
}

function discardSuggestion(groupIdx) {
  delete pendingSuggestions[groupIdx];
  renderDirectionList();
}

// ── Event listeners ───────────────────────────────────────────────────────────
addBtn.addEventListener('click', addCommand);
commandInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCommand(); });
clearBtn.addEventListener('click', () => { directions = []; nameInput.value = ''; renderDirections(); });
recordBtn.addEventListener('click', runActions);
previewBtn.addEventListener('click', runPreview);
stopBtn.addEventListener('click', () => fetch('/api/stop', { method: 'POST' }));

jsonPreview.addEventListener('input', onDirectionsEdit);

blueprintTestBtn.addEventListener('click', testBlueprint);
blueprintResetBtn.addEventListener('click', resetBlueprint);
blueprintPreview.addEventListener('input', onBlueprintEdit);

saveBtn.addEventListener('click', saveScript);
exportTxtBtn.addEventListener('click', exportTxt);
recordAllBtn.addEventListener('click', recordAll);
selectAllCheckbox.addEventListener('change', () => {
  const checkboxes = /** @type {NodeListOf<HTMLInputElement>} */ (savedScriptsList.querySelectorAll('.script-checkbox'));
  selectedScripts = selectAllCheckbox.checked ? savedScripts.map(s => s.name) : [];
  checkboxes.forEach(cb => { cb.checked = selectAllCheckbox.checked; });
  renderBatchControls();
});

renderDirections();
Promise.all([
  fetch('/api/default-blueprint').then((r) => r.json()),
  fetch('/api/current-blueprint').then((r) => r.ok ? r.json() : null).catch(() => null),
]).then(([{ blueprint: def }, currentRes]) => {
  defaultBlueprint = def;
  blueprint = currentRes?.blueprint ?? def;
  renderBlueprint();
});
loadSavedScripts();
loadDirectionLibrary();
loadRecordings();
