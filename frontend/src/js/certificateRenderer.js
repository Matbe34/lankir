import { escapeHtml } from './utils.js';
import { iconSvg } from './icons.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_SOON_DAYS = 30;

const SOURCES = {
    pkcs11: { name: 'Smart card', icon: 'id-card' },
    pkcs12: { name: 'File', icon: 'file-key' },
    nss: { name: 'Browser store', icon: 'globe' }
};

// Day, short month name and year, e.g. "14 Mar 2028" or "Mar 14, 2028" by locale; never 3/14/2028.
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** escapeHtml, which is safe in attribute values too. */
export const escapeAttr = escapeHtml;

/** Returns human-readable certificate type name. */
export function getCertTypeName(source) {
    return SOURCES[source]?.name ?? source;
}

/**
 * Parses the backend's "2006-01-02 15:04:05" (UTC) and ISO strings. WebKit's
 * Date() rejects the space-separated form, so it is read field by field.
 */
export function parseCertDate(value) {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
    const date = m
        ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)))
        : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats a certificate date for display with the month as a word. */
export function formatDate(value) {
    const date = parseCertDate(value);
    return date ? DATE_FORMAT.format(date) : (value || 'Unknown');
}

/** Calculates days until certificate expiry. */
export function getDaysUntilExpiry(validTo) {
    const date = parseCertDate(validTo);
    return date ? Math.ceil((date - Date.now()) / DAY_MS) : null;
}

/**
 * The status pill for a certificate: { tone, text, reason, note }. tone is ''
 * for muted. note: the reason says more than the dates, so the details show it.
 */
export function getCertStatus(cert) {
    const validTo = parseCertDate(cert.validTo);
    const msLeft = validTo ? validTo - Date.now() : null;
    const days = msLeft === null ? null : Math.floor(msLeft / DAY_MS);
    if (msLeft !== null && msLeft < 0) {
        return { tone: '', text: 'Expired', reason: `Expired on ${formatDate(cert.validTo)}` };
    }
    if (!cert.isValid) {
        return { tone: '', text: 'Not valid yet', reason: `Valid from ${formatDate(cert.validFrom)}` };
    }
    if (!cert.canSign) {
        return { tone: '', text: "Can't sign", reason: "No private key on this computer, so it can't sign", note: true };
    }
    if (days !== null && days <= EXPIRES_SOON_DAYS) {
        const text = days === 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
        return { tone: 'warning', text, reason: `Expires on ${formatDate(cert.validTo)}` };
    }
    return { tone: 'success', text: 'Valid', reason: '' };
}

/** A distinguished name with a break opportunity at each separator, never inside a value. */
// Go prints attributes it has no short name for as their OID; these are common in
// Spanish and EU personal certificates.
const DN_NAMES = {
    '2.5.4.4': 'SN', '2.5.4.42': 'GN', '2.5.4.12': 'T', '2.5.4.65': 'PSEUDONYM',
    '2.5.4.97': 'ORGANIZATIONIDENTIFIER', '1.2.840.113549.1.9.1': 'EMAIL'
};
const nameDnPart = (part) => part.replace(/^([0-9.]+)=/, (all, oid) => DN_NAMES[oid] ? `${DN_NAMES[oid]}=` : all);

export function renderDn(dn) {
    return dn.split(/,\s*(?=[A-Za-z0-9.]+=)/)
        .map((part, i, parts) => `<span class="dn-part">${escapeHtml(nameDnPart(part))}${i < parts.length - 1 ? ',' : ''}</span>`)
        .join(' ');
}

/** Renders a single certificate as a compact row whose details open below it. */
export function renderCertificateItem(cert) {
    const source = SOURCES[cert.source] ?? { name: cert.source || 'Unknown', icon: 'file-key' };
    const status = getCertStatus(cert);
    const muted = status.tone === '' ? ' is-muted' : '';
    const subject = cert.subject || '';
    const meta = [cert.issuer, cert.validTo && `until ${formatDate(cert.validTo)}`].filter(Boolean).map(escapeHtml).join(' · ');

    return `
        <details class="certificate-item cert-row${muted}" data-fingerprint="${escapeAttr(cert.fingerprint)}">
            <summary class="list-row">
                <span class="list-row-icon">${iconSvg(source.icon)}</span>
                <span class="list-row-text">
                    <span class="list-row-title cert-name">${escapeHtml(cert.name || 'Unnamed certificate')}</span>
                    <span class="list-row-sub"><span class="pill cert-source">${escapeHtml(source.name)}</span><span class="cert-meta">${meta}</span></span>
                </span>
                <span class="pill cert-status ${status.tone}"${status.reason ? ` title="${escapeAttr(status.reason)}"` : ''}>${escapeHtml(status.text)}</span>
                ${iconSvg('chevron-down', 'icon-sm disclosure')}
            </summary>
            <dl class="cert-details">
                ${status.note ? `<dt>Status</dt><dd>${escapeHtml(status.reason)}</dd>` : ''}
                <dt>Subject</dt>
                <dd class="cert-dn-cell">
                    <code class="cert-dn">${subject ? renderDn(subject) : 'Unknown'}</code>
                    ${subject ? `<button type="button" class="icon-btn sm" data-copy="${escapeAttr(subject)}" data-tip="Copy subject" aria-label="Copy subject">${iconSvg('copy', 'icon-sm')}</button>` : ''}
                </dd>
                <dt>Issuer</dt><dd>${escapeHtml(cert.issuer || 'Unknown')}</dd>
                <dt>Valid</dt><dd>${escapeHtml(formatDate(cert.validFrom))} to ${escapeHtml(formatDate(cert.validTo))}</dd>
            </dl>
        </details>
    `;
}

/** Renders a list of certificates as HTML. */
export function renderCertificateList(certificates) {
    if (!certificates || certificates.length === 0) {
        return '<div class="empty-state"><p>No certificates found</p></div>';
    }
    return certificates.map((cert) => renderCertificateItem(cert)).join('');
}
