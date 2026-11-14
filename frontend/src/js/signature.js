import { state, getActivePDF } from './state.js';
import { updateStatus, escapeHtml, sanitizeError } from './utils.js';
import { openRecentFile, saveTab, closeTab, refreshDirty } from './documents.js';
import { showConfirm, showChoice } from './messageDialog.js';
import { getSetting, setSetting, openSettings } from './settings.js';
import { startPlacement } from './signaturePlacement.js';
import { stampParts, stampDate } from './stampPreview.js';
import { updatePageRoom } from './pageRoom.js';
import { SignatureService, PDFService } from './backend.js';
import { iconSvg } from './icons.js';
import { escapeAttr, renderDn, formatDate, parseCertDate } from './certificateRenderer.js';
import { copyText } from './certificates.js';
import { bindMenu, closeOpenMenu } from './menus.js';
import { showToast } from './toast.js';

const WRONG_PIN = /incorrect PIN or password/i;

// The open sign panel: its tab, the certificates and profiles it offers, the
// chosen certificate and the live signature box of a visible profile. Set
// while certificates load too, so a second Sign does nothing.
let panel = null;
// Bumped when the panel closes or reopens, so a slow load can tell it is stale.
let panelSeq = 0;

const panelEl = () => document.getElementById('signPanel');
const byId = (id) => document.getElementById(id);

const canSign = (cert) => cert.isValid && cert.canSign;

/** The signed copy's name next to the original: <name>_signed.pdf. */
function signedName(fileName) {
    return fileName.replace(/\.pdf$/i, '') + '_signed.pdf';
}

/**
 * A file name on one line that loses its middle when it doesn't fit: the end
 * of the name and the extension stay ("Master Servi…eement_signed.pdf").
 */
function destName(name) {
    const cut = Math.max(0, name.replace(/_signed\.pdf$/i, '').length - 6);
    return `<span id="signDest" class="path dock-dest" data-tip="${escapeAttr(name)}">`
        + `<span class="path-head">${escapeHtml(name.slice(0, cut))}</span>`
        + `<span class="path-tail">${escapeHtml(name.slice(cut))}</span></span>`;
}

/** The calendar day of a Go time string ("2029-03-02 09:00:00 +0000 UTC"). */
function parseDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const formatDay = (date) => date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

function certSource(cert) {
    switch (cert.source) {
        case 'pkcs11': return /\bDNIE\b/i.test(cert.issuer || '') ? 'DNIe' : 'Smart card';
        case 'pkcs12':
        case 'User File': return 'File';
        case 'nss':
        case 'NSS Database': return 'NSS database';
        case 'Windows Certificate Store': return 'Windows store';
        default: return cert.source || 'Certificate';
    }
}

const DAY = 86400000;

/**
 * The line under a certificate's name: where it lives and until when, or why
 * it can't sign. tone 'warning' when it expires within a month.
 */
function certMeta(cert) {
    const source = certSource(cert);
    const until = parseDay(cert.validTo);
    if (!cert.canSign) return { text: "Can't sign: no private key" };
    if (!cert.isValid) {
        const from = parseDay(cert.validFrom);
        if (from && from > new Date()) return { text: `Not valid until ${formatDay(from)}` };
        return { text: until ? `Expired ${formatDay(until)}` : "Can't sign: not valid" };
    }
    // A locked .p12 is only read when signing supplies its password.
    if (!until) return { text: cert.fingerprint?.startsWith('file:') ? 'Password-protected file' : source };
    const days = Math.ceil((until - new Date()) / DAY);
    if (days <= 30) return { text: `${source} · expires ${days === 1 ? 'tomorrow' : `in ${days} days`}`, tone: 'warning' };
    return { text: `${source} · until ${formatDay(until)}` };
}

/**
 * The holder's name in parts that never break inside ("DNI 12345678Z"): a line
 * may end only after a " - " separator, each part ellipsizes on its own.
 */
function nameParts(name) {
    return name.split(/ - /)
        .map((part, i, parts) => `<span class="name-part">${escapeHtml(part)}${i < parts.length - 1 ? '<span class="name-sep"> -</span>' : ''}</span>`)
        .join(' ');
}

/** Marks the name parts that end a line, so the " -" left dangling after them can be hidden. */
function markNameBreaks(root) {
    for (const part of root.querySelectorAll('.name-part')) {
        const next = part.nextElementSibling;
        part.classList.toggle('is-line-end', !!next && next.offsetTop > part.offsetTop);
    }
}

const certName = (cert) => cert.name || 'Unnamed certificate';

function certText(cert) {
    const meta = certMeta(cert);
    return `<span class="option-text"><span class="option-title">${nameParts(certName(cert))}</span>`
        + `<span class="option-meta${meta.tone ? ` is-${meta.tone}` : ''}">${escapeHtml(meta.text)}</span></span>`;
}

