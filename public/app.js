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

// ── State ─────────────────────────────────────────────────────────────────────
/** @type {Array<object>} */
let steps = [];
/** @type {object|null} */
let blueprint = null;
let updatingStepsFromCode = false;
let updatingBlueprintFromCode = false;

// ── Step descriptions ─────────────────────────────────────────────────────────
function describe(step) {
  switch (step.action) {
    case 'navigate':        return `Go to: ${step.url}`;
    case 'click':           return `Click: ${step.selector}`;
    case 'fill':            return `Fill "${step.selector}" with "${step.value}"`;
    case 'type':            return `Type "${step.text}" in ${step.selector}`;
    case 'wait':            return `Wait ${step.ms}ms`;
    case 'waitForSelector': return `Wait for: ${step.selector}`;
    case 'screenshot':      return `Screenshot${step.path ? ': ' + step.path : ''}`;
    case 'scroll':          return `Scroll to (${step.x ?? 0}, ${step.y ?? 0})`;
    case 'hover':           return `Hover: ${step.selector}`;
    case 'press':           return `Press key: ${step.key}`;
    case 'frameLocator':    return `Enter frame: ${step.selector}`;
    case 'exitFrame':       return 'Exit frame';
    case 'wpNavigate':      return `WP Navigate → ${step.screen}`;
    case 'wpInstallPlugin': return `Install plugin: ${step.slug}${step.activate ? ' (+ activate)' : ''}`;
    case 'wpSelectBlock':   return `Select block: ${step.blockType}${step.index != null ? ' #' + step.index : ''}`;
    case 'wpInsertBlock':   return `Insert block: ${step.blockType}`;
    case 'wpDeleteBlock':   return `Delete block: ${step.blockType}`;
    case 'wpCommandPalette':return `Command palette${step.command ? ': ' + step.command : ''}`;
    default:                return step.action;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderStepList() {
  stepList.innerHTML = '';
  emptyHint.style.display = steps.length ? 'none' : '';
  runBtn.disabled = steps.length === 0;
  stepCount.textContent = `(${steps.length})`;

  steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="index">${i + 1}</span>
      <span class="label">${describe(step)}</span>
      <span class="action-tag">${step.action}</span>
    `;
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

renderSteps();
renderBlueprint();
