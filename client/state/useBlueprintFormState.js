import { useEffect, useMemo, useRef, useState } from 'react';

// The runPHP step that dismisses the block-editor welcome guide — always internal.
// Detected by a unique substring rather than an exact string match so whitespace
// differences in the source blueprint don't accidentally mark it as "extra".
const INTERNAL_PHP_MARKER = 'wp_persisted_preferences';

const DEFINE_WP_CONFIG_STEP = {
  step: 'defineWpConfigConsts',
  consts: {
    WP_DEBUG: false,
    WP_DEBUG_LOG: false,
    WP_DEBUG_DISPLAY: false,
    SCRIPT_DEBUG: false,
    SAVEQUERIES: false,
  },
};

const LOGIN_STEP = { step: 'login' };

// The exact runPHP code emitted by formToBlueprint — always appended before login.
const WELCOME_GUIDE_PHP =
  "<?php require_once '/wordpress/wp-load.php'; $user = get_user_by('login', 'admin'); $prefs = [ '_modified' => date('c'), 'core/edit-post' => [ 'welcomeGuide' => false, 'fullscreenMode' => false ], 'core/edit-site' => [ 'welcomeGuide' => false ] ]; update_user_meta($user->ID, 'wp_persisted_preferences', $prefs); update_user_option($uid, 'acknowledged_edit_file_warning', true); ?>";

function isInternalRunPhp(step) {
  return step.step === 'runPHP' && typeof step.code === 'string' && step.code.includes(INTERNAL_PHP_MARKER);
}

