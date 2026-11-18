import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4183/pages-check/'

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'npm run build -- --base=/pages-check/ && npm run preview -- --host 127.0.0.1 --port 4183 --strictPort --base=/pages-check/',
    url: baseURL,
  },
})
