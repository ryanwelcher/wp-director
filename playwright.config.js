// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './recordings',
  outputDir: './output',
  workers: 1,
  timeout: 120_000,

  globalSetup: './global-setup.js',
  globalTeardown: './global-teardown.js',

  use: {
    baseURL: 'http://127.0.0.1:9400',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 },
    },
    trace: 'on',    // always record trace for interactive replay
    screenshot: 'on', // capture screenshots on each step
    launchOptions: {
      slowMo: 500,  // slow down actions so the recording is easier to follow
      args: ['--remote-debugging-port=9222'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