/** Signs the active tab: opens the sign panel, saving unsaved edits first. */
export async function signPDF() {
    // One panel at a time; it stays open until signed or cancelled.
    if (panel || !panelEl().classList.contains('hidden')) return;
    const tab = getActivePDF();
    if (!tab?.pdfDocument) {
        updateStatus('No PDF loaded');
        showToast('Open a PDF to sign it');
        return;
    }
    if (refreshDirty(tab) && !(await saveFirst(tab))) {
        updateStatus('Signing cancelled');
        return;
    }
    // The user may have moved on while it saved.
    if (tab.closed || state.activeTabId !== tab.id) return;

    const seq = ++panelSeq;
    panel = { tab, loading: true };
    // The viewer calls this when the tab is hidden or closed.
    tab.cancelPlacement = closeSignPanel;
    showPanel(panelShell(`<div class="empty-state" role="status"><span class="spinner"></span><p>Loading certificates…</p></div>`));

    let certs, profiles;
    try {
        [certs, profiles] = await Promise.all([SignatureService.ListCertificates(), SignatureService.ListSignatureProfiles()]);
    } catch (error) {
        if (seq === panelSeq) renderLoadError(sanitizeError(error));
        return;
    }
    if (seq !== panelSeq) return;
    certs = certs || [];
    Object.assign(panel, {
        loading: false,
        // The ones that can sign first; the rest are listed, disabled, with the reason.
        certs: [...certs.filter(canSign), ...certs.filter((c) => !canSign(c))],
        signable: certs.filter(canSign),
        profiles: profiles || [],
        placing: null,
        busy: false
    });
    renderPanel();
}

/** Signing works on the file on disk, so unsaved edits must be written first. */
async function saveFirst(tab) {
    const choice = await showChoice(
        `"${tab.fileName}" has unsaved changes. Save them before signing?`,
        'Unsaved changes',
        [{ label: 'Cancel', value: 'cancel' }, { label: 'Save and Sign', value: 'save', primary: true }]
    );
    return choice === 'save' && (await saveTab(tab.id));
}

/** Closes the sign panel and removes its box from the page, unless it is signing. */
export function closeSignPanel() {
    if (panel?.busy) return;
    if (panel) {
        panel.placing?.stop();
        if (panel.tab.cancelPlacement === closeSignPanel) delete panel.tab.cancelPlacement;
    }
    panel = null;
    panelSeq++;
    closeOpenMenu();
    const el = panelEl();
    el.classList.add('hidden');
    el.innerHTML = '';
    byId('signBtn')?.setAttribute('aria-pressed', 'false');
    updatePageRoom();
}

function showPanel(html) {
    const el = panelEl();
    el.innerHTML = html;
    el.classList.remove('hidden');
    byId('signBtn')?.setAttribute('aria-pressed', 'true');
    updatePageRoom();
    byId('signCancelX').onclick = closeSignPanel;
}

function panelShell(body, footer = '') {
    const fileName = panel?.tab?.fileName ?? '';
    return `
        <div class="dock-head">
            <div class="dock-heading">
                <h2 id="signPanelTitle" class="dock-title">Sign document</h2>
                <p class="dock-sub" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</p>
            </div>
            <button id="signCancelX" class="icon-btn" aria-label="Close" data-tip="Close" data-keys="Esc">${iconSvg('x')}</button>
        </div>
        <div class="dock-body">${body}</div>
        ${footer ? `<div class="dock-foot">${footer}</div>` : ''}`;
}

function renderLoadError(message) {
    showPanel(panelShell(`
        <div class="empty-state">
            ${iconSvg('circle-alert')}
            <p class="empty-state-title">Couldn't load certificates</p>
            <p>${escapeHtml(message)}</p>
        </div>`));
}

function renderEmpty() {
    showPanel(panelShell(`
        <div class="empty-state">
            ${iconSvg('key-round')}
            <p class="empty-state-title">No signing certificate found</p>
            <p>Lankir looks in .p12 and .pfx files, smart cards and the system NSS database. Point it to yours in Settings.</p>
            <button id="signOpenCertSettings" class="btn btn-primary">Open certificate settings</button>
        </div>`));
    byId('signOpenCertSettings').onclick = () => {
        closeSignPanel();
        openSettings('certificates');
    };
}

