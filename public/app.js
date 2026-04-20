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
const stepsViewToggle = document.getElementById('steps-view-toggle');
const stepsJsonView = document.getElementById('steps-json-view');

// ── Saved Scripts elements ────────────────────────────────────────────────────
const saveBtn = document.getElementById('save-btn');
const savedScriptsList = document.getElementById('saved-scripts-list');
const savedCountBadge = document.getElementById('saved-count-badge');
const selectAllCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('select-all-scripts'));
const selectedCountEl = document.getElementById('selected-count');
const recordAllBtn = document.getElementById('record-all-btn');

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
let steps = [];
/** @type {object|null} */
let blueprint = null;
/** @type {object|null} */
let defaultBlueprint = null;
let updatingStepsFromCode = false;
let updatingBlueprintFromCode = false;
/** @type {string[]} */
let selectedScripts = [];
/** @type {Array<{name: string, filename: string, stepCount: number}>} */
let savedScripts = [];

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

function fi(idx, fieldName, val, type = 'text') {
  const cls = type === 'number' ? 'step-field step-field--num' : 'step-field';
  return `<input class="${cls}" data-index="${idx}" data-field="${fieldName}" type="${type}" value="${ea(val)}">`;
}

function describeHTML(step, i) {
  switch (step.action) {
    case 'navigate':        return `Go to ${fi(i, 'url', step.url)}`;
    case 'click':           return `Click "${fi(i, 'selector', step.selector)}"`;
    case 'fill':            return `Type ${fi(i, 'value', step.value)} into "${fi(i, 'selector', step.selector)}"`;
    case 'type':            return `Type ${fi(i, 'text', step.text)} into "${fi(i, 'selector', step.selector)}"`;
    case 'wait':            return `Wait ${fi(i, 'ms', step.ms, 'number')}ms`;
    case 'waitForSelector': return `Wait for "${fi(i, 'selector', step.selector)}" to appear`;
    case 'screenshot':      return `Take a screenshot${step.path != null ? ` (${fi(i, 'path', step.path)})` : ''}`;
    case 'scroll':          return `Scroll to (${fi(i, 'x', step.x ?? 0, 'number')}, ${fi(i, 'y', step.y ?? 0, 'number')})`;
    case 'hover':           return `Hover over "${fi(i, 'selector', step.selector)}"`;
    case 'press':           return `Press the ${fi(i, 'key', step.key)} key`;
    case 'frameLocator':    return `Switch into frame "${fi(i, 'selector', step.selector)}"`;
    case 'exitFrame':       return 'Return to the main page';
    case 'wpNavigate':      return `Go to ${WP_SCREENS[step.screen] ?? step.screen}`;
    case 'wpInstallPlugin': return `Install the ${fi(i, 'slug', step.slug)} plugin${step.activate ? ' and activate it' : ''}`;
    case 'wpSelectBlock':   return `Select the ${step.blockType} block`;
    case 'wpInsertBlock':   return `Insert a ${step.blockType} block`;
    case 'wpDeleteBlock':   return `Delete the ${step.blockType} block`;
    case 'wpCommandPalette':return step.command != null ? `Run command ${fi(i, 'command', step.command)}` : 'Open the command palette';
    case 'wpSetPostTitle':  return `Set the post title to ${fi(i, 'title', step.title)}`;
    case 'wpSetPostContent':return `Set ${step.blockType ? step.blockType + ' block' : 'block'} content to ${fi(i, 'content', step.content)}`;
    default:                return step.action;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
let draggingIndex = null;

function renderStepList() {
  stepList.innerHTML = '';
  emptyHint.style.display = steps.length ? 'none' : '';
  recordBtn.disabled = steps.length === 0;
  previewBtn.disabled = steps.length === 0;
  saveBtn.disabled = steps.length === 0;
  stepCount.textContent = `(${steps.length})`;

  steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.innerHTML = `
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <span class="index">${i + 1}</span>
      <span class="label">${describeHTML(step, i)}</span>
      <span class="action-tag">${step.action}</span>
    `;

    li.querySelectorAll('.step-field').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = parseInt(/** @type {HTMLInputElement} */(input).dataset.index);
        const field = /** @type {HTMLInputElement} */(input).dataset.field;
        const raw = /** @type {HTMLInputElement} */(input).value;
        steps[idx][field] = /** @type {HTMLInputElement} */(input).type === 'number' ? Number(raw) : raw;
        renderJSON();
      });
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
      const moved = steps.splice(draggingIndex, 1)[0];
      steps.splice(i, 0, moved);
      renderSteps();
    });

    stepList.appendChild(li);
  });
}

