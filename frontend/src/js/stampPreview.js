import { escapeHtml } from './utils.js';
import { iconSvg } from './icons.js';
import { escapeAttr } from './certificateRenderer.js';

/**
 * What a visible signature draws on the page (internal/signature/appearance.go):
 * the image, then one line each for the signer, the date, the location and the
 * custom text, as the profile turns them on. Shared by the profile editor's
 * preview and the signature box on the page. html is '' when nothing shows;
 * iconPlaceholder stands in for an image the profile shows but has not chosen.
 */
export function stampParts(appearance = {}, { signerName = '', date = '', location = '', iconDataUrl = null, iconPlaceholder = false } = {}) {
    const lines = [];
    const line = (label, value) => `<div class="preview-line"><span class="preview-label">${label}</span> ${escapeHtml(value)}</div>`;
    if (appearance.showSignerName) lines.push(line('Signed by', signerName));
    if (appearance.showSigningTime) lines.push(line('Date', date));
    if (appearance.showLocation && location) lines.push(line('Location', location));
    const customText = (appearance.customText || '').trim();
    if (customText) lines.push(`<div class="preview-line preview-custom">${escapeHtml(customText)}</div>`);

    let icon = '';
    if (appearance.showLogo && iconDataUrl) icon = `<img src="${escapeAttr(iconDataUrl)}" alt="" class="preview-icon">`;
    else if (appearance.showLogo && iconPlaceholder) icon = `<span class="preview-icon preview-icon-empty">${iconSvg('image')}</span>`;

    const layout = appearance.logoPosition === 'top' ? 'icon-top' : 'icon-left';
    const html = icon || lines.length ? `${icon}${lines.length ? `<div class="preview-text">${lines.join('')}</div>` : ''}` : '';
    return { html, layout, lines: lines.length };
}

/** The date as the previews show it. */
export const stampDate = (now = new Date()) => now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
