import { test, expect, devices } from '@playwright/test';
import { newPerson, createRoom, openRoom, sendChat, message } from './helpers.js';

// Not assertions on pixels: these screenshots are for a person to look at after a design change.
const shot = (page, name) => page.screenshot({ path: `screenshots/${test.info().project.name}-${name}.png` });

const svg = (a, b) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${a}"/><circle cx="560" cy="200" r="90" fill="${b}"/><path d="M0 470 260 260l180 140 140-110 220 180v130H0z" fill="${b}" opacity=".7"/></svg>`);

for (const scheme of ['light', 'dark']) {
    test(`landing (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/');
        await page.waitForTimeout(1300);
        await shot(page, `landing-${scheme}`);
        if (test.info().project.name === 'desktop') {
            // Midway through the finale: the sentence splits and the frame grows into the close.
            const y = await page.evaluate(() => {
                const story = document.getElementById('story');
                const reel = 4 * 0.75 * innerHeight;
                return story.offsetTop + reel + (story.offsetHeight - innerHeight - reel) * 0.45;
            });
            await page.evaluate((top) => scrollTo(0, top), y);
            await page.waitForTimeout(700);
            await shot(page, `landing-finale-${scheme}`);
        }
        await page.locator('.close').scrollIntoViewIfNeeded();
        await page.waitForTimeout(900);
        await shot(page, `landing-close-${scheme}`);
    });

    test(`room with files and chat (${scheme})`, async ({ browser }, info) => {
        const phone = info.project.name === 'phone';
        const device = phone ? devices['Pixel 7'] : {};
        const maya = await newPerson(browser, 'Maya', { ...device, colorScheme: scheme });
        const arjun = await newPerson(browser, 'Arjun Mehta', device);
        const code = await createRoom(maya.page);
        await openRoom(maya.page, code);
        await openRoom(arjun.page, code);

        const files = [
            { name: 'site-visit.svg', mimeType: 'image/svg+xml', buffer: svg('#9fb0a3', '#4f6354') },
            { name: 'moodboard.svg', mimeType: 'image/svg+xml', buffer: svg('#d9cbb8', '#8c6d4f') },
            { name: 'Q3 report.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2_400_000, 1) },
            { name: 'brief-v3.docx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(88_000, 1) },
            { name: 'build-1042.zip', mimeType: 'application/zip', buffer: Buffer.alloc(5_200_000, 1) },
            { name: 'walkthrough.mp4', mimeType: 'application/octet-stream', buffer: Buffer.alloc(3_100_000, 1) },
            { name: 'budget-q3.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(164_000, 1) }
        ];
        await arjun.page.locator('#fileInput').setInputFiles(files.slice(0, 4));
        await maya.page.locator('#fileInput').setInputFiles(files.slice(4));
        await expect(maya.page.locator('.card')).toHaveCount(files.length, { timeout: 20_000 });

        if (phone) await arjun.page.locator('#chatToggle').click();
        await sendChat(arjun.page, 'Uploaded the site photos and the brief.');
        await sendChat(maya.page, 'Great — the report is in too. Page 4 has the new split.');
        const m = message(arjun.page, 'Page 4 has the new split');
        const reveal = async () => (phone ? m.locator('.bubble').tap() : m.hover());
        await reveal();
        await m.locator('[data-a="reply"]').click();
        await arjun.page.locator('#chat textarea').fill('Perfect, printing it now');
        await arjun.page.locator('#chat textarea').press('Enter');
        await reveal();
        await m.locator('[data-a="react"]').click();
        await arjun.page.getByRole('button', { name: 'React 👍' }).click();
        await expect(message(maya.page, 'Perfect, printing it now')).toBeVisible();
        await maya.page.locator('.toast').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        await maya.page.waitForTimeout(600);

        if (phone) {
            await shot(maya.page, `room-files-${scheme}`);
            await maya.page.locator('#chatToggle').click();
            await maya.page.waitForTimeout(500);
            await shot(maya.page, `room-chat-${scheme}`);
        } else {
            await shot(maya.page, `room-${scheme}`);
            await maya.page.locator('#chatToggle').click();
            await maya.page.waitForTimeout(500);
            await shot(maya.page, `room-chat-hidden-${scheme}`);
            await maya.page.locator('[data-view="list"]').click();
            await shot(maya.page, `room-list-${scheme}`);
            await maya.page.locator('[data-view="grid"]').click();
        }
        await maya.context.close();
        await arjun.context.close();
    });
}

test('private room waiting screen and request card', async ({ browser }) => {
    const owner = await newPerson(browser, 'Maya');
    const guest = await newPerson(browser);
    const code = await createRoom(owner.page, { requiresApproval: true });
    await openRoom(owner.page, code);
    await guest.page.goto(`/room/${code}`);
    await shot(guest.page, 'lobby');
    await guest.page.locator('#lobbyName').fill('Dev Kapoor');
    await guest.page.locator('#lobbyAsk').click();
    await expect(owner.page.locator('.request')).toBeVisible();
    await owner.page.waitForTimeout(400);
    await shot(owner.page, 'request-card');
    await owner.context.close();
    await guest.context.close();
});
