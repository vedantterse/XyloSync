import { defineConfig, devices } from '@playwright/test';

// Runs inside the official Playwright image on the Compose network:
//   docker compose --profile test run --rm e2e
export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    outputDir: 'test-results',
    use: {
        baseURL: process.env.BASE_URL || 'http://localhost:3000',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off'
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
        { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /(landing|visual|preview)\.spec\.js/ }
    ]
});