function renderPanel() {
    const { tab, certs, signable, profiles } = panel;
    if (signable.length === 0) {
        renderEmpty();
        return;
    }

    const lastCert = getSetting('lastCertificateFingerprint');
    panel.certFp = (signable.find((c) => c.fingerprint === lastCert) || signable[0]).fingerprint;
    const lastProfile = getSetting('lastSignatureProfileId');
    const profile = profiles.find((p) => p.id === lastProfile) || profiles.find((p) => p.isDefault) || profiles[0];
    const single = signable.length === 1;

    const certField = single
        ? `<span class="field-label">Certificate</span>
           <div id="signCertSummary" class="cert-summary" data-tip="${escapeAttr(certName(signable[0]))}">${certText(signable[0])}</div>`
        : `<span class="field-label" id="signCertLabel">Certificate</span>
           <button type="button" id="signCertButton" class="select-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="signCertMenu" aria-labelledby="signCertLabel signCertButton"></button>
           <div id="signCertMenu" class="menu hidden" role="menu" aria-label="Certificate"></div>`;

    showPanel(panelShell(`
        <div class="dock-field">${certField}<div id="signCertStatus" aria-live="polite"></div></div>
        <div class="dock-field">
            <label class="field-label" for="signProfileSelect">Profile</label>
            <select id="signProfileSelect" class="input" aria-describedby="signProfileHint"></select>
            <p id="signProfileHint" class="field-hint"></p>
        </div>
        <div class="dock-field" id="signPinRow">
            <label class="field-label" id="signPinLabel" for="signPinInput">PIN or password</label>
            <div class="input-group">
                <input type="password" id="signPinInput" autocomplete="off" spellcheck="false" aria-describedby="signPinError">
                <button type="button" id="signPinToggle" class="icon-btn sm" aria-label="Show PIN" aria-pressed="false" data-tip="Show PIN">${iconSvg('eye')}</button>
            </div>
            <p id="signPinError" class="field-error" role="alert"></p>
        </div>
        <div class="dock-field">
            <p class="field-hint">Saved next to the original as</p>
            ${destName(signedName(tab.fileName))}
            <button id="signSaveAs" class="btn btn-ghost btn-inline">${iconSvg('folder-open')}Save signed copy as…</button>
        </div>
        <p id="signError" class="field-error" role="alert"></p>`,
    `
        <button id="signCancel" class="btn">Cancel</button>
        <button id="signSubmit" class="btn btn-primary">Sign</button>`));

    if (single) markNameBreaks(byId('signCertSummary'));
    else {
        const menu = byId('signCertMenu');
        menu.append(...certs.map((cert) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'menu-item menu-item-2l';
            option.setAttribute('role', 'menuitemradio');
            // Set through the DOM: fingerprints are file paths and can hold any character.
            option.dataset.fingerprint = cert.fingerprint;
            option.disabled = !canSign(cert);
            option.innerHTML = certText(cert);
            return option;
        }));
        const button = byId('signCertButton');
        bindMenu(button, menu, {
            // The list is as wide as the field.
            onOpen: () => {
                menu.style.width = `${button.offsetWidth}px`;
                markNameBreaks(menu);
            },
            focusItem: () => menu.querySelector('[aria-checked="true"]')
        });
        menu.addEventListener('click', (e) => {
            const option = e.target.closest('[role="menuitemradio"]');
            if (!option || option.disabled) return;
            panel.certFp = option.dataset.fingerprint;
            showCert();
            updateFields();
            const profile = selectedProfile();
            if (panel.placing && profile) panel.placing.setStamp(stampOf(profile));
            button.focus();
        });
        showCert();
    }

    // Values set through the DOM: profile ids come from the user's config.
    const select = byId('signProfileSelect');
    select.append(...profiles.map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.name })));
    if (profile) select.value = profile.id;
    select.onchange = () => {
        syncPlacement();
        showError('');
    };

    const pinInput = byId('signPinInput');
    pinInput.addEventListener('input', () => showPinError(''));
    byId('signPinToggle').onclick = () => {
        const show = pinInput.type === 'password';
        pinInput.type = show ? 'text' : 'password';
        const toggle = byId('signPinToggle');
        toggle.setAttribute('aria-pressed', String(show));
        toggle.innerHTML = iconSvg(show ? 'eye-off' : 'eye');
        toggle.dataset.tip = show ? 'Hide PIN' : 'Show PIN';
        toggle.setAttribute('aria-label', toggle.dataset.tip);
    };

    byId('signCancel').onclick = closeSignPanel;
    byId('signSubmit').onclick = () => submit(false);
    byId('signSaveAs').onclick = () => submit(true);
    panelEl().onkeydown = (e) => {
        if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            submit(false);
        }
    };
    updateFields();
    syncPlacement();
    (selectedCert().requiresPin ? pinInput : byId('signCertButton') || select).focus({ preventScroll: true });
}

const selectedCert = () => panel.signable.find((c) => c.fingerprint === panel.certFp);
const selectedProfile = () => panel.profiles.find((p) => p.id === byId('signProfileSelect').value);

