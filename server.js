// @ts-check
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const client = new Anthropic.default();

const PID_FILE = path.join(__dirname, '.wp-playground.pid');
const PREVIEW_PID_FILE = path.join(__dirname, '.wp-playground-preview.pid');
const GENERATED_BLUEPRINT = path.join(__dirname, 'blueprint.generated.json');
const PREVIEW_BLUEPRINT = path.join(__dirname, 'blueprint.preview.json');
const PREVIEW_PORT = 9401;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── System prompts ───────────────────────────────────────────────────────────

const STEPS_PROMPT = `You are a Playwright step generator for a WordPress recording tool. Convert natural language commands into steps by calling the add_steps tool.

## Available Actions

### Generic
- navigate: { "action": "navigate", "url": "string", "waitUntil"?: "load"|"domcontentloaded"|"networkidle" }
- click: { "action": "click", "selector": "string" }
- fill: { "action": "fill", "selector": "string", "value": "string" }
- type: { "action": "type", "selector": "string", "text": "string", "delay"?: number }
- wait: { "action": "wait", "ms": number }
- waitForSelector: { "action": "waitForSelector", "selector": "string", "timeout"?: number }
- screenshot: { "action": "screenshot", "path"?: "string" }
- scroll: { "action": "scroll", "x"?: number, "y"?: number }
- hover: { "action": "hover", "selector": "string" }
- press: { "action": "press", "key": "string" }
- frameLocator: { "action": "frameLocator", "selector": "string" }
- exitFrame: { "action": "exitFrame" }

### WordPress-specific (prefer these when intent is WordPress-related)
- wpNavigate: { "action": "wpNavigate", "screen": "dashboard"|"posts"|"new-post"|"pages"|"new-page"|"media"|"comments"|"plugins"|"add-plugin"|"themes"|"appearance"|"widgets"|"menus"|"site-editor"|"customizer"|"settings"|"users"|"profile" }
- wpInstallPlugin: { "action": "wpInstallPlugin", "slug": "plugin-slug", "activate"?: boolean }
- wpSelectBlock: { "action": "wpSelectBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpInsertBlock: { "action": "wpInsertBlock", "blockType": "paragraph"|"heading"|"image"|etc, "afterIndex"?: number }
- wpDeleteBlock: { "action": "wpDeleteBlock", "blockType": "paragraph"|"heading"|"image"|etc, "index"?: number }
- wpCommandPalette: { "action": "wpCommandPalette", "command"?: "string" }
- wpSetPostTitle: { "action": "wpSetPostTitle", "title": "string" }
- wpSetPostContent: { "action": "wpSetPostContent", "content": "string", "blockType"?: "heading"|"paragraph"|etc, "index"?: number, "replace"?: boolean, "delay"?: number } — types into a block; when blockType is given, targets that specific block by index (0-based); replace defaults to true (triple-click to select all existing text first); set replace:false to append

## Rules
- Always include wait steps (400-800ms) after navigation or significant UI interactions
- Use wpInstallPlugin for installing plugins — derive the slug from the plugin name (lowercase, hyphens)
- Use wpNavigate instead of navigate for WordPress admin screens
- Include waitForSelector before interacting with elements that may not be immediately present
- When entering the block editor, frameLocator to 'iframe[name="editor-canvas"]' MUST come first — before any waitForSelector, click, fill, or type that targets editor content. exitFrame after.
- To set the post/page title, always use wpSetPostTitle — never manually frameLocator + click/fill the title field
- To update/replace content of a specific block, use wpSetPostContent with blockType and index — do NOT use wpSelectBlock followed by wpSetPostContent
- To set/replace/update block content, use wpSetPostContent — it triple-clicks to select all existing text first (replace:true by default); only pass replace:false when the intent is to append
- Never invent action types — only use the actions listed above`;

// ─── Tool definitions ─────────────────────────────────────────────────────────

const STEPS_TOOL = {
  name: 'add_steps',
  description: 'Add one or more Playwright steps for the recording.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: 'The steps to add.',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'The action type.' },
          },
          required: ['action'],
          additionalProperties: true,
        },
      },
    },
    required: ['steps'],
  },
};

