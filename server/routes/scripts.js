// @ts-check

/**
 * Saved-script CRUD.
 *
 *   GET    /api/scripts            → list saved recordings
 *   POST   /api/scripts/save       → write scripts/<name>.json
 *   DELETE /api/scripts/:filename  → remove a saved recording
 *
 * On-disk layout: `scripts/<slug>.json` where each file is
 *   {
 *     "name": "human readable",
 *     "directions": [ ... ],
 *     "blueprint": { ... },
 *     "recordingSettings": { "typingDelay": 100, ... }
 *   }
 *
 * Reads intentionally support only `name`, `directions`, `actions`,
 * `blueprint`, and `recordingSettings`. Older root settings are ignored so
 * legacy files load with current defaults instead of translated settings.
 *
 * Security: the DELETE route path-parameter is regex-validated so it can't
 * traverse out of the scripts/ directory.
 */

const fs = require('fs');
const path = require('path');
const {
  STEPS_DIR,
  SAFE_FILENAME_RE,
  DEFAULT_BLUEPRINT,
  GENERATED_BLUEPRINT,
} = require('../config');
const { normalizeVideoSize } = require('../video-size');

const DEFAULT_RECORDING_SETTINGS = Object.freeze({
  endPause: 2000,
  stepPause: 0,
  typingDelay: 100,
  videoSize: normalizeVideoSize(null),
});

/**
 * Normalize a user-provided name into a safe on-disk filename.
 * Replaces anything outside [a-z0-9-] with a hyphen, lowercases the result.
 *
 * @param {string} name
 * @returns {string}
 */
function nameToFilename(name) {
  return `${name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.json`;
}

function millisecondsSetting(value, fallback, max = 10_000) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return fallback;
  return Math.max(0, Math.min(max, Math.round(milliseconds)));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDirectionGroups(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((step) => (
    step?.label != null
      ? { ...step, actions: Array.isArray(step.actions) ? step.actions : [] }
      : { label: step?.action, actions: [step] }
  ));
}

function scriptDirections(def) {
  return normalizeDirectionGroups(
    Array.isArray(def?.directions)
      ? def.directions
      : Array.isArray(def?.actions)
        ? def.actions
        : []
  );
}

function normalizeRecordingSettings(settings) {
  const source = isPlainObject(settings) ? settings : {};

  return {
    endPause: millisecondsSetting(source.endPause, DEFAULT_RECORDING_SETTINGS.endPause),
    stepPause: millisecondsSetting(source.stepPause, DEFAULT_RECORDING_SETTINGS.stepPause),
    typingDelay: millisecondsSetting(source.typingDelay, DEFAULT_RECORDING_SETTINGS.typingDelay, 1000),
    videoSize: normalizeVideoSize(source.videoSize, DEFAULT_RECORDING_SETTINGS.videoSize),
  };
}

function scriptBlueprint(def) {
  return isPlainObject(def?.blueprint) ? def.blueprint : null;
}

function storedRecordingSettings(def) {
  if (!isPlainObject(def?.recordingSettings)) return undefined;

  const source = def.recordingSettings;
  const settings = {};
  if (source.endPause != null) {
    settings.endPause = millisecondsSetting(source.endPause, DEFAULT_RECORDING_SETTINGS.endPause);
  }
  if (source.stepPause != null) {
    settings.stepPause = millisecondsSetting(source.stepPause, DEFAULT_RECORDING_SETTINGS.stepPause);
  }
  if (source.typingDelay != null) {
    settings.typingDelay = millisecondsSetting(source.typingDelay, DEFAULT_RECORDING_SETTINGS.typingDelay, 1000);
  }
  if (source.videoSize != null) {
    settings.videoSize = normalizeVideoSize(source.videoSize, DEFAULT_RECORDING_SETTINGS.videoSize);
  }

  return settings;
}

function fallbackBlueprint() {
  const blueprintPath = fs.existsSync(GENERATED_BLUEPRINT) ? GENERATED_BLUEPRINT : DEFAULT_BLUEPRINT;
  try {
    return JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
  } catch {
    return null;
  }
}

function scriptForRun(def, overrides = {}) {
  let recordingSettings = normalizeRecordingSettings(def?.recordingSettings);

  if (overrides.endPause != null) {
    recordingSettings = {
      ...recordingSettings,
      endPause: millisecondsSetting(overrides.endPause, recordingSettings.endPause),
    };
  }
  if (overrides.stepPause != null) {
    recordingSettings = {
      ...recordingSettings,
      stepPause: millisecondsSetting(overrides.stepPause, recordingSettings.stepPause),
    };
  }
  if (overrides.typingDelay != null) {
    recordingSettings = {
      ...recordingSettings,
      typingDelay: millisecondsSetting(overrides.typingDelay, recordingSettings.typingDelay, 1000),
    };
  }
  if (overrides.videoSize != null) {
    recordingSettings = { ...recordingSettings, videoSize: normalizeVideoSize(overrides.videoSize) };
  }

  return {
    name: def?.name,
    actions: scriptDirections(def),
    recordingSettings,
    ...recordingSettings,
  };
}

function register(app) {
  app.get('/api/scripts', (req, res) => {
    if (!fs.existsSync(STEPS_DIR)) return res.json({ scripts: [] });
    const files = fs.readdirSync(STEPS_DIR).filter(f => f.endsWith('.json'));
    const scripts = files.map(f => {
      try {
        const def = JSON.parse(fs.readFileSync(path.join(STEPS_DIR, f), 'utf8'));
        const directions = scriptDirections(def);
        return {
          name: def.name,
          filename: f,
          directionCount: directions.length,
          directions,
          blueprint: scriptBlueprint(def) ?? undefined,
          recordingSettings: storedRecordingSettings(def),
        };
      } catch {
        // Skip malformed files rather than failing the whole listing.
        return null;
      }
    }).filter(Boolean);
    res.json({ scripts });
  });

  app.post('/api/scripts/save', (req, res) => {
    const {
      name = `recording-${Date.now()}`,
      directions = [],
      blueprint = null,
      recordingSettings = {},
    } = req.body;
    if (!fs.existsSync(STEPS_DIR)) fs.mkdirSync(STEPS_DIR);
    const filename = nameToFilename(name);
    const scriptData = {
      name,
      directions,
      blueprint: scriptBlueprint({ blueprint }) ?? fallbackBlueprint(),
      recordingSettings: normalizeRecordingSettings(recordingSettings),
    };
    fs.writeFileSync(path.join(STEPS_DIR, filename), JSON.stringify(scriptData, null, 2));
    res.json({ filename });
  });

  app.delete('/api/scripts/:filename', (req, res) => {
    const filename = req.params.filename;
    // Reject any filename containing path separators or unexpected chars.
    if (!SAFE_FILENAME_RE.test(filename)) {
      return res.status(400).json({ error: 'invalid filename' });
    }
    const filePath = path.join(STEPS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  });
}

module.exports = {
  DEFAULT_RECORDING_SETTINGS,
  register,
  nameToFilename,
  normalizeRecordingSettings,
  scriptDirections,
  scriptForRun,
};