/** Shows the chosen certificate in the picker and checks it in the list. */
function showCert() {
    const button = byId('signCertButton');
    button.innerHTML = certText(selectedCert());
    button.dataset.tip = certName(selectedCert());
    markNameBreaks(button);
    for (const option of byId('signCertMenu').children) {
        option.setAttribute('aria-checked', String(option.dataset.fingerprint === panel.certFp));
    }
}

function updateFields() {
    const cert = selectedCert();
    byId('signPinRow').hidden = !(cert.requiresPin || cert.pinOptional);
    byId('signPinLabel').textContent = cert.requiresPin ? 'PIN or password' : 'PIN or password (optional)';
    showPinError('');
    showError('');
    checkRevocation();
}

const chosenRevoked = () => panel?.revocation?.status === 'revoked';

/**
 * With online checks on, asks Go whether the chosen certificate was revoked.
 * Only the answer to the latest question in this panel is shown.
 */
function checkRevocation() {
    const current = panel;
    const seq = (current.revocationSeq ?? 0) + 1;
    Object.assign(current, { revocationSeq: seq, revocation: null, revocationPending: null });
    showRevocation();
    if (!getSetting('checkRevocationOnline')) return;
    // Signing waits for this, so a revoked answer can still stop it.
    current.revocationPending = askRevocation(current, seq);
}

async function askRevocation(current, seq) {
    let result;
    try {
        result = await SignatureService.CheckCertificateRevocation(current.certFp);
    } catch (error) {
        console.error('Error checking certificate revocation:', error);
        result = { status: 'unavailable' };
    }
    if (panel !== current || current.revocationSeq !== seq) return;
    current.revocation = result;
    showRevocation();
}

/** A revoked certificate: a danger notice, and no signing with it. No answer: a quiet note. */
function showRevocation() {
    const { status, revokedAt } = panel.revocation || {};
    const el = byId('signCertStatus');
    if (status === 'revoked') {
        const date = new Date(revokedAt);
        const when = revokedAt && !Number.isNaN(date.getTime())
            ? ` on <time datetime="${escapeAttr(revokedAt)}">${escapeHtml(formatDay(date))}</time>` : '';
        el.innerHTML = `<div class="notice danger" role="alert"><span class="notice-icon">${iconSvg('shield-x', 'icon-sm')}</span>`
            + `<span>This certificate was revoked${when}. Signatures made with it can't be trusted.</span></div>`;
    } else if (status === 'unavailable') {
        el.innerHTML = '<p class="field-hint">Couldn\'t check whether this certificate was revoked.</p>';
    } else {
        el.innerHTML = '';
    }
    for (const id of ['signSubmit', 'signSaveAs']) byId(id).disabled = panel.busy || panel.checking || chosenRevoked();
}

/** Puts the box of a visible profile on the page, or takes it off for an invisible one. */
function syncPlacement() {
    const profile = selectedProfile();
    const hint = byId('signProfileHint');
    panel.placing?.stop();
    panel.placing = null;
    if (profile?.visibility !== 'visible') {
        hint.textContent = 'Not drawn on the page; PDF readers list it in their signature panel.';
        return;
    }
    panel.placing = startPlacement(panel.tab, profile, {
        onChange: (page) => { hint.textContent = `Drag the box on page ${page} to move it, or its corner to resize.`; },
        avoid: () => panelEl().getBoundingClientRect(),
        stamp: stampOf(profile)
    });
    panel.placing.reveal();
}

/** What the profile's stamp draws when the chosen certificate signs now. */
function stampOf(profile) {
    const cert = selectedCert();
    // With the lookup on, the location comes from the IP address at signing time.
    const location = getSetting('signatureLocationLookup') ? 'From your IP address when signing' : profile.location;
    return stampParts(profile.appearance, {
        signerName: cert?.name || cert?.subject || '', date: stampDate(), location, iconDataUrl: profile.appearance?.logoPath || null
    });
}

function showError(message) {
    byId('signError').textContent = message;
}

function showPinError(message) {
    byId('signPinError').textContent = message;
    const input = byId('signPinInput');
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
}

/** Signing, or with checking only waiting for the certificate check, which the panel can still be closed during. */
function setBusy(busy, checking = false) {
    panel.busy = busy && !checking;
    panel.checking = busy && checking;
    for (const id of ['signSubmit', 'signSaveAs', 'signProfileSelect', 'signCertButton', 'signPinInput', 'signPinToggle', 'signCancel', 'signCancelX']) {
        const el = byId(id);
        const closes = id === 'signCancel' || id === 'signCancelX';
        if (el) el.disabled = (panel.busy || (panel.checking && !closes)) || (chosenRevoked() && (id === 'signSubmit' || id === 'signSaveAs'));
    }
    const submitBtn = byId('signSubmit');
    submitBtn.setAttribute('aria-busy', String(busy));
    submitBtn.innerHTML = busy ? `<span class="spinner" aria-hidden="true"></span>${checking ? 'Checking certificate…' : 'Signing…'}` : 'Sign';
}