// ─── WP Playground management ─────────────────────────────────────────────────

function killPlayground() {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch {}
  fs.unlinkSync(PID_FILE);
}

function startPlayground(blueprintPath, onData) {
  return new Promise((resolve, reject) => {
    const server = spawn(
      'npx',
      ['@wp-playground/cli', 'server', '--port=9400', '--login', `--blueprint=${blueprintPath}`],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true, cwd: __dirname }
    );

    const timeout = setTimeout(
      () => reject(new Error('WP Playground did not start within 120s')),
      120_000
    );

    server.stdout.on('data', (data) => {
      const text = data.toString();
      onData?.({ type: 'stdout', text: `[WP Playground] ${text}` });
      if (text.includes('Ready!')) {
        clearTimeout(timeout);
        fs.writeFileSync(PID_FILE, server.pid.toString());
        server.unref();
        resolve(undefined);
      }
    });

    server.stderr.on('data', (data) => {
      onData?.({ type: 'stderr', text: `[WP Playground] ${data}` });
    });

    server.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

function killPreviewPlayground() {
  if (!fs.existsSync(PREVIEW_PID_FILE)) return;
  const pid = parseInt(fs.readFileSync(PREVIEW_PID_FILE, 'utf8'));
  try { process.kill(pid, 'SIGTERM'); } catch {}
  fs.unlinkSync(PREVIEW_PID_FILE);
}

function startPreviewPlayground(blueprintPath) {
  return new Promise((resolve, reject) => {
    const server = spawn(
      'npx',
      ['@wp-playground/cli', 'server', `--port=${PREVIEW_PORT}`, '--login', `--blueprint=${blueprintPath}`],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true, cwd: __dirname }
    );

    const timeout = setTimeout(
      () => reject(new Error('Preview Playground did not start within 120s')),
      120_000
    );

    server.stdout.on('data', (data) => {
      if (data.toString().includes('Ready!')) {
        clearTimeout(timeout);
        fs.writeFileSync(PREVIEW_PID_FILE, server.pid.toString());
        server.unref();
        resolve();
      }
    });

    server.stderr.on('data', () => {});
    server.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

// ─── API endpoints ────────────────────────────────────────────────────────────

app.post('/api/translate', async (req, res) => {
  const { command, history = [] } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });

  try {
    const historyContext = history.length
      ? `\n\nSteps added so far:\n${JSON.stringify(history, null, 2)}`
      : '';

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: STEPS_PROMPT + historyContext,
      tools: [STEPS_TOOL],
      tool_choice: { type: 'tool', name: 'add_steps' },
      messages: [{ role: 'user', content: command }],
    });

    const toolUse = message.content.find((b) => b.type === 'tool_use');
    const steps = toolUse?.input?.steps ?? [];
    res.json({ steps });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/default-blueprint', (req, res) => {
  try {
    const bp = JSON.parse(fs.readFileSync(path.join(__dirname, 'blueprint.json'), 'utf8'));
    res.json({ blueprint: bp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/current-blueprint', (req, res) => {
  try {
    const generatedPath = path.join(__dirname, 'blueprint.generated.json');
    const src = fs.existsSync(generatedPath) ? generatedPath : path.join(__dirname, 'blueprint.json');
    const bp = JSON.parse(fs.readFileSync(src, 'utf8'));
    res.json({ blueprint: bp });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/preview-blueprint', async (req, res) => {
  const { blueprint } = req.body;
  if (!blueprint) return res.status(400).json({ error: 'blueprint required' });

  try {
    killPreviewPlayground();
    fs.writeFileSync(PREVIEW_BLUEPRINT, JSON.stringify(blueprint, null, 2));
    await startPreviewPlayground(PREVIEW_BLUEPRINT);
    const landingPage = blueprint.landingPage || '/';
    res.json({ url: `http://localhost:${PREVIEW_PORT}${landingPage}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scripts', (req, res) => {
  const stepsDir = path.join(__dirname, 'steps');
  if (!fs.existsSync(stepsDir)) return res.json({ scripts: [] });
  const files = fs.readdirSync(stepsDir).filter(f => f.endsWith('.json'));
  const scripts = files.map(f => {
    try {
      const def = JSON.parse(fs.readFileSync(path.join(stepsDir, f), 'utf8'));
      return { name: def.name, filename: f, stepCount: (def.steps ?? []).length, steps: def.steps ?? [] };
    } catch { return null; }
  }).filter(Boolean);
  res.json({ scripts });
});

app.post('/api/scripts/save', (req, res) => {
  const { name = `recording-${Date.now()}`, steps = [] } = req.body;
  const stepsDir = path.join(__dirname, 'steps');
  if (!fs.existsSync(stepsDir)) fs.mkdirSync(stepsDir);
  const filename = `${name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.json`;
  fs.writeFileSync(path.join(stepsDir, filename), JSON.stringify({ name, steps }, null, 2));
  res.json({ filename });
});

app.delete('/api/scripts/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^[a-z0-9-]+\.json$/i.test(filename)) return res.status(400).json({ error: 'invalid filename' });
  const filePath = path.join(__dirname, 'steps', filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

app.post('/api/run/batch', async (req, res) => {
  const { names = [], blueprint = null, videoSize = null } = req.body;
  if (!names.length) return res.status(400).json({ error: 'no scripts selected' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  if (blueprint) {
    try {
      send({ type: 'stdout', text: '[Blueprint] Restarting WP Playground with custom blueprint…\n' });
      fs.writeFileSync(GENERATED_BLUEPRINT, JSON.stringify(blueprint, null, 2));
      killPlayground();
      await startPlayground(GENERATED_BLUEPRINT, send);
      send({ type: 'stdout', text: '[Blueprint] WP Playground ready.\n' });
    } catch (err) {
      send({ type: 'stderr', text: `[Blueprint] Failed to start WP Playground: ${err.message}\n` });
      send({ type: 'done', code: 1 });
      return res.end();
    }
  }

  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const grepPattern = `(${escaped.join('|')})`;

  const proc = spawn(
    'npx', ['playwright', 'test', 'recordings/steps-runner.spec.js', '--grep', grepPattern],
    { cwd: __dirname, env: { ...process.env } }
  );

  proc.stdout.on('data', (d) => send({ type: 'stdout', text: d.toString() }));
  proc.stderr.on('data', (d) => send({ type: 'stderr', text: d.toString() }));
  proc.on('close', async (code) => {
    if (code === 0) await processVideo(videoSize, send);
    send({ type: 'done', code });
    res.end();
  });
});

app.get('/api/screencast', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Poll until Chrome's remote debugging port is ready (up to 30s)
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://localhost:9222/json');
      const targets = await r.json();
      const target = targets.find((t) => t.type === 'page');
      if (target?.webSocketDebuggerUrl) { wsUrl = target.webSocketDebuggerUrl; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!wsUrl) {
    send({ type: 'error', message: 'Chrome remote debugging not available' });
    return res.end();
  }

  const ws = new WebSocket(wsUrl);
  let msgId = 0;

  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: ++msgId,
      method: 'Page.startScreencast',
      params: { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 800 },
    }));
  });

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === 'Page.screencastFrame') {
      send({ type: 'frame', data: msg.params.data });
      ws.send(JSON.stringify({
        id: ++msgId,
        method: 'Page.screencastFrameAck',
        params: { sessionId: msg.params.sessionId },
      }));
    }
  });

  ws.on('error', () => {});

  req.on('close', () => ws.close());
});

app.post('/api/run', async (req, res) => {
  const { name = `recording-${Date.now()}`, steps = [], blueprint = null, videoSize = null } = req.body;
  if (!steps.length) return res.status(400).json({ error: 'no steps provided' });

  const stepsDir = path.join(__dirname, 'steps');
  if (!fs.existsSync(stepsDir)) fs.mkdirSync(stepsDir);

  const filename = `${name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.json`;
  fs.writeFileSync(path.join(stepsDir, filename), JSON.stringify({ name, steps }, null, 2));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // If a custom blueprint is provided, restart WP Playground with it
  if (blueprint) {
    try {
      send({ type: 'stdout', text: '[Blueprint] Restarting WP Playground with custom blueprint…\n' });
      fs.writeFileSync(GENERATED_BLUEPRINT, JSON.stringify(blueprint, null, 2));
      killPlayground();
      await startPlayground(GENERATED_BLUEPRINT, send);
      send({ type: 'stdout', text: '[Blueprint] WP Playground ready.\n' });
    } catch (err) {
      send({ type: 'stderr', text: `[Blueprint] Failed to start WP Playground: ${err.message}\n` });
      send({ type: 'done', code: 1 });
      return res.end();
    }
  }

  const proc = spawn(
    'npx', ['playwright', 'test', 'recordings/steps-runner.spec.js', '--grep', name],
    { cwd: __dirname, env: { ...process.env } }
  );

  proc.stdout.on('data', (d) => send({ type: 'stdout', text: d.toString() }));
  proc.stderr.on('data', (d) => send({ type: 'stderr', text: d.toString() }));
  proc.on('close', async (code) => {
    if (code === 0) await processVideo(videoSize, send);
    send({ type: 'done', code, file: path.join(stepsDir, filename) });
    res.end();
  });
});

// ─── Video post-processing ────────────────────────────────────────────────────

const OUTPUT_DIR = path.join(__dirname, 'output');

function findNewestVideoDir() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const dirs = fs.readdirSync(OUTPUT_DIR)
    .filter(d => fs.existsSync(path.join(OUTPUT_DIR, d, 'video.webm')))
    .map(d => ({ d, mtime: fs.statSync(path.join(OUTPUT_DIR, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return dirs[0]?.d ?? null;
}

function processVideo(videoSize, send) {
  return new Promise((resolve) => {
    const dirname = findNewestVideoDir();
    if (!dirname) return resolve();

    const inputPath  = path.join(OUTPUT_DIR, dirname, 'video.webm');
    const outputPath = path.join(OUTPUT_DIR, dirname, 'video.mp4');

    const needsScale = videoSize && !(videoSize.width === 1920 && videoSize.height === 1080);
    const label = needsScale ? `Converting to MP4 and scaling to ${videoSize.width}×${videoSize.height}` : 'Converting to MP4';
    send({ type: 'stdout', text: `[ffmpeg] ${label}…\n` });

    const scaleFilter = needsScale ? [`-vf`, `scale=${videoSize.width}:${videoSize.height}:flags=lanczos`] : [];

    const ff = spawn(ffmpegPath, [
      '-i', inputPath,
      ...scaleFilter,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k',
      '-y', outputPath,
    ]);

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

function findVideoFile(dirname) {
  const mp4 = path.join(OUTPUT_DIR, dirname, 'video.mp4');
  if (fs.existsSync(mp4)) return { file: mp4, ext: 'mp4', mime: 'video/mp4' };
  const webm = path.join(OUTPUT_DIR, dirname, 'video.webm');
  if (fs.existsSync(webm)) return { file: webm, ext: 'webm', mime: 'video/webm' };
  return null;
}

app.get('/api/recordings', (req, res) => {
  if (!fs.existsSync(OUTPUT_DIR)) return res.json({ recordings: [] });
  const dirs = fs.readdirSync(OUTPUT_DIR).filter(d => findVideoFile(d) !== null);
  const recordings = dirs.map((dirname) => {
    const { file, ext } = findVideoFile(dirname);
    const stat = fs.statSync(file);
    const slug = dirname
      .replace(/^steps-runner-/, '')
      .replace(/-chromium$/, '');
    const name = slug.replace(/-/g, ' ');
    return { name, slug, dirname, ext, size: stat.size, mtime: stat.mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
  res.json({ recordings });
});

app.get('/api/recordings/:dirname/video', (req, res) => {
  const dirname = req.params.dirname;
  if (!/^[a-z0-9-]+$/i.test(dirname)) return res.status(400).end();
  const found = findVideoFile(dirname);
  if (!found) return res.status(404).end();
  const slug = dirname.replace(/^steps-runner-/, '').replace(/-chromium$/, '');
  res.setHeader('Content-Type', found.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.${found.ext}"`);
  fs.createReadStream(found.file).pipe(res);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WP Reel at http://localhost:${PORT}`));
