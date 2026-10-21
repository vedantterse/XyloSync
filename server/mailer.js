import nodemailer from 'nodemailer';
import { config } from './config.js';

export const transporter = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined
});

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);

const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

export function renderMail({ senderName, message, files }) {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const rows = files.map((f) => `
        <tr>
            <td style="padding:10px 0;border-bottom:1px solid #26262b;color:#e4e4e7;font-size:14px;">${escapeHtml(f.name)}</td>
            <td style="padding:10px 0;border-bottom:1px solid #26262b;color:#a1a1aa;font-size:13px;text-align:right;white-space:nowrap;">${formatBytes(f.size)}</td>
        </tr>`).join('');
    const note = message
        ? `<div style="margin:24px 0;padding:16px 18px;border-radius:12px;background:#17171b;border:1px solid #26262b;color:#d4d4d8;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</div>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Files from ${escapeHtml(senderName)}</title></head>
<body style="margin:0;padding:32px 16px;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#111114;border:1px solid #232328;border-radius:18px;overflow:hidden;">
    <tr><td style="height:4px;background:linear-gradient(90deg,#a78bfa,#5eead4);"></td></tr>
    <tr><td style="padding:32px 32px 8px;">
      <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#a78bfa;font-weight:600;">XyloSync</div>
      <h1 style="margin:12px 0 4px;font-size:22px;line-height:1.3;color:#fafafa;font-weight:650;">${escapeHtml(senderName)} sent you ${files.length} file${files.length === 1 ? '' : 's'}</h1>
      <p style="margin:0;color:#a1a1aa;font-size:14px;">${formatBytes(totalSize)} total &middot; attached as a single ZIP archive</p>
      ${note}
    </td></tr>
    <tr><td style="padding:8px 32px 28px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
    </td></tr>
    <tr><td style="padding:18px 32px;background:#0d0d10;color:#71717a;font-size:12px;">Delivered by your self-hosted XyloSync instance.</td></tr>
  </table>
</body></html>`;

    const text = [
        `${senderName} sent you ${files.length} file(s) via XyloSync.`,
        message ? `\nMessage:\n${message}\n` : '',
        ...files.map((f) => `- ${f.name} (${formatBytes(f.size)})`)
    ].join('\n');

    return { html, text, subject: `${senderName} shared ${files.length} file${files.length === 1 ? '' : 's'} with you` };
}
