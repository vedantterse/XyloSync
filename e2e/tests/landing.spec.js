import { test, expect } from '@playwright/test';
import { createRoom } from './helpers.js';

test('landing shows the headline and creates a room', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Drop it here,');
    await expect(page.locator('h1')).toContainText('open it there.');
    await expect(page).toHaveTitle(/XyloSync/);

    await page.locator('#createRoom').click();
    await expect(page).toHaveURL(/\/room\/\d{5}$/);
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#usage')).toContainText('you own this room');
});

test('joining with a code typed in one go', async ({ page, browser }) => {
    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    await ownerPage.goto('/');
    const code = await createRoom(ownerPage);

    await page.goto('/');
    await page.locator('#codeInput input').first().click();
    // Autofill and some phone keyboards insert the whole code into the first box.
    await page.keyboard.insertText(code);
    await expect(page).toHaveURL(new RegExp(`/room/${code}$`));
    await expect(page.locator('#usage')).toContainText('owned by');
    await owner.close();
});

test('a wrong code is refused', async ({ page }) => {
    await page.goto('/');
    await page.locator('#codeInput input').first().click();
    await page.keyboard.insertText('00000');
    await expect(page.locator('.toast')).toContainText('no room 00000');
    await expect(page).toHaveURL(/\/$/);
});
