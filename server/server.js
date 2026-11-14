import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { redis } from './redis.js';
import { minio, BUCKET, ensureBucket, enableBucketWebhook } from './storage.js';
import { identity, parseCookies } from './identity.js';
import { createRealtime } from './realtime.js';
import { createApi } from './api.js';
import { createWebhooks } from './webhooks.js';
import { errorHandler, securityHeaders } from './http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const fontDir = (pkg) => path.join(__dirname, '..', 'node_modules', '@fontsource-variable', pkg, 'files');

const app = express();
const httpServer = createServer(app);
// Large uploads can take a long time; Node's default 5 minute request timeout would cut them off.
httpServer.requestTimeout = 0;
httpServer.headersTimeout = 60_000;
httpServer.keepAliveTimeout = 65_000;

const io = createRealtime(httpServer);

app.disable('x-powered-by');
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

app.get('/healthz', async (req, res) => {
    try {
        await Promise.all([redis.ping(), minio.bucketExists(BUCKET)]);
        res.json({ ok: true });
    } catch (err) {
        res.status(503).json({ ok: false, error: err.message });
    }
});

// MinIO calls this from inside the Docker network; it has its own token auth.
app.use(createWebhooks(io));

app.use(securityHeaders);
app.use('/vendor/geist', express.static(fontDir('geist'), { maxAge: '30d', immutable: true }));
app.use('/vendor/geist-mono', express.static(fontDir('geist-mono'), { maxAge: '30d', immutable: true }));
// PDF.js draws PDFs on phones, whose browsers can't show one inside a page. Served from our own
// node_modules like the fonts; .mjs needs an explicit JavaScript type for module loading.
const pdfjsDir = (...parts) => path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', ...parts);
const vendorOptions = {
    maxAge: '30d',
    immutable: true,
    setHeaders: (res, file) => { if (file.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); }
};
app.use('/vendor/pdfjs/build', express.static(pdfjsDir('legacy', 'build'), vendorOptions));
app.use('/vendor/pdfjs/cmaps', express.static(pdfjsDir('cmaps'), vendorOptions));
app.use('/vendor/pdfjs/standard_fonts', express.static(pdfjsDir('standard_fonts'), vendorOptions));
// maxAge 0 + ETag: browsers revalidate, so a rebuilt image never serves stale JS/CSS.
app.use(express.static(publicDir, { index: false, maxAge: 0 }));

app.use(parseCookies, identity);
app.use('/api', createApi(io));
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Not found.' }));

const page = (file) => (req, res) => res.sendFile(path.join(publicDir, file));
app.get('/', page('index.html'));
app.get('/room/:code', page('room.html'));
app.get(['/how', '/how-it-works'], page('how.html'));
// Old XyloSync URLs.
app.get(['/homepage', '/homepage.html', '/index.html'], (req, res) => res.redirect(301, '/'));
app.use((req, res) => res.status(404).sendFile(path.join(publicDir, 'index.html')));

app.use(errorHandler);

async function start() {
    await ensureBucket();
    await new Promise((resolve) => httpServer.listen(config.port, resolve));
    console.log(`[server] ${config.appName} listening on :${config.port}`);
    // Registered after we're listening so MinIO can reach the webhook endpoint.
    enableBucketWebhook().catch((err) => console.error('[storage] bucket webhook setup failed:', err.message));
}

start().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
});

const shutdown = () => {
    console.log('[server] shutting down');
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
