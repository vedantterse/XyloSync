import { expect } from '@playwright/test';

// Each browser context is a separate visitor with its own signed identity cookie.
export async function newPerson(browser, name, options = {}) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    if (name) {
        await page.goto('/');
        const res = await page.request.patch('/api/me', { data: { name } });
        expect(res.ok()).toBeTruthy();
    }
    return { context, page };
}

export async function createRoom(page, { requiresApproval = false } = {}) {
    const res = await page.request.post('/api/rooms', { data: { requiresApproval } });
    expect(res.status()).toBe(201);
    const { room } = await res.json();
    return room.code;
}

export async function openRoom(page, code) {
    await page.goto(`/room/${code}`);
    await expect(page.locator('#workspace')).toBeVisible();
    await expect(page.locator('#liveState .text')).toHaveText('Live');
}

export const chatInput = (page) => page.locator('#chat textarea');

export async function sendChat(page, text) {
    await chatInput(page).fill(text);
    await chatInput(page).press('Enter');
    await expect(page.locator('#chat .msg.me .text', { hasText: text })).toBeVisible();
    await expect(page.locator('#chat .msg.me.pending')).toHaveCount(0);
}

export const message = (page, text) => page.locator('#chat .msg', { has: page.locator('.text', { hasText: text }) });
