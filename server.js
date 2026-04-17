// @ts-check
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const client = new Anthropic.default();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are a Playwright step generator for a WordPress recording tool. Convert natural language commands into JSON step arrays.

Return ONLY a valid JSON array of step objects. No explanation, no markdown, no code fences — just the raw JSON array.

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

## Rules
- Always include wait steps (400-800ms) after navigation or significant UI interactions
- Use wpInstallPlugin for installing plugins — derive the slug from the plugin name (lowercase, hyphens)
- Use wpNavigate instead of navigate for WordPress admin screens
- Include waitForSelector before interacting with elements that may not be immediately present
- When entering the block editor, always frameLocator to 'iframe[name="editor-canvas"]' before block interactions, and exitFrame after
- Never invent action types — only use the actions listed above

## Examples

User: "go to the posts list"
Response: [{"action":"wpNavigate","screen":"posts"}]

User: "install the advanced query loop plugin and activate it"
Response: [{"action":"wpInstallPlugin","slug":"advanced-query-loop","activate":true}]

User: "take a screenshot"
Response: [{"action":"screenshot"}]

User: "insert a paragraph block"
Response: [{"action":"frameLocator","selector":"iframe[name=\\"editor-canvas\\"]"},{"action":"wpInsertBlock","blockType":"paragraph"},{"action":"exitFrame"},{"action":"wait","ms":400}]`;

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
      system: SYSTEM_PROMPT + historyContext,
      messages: [{ role: 'user', content: command }],
    });

    const text = message.content.find((b) => b.type === 'text')?.text ?? '[]';
    const steps = JSON.parse(text);
    res.json({ steps });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run', (req, res) => {
  const { name = `recording-${Date.now()}`, steps = [] } = req.body;
  if (!steps.length) return res.status(400).json({ error: 'no steps provided' });

  const stepsDir = path.join(__dirname, 'steps');
  if (!fs.existsSync(stepsDir)) fs.mkdirSync(stepsDir);

  const filename = `${name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.json`;
  const filepath = path.join(stepsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify({ name, steps }, null, 2));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const proc = spawn(
    'npx', ['playwright', 'test', 'recordings/steps-runner.spec.js', '--grep', name],
    { cwd: __dirname, env: { ...process.env } }
  );

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  proc.stdout.on('data', (d) => send({ type: 'stdout', text: d.toString() }));
  proc.stderr.on('data', (d) => send({ type: 'stderr', text: d.toString() }));
  proc.on('close', (code) => {
    send({ type: 'done', code, file: filepath });
    res.end();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Playwright recorder UI at http://localhost:${PORT}`));
