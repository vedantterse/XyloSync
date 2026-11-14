// PDF previews on phones. Mobile browsers can't show a PDF inside a page (Android shows a blank
// frame, iOS only the first page), so there we draw each page ourselves with PDF.js. It's served
// from our own server and only loaded the first time someone opens a PDF.
const BASE = '/vendor/pdfjs';
let library = null;

function pdfjs() {
    library ||= import(`${BASE}/build/pdf.min.mjs`).then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = `${BASE}/build/pdf.worker.min.mjs`;
        return lib;
    });
    return library;
}

// Desktop browsers have a good built-in viewer; touch devices and browsers without one get ours.
export const drawsPdfItself = () => !navigator.pdfViewerEnabled || matchMedia('(pointer: coarse)').matches;

// Returns { el, destroy }. Pages are drawn as they scroll into view, at the screen's sharpness.
export function pdfView(src, { onError } = {}) {
    const el = document.createElement('div');
    el.className = 'pdf-pages';
    const status = document.createElement('p');
    status.className = 'pdf-status';
    status.textContent = 'Loading…';
    el.append(status);

    let doc = null;
    let destroyed = false;
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            drawPage(entry.target).catch(() => {});
        }
    }, { root: el, rootMargin: '800px 0px' });

    async function drawPage(slot) {
        if (destroyed) return;
        const page = await doc.getPage(Number(slot.dataset.page));
        const cssWidth = slot.clientWidth;
        const scale = cssWidth / page.getViewport({ scale: 1 }).width;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * ratio });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (destroyed) return;
        slot.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        slot.replaceChildren(canvas);
        page.cleanup();
    }

    (async () => {
        try {
            const { getDocument } = await pdfjs();
            const task = getDocument({
                url: src,
                withCredentials: true,
                isEvalSupported: false,
                cMapUrl: `${BASE}/cmaps/`,
                cMapPacked: true,
                standardFontDataUrl: `${BASE}/standard_fonts/`
            });
            doc = await task.promise;
            if (destroyed) return doc.destroy();
            // Every page gets a placeholder of the right shape first, so scrolling doesn't jump.
            const first = (await doc.getPage(1)).getViewport({ scale: 1 });
            status.remove();
            for (let n = 1; n <= doc.numPages; n++) {
                const slot = document.createElement('div');
                slot.className = 'pdf-page';
                slot.dataset.page = String(n);
                slot.style.aspectRatio = `${first.width} / ${first.height}`;
                slot.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`);
                el.append(slot);
                observer.observe(slot);
            }
        } catch {
            if (destroyed) return;
            status.textContent = 'Couldn’t show this PDF here.';
            onError?.(el);
        }
    })();

    return {
        el,
        destroy() {
            destroyed = true;
            observer.disconnect();
            doc?.destroy();
        }
    };
}