function renderJSON() {
  updatingStepsFromCode = true;
  jsonPreview.value = JSON.stringify(steps, null, 2);
  updatingStepsFromCode = false;
  jsonPreview.classList.remove('invalid');
  jsonError.classList.add('hidden');
}

function renderSteps() {
  renderStepList();
  renderJSON();
  stepsJsonView.textContent = JSON.stringify(steps, null, 2);
  const hasSteps = steps.length > 0;
  stepsViewToggle.hidden = !hasSteps;
  if (!hasSteps) {
    stepList.style.display = '';
    stepsJsonView.style.display = 'none';
    stepsViewToggle.textContent = 'Show JSON';
  }
}

// ── Steps view toggle ─────────────────────────────────────────────────────────
stepsViewToggle.addEventListener('click', () => {
  const listVisible = stepList.style.display !== 'none';
  stepList.style.display = listVisible ? 'none' : '';
  stepsJsonView.style.display = listVisible ? 'block' : 'none';
  stepsViewToggle.textContent = listVisible ? 'Show Steps' : 'Show JSON';
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
function onStepsEdit() {
  if (updatingStepsFromCode) return;
  try {
    const parsed = JSON.parse(jsonPreview.value);
    if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
    steps = parsed;
    renderStepList();
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
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, history: steps }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Translation failed');
    steps.push(...data.steps);
    renderSteps();
    commandInput.value = '';
    setStatus(statusEl, `Added ${data.steps.length} step${data.steps.length !== 1 ? 's' : ''}`);
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

  const res = await fetchPromise;
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
          if (msg.stopped) {
            logOutput.textContent += '\n--- Stopped ---\n';
            logBadge.textContent = 'stopped';
            logBadge.className = 'badge badge-fail';
          } else {
            logOutput.textContent += `\n--- Done (exit ${msg.code}) ---\n`;
            logBadge.textContent = msg.code === 0 ? 'complete' : 'failed';
            logBadge.className = 'badge' + (msg.code === 0 ? ' badge-pass' : ' badge-fail');
          }
          onDone(msg);
        }
      } catch {}
    }
  }
}

async function runSteps() {
  const name = nameInput.value.trim() || `recording-${Date.now()}`;
  await streamRun(
    fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, steps, blueprint, videoSize: getVideoSize() }),
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
      body: JSON.stringify({ name, steps, blueprint, videoSize: null, preview: true }),
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
      <span class="script-meta">${recording.stepCount} step${recording.stepCount !== 1 ? 's' : ''}</span>
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
      steps = recording.steps ?? [];
      nameInput.value = recording.name;
      renderSteps();
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
      body: JSON.stringify({ name, steps }),
    });
    if (!res.ok) throw new Error('Save failed');
    setStatus(statusEl, `Saved "${name}"`);
    await loadSavedScripts();
  } catch (err) {
    setStatus(statusEl, err.message, true);
  } finally {
    saveBtn.disabled = steps.length === 0;
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

// ── Event listeners ───────────────────────────────────────────────────────────
addBtn.addEventListener('click', addCommand);
commandInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCommand(); });
clearBtn.addEventListener('click', () => { steps = []; renderSteps(); });
recordBtn.addEventListener('click', runSteps);
previewBtn.addEventListener('click', runPreview);
stopBtn.addEventListener('click', () => fetch('/api/stop', { method: 'POST' }));

jsonPreview.addEventListener('input', onStepsEdit);

blueprintTestBtn.addEventListener('click', testBlueprint);
blueprintResetBtn.addEventListener('click', resetBlueprint);
blueprintPreview.addEventListener('input', onBlueprintEdit);

saveBtn.addEventListener('click', saveScript);
recordAllBtn.addEventListener('click', recordAll);
selectAllCheckbox.addEventListener('change', () => {
  const checkboxes = /** @type {NodeListOf<HTMLInputElement>} */ (savedScriptsList.querySelectorAll('.script-checkbox'));
  selectedScripts = selectAllCheckbox.checked ? savedScripts.map(s => s.name) : [];
  checkboxes.forEach(cb => { cb.checked = selectAllCheckbox.checked; });
  renderBatchControls();
});

renderSteps();
Promise.all([
  fetch('/api/default-blueprint').then((r) => r.json()),
  fetch('/api/current-blueprint').then((r) => r.ok ? r.json() : null).catch(() => null),
]).then(([{ blueprint: def }, currentRes]) => {
  defaultBlueprint = def;
  blueprint = currentRes?.blueprint ?? def;
  renderBlueprint();
});
loadSavedScripts();
loadRecordings();
