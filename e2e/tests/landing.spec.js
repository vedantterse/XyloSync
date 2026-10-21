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

test('the header "Create room" button creates a room', async ({ page }) => {
    await page.goto('/');
    await page.locator('#navCreate').click();
    await expect(page).toHaveURL(/\/room\/\d{5}$/);
});

test('nothing on the landing page is wider than the screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('.close').scrollIntoViewIfNeeded();
    // The day timeline's track is meant to extend past the screen (it scrolls sideways inside
    // a clipped window); everything else must fit, and the page itself must never scroll sideways.
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.story, .day-track'))
        .map((el) => el.className || el.tagName));
    expect(overflow).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});

test('how it works: a sample file reaches every screen', async ({ page }) => {
    await page.goto('/how');
    await page.locator('#realSpeed').check({ force: true });
    await page.locator('#sendSample').click();
    await expect(page.locator('.station[data-key="screens"]')).toHaveClass(/reached/, { timeout: 15_000 });
    await expect(page.locator('#exTitle')).toHaveText(/Every screen has Q3 report\.pdf/);
    await page.locator('#nameTry').fill('ARJUN');
    await expect(page.locator('#verdict')).toContainText('Turned away');
});

test('with reduced motion the story is shown still and complete', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/still/);
    await page.locator('#statement').scrollIntoViewIfNeeded();
    await expect(page.locator('.phrase .sub').first()).toHaveCSS('opacity', '1');
    await page.locator('#numbers').scrollIntoViewIfNeeded();
    await expect(page.locator('.figure [data-value]').first()).toHaveText('60');
    await ctx.close();
});
