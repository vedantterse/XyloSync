import http from 'http';
import { test, expect } from '@playwright/test';
import { newPerson, sendChat, createRoom, openRoom } from './helpers.js';

// Someone removed from a private room must lose every way in — HTTP, sockets, email — and can
// only come back by asking again and being admitted again.
test('a removed person cannot get back into a private room', async ({ browser }) => {
    const owner = await newPerson(browser, 'Maya');
    const guest = await newPerson(browser);
    const req = guest.page.request;

    const { room } = await (await owner.page.request.post('/api/rooms', { data: { requiresApproval: true } })).json();
    const code = room.code;
    await owner.page.goto(`/room/${code}`);
    await expect(owner.page.locator('#liveState .text')).toHaveText('Live');
    await owner.page.locator('#fileInput').setInputFiles({ name: 'secret-plan.txt', mimeType: 'text/plain', buffer: Buffer.from('top secret') });
    await expect(owner.page.locator('.card', { hasText: 'secret-plan.txt' })).toBeVisible();

    // Guest asks, owner admits.
    expect((await req.post(`/api/rooms/${code}/requests`, { data: { name: 'Dev' } })).status()).toBe(201);
    const pid = (await (await owner.page.request.get(`/api/rooms/${code}/requests`)).json()).requests[0].id;
    expect((await owner.page.request.post(`/api/rooms/${code}/requests/${pid}/admit`)).ok()).toBeTruthy();
    await guest.page.goto(`/room/${code}`);
    await expect(guest.page.locator('#liveState .text')).toHaveText('Live');
    await sendChat(guest.page, 'Hello from Dev');

    // A second, hand-made socket that is already watching the room before the removal.
    await guest.page.evaluate(async (c) => {
        window.__s = io({ transports: ['websocket'] });
        window.__got = [];
        window.__s.on('chat:message', (m) => window.__got.push(m.text));
        await new Promise((r) => window.__s.on('connect', r));
        window.__watch = await new Promise((r) => window.__s.emit('room:watch', c, r));
    }, code);
    expect(await guest.page.evaluate(() => window.__watch.ok)).toBe(true);

    // The owner removes the guest.
    expect((await owner.page.request.delete(`/api/rooms/${code}/members/${pid}`)).ok()).toBeTruthy();
    await expect(guest.page.getByRole('heading', { name: 'You were removed from this room' })).toBeVisible();

    // Every HTTP route is closed.
    const blocked = [
        await req.get(`/api/rooms/${code}/files`),
        await req.get(`/api/rooms/${code}/files/secret-plan.txt`),
        await req.get(`/api/rooms/${code}/files/secret-plan.txt?inline=1`),
        await req.get(`/api/rooms/${code}/archive`),
        await req.get(`/api/rooms/${code}/messages`),
        await req.get(`/api/rooms/${code}/members`),
        await req.post(`/api/rooms/${code}/notes`, { data: { content: 'sneaky' } }),
        await req.post(`/api/rooms/${code}/files`, { headers: { 'X-File-Name': 'sneaky.txt', 'Content-Type': 'application/octet-stream' }, data: Buffer.from('x') }),
        await req.post('/api/mail/send', { data: { roomCode: code, roomFiles: ['secret-plan.txt'], recipients: ['me@example.com'] } })
    ];
    for (const res of blocked) expect(res.status(), res.url()).toBe(403);

    // The old socket can no longer act, and no longer hears the room.
    const afterRemoval = await guest.page.evaluate(async (c) => {
        const send = await new Promise((r) => window.__s.emit('chat:send', { text: 'still here?' }, r));
        const rewatch = await new Promise((r) => window.__s.emit('room:watch', c, r));
        const fresh = io({ transports: ['websocket'] });
        await new Promise((r) => fresh.on('connect', r));
        const freshWatch = await new Promise((r) => fresh.emit('room:watch', c, r));
        const freshSend = await new Promise((r) => fresh.emit('chat:send', { text: 'new socket' }, r));
        return { send: send.ok, rewatch: rewatch.ok, freshWatch: freshWatch.ok, freshSend: freshSend.ok };
    }, code);
    expect(afterRemoval).toEqual({ send: false, rewatch: false, freshWatch: false, freshSend: false });
    await sendChat(owner.page, 'Only members can read this');
    await owner.page.waitForTimeout(500);
    expect(await guest.page.evaluate(() => window.__got)).not.toContain('Only members can read this');

    // Asking again puts them back in the waiting room — not straight into the room.
    expect((await req.post(`/api/rooms/${code}/requests`, { data: { name: 'Dev again' } })).status()).toBe(201);
    const info = await (await req.get(`/api/rooms/${code}`)).json();
    expect(info.room.access).toBe('pending');
    expect((await req.get(`/api/rooms/${code}/files`)).status()).toBe(403);

    // Spamming requests is throttled.
    let last;
    for (let i = 0; i < 8; i++) last = await req.post(`/api/rooms/${code}/requests`, { data: { name: `Dev ${i}` } });
    expect(last.status()).toBe(429);

    // A cleared cookie is just a stranger: still has to ask.
    const stranger = await newPerson(browser);
    expect((await stranger.page.request.get(`/api/rooms/${code}/files`)).status()).toBe(403);

    for (const p of [owner, guest, stranger]) await p.context.close();
});

