import { test, expect } from '@playwright/test';
import { newPerson, openRoom, sendChat, message } from './helpers.js';

test('private room: waiting list, unique names, admit, deny and remove', async ({ browser }) => {
    const owner = await newPerson(browser, 'Maya');
    const guest = await newPerson(browser);          // keeps its generated name
    const copycat = await newPerson(browser);

    // The owner turns on "Private room" when creating it.
    await owner.page.goto('/');
    await owner.page.locator('.lede label.switch').click();
    await owner.page.locator('#createRoom').click();
    await expect(owner.page).toHaveURL(/\/room\/\d{5}$/);
    const code = owner.page.url().split('/').pop();
    await expect(owner.page.locator('#privateTag')).toBeVisible();
    await expect(owner.page.locator('#liveState .text')).toHaveText('Live');

    // A visitor lands in the waiting room, not the files.
    await guest.page.goto(`/room/${code}`);
    await expect(guest.page.getByRole('heading', { name: `Room ${code} is private` })).toBeVisible();
    await expect(guest.page.locator('#workspace')).toBeHidden();
    expect((await guest.page.request.get(`/api/rooms/${code}/files`)).status()).toBe(403);

    // The generated name is not allowed…
    const generated = (await (await guest.page.request.get('/api/me')).json()).user.name;
    await guest.page.locator('#lobbyName').fill(generated);
    await guest.page.locator('#lobbyAsk').click();
    await expect(guest.page.locator('#lobbyError')).toContainText('Choose your own name');

    // …and neither is a name already in the room, whatever its case.
    await guest.page.locator('#lobbyName').fill('mAyA');
    await guest.page.locator('#lobbyAsk').click();
    await expect(guest.page.locator('#lobbyError')).toContainText('already taken');

    await guest.page.locator('#lobbyName').fill('Dev Kapoor');
    await guest.page.locator('#lobbyAsk').click();
    await expect(guest.page.locator('#lobbyWaitText')).toHaveText('Asking to join as Dev Kapoor…');

    // A second visitor can't take the pending name either.
    await copycat.page.goto(`/room/${code}`);
    await copycat.page.locator('#lobbyName').fill('dev kapoor');
    await copycat.page.locator('#lobbyAsk').click();
    await expect(copycat.page.locator('#lobbyError')).toContainText('already taken');
    await copycat.page.locator('#lobbyName').fill('Sana');
    await copycat.page.locator('#lobbyAsk').click();
    await expect(copycat.page.locator('#lobbyWaitText')).toContainText('Sana');

    // The owner sees a card for each request, like a meeting lobby.
    const devCard = owner.page.locator('.request', { hasText: 'Dev Kapoor' });
    await expect(devCard).toBeVisible();
    await expect(owner.page.locator('#waitingBadge')).toHaveText('2');
    await devCard.getByRole('button', { name: 'Admit' }).click();
    await owner.page.locator('.request', { hasText: 'Sana' }).getByRole('button', { name: 'Deny' }).click();

    // Admitted: straight into the room, under the chosen name.
    await expect(guest.page.locator('#workspace')).toBeVisible();
    await expect(guest.page.locator('#liveState .text')).toHaveText('Live');
    await sendChat(guest.page, 'Thanks for letting me in');
    await expect(message(owner.page, 'Thanks for letting me in').locator('.who')).toHaveText('Dev Kapoor');

    // Denied: told so, and free to ask again.
    await expect(copycat.page.locator('#lobbyError')).toContainText('didn’t let you in');

    // The owner can remove someone; they lose access immediately.
    await owner.page.locator('#peopleBtn').click();
    const row = owner.page.locator('.popover .person', { hasText: 'Dev Kapoor' }).filter({ has: owner.page.getByRole('button', { name: 'Remove' }) });
    await row.getByRole('button', { name: 'Remove' }).click();
    await owner.page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
    await expect(guest.page.getByRole('heading', { name: 'You were removed from this room' })).toBeVisible();
    expect((await guest.page.request.get(`/api/rooms/${code}/messages`)).status()).toBe(403);

    for (const p of [owner, guest, copycat]) await p.context.close();
});

test('the owner of a private room is never asked to wait', async ({ browser }) => {
    const owner = await newPerson(browser, 'Lena');
    await owner.page.goto('/');
    const res = await owner.page.request.post('/api/rooms', { data: { requiresApproval: true } });
    const { room } = await res.json();
    await openRoom(owner.page, room.code);
    await expect(owner.page.locator('#usage')).toContainText('you own this room');
    await owner.context.close();
});
