import { test, expect } from '@playwright/test';

// Use environment variables or placeholders until provided
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com'; // TODO: Replace with real credentials
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'password123'; // TODO: Replace with real credentials

test.describe('Authentication', () => {
  test('Successful Login and Dashboard Load', async ({ page }) => {
    await page.goto('/');

    // Wait for initialization to finish and the button to become enabled
    await expect(page.locator('#login-btn')).toHaveText('Sign In', { timeout: 15000 });
    await expect(page.locator('#login-btn')).not.toBeDisabled();

    // Fill credentials
    await page.locator('#login-email').fill(TEST_EMAIL);
    await page.locator('#login-password').fill(TEST_PASSWORD);

    // Submit
    await page.locator('#login-btn').click();

    // Verify successful login by checking for the Dashboard/App View
    await expect(page.locator('#app-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#nav')).toBeVisible();
    
    // Verify Health Status pill says Online
    await expect(page.locator('#net-status')).toContainText('Online', { timeout: 5000 });
  });

  test('Logout', async ({ page }) => {
    // We must login first
    await page.goto('/');
    await expect(page.locator('#login-btn')).toHaveText('Sign In', { timeout: 15000 });
    await page.locator('#login-email').fill(TEST_EMAIL);
    await page.locator('#login-password').fill(TEST_PASSWORD);
    await page.locator('#login-btn').click();
    await expect(page.locator('#app-view')).toBeVisible({ timeout: 15000 });

    // Click logout
    await page.locator('#logout-btn').click();

    // Verify returned to login view
    await expect(page.locator('#login-view')).toBeVisible();
    await expect(page.locator('#app-view')).toBeHidden();
  });
});
