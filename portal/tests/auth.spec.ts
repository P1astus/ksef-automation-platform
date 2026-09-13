import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the starting URL before each test.
    await page.goto('http://localhost:3000/login');
  });

  test('should allow a user to log in with valid credentials', async ({ page }) => {
    // Fill in the email and password
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'Admin1234!');

    // Click the login button
    await page.click('button[type="submit"]');

    // Wait for the URL to change to the dashboard
    await page.waitForURL('**/dashboard');

    // Verify that we are on the dashboard by checking for a specific element
    await expect(page).toHaveURL(/.*dashboard/);
    
    // Check if the Dashboard heading is visible
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');

    await page.click('button[type="submit"]');

    // Check for an error message
    const errorMessage = page.locator('text=⚠').first();
    await expect(errorMessage).toBeVisible();
  });

  test('should allow a user to log out', async ({ page }) => {
    // Login first
    await page.fill('input[type="email"]', 'admin@example.com');
    await page.fill('input[type="password"]', 'Admin1234!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    await page.waitForLoadState('networkidle');

    // Click logout button with force to bypass layout overlaps
    await page.locator('button:has-text("Wyloguj się")').click({ force: true });

    // Verify redirection to login page
    await expect(page).toHaveURL(/.*login/, { timeout: 10000 });
  });
});