function stripPluginPath(path = '') {
  return path.replace(/^\/?wordpress\/wp-content\/plugins\//, '').replace(/\/$/, '');
}

function stripThemePath(path = '') {
  return path.replace(/^\/?wordpress\/wp-content\/themes\//, '').replace(/\/$/, '');
}

function defaultFormState() {
  return {
    // Phase 3 — environment & site settings
    wpVersion: 'latest',
    phpVersion: 'latest',
    landingPage: '/wp-admin/',
    networking: true,
    blogName: '',
    blogDescription: '',
    adminEmail: '',
    timezone: '',
    language: '',
    permalinkStructure: '',
    // Phase 4 — plugins & themes
    plugins: [],
    themes: [],
    // Phase 5 — content
    samplePosts: 0,
    wxrPath: '',
    // Steps that cannot be round-tripped to the form
    extraSteps: [],
  };
}

export function blueprintToForm(blueprint) {
  if (!blueprint) return defaultFormState();
  const form = defaultFormState();

  // Top-level fields
  form.wpVersion = blueprint.preferredVersions?.wp ?? 'latest';
  form.phpVersion = blueprint.preferredVersions?.php ?? 'latest';
  form.landingPage = blueprint.landingPage ?? '/wp-admin/';
  form.networking = blueprint.features?.networking ?? true;

  // Top-level siteOptions shorthand (Playground supports this as well as a step)
  const topOpts = blueprint.siteOptions ?? {};
  form.blogName = topOpts.blogname ?? '';
  form.blogDescription = topOpts.blogdescription ?? '';
  form.adminEmail = topOpts.admin_email ?? '';
  form.timezone = topOpts.timezone_string ?? '';
  form.language = topOpts.WPLANG ?? '';
  form.permalinkStructure = topOpts.permalink_structure ?? '';

  // Top-level plugins array shorthand — each entry is a slug string or URL string
  for (const entry of blueprint.plugins ?? []) {
    const slug = typeof entry === 'string' ? entry : (entry.slug ?? '');
    if (slug && !form.plugins.some((p) => p.slug === slug)) form.plugins.push({ slug });
  }

  const extraSteps = [];

  for (const step of blueprint.steps ?? []) {
    if (step.step === 'defineWpConfigConsts') {
      // internal fixed step — always re-emitted
    } else if (step.step === 'login') {
      // internal fixed step
    } else if (isInternalRunPhp(step)) {
      // internal welcome-guide dismissal — always re-emitted
    } else if (step.step === 'setSiteOptions') {
      const opts = step.options ?? {};
      if (opts.blogname != null) form.blogName = opts.blogname;
      if (opts.blogdescription != null) form.blogDescription = opts.blogdescription;
      if (opts.admin_email != null) form.adminEmail = opts.admin_email;
      if (opts.timezone_string != null) form.timezone = opts.timezone_string;
      if (opts.WPLANG != null) form.language = opts.WPLANG;
      if (opts.permalink_structure != null) form.permalinkStructure = opts.permalink_structure;
    } else if (step.step === 'installPlugin') {
      const slug = step.pluginData?.slug ?? '';
      if (slug && !form.plugins.some((p) => p.slug === slug)) form.plugins.push({ slug });
    } else if (step.step === 'activatePlugin') {
      // legacy — activation is now always unconditional; ignore
    } else if (step.step === 'installTheme') {
      const slug = step.themeData?.slug ?? '';
      if (slug) form.themes.push({ slug });
    } else if (step.step === 'activateTheme') {
      // legacy — activation is now always unconditional; ignore
    } else if (step.step === 'importWxr') {
      form.wxrPath = step.file?.url ?? step.file?.contents ?? '';
    } else if (step.step === 'wp-cli') {
      const match = (step.command ?? '').match(/^(?:wp )?post generate --count=(\d+)/i);
      if (match) {
        form.samplePosts = parseInt(match[1], 10);
      } else {
        extraSteps.push(step);
      }
    } else {
      extraSteps.push(step);
    }
  }

  form.extraSteps = extraSteps;
  return form;
}

export function formToBlueprint(form, schema) {
  const blueprint = {};
  if (schema) blueprint.$schema = schema;

  // Versions — emit both keys together whenever either is pinned; Playground requires
  // the full preferredVersions object when the node is present.
  if (form.wpVersion !== 'latest' || form.phpVersion !== 'latest') {
    blueprint.preferredVersions = { wp: form.wpVersion, php: form.phpVersion };
  }

  if (form.landingPage) blueprint.landingPage = form.landingPage;

  if (!form.networking) blueprint.features = { networking: false };

  if (form.samplePosts > 0) blueprint.extraLibraries = ['wp-cli'];

  const steps = [];

  // 1. WP config constants (internal fixed)
  steps.push(DEFINE_WP_CONFIG_STEP);

  // 2. Site options
  const siteOpts = {};
  if (form.blogName) siteOpts.blogname = form.blogName;
  if (form.blogDescription) siteOpts.blogdescription = form.blogDescription;
  if (form.adminEmail) siteOpts.admin_email = form.adminEmail;
  if (form.timezone) siteOpts.timezone_string = form.timezone;
  if (form.language) siteOpts.WPLANG = form.language;
  if (form.permalinkStructure) siteOpts.permalink_structure = form.permalinkStructure;
  if (Object.keys(siteOpts).length > 0) {
    steps.push({ step: 'setSiteOptions', options: siteOpts });
  }

  // 3. Plugins — top-level shorthand array of slug strings
  const pluginEntries = form.plugins.filter((p) => p.slug);
  if (pluginEntries.length > 0) {
    blueprint.plugins = pluginEntries.map((p) => p.slug);
  }

  // 4. Install + activate each theme unconditionally
  for (const t of form.themes) {
    if (!t.slug) continue;
    steps.push({ step: 'installTheme', themeData: { resource: 'wordpress.org/themes', slug: t.slug } });
    steps.push({ step: 'activateTheme', themeFolderName: t.slug });
  }

  // 7. Sample posts
  if (form.samplePosts > 0) {
    steps.push({
      step: 'wp-cli',
      command: `wp post generate --count=${form.samplePosts} --post_type=post --post_status=publish`,
    });
  }

  // 8. WXR import
  if (form.wxrPath) {
    steps.push({ step: 'importWxr', file: { resource: 'url', url: form.wxrPath } });
  }

  // 9. Internal fixed steps
  steps.push({ step: 'runPHP', code: WELCOME_GUIDE_PHP });
  steps.push(LOGIN_STEP);

  // 10. Unrepresentable extra steps preserved verbatim
  steps.push(...form.extraSteps);

  blueprint.steps = steps;
  return blueprint;
}

export function useBlueprintFormState(initialBlueprint) {
  const schemaRef = useRef(initialBlueprint?.$schema ?? null);
  const [formState, setFormState] = useState(() => blueprintToForm(initialBlueprint));

  useEffect(() => {
    schemaRef.current = initialBlueprint?.$schema ?? null;
    setFormState(blueprintToForm(initialBlueprint));
  }, [initialBlueprint]);

  const compiledBlueprint = useMemo(
    () => formToBlueprint(formState, schemaRef.current),
    [formState],
  );

  function updateForm(partial) {
    setFormState((prev) => ({ ...prev, ...partial }));
  }

  function loadBlueprint(bp) {
    schemaRef.current = bp?.$schema ?? null;
    setFormState(blueprintToForm(bp));
  }

  return {
    formState,
    updateForm,
    loadBlueprint,
    compiledBlueprint,
    hasExtraSteps: formState.extraSteps.length > 0,
  };
}