async function submit(saveAs) {
    if (!panel || panel.loading || panel.busy || panel.checking || chosenRevoked()) return;
    const current = panel;
    const { tab } = current;
    const cert = selectedCert();
    const profile = selectedProfile();
    const pinInput = byId('signPinInput');
    const pin = pinInput.value;

    if (cert.requiresPin && !pin) {
        showPinError('Enter the PIN or password for this certificate.');
        pinInput.focus();
        return;
    }
    showError('');
    // The page stays usable while the panel is open, so it may have been edited since.
    if (refreshDirty(tab) && (!(await saveFirst(tab)) || panel !== current)) return;

    let outputPath = '';
    if (saveAs) {
        const target = await PDFService.ChooseSavePath(tab.docId, signedName(tab.fileName));
        if (!target || panel !== current) return;
        if (target.path === tab.filePath) {
            showError('Choose a different file than the document being signed.');
            return;
        }
        if (target.exists && !(await showConfirm('A file with that name already exists in the folder. Replacing it overwrites its contents.',
            `Replace “${target.path.split(/[/\\]/).pop()}”?`, { confirmLabel: 'Replace', danger: true }))) return;
        if (panel !== current) return;
        outputPath = target.path;
    }

    setBusy(true, true);
    await current.revocationPending;
    if (panel !== current) return;
    if (chosenRevoked() || selectedCert() !== cert) {
        setBusy(false);
        return;
    }
    // Edited while waiting (or while saving): asking now could answer another
    // prompt that is open, so the next Sign asks.
    if (refreshDirty(tab)) {
        setBusy(false);
        showError('The document changed before signing started. Sign again to save and sign it.');
        return;
    }
    setBusy(true);
    updateStatus('Signing…');
    try {
        const signedPath = await SignatureService.SignPDF({
            pdfPath: tab.filePath,
            outputPath,
            certFingerprint: cert.fingerprint,
            pin,
            profileId: profile.id,
            position: profile.visibility === 'visible' ? current.placing.position() : null,
            tsaUrl: getSetting('tsaUrl') || ''
        });
        if (panel !== current) return;
        current.busy = false;
        closeSignPanel();
        updateStatus(`Signed: ${signedPath}`);
        showToast(`Signed and saved as ${signedPath.split(/[/\\]/).pop()}`, { tone: 'success' });
        // SignPDF saved the choice in Go; keep this window's copy in step.
        setSetting('lastCertificateFingerprint', cert.fingerprint);
        setSetting('lastSignatureProfileId', profile.id);
        await openSignedPDF(signedPath);
    } catch (error) {
        console.error('Error signing PDF:', error);
        if (panel !== current) return;
        setBusy(false);
        updateStatus('Signing failed');
        const message = error?.message ?? String(error);
        if (WRONG_PIN.test(message) && !byId('signPinRow').hidden) {
            pinInput.value = '';
            showPinError('Wrong PIN or password. Try again.');
            pinInput.focus();
        } else {
            showError(`Signing failed: ${sanitizeError(error)}`);
        }
    }
}


/** Opens a signed PDF in a tab, replacing a tab that still shows an overwritten file. */
export async function openSignedPDF(filePath) {
    try {
        const stale = [...state.openPDFs.values()].find((tab) => tab.filePath === filePath);
        if (stale && !(await closeTab(stale.id))) return;
        await openRecentFile(filePath);
    } catch (error) {
        console.error('Error opening signed PDF:', error);
    }
}

const revocationTurnedOff = (sig) => sig.revocationStatus === 'not_checked' && /turned off in settings/i.test(sig.revocationCheck || '');

function explain(sig) {
    if (!sig.isValid) {
        return 'The document was changed after this signature was made, or the signature is damaged.';
    }
    if (sig.revocationStatus === 'revoked') {
        return 'The document is unchanged since it was signed, but the signer\'s certificate was revoked, so the signature can\'t be trusted.';
    }
    if (sig.certificateValid && sig.revocationStatus === 'revoked_later') {
        return 'The document is unchanged since it was signed, and a trusted timestamp shows it was signed before the signer\'s certificate was revoked.';
    }
    if (sig.certificateValid && sig.revocationStatus === 'good') {
        return 'The document is unchanged since it was signed, and the signer\'s certificate is trusted.';
    }
    if (sig.certificateValid && revocationTurnedOff(sig)) {
        return 'The document is unchanged since it was signed and the signer\'s certificate is trusted, but whether it was revoked wasn\'t checked: online checks are off in Settings.';
    }
    if (sig.certificateValid) {
        return 'The document is unchanged since it was signed and the signer\'s certificate is trusted, but Lankir couldn\'t confirm the certificate is not revoked.';
    }
    return 'The document is unchanged since it was signed, but the signer\'s certificate is not trusted by this system, so the signer\'s identity is not confirmed.';
}

