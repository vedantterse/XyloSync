import { test, expect } from '@playwright/test';
import { newPerson, createRoom, openRoom, chatInput, sendChat, message } from './helpers.js';

test.describe('an open room', () => {
    let maya;
    let arjun;
    let code;

    test.beforeEach(async ({ browser }) => {
        maya = await newPerson(browser, 'Maya');
        arjun = await newPerson(browser, 'Arjun');
        code = await createRoom(maya.page);
        await openRoom(maya.page, code);
        await openRoom(arjun.page, code);
        await expect(maya.page.locator('#presenceCount')).toHaveText('2');
    });

    test.afterEach(async () => {
        await maya.context.close();
        await arjun.context.close();
    });

    test('a file uploaded by one person appears for the other without a refresh', async () => {
        await maya.page.locator('#fileInput').setInputFiles({
            name: 'Q3 report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test')
        });
        const card = arjun.page.locator('.card', { hasText: 'Q3 report.pdf' });
        await expect(card).toBeVisible();
        await expect(card.locator('.new')).toBeVisible();
        await expect(arjun.page.locator('.toast')).toContainText('Maya added Q3 report.pdf');
        await expect(arjun.page.locator('#usage')).toContainText('1 file');

        // Only the owner can delete, and the deletion reaches the other screen too.
        await expect(arjun.page.locator('.card [data-act="delete"]')).toHaveCount(0);
        await maya.page.locator('.card', { hasText: 'Q3 report.pdf' }).hover();
        await maya.page.locator('.card [data-act="delete"]').click();
        await maya.page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(card).toHaveCount(0);
    });

    test('chat: send, reply, react, edit, delete and typing', async () => {
        await sendChat(maya.page, 'Numbers for Thursday are in');
        const onArjun = message(arjun.page, 'Numbers for Thursday are in');
        await expect(onArjun).toBeVisible();
        await expect(onArjun.locator('.who')).toHaveText('Maya');

        // typing indicator
        await chatInput(arjun.page).pressSequentially('Got', { delay: 40 });
        await expect(maya.page.locator('#chat .typing')).toHaveText('Arjun is typing…');

        // reply
        await onArjun.hover();
        await onArjun.locator('[data-a="reply"]').click();
        await expect(arjun.page.locator('#chat .context')).toContainText('Replying to Maya');
        await chatInput(arjun.page).fill('Got it, printing now');
        await chatInput(arjun.page).press('Enter');
        const reply = message(maya.page, 'Got it, printing now');
        await expect(reply.locator('.quote')).toContainText('Numbers for Thursday are in');
        await expect(maya.page.locator('#chat .typing')).toHaveText('');

        // react: one reaction per person, visible to both
        await onArjun.hover();
        await onArjun.locator('[data-a="react"]').click();
        await arjun.page.getByRole('button', { name: 'React ❤️' }).click();
        const onMaya = message(maya.page, 'Numbers for Thursday are in');
        await expect(onMaya.locator('.reaction')).toHaveText('❤️');
        await message(maya.page, 'Numbers for Thursday are in').locator('.reaction').click();
        await expect(onMaya.locator('.reaction')).toContainText('2');
        await expect(onArjun.locator('.reaction .n')).toHaveText('2');

        // edit with the up arrow, like a desktop chat app
        await chatInput(maya.page).press('ArrowUp');
        await expect(maya.page.locator('#chat .context')).toContainText('Editing message');
        await chatInput(maya.page).fill('Numbers for Friday are in');
        await chatInput(maya.page).press('Enter');
        const edited = message(arjun.page, 'Numbers for Friday are in');
        await expect(edited.locator('.stamp')).toContainText('edited');
        await expect(message(maya.page, 'Got it, printing now').locator('.quote')).toContainText('Numbers for Friday are in');

        // delete own message
        const own = message(arjun.page, 'Got it, printing now');
        await own.hover();
        await own.locator('[data-a="more"]').click();
        await arjun.page.getByRole('menuitem', { name: 'Delete for everyone' }).click();
        await arjun.page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(maya.page.locator('#chat .msg.deleted .text')).toHaveText('This message was deleted');

        // history survives a reload
        await arjun.page.reload();
        await expect(message(arjun.page, 'Numbers for Friday are in')).toBeVisible();
    });

    test('hiding the chat gives the files the space and counts unread messages', async () => {
        const filesBefore = await maya.page.locator('#filesPane').boundingBox();
        await maya.page.locator('#chatToggle').click();
        await expect(maya.page.locator('#workspace')).toHaveClass(/chat-hidden/);
        await expect.poll(async () => (await maya.page.locator('#filesPane').boundingBox()).width).toBeGreaterThan(filesBefore.width + 300);

        await sendChat(arjun.page, 'Anyone there?');
        await expect(maya.page.locator('#unreadBadge')).toHaveText('1');
        await maya.page.locator('#chatToggle').click();
        await expect(maya.page.locator('#unreadBadge')).toBeHidden();
        await expect(message(maya.page, 'Anyone there?')).toBeVisible();
    });

    test('deleting the room sends everyone home and deletes the chat', async () => {
        await sendChat(arjun.page, 'This will be gone');
        await maya.page.locator('#roomMenuBtn').click();
        await maya.page.getByRole('menuitem', { name: 'Delete room' }).click();
        await maya.page.getByRole('alertdialog').getByRole('button', { name: 'Delete room' }).click();
        await expect(maya.page).toHaveURL(/\/$/);
        await expect(arjun.page.getByRole('heading', { name: 'This room was deleted' })).toBeVisible();
        const res = await arjun.page.request.get(`/api/rooms/${code}/messages`);
        expect(res.status()).toBe(404);
    });
});
