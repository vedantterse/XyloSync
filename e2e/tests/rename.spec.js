import { test, expect } from '@playwright/test';
import { newPerson, createRoom, openRoom, sendChat, message } from './helpers.js';

async function renameFromMenu(page, name) {
    await page.locator('#roomMenuBtn').click();
    await page.getByRole('menuitem', { name: 'Change my name' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input').fill(name);
    await dialog.getByRole('button', { name: 'Save' }).click();
}

test('a new name shows up everywhere: files, chat, quotes, people and the owner line', async ({ browser }) => {
    const maya = await newPerson(browser, 'Maya');
    const arjun = await newPerson(browser, 'Arjun');
    const code = await createRoom(maya.page);
    await openRoom(maya.page, code);
    await openRoom(arjun.page, code);

    await arjun.page.locator('#fileInput').setInputFiles({ name: 'site.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await expect(maya.page.locator('.card', { hasText: 'site.txt' })).toContainText('Arjun');
    await sendChat(arjun.page, 'Photos are up');
    const onMaya = message(maya.page, 'Photos are up');
    await onMaya.hover();
    await onMaya.locator('[data-a="reply"]').click();
    await maya.page.locator('#chat textarea').fill('Thanks');
    await maya.page.locator('#chat textarea').press('Enter');
    await expect(message(arjun.page, 'Thanks').locator('.quote b')).toHaveText('You');

    // Arjun renames: Maya's screen updates without a reload.
    await renameFromMenu(arjun.page, 'Arjun Mehta');
    await expect(maya.page.locator('.card', { hasText: 'site.txt' })).toContainText('Arjun Mehta');
    await expect(message(maya.page, 'Photos are up').locator('.who')).toHaveText('Arjun Mehta');
    await expect(message(maya.page, 'Thanks').locator('.quote b')).toHaveText('Arjun Mehta');
    await expect(maya.page.locator('#presenceStack [title="Arjun Mehta"]')).toHaveCount(1);

    // The owner renames: the "owned by" line changes for everyone.
    await renameFromMenu(maya.page, 'Maya Rao');
    await expect(arjun.page.locator('#usage')).toContainText('owned by Maya Rao');
    await expect(message(arjun.page, 'Thanks').locator('.who')).toHaveText('Maya Rao');

    // And it all holds after a reload, because names are resolved on the server too.
    await maya.page.reload();
    await expect(message(maya.page, 'Photos are up').locator('.who')).toHaveText('Arjun Mehta');
    await expect(maya.page.locator('.card', { hasText: 'site.txt' })).toContainText('Arjun Mehta');
    await maya.context.close();
    await arjun.context.close();
});

test('in a private room a member renames within the room, and names stay unique', async ({ browser }) => {
    const owner = await newPerson(browser, 'Lena');
    const guest = await newPerson(browser);
    const other = await newPerson(browser);
    const code = await createRoom(owner.page, { requiresApproval: true });
    for (const [p, name] of [[guest, 'Dev'], [other, 'Sana']]) {
        await p.page.request.post(`/api/rooms/${code}/requests`, { data: { name } });
    }
    for (const r of (await (await owner.page.request.get(`/api/rooms/${code}/requests`)).json()).requests) {
        await owner.page.request.post(`/api/rooms/${code}/requests/${r.id}/admit`);
    }
    await openRoom(owner.page, code);
    await openRoom(guest.page, code);
    await sendChat(guest.page, 'Hi from Dev');

    // Taking someone else's name (any case) is refused.
    await renameFromMenu(guest.page, 'sana');
    await expect(guest.page.locator('.toast')).toContainText('already taken');
    await guest.page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await renameFromMenu(guest.page, 'Dev Kapoor');
    await expect(message(owner.page, 'Hi from Dev').locator('.who')).toHaveText('Dev Kapoor');
    // The old name is free again; the new one is taken.
    const taken = await other.page.request.patch(`/api/rooms/${code}/me`, { data: { name: 'dev kapoor' } });
    expect(taken.status()).toBe(409);
    expect((await other.page.request.patch(`/api/rooms/${code}/me`, { data: { name: 'Dev' } })).ok()).toBeTruthy();

    // The owner can't take a member's name either.
    expect((await owner.page.request.patch('/api/me', { data: { name: 'Dev Kapoor' } })).status()).toBe(409);
    for (const p of [owner, guest, other]) await p.context.close();
});