/** "9 Nov 2026, 12:32" in the user's locale; the raw text if it isn't a date. */
function formatSigningTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function signatureStatus(sig) {
    if (!sig.isValid) return { tone: 'invalid', icon: 'shield-x', text: 'Invalid signature' };
    if (sig.revocationStatus === 'revoked') return { tone: 'invalid', icon: 'shield-x', text: 'Certificate revoked' };
    if (sig.certificateValid && sig.revocationStatus === 'revoked_later') return { tone: 'untrusted', icon: 'triangle-alert', text: 'Valid, certificate revoked after signing' };
    if (sig.certificateValid && sig.revocationStatus === 'good') return { tone: 'valid', icon: 'shield-check', text: 'Valid, certificate trusted' };
    if (sig.certificateValid && revocationTurnedOff(sig)) return { tone: 'untrusted', icon: 'triangle-alert', text: 'Valid, revocation not checked' };
    if (sig.certificateValid) return { tone: 'untrusted', icon: 'triangle-alert', text: 'Valid, revocation couldn\'t be checked' };
    return { tone: 'untrusted', icon: 'triangle-alert', text: 'Valid, certificate not trusted' };
}

const fact = (label, value, extra = '') => value ? `<div class="fact${extra}"><dt>${label}</dt><dd>${value}</dd></div>` : '';

/** A wide fact in mono text, wrapping only at its separators, copied whole from a button on its label row. */
function copyFact(label, html, text, what) {
    if (!text) return '';
    return `<div class="fact fact-wide fact-copy"><dt>${label}`
        + `<button type="button" class="icon-btn sm" data-copy="${escapeAttr(text)}" data-tip="Copy ${what}" aria-label="Copy ${what}">${iconSvg('copy', 'icon-sm')}</button></dt>`
        + `<dd><code class="cert-dn">${html}</code></dd></div>`;
}

const TIME_SOURCES = {
    timestamp: 'A trusted timestamp',
    signer: 'The signer\'s computer, not verified'
};

function timestampText(sig) {
    const time = sig.timestampTime ? `${formatSigningTime(sig.timestampTime)}, ` : '';
    switch (sig.timestampStatus) {
        case 'valid': return time ? `${time}trusted` : 'Trusted';
        case 'untrusted': return time ? `${time}not trusted` : 'Not trusted';
        case 'invalid': return 'Invalid';
        default: return 'None';
    }
}

/** "Expired" or "Not valid yet" beside the certificate's dates, when either is so. */
function validityFlag(sig) {
    const now = Date.now();
    const until = parseCertDate(sig.certificateValidUntil);
    const from = parseCertDate(sig.certificateValidFrom);
    if (until && until < now) return ' <span class="pill warning">Expired</span>';
    if (from && from > now) return ' <span class="pill warning">Not valid yet</span>';
    return '';
}

/** The chain from the signer up, ending at the issuer the PDF names last. */
function chainNodes(sig) {
    const chain = sig.chain || [];
    const nodes = chain.map((c, i) => ({ name: c.subject, role: i === 0 ? 'Signer' : c.subject === c.issuer ? 'Root' : 'Intermediate' }));
    const last = chain[chain.length - 1];
    if (last && last.issuer !== last.subject) nodes.push({ name: last.issuer, role: 'Not in the PDF' });
    return nodes;
}

function renderChain(sig) {
    const nodes = chainNodes(sig);
    if (!nodes.length) return '';
    const marks = nodes.map((node, i) => ({ icon: i === 0 ? 'id-card' : 'shield', tone: '', role: node.role }));
    const end = marks[marks.length - 1];
    Object.assign(end, sig.issuerTrusted || sig.certificateValid
        ? { icon: 'shield-check', tone: 'success', role: `${end.role}, trusted` }
        : { icon: 'shield-alert', tone: 'warning', role: `${end.role}, not trusted` });
    if (sig.revocationStatus === 'revoked') {
        Object.assign(marks[0], { icon: 'shield-x', tone: 'danger', role: `${marks[0].role}, revoked` });
    }
    return `<ol class="signature-chain">${nodes.map((node, i) => `<li class="signature-chain-node${marks[i].tone ? ` ${marks[i].tone}` : ''}">`
        + `<span class="signature-chain-icon">${iconSvg(marks[i].icon, 'icon-sm')}</span>`
        + `<span class="signature-chain-text"><span class="signature-chain-name">${escapeHtml(node.name)}</span>`
        + `<span class="signature-chain-role">${escapeHtml(marks[i].role)}</span></span></li>`).join('')}</ol>`;
}

