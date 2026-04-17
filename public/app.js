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
const runBtn = document.getElementById('run-btn');
const statusEl = document.getElementById('status');

// ── Blueprint elements ────────────────────────────────────────────────────────
const blueprintInput = document.getElementById('blueprint-input');
const blueprintBtn = document.getElementById('blueprint-btn');
const blueprintResetBtn = document.getElementById('blueprint-reset-btn');
const blueprintStatusEl = document.getElementById('blueprint-status');
/** @type {HTMLTextAreaElement} */
const blueprintPreview = /** @type {any} */ (document.getElementById('blueprint-preview'));
const blueprintError = document.getElementById('blueprint-error');
const blueprintBadge = document.getElementById('blueprint-badge');

// ── Log elements ──────────────────────────────────────────────────────────────
const logPanel = document.getElementById('log-panel');
const logOutput = document.getElementById('log-output');
const closeLog = document.getElementById('close-log');

// ── Saved Scripts elements ────────────────────────────────────────────────────
const saveBtn = document.getElementById('save-btn');
const savedScriptsList = document.getElementById('saved-scripts-list');
const savedCountBadge = document.getElementById('saved-count-badge');
const selectAllCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('select-all-scripts'));
const selectedCountEl = document.getElementById('selected-count');
const runBatchBtn = document.getElementById('run-batch-btn');

// ── State ─────────────────────────────────────────────────────────────────────
/** @type {Array<object>} */
let steps = [];
/** @type {object|null} */
let blueprint = null;
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
  runBtn.disabled = steps.length === 0;
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
}

function renderBlueprint() {
  updatingBlueprintFromCode = true;
  blueprintPreview.value = blueprint ? JSON.stringify(blueprint, null, 2) : '';
  updatingBlueprintFromCode = false;
  blueprintPreview.classList.remove('invalid');
  blueprintError.classList.add('hidden');
  blueprintBadge.classList.toggle('hidden', !blueprint);
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
    blueprint = null;
    blueprintPreview.classList.remove('invalid');
    blueprintError.classList.add('hidden');
    blueprintBadge.classList.add('hidden');
    return;
  }
  try {
    blueprint = JSON.parse(val);
    blueprintPreview.classList.remove('invalid');
    blueprintError.classList.add('hidden');
    blueprintBadge.classList.remove('hidden');
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

async function generateBlueprint() {
  const command = blueprintInput.value.trim();
  if (!command) return;

  blueprintBtn.disabled = true;
  blueprintInput.disabled = true;
  setStatus(blueprintStatusEl, 'Generating blueprint…');

  try {
    const res = await fetch('/api/blueprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Blueprint generation failed');
    blueprint = data.blueprint;
    renderBlueprint();
    blueprintInput.value = '';
    setStatus(blueprintStatusEl, 'Blueprint generated');
  } catch (err) {
    setStatus(blueprintStatusEl, err.message, true);
  } finally {
    blueprintBtn.disabled = false;
    blueprintInput.disabled = false;
  }
}

function resetBlueprint() {
  blueprint = null;
  renderBlueprint();
}

async function runSteps() {
  const name = nameInput.value.trim() || `recording-${Date.now()}`;
  logOutput.textContent = '';
  logPanel.classList.remove('hidden');
  runBtn.disabled = true;

  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, steps, blueprint }),
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
          logOutput.textContent += `\n--- Done (exit ${msg.code}) ---\n`;
          runBtn.disabled = steps.length === 0;
        }
      } catch {}
    }
  }
}

// ── Saved Scripts ─────────────────────────────────────────────────────────────
function renderBatchControls() {
  selectedCountEl.textContent = `${selectedScripts.length} selected`;
  runBatchBtn.disabled = selectedScripts.length === 0;
  const total = savedScripts.length;
  selectAllCheckbox.checked = total > 0 && selectedScripts.length === total;
  selectAllCheckbox.indeterminate = selectedScripts.length > 0 && selectedScripts.length < total;
}

function renderSavedScripts(scripts) {
  savedScripts = scripts;
  selectedScripts = selectedScripts.filter(n => scripts.some(s => s.name === n));

  savedCountBadge.textContent = scripts.length.toString();
  savedCountBadge.classList.toggle('hidden', scripts.length === 0);

  if (!scripts.length) {
    savedScriptsList.innerHTML = '<p class="hint">No scripts saved yet.</p>';
    renderBatchControls();
    return;
  }

  savedScriptsList.innerHTML = '';
  for (const script of scripts) {
    const div = document.createElement('div');
    div.className = 'saved-script-item';
    div.innerHTML = `
      <input type="checkbox" class="script-checkbox" data-name="${script.name}"${selectedScripts.includes(script.name) ? ' checked' : ''}>
      <span class="script-name">${script.name}</span>
      <span class="script-meta">${script.stepCount} step${script.stepCount !== 1 ? 's' : ''}</span>
      <button class="script-load-btn secondary" data-name="${script.name}">Load</button>
      <button class="script-delete-btn danger" data-name="${script.name}" data-filename="${script.filename}">Delete</button>
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
      const script = savedScripts.find(s => s.name === name);
      if (!script) return;
      steps = script.steps ?? [];
      nameInput.value = script.name;
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

async function runBatch() {
  logOutput.textContent = '';
  logPanel.classList.remove('hidden');
  runBatchBtn.disabled = true;

  const res = await fetch('/api/run/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: selectedScripts, blueprint }),
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
          logOutput.textContent += `\n--- Done (exit ${msg.code}) ---\n`;
          runBatchBtn.disabled = selectedScripts.length === 0;
        }
      } catch {}
    }
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
addBtn.addEventListener('click', addCommand);
commandInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCommand(); });
clearBtn.addEventListener('click', () => { steps = []; renderSteps(); });
runBtn.addEventListener('click', runSteps);
closeLog.addEventListener('click', () => logPanel.classList.add('hidden'));
jsonPreview.addEventListener('input', onStepsEdit);

blueprintBtn.addEventListener('click', generateBlueprint);
blueprintInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') generateBlueprint(); });
blueprintResetBtn.addEventListener('click', resetBlueprint);
blueprintPreview.addEventListener('input', onBlueprintEdit);

saveBtn.addEventListener('click', saveScript);
runBatchBtn.addEventListener('click', runBatch);
selectAllCheckbox.addEventListener('change', () => {
  const checkboxes = /** @type {NodeListOf<HTMLInputElement>} */ (savedScriptsList.querySelectorAll('.script-checkbox'));
  selectedScripts = selectAllCheckbox.checked ? savedScripts.map(s => s.name) : [];
  checkboxes.forEach(cb => { cb.checked = selectAllCheckbox.checked; });
  renderBatchControls();
});

renderSteps();
renderBlueprint();
loadSavedScripts();
