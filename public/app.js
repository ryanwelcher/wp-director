// @ts-check

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
const logPanel = document.getElementById('log-panel');
const logOutput = document.getElementById('log-output');
const closeLog = document.getElementById('close-log');

/** @type {Array<object>} */
let steps = [];
let updatingFromCode = false;

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
  updatingFromCode = true;
  jsonPreview.value = JSON.stringify(steps, null, 2);
  updatingFromCode = false;
  jsonPreview.classList.remove('invalid');
  jsonError.classList.add('hidden');
}

function renderSteps() {
  renderStepList();
  renderJSON();
}

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (isError ? ' error' : '');
  statusEl.classList.remove('hidden');
  if (!isError) setTimeout(() => statusEl.classList.add('hidden'), 3000);
}

function onJSONEdit() {
  if (updatingFromCode) return;
  try {
    const parsed = JSON.parse(jsonPreview.value);
    if (!Array.isArray(parsed)) throw new Error('JSON must be an array');
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

async function addCommand() {
  const command = commandInput.value.trim();
  if (!command) return;

  addBtn.disabled = true;
  commandInput.disabled = true;
  setStatus('Translating…');

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
    setStatus(`Added ${data.steps.length} step${data.steps.length !== 1 ? 's' : ''}`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    addBtn.disabled = false;
    commandInput.disabled = false;
    commandInput.focus();
  }
}

async function runSteps() {
  const name = nameInput.value.trim() || `recording-${Date.now()}`;
  logOutput.textContent = '';
  logPanel.classList.remove('hidden');
  runBtn.disabled = true;

  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, steps }),
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

addBtn.addEventListener('click', addCommand);
commandInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCommand(); });
clearBtn.addEventListener('click', () => { steps = []; renderSteps(); });
runBtn.addEventListener('click', runSteps);
closeLog.addEventListener('click', () => logPanel.classList.add('hidden'));
jsonPreview.addEventListener('input', onJSONEdit);

renderSteps();