const TONE_ICONS = { success: 'circle-check', warning: 'triangle-alert', danger: 'circle-x' };

/** Why revocation wasn't checked, without the "Not checked" the row's title already says. */
function notCheckedReason(text) {
    const reason = /^Not checked(?:: | \()(.+?)\)?$/.exec(text || '')?.[1];
    if (reason) return reason[0].toUpperCase() + reason.slice(1);
    return text === 'Not checked' ? '' : text;
}

function revocationCheck(sig) {
    switch (sig.revocationStatus) {
        case 'good': return ['success', 'Not revoked', [sig.revocationCheck]];
        case 'revoked': return ['danger', 'Certificate revoked', [sig.certificateValidationMessage, sig.revocationCheck]];
        // Only a trusted certificate's revocation date was checked.
        case 'revoked_later': return sig.certificateValid
            ? ['warning', 'Certificate revoked after signing', [sig.revocationCheck]]
            : ['warning', 'Revocation not checked', []];
        case 'unavailable': return ['warning', 'Couldn\'t check revocation', [sig.revocationCheck]];
        default: return ['warning', 'Revocation not checked', [notCheckedReason(sig.revocationCheck)]];
    }
}

function renderChecks(sig) {
    const revoked = sig.revocationStatus === 'revoked';
    const checks = [
        sig.isValid
            ? ['success', 'Document unchanged since signing', []]
            : ['danger', 'Document changed or signature damaged', [sig.validationMessage]],
        sig.issuerTrusted || sig.certificateValid
            ? ['success', 'Issued by a trusted authority', []]
            // A revoked certificate's message is about the revocation, shown below.
            : ['warning', 'Certificate not trusted', revoked ? [] : [sig.certificateValidationMessage]],
        revocationCheck(sig),
        ...(sig.warnings || []).map((warning) => ['warning', warning, []])
    ];
    return `<ul class="signature-checks">${checks.map(([tone, title, details]) => `<li class="signature-check" data-tone="${tone}">`
        + `<span class="signature-check-icon">${iconSvg(TONE_ICONS[tone], 'icon-sm')}</span>`
        + `<span class="signature-check-text"><span class="signature-check-title">${escapeHtml(title)}</span>`
        + details.filter(Boolean).map((detail) => `<span class="signature-check-detail">${escapeHtml(detail)}</span>`).join('')
        + '</span></li>').join('')}</ul>`;
}

function moreGroup(id, title, body) {
    return body ? `<section class="signature-more-group" aria-labelledby="${id}"><h4 id="${id}" class="signature-more-title">${title}</h4>${body}</section>` : '';
}

/** Everything else about a signature, behind See more. */
function renderMore(sig, id) {
    const signature = [
        fact('Time source', TIME_SOURCES[sig.signingTimeSource] || 'Not recorded'),
        fact('Timestamp', escapeHtml(timestampText(sig))),
        fact('Contact', escapeHtml(sig.contactInfo || ''))
    ].join('');
    const validity = sig.certificateValidFrom || sig.certificateValidUntil
        ? `<span class="fact-date">${escapeHtml(formatDate(sig.certificateValidFrom))} –</span> <span class="fact-date">${escapeHtml(formatDate(sig.certificateValidUntil))}</span>${validityFlag(sig)}`
        : '';
    const certificate = [
        copyFact('Subject', sig.signerDN && renderDn(sig.signerDN), sig.signerDN, 'subject'),
        copyFact('Serial', escapeHtml(sig.certificateSerial || '').replaceAll(':', ':<wbr>'), sig.certificateSerial, 'serial number'),
        fact('Issuer', escapeHtml(sig.issuerName || '')),
        fact('Key', escapeHtml(sig.keyAlgorithm || '')),
        fact('Signature algorithm', escapeHtml(sig.signatureType || '')),
        fact('Valid', validity, ' fact-wide')
    ].join('');
    return `<div class="signature-more" id="${id}" hidden>`
        + moreGroup(`${id}-signature`, 'Signature', `<dl class="facts">${signature}</dl>`)
        + moreGroup(`${id}-certificate`, 'Signer certificate', certificate && `<dl class="facts">${certificate}</dl>`)
        + moreGroup(`${id}-chain`, 'Certificate chain', renderChain(sig))
        + moreGroup(`${id}-checks`, 'Checks', renderChecks(sig))
        + '</div>';
}