test('identity cookies cannot be forged to become the owner', async ({ browser }) => {
    const owner = await newPerson(browser, 'Maya');
    const code = (await (await owner.page.request.post('/api/rooms', { data: { requiresApproval: true } })).json()).room.code;
    const cookie = (await owner.context.cookies()).find((c) => c.name === 'fs_id');

    const forger = await browser.newContext();
    // Copy the owner's cookie but change the name inside it: the signature no longer matches.
    const tampered = decodeURIComponent(cookie.value).replace('Maya', 'Mallory');
    await forger.addCookies([{ ...cookie, value: encodeURIComponent(tampered) }]);
    const page = await forger.newPage();
    const res = await page.request.get(`/api/rooms/${code}`);
    expect((await res.json()).room.isOwner).toBe(false);
    expect((await page.request.delete(`/api/rooms/${code}`)).status()).toBe(403);
    await forger.close();
    await owner.context.close();
});

// Each upload is capped at 15 MB: the server refuses bigger or unsized bodies outright, and the
// room page refuses big files before sending a byte.
test('uploads over 15 MB are refused', async ({ browser, baseURL }) => {
    const maya = await newPerson(browser, 'Maya');
    const code = await createRoom(maya.page);
    const url = `/api/rooms/${code}/files`;
    const upload = (name, size) => maya.page.request.post(url, {
        headers: { 'X-File-Name': name, 'Content-Type': 'application/octet-stream' },
        data: Buffer.alloc(size, 1)
    });

    expect((await upload('fits.bin', 15 * 1024 * 1024)).status()).toBe(201);

    // The rest goes over a raw connection: the server answers from the headers alone and closes
    // without reading the body, which a client still busy sending would see as a broken pipe.
    const cookie = (await maya.context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const send = (headers, body = Buffer.alloc(0)) => new Promise((resolve, reject) => {
        const req = http.request(new URL(url, baseURL), {
            method: 'POST',
            headers: { cookie, 'Content-Type': 'application/octet-stream', ...headers }
        }, (res) => {
            let text = '';
            res.on('data', (chunk) => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, text }));
        });
        req.on('error', reject);
        req.write(body);
        // Leave an oversized body unsent: the answer has to come before any of it is read.
        if (!headers['Content-Length']) req.end();
    });

    const big = await send({ 'X-File-Name': 'too-big.bin', 'Content-Length': String(15 * 1024 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect(JSON.parse(big.text).message).toContain('15 MB');

    // A chunked body has no length to check up front, so it is refused before it is read.
    const chunked = await send({ 'X-File-Name': 'chunked.bin', 'Transfer-Encoding': 'chunked' }, Buffer.alloc(1024, 1));
    expect(chunked.status).toBe(411);

    await openRoom(maya.page, code);
    await expect(maya.page.locator('.card')).toHaveCount(1);
    await maya.page.locator('#fileInput').setInputFiles({ name: 'huge-video.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(16 * 1024 * 1024, 1) });
    await expect(maya.page.locator('.toast', { hasText: 'huge-video.mp4 is over the 15 MB limit' })).toBeVisible();
    await maya.page.waitForTimeout(500);
    await expect(maya.page.locator('.card')).toHaveCount(1);
    await maya.context.close();
});
