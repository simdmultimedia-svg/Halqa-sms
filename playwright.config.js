import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173', // Vite dev server or preview
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* Mobile viewports */
    {
      name: 'Mobile Chrome (320px)',
      use: { ...devices['Pixel 5'], viewport: { width: 320, height: 600 } },
    },
    {
      name: 'Mobile Safari (375px)',
      use: { ...devices['iPhone 12'], viewport: { width: 375, height: 667 } },
    },
    {
      name: 'Tablet (768px)',
      use: { ...devices['iPad Mini'], viewport: { width: 768, height: 1024 } },
    },
  ],
  webServer: {
    command: 'npm run preview', // Let's use preview for prod parity
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