function setMoreOpen(button, open) {
    button.setAttribute('aria-expanded', String(open));
    button.querySelector('span').textContent = open ? 'See less' : 'See more';
    document.getElementById(button.getAttribute('aria-controls')).hidden = !open;
}

/** HTML for the Signatures section of the side panel's Info segment. */
export function renderSignatureList(signatures) {
    if (!signatures?.length) return '<p class="info-empty">No signatures</p>';
    return signatures.map((sig, i) => {
        const status = signatureStatus(sig);
        const facts = [
            fact('Signed', sig.signingTime ? escapeHtml(formatSigningTime(sig.signingTime)) : ''),
            fact('Reason', escapeHtml(sig.reason || '')),
            fact('Location', escapeHtml(sig.location || ''))
        ].join('');
        const id = `signatureMore${i}`;
        return `
            <div class="signature-item ${status.tone}">
                <div class="signature-signer">${escapeHtml(sig.signerName || 'Unknown signer')}</div>
                <div class="signature-status ${status.tone}">${iconSvg(status.icon, 'icon-sm')}<span>${status.text}</span></div>
                <p class="signature-explain">${explain(sig)}</p>
                ${facts ? `<dl class="facts">${facts}</dl>` : ''}
                <button type="button" class="disclosure-btn signature-more-btn" data-signature="${i}" aria-expanded="false" aria-controls="${id}"><span>See more</span>${iconSvg('chevron-down', 'icon-sm')}</button>
                ${renderMore(sig, id)}
            </div>`;
    }).join('');
}

// The signatures opened with See more in the shown document; the set lives on
// its tab, so it lasts while the document stays open.
let openSignatures = new Set();

function onSignatureInfoClick(event) {
    const more = event.target.closest('.signature-more-btn');
    if (more) {
        const open = more.getAttribute('aria-expanded') !== 'true';
        setMoreOpen(more, open);
        if (open) openSignatures.add(more.dataset.signature);
        else openSignatures.delete(more.dataset.signature);
        return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) copyText(copy.dataset.copy, copy.closest('.fact')?.querySelector('code'));
}

function showSignatures(container, signatures, pdfPath) {
    const tab = [...state.openPDFs.values()].find((t) => t.filePath === pdfPath);
    openSignatures = tab ? (tab.openSignatures ??= new Set()) : new Set();
    container.innerHTML = renderSignatureList(signatures);
    container.querySelectorAll('.signature-more-btn').forEach((button) => {
        if (openSignatures.has(button.dataset.signature)) setMoreOpen(button, true);
    });
    if (!container.dataset.bound) {
        container.dataset.bound = '1';
        container.addEventListener('click', onSignatureInfoClick);
    }
}

let signatureRequest = 0;

// Switching online revocation checks in Settings checks the open document again.
let revocationOnline;
document.addEventListener('settings-applied', () => {
    const online = getSetting('checkRevocationOnline');
    const changed = revocationOnline !== undefined && online !== revocationOnline;
    revocationOnline = online;
    const tab = getActivePDF();
    if (changed && tab?.filePath) loadSignatureInfo(tab.filePath);
});

/** A dot on the side panel's Info segment while a signature needs attention. */
function markInfoSegment(tone) {
    const segment = document.querySelector('.tab-btn[data-tab="signatures"]');
    if (!segment) return;
    if (tone) {
        segment.dataset.attention = tone;
        segment.setAttribute('aria-description', tone === 'danger' ? 'A signature is invalid' : 'A signature needs attention');
    } else {
        delete segment.dataset.attention;
        segment.removeAttribute('aria-description');
    }
}

/** Empties the Signatures section, dropping any check still running, for a document not loaded yet. */
export function clearSignatureInfo() {
    signatureRequest++;
    const container = document.getElementById('signatureInfo');
    if (container) container.innerHTML = '';
    markInfoSegment(null);
}

/** Shows the signatures of the PDF at pdfPath in the sidebar. */
export async function loadSignatureInfo(pdfPath) {
    const container = document.getElementById('signatureInfo');
    if (!container) return;
    const request = ++signatureRequest;
    container.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Checking signatures…</p></div>';
    markInfoSegment(null);
    try {
        const signatures = await SignatureService.VerifySignatures(pdfPath);
        if (request !== signatureRequest) return;
        showSignatures(container, signatures, pdfPath);
        const tones = (signatures || []).map((sig) => signatureStatus(sig).tone);
        markInfoSegment(tones.includes('invalid') ? 'danger' : tones.includes('untrusted') ? 'warning' : null);
    } catch (error) {
        console.error('Error loading signature info:', error);
        if (request === signatureRequest) {
            container.innerHTML = `<div class="empty-state"><p>Couldn't check signatures</p><p class="setting-hint">${escapeHtml(sanitizeError(error))}</p></div>`;
        }
    }
}
