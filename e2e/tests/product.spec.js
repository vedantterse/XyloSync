import { test, expect } from '@playwright/test';
import { newPerson, createRoom, openRoom } from './helpers.js';

const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025';

test('email: room files and an uploaded file arrive as one ZIP', async ({ browser }) => {
    const maya = await newPerson(browser, 'Maya');
    const code = await createRoom(maya.page);
    await openRoom(maya.page, code);
    await maya.page.locator('#fileInput').setInputFiles({ name: 'floor-plan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF plan') });
    await expect(maya.page.locator('.card', { hasText: 'floor-plan.pdf' })).toBeVisible();

    const to = `client-${Date.now()}@example.com`;
    await maya.page.locator('#mailBtn').click();
    const dialog = maya.page.getByRole('dialog');
    await dialog.locator('#mailTo').fill(`${to} `);
    await dialog.locator('#mailMsg').fill('Plan and invoice attached.');
    await dialog.locator('.pick', { hasText: 'floor-plan.pdf' }).click();
    await dialog.locator('#attachDrop input').setInputFiles({ name: 'invoice.txt', mimeType: 'text/plain', buffer: Buffer.from('invoice 42') });
    await expect(dialog.locator('.send-label')).toHaveText(/Send 2 files/);
    await dialog.locator('[type=submit]').click();
    await expect(maya.page.locator('.toast', { hasText: 'Email delivered to 1 recipient' })).toBeVisible({ timeout: 20_000 });

    const search = await (await maya.page.request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    expect(search.messages.length).toBe(1);
    const message = await (await maya.page.request.get(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`)).json();
    expect(message.Subject).toBe('Maya shared 2 files with you');
    expect(message.Text).toContain('Plan and invoice attached.');
    expect(message.Attachments.map((a) => a.FileName)).toEqual([expect.stringMatching(/^XyloSync-.*\.zip$/)]);
    await maya.context.close();
});

test('at the room limit, "Create a room" opens your rooms to open or delete one', async ({ browser }) => {
    const lena = await newPerson(browser, 'Lena');
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push(await createRoom(lena.page));

    await lena.page.goto('/');
    await expect(lena.page.locator('#roomsCount')).toHaveText('3');
    await lena.page.locator('#createRoom').click();
    const dialog = lena.page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'You already have 3 rooms' })).toBeVisible();
    await expect(dialog.locator('.room-row')).toHaveCount(3);
    await expect(dialog.locator('.room-row').first()).toContainText(/Deletes in (7 h 59|8 h 0) min/);
    await expect(dialog.locator('[data-create]')).toBeDisabled();

    // Delete one from the dialog, then create.
    await dialog.locator('.room-row', { hasText: codes[0] }).getByRole('button', { name: 'Delete' }).click();
    await lena.page.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
    await expect(dialog.locator('.room-row')).toHaveCount(2);
    await dialog.locator('[data-create]').click();
    await expect(lena.page).toHaveURL(/\/room\/\d{5}$/);
    await expect(lena.page.locator('#usage')).toContainText(/deletes in (7 h 59|8 h 0) min/);
    await lena.context.close();
});
