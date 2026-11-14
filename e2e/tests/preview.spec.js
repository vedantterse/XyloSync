import { test, expect } from '@playwright/test';
import { createRoom, openRoom } from './helpers.js';

// A one-page PDF that says "Hello PDF".
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 40 100 Td (Hello PDF) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#9fb0a3"/></svg>');

// Phones can't show a PDF inside a page, so the preview draws it with PDF.js there and keeps the
// browser's own viewer on desktop. On phones a sideways swipe moves between files.
test('file previews work, including PDFs on phones', async ({ page }, info) => {
    const phone = info.project.name === 'phone';
    const code = await createRoom(page);
    await openRoom(page, code);
    await page.locator('#fileInput').setInputFiles([
        { name: 'photo.svg', mimeType: 'image/svg+xml', buffer: svg },
        { name: 'plan.pdf', mimeType: 'application/pdf', buffer: pdf }
    ]);
    await expect(page.locator('.card')).toHaveCount(2, { timeout: 15_000 });

    const card = page.locator('.card', { hasText: 'plan.pdf' });
    if (phone) await card.tap(); else await card.click();
    const preview = page.locator('.preview');
    await expect(preview.locator('.title strong')).toHaveText('plan.pdf');
    // Browsers with a built-in PDF viewer (desktop, not headless) keep it; everything else gets PDF.js.
    const native = await page.evaluate(() => navigator.pdfViewerEnabled && !matchMedia('(pointer: coarse)').matches);
    if (phone) expect(native).toBe(false);
    if (!native) {
        await expect(preview.locator('.pdf-page canvas')).toHaveCount(1);
        expect(await preview.locator('.pdf-page canvas').evaluate((c) => c.width)).toBeGreaterThan(300);
    } else {
        await expect(preview.locator('iframe')).toHaveAttribute('src', /plan\.pdf/);
    }

    if (phone) {
        // Swipe left: the next file opens.
        const stage = preview.locator('.stage');
        const box = await stage.boundingBox();
        const y = box.y + box.height / 2;
        await stage.dispatchEvent('touchstart', { touches: [{ identifier: 0, clientX: box.x + box.width - 40, clientY: y }], changedTouches: [] });
        await stage.dispatchEvent('touchend', { touches: [], changedTouches: [{ identifier: 0, clientX: box.x + 40, clientY: y }] });
        await expect(preview.locator('.title strong')).toHaveText('photo.svg');
        await expect(preview.locator('.pdf-pages')).toHaveCount(0);
    } else {
        await page.keyboard.press('ArrowRight');
        await expect(preview.locator('.title strong')).toHaveText('photo.svg');
    }
    await expect(preview.locator('.stage img')).toBeVisible();
    await preview.locator('[data-close]').click();
    await expect(preview).toHaveCount(0);
});
