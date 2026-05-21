// @ts-check

/**
 * Intent catalog CRUD + slot-fill expansion.
 *
 *   GET    /api/intents              → list catalog ({ id, description, slots, userSaved })
 *   GET    /api/intents/:id          → full intent JSON (for inspection / authoring)
 *   POST   /api/intents              → write intents/<id>.json (refuses overwrite)
 *   POST   /api/intents/expand       → expand({ id, slots }) into the same
 *                                       { directions: [...] } shape /api/translate returns
 *   DELETE /api/intents/:id          → remove a user-saved intent (refuses non-userSaved)
 *
 * The expand endpoint is the panel's path into the editor: zero-slot intents
 * call it with `slots: {}`; slot-bearing intents call it once their inline
 * form is filled. Either way the response is identical to what the natural
 * language pipeline produces, so the UI's downstream insertion code works
 * regardless of how the intent was triggered.
 */

const fs = require('fs');
const path = require('path');
const { getCatalog, getIntent, reload } = require('../intents/loader');
const { expand } = require('../intents/expand');

const INTENTS_DIR = path.join(__dirname, '..', '..', 'intents');
const SAFE_ID_RE = /^[a-z0-9-]+$/;

/** Shape returned by GET /api/intents for each catalog entry. */
function summarize(intent) {
  return {
    id: intent.id,
    description: intent.description,
    label: intent.label,
    examples: intent.examples,
    slots: intent.slots,
    userSaved: Boolean(intent.userSaved),
  };
}

function register(app) {
  app.get('/api/intents', (_req, res) => {
    const intents = getCatalog().map(summarize).sort((a, b) => a.id.localeCompare(b.id));
    res.json({ intents });
  });

  app.get('/api/intents/:id', (req, res) => {
    const { id } = req.params;
    if (!SAFE_ID_RE.test(id)) return res.status(400).json({ error: 'invalid intent id' });
    const intent = getIntent(id);
    if (!intent) return res.status(404).json({ error: 'not found' });
    res.json({ intent });
  });

  app.post('/api/intents', (req, res) => {
    const intent = req.body?.intent;
    if (!intent || typeof intent !== 'object') {
      return res.status(400).json({ error: 'intent object required' });
    }
    if (typeof intent.id !== 'string' || !SAFE_ID_RE.test(intent.id)) {
      return res.status(400).json({ error: 'intent.id must be kebab-case [a-z0-9-]+' });
    }
    if (fs.existsSync(path.join(INTENTS_DIR, `${intent.id}.json`)) || getIntent(intent.id)) {
      return res.status(409).json({ error: `intent "${intent.id}" already exists` });
    }

    // Always brand server-saved intents so the UI can offer deletion.
    const toWrite = { ...intent, userSaved: true };

    if (!fs.existsSync(INTENTS_DIR)) fs.mkdirSync(INTENTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(INTENTS_DIR, `${intent.id}.json`), `${JSON.stringify(toWrite, null, 2)}\n`);
    try {
      reload();
    } catch (err) {
      // Bad write — roll back and surface the validation error.
      fs.unlinkSync(path.join(INTENTS_DIR, `${intent.id}.json`));
      try { reload(); } catch { /* ignore */ }
      return res.status(400).json({ error: err.message });
    }
    res.json({ intent: summarize(getIntent(intent.id)) });
  });

  app.post('/api/intents/expand', (req, res) => {
    const { id, slots } = req.body ?? {};
    if (typeof id !== 'string') return res.status(400).json({ error: 'id required' });
    if (!getIntent(id)) return res.status(404).json({ error: `intent "${id}" not found` });
    try {
      const direction = expand({ id, slots: slots ?? {} });
      res.json({ directions: [direction] });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/intents/:id', (req, res) => {
    const { id } = req.params;
    if (!SAFE_ID_RE.test(id)) return res.status(400).json({ error: 'invalid intent id' });
    const intent = getIntent(id);
    if (!intent) return res.status(404).json({ error: 'not found' });
    if (!intent.userSaved) {
      return res.status(403).json({ error: 'cannot delete built-in intents' });
    }
    fs.unlinkSync(path.join(INTENTS_DIR, `${id}.json`));
    reload();
    res.json({ ok: true });
  });
}

module.exports = { register };
