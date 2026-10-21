export class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Express 4 does not catch rejected promises; route them to the error handler.
export const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(`[http] ${req.method} ${req.originalUrl}`, err);
    if (res.headersSent) return res.destroy();
    res.status(status).json({
        success: false,
        message: status >= 500 ? 'Something went wrong on our side.' : err.message
    });
}

export function contentDisposition(type, filename) {
    const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self' ws: wss:",
        "font-src 'self'",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'"
    ].join('; '));
    next();
}
