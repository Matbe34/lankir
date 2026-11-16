import { openPDFFile, openRecentFile, switchToHome } from './documents.js';
import { escapeHtml } from './utils.js';
import { UI } from './constants.js';
import { getSetting } from './settings.js';
import { state } from './state.js';
import { loadDocument, renderPageCanvas } from './viewer.js';
import { PDFService, RecentFilesService } from './backend.js';
import { iconSvg } from './icons.js';
import { renderShortcutHints } from './shortcuts.js';

const recentLimit = () => getSetting('recentFilesLength') || 5;

const folderOf = (path) => {
    const dir = path.replace(/[/\\][^/\\]*$/, '');
    return dir.replace(/^\/home\/[^/]+/, '~');
};

const pagesText = (n) => (n ? `${n} ${n === 1 ? 'page' : 'pages'}` : '');

/** "Today, 09:14", "Yesterday", "10 Nov" or "10 Nov 2025". */
export function formatRecentDate(iso, now = new Date()) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((day(now) - day(date)) / 86400000);
    if (days === 0) return `Today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (days === 1) return 'Yesterday';
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString([], { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * A folder path that loses its middle first: the head ellipsizes, the last
 * folder always shows ("~/Documents/Cli…/Northwind").
 */
export function pathMarkup(folder) {
    const cut = folder.lastIndexOf('/', folder.length - 2) + 1;
    return `<span class="path"><span class="path-head">${escapeHtml(folder.slice(0, cut))}</span>`
        + `<span class="path-tail">${escapeHtml(folder.slice(cut))}</span></span>`;
}

const emptyRecent = (text) => `<div class="empty-state recent-empty"><p>${text}</p></div>`;

/**
 * Loads and displays recent files on the welcome screen. focusIndex moves
 * keyboard focus to that row (or the last one) once the rows are in.
 */
export async function loadRecentFilesWelcome({ focusIndex = null } = {}) {
    const recentGrid = document.getElementById('recentFilesGrid');
    if (!recentGrid) return;
    try {
        const recentFiles = await RecentFilesService.GetRecent();
        if (!recentFiles || recentFiles.length === 0) {
            recentGrid.innerHTML = emptyRecent('Files you open show up here.');
            if (focusIndex !== null) document.getElementById('welcomeOpenBtn')?.focus();
            return;
        }

        recentGrid.innerHTML = '';
        const cards = recentFiles.slice(0, recentLimit()).map((file) => {
            const card = document.createElement('div');
            card.className = 'recent-file-card';
            card.setAttribute('role', 'listitem');
            const pages = pagesText(file.pageCount);
            card.innerHTML = `
                <button type="button" class="recent-open">
                    <span class="file-thumbnail-container"><span class="file-thumbnail-loading"></span></span>
                    <span class="recent-file-info">
                        <span class="file-name">${escapeHtml(file.fileName)}</span>
                        <span class="file-info">${pathMarkup(folderOf(file.filePath))}${pages ? `<span class="file-pages">· ${pages}</span>` : ''}</span>
                    </span>
                    <span class="recent-file-date">${escapeHtml(formatRecentDate(file.lastOpened))}</span>
                </button>
                <button type="button" class="icon-btn sm recent-file-remove" aria-label="Remove ${escapeHtml(file.fileName)} from recent files" data-tip="Remove from recent files">${iconSvg('x', 'icon-sm')}</button>
            `;
            const open = card.querySelector('.recent-open');
            open.dataset.tip = file.filePath;
            open.addEventListener('click', () => openRecentFile(file.filePath));
            card.querySelector('.recent-file-remove').addEventListener('click', () => {
                removeRecentFile(file.filePath, [...recentGrid.children].indexOf(card));
            });
            recentGrid.appendChild(card);
            return { file, card };
        });
        if (focusIndex !== null) cards[Math.min(focusIndex, cards.length - 1)].card.querySelector('.recent-open').focus();

        // One at a time: each thumbnail spins up a pdf.js document.
        for (const { file, card } of cards) {
            if (!card.isConnected) break;
            await loadThumbnail(file.filePath, card);
        }
    } catch (error) {
        console.error('Error loading recent files for welcome:', error);
        recentGrid.innerHTML = emptyRecent('Couldn’t load recent files.');
    }
}

/** Renders the first page into a recent file row. */
async function loadThumbnail(filePath, card) {
    const container = card.querySelector('.file-thumbnail-container');
    let doc = null;
    let task = null;
    try {
        doc = await PDFService.OpenPDFByPath(filePath);
        task = loadDocument(`/doc/${doc.id}`);
        const pdfDocument = await task.promise;
        const canvas = await renderPageCanvas(await pdfDocument.getPage(1), UI.THUMBNAIL_WIDTH * UI.THUMBNAIL_OVERSAMPLE);
        canvas.removeAttribute('style');
        canvas.className = 'file-thumbnail';
        container.replaceChildren(canvas);
    } catch (error) {
        // Missing, moved or password-protected files keep the icon.
        console.debug('Recent file thumbnail failed:', filePath, error);
        container.innerHTML = iconSvg('file-text');
    } finally {
        task?.destroy().catch(() => {});
        if (doc) PDFService.ClosePDF(doc.id).catch(() => {});
    }
}

/** Removes a file from the recent files list; focus stays on the row that takes its place. */
async function removeRecentFile(filePath, index) {
    try {
        await RecentFilesService.RemoveRecent(filePath);
        await loadRecentFilesWelcome({ focusIndex: index });
    } catch (error) {
        console.error('Error removing recent file:', error);
    }
}

function menuItem(icon, label, onClick, extra = '') {
    const item = document.createElement('button');
    item.className = 'menu-item';
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `${icon ? iconSvg(icon) : ''}<span class="menu-label"></span>${extra}`;
    item.querySelector('.menu-label').textContent = label;
    item.addEventListener('click', onClick);
    return item;
}

const separator = () => Object.assign(document.createElement('div'), { className: 'menu-sep', role: 'separator' });

/** Fills the Open menu: open a file, the recent files, and the start page. */
export async function fillRecentMenu(menu) {
    const head = Object.assign(document.createElement('div'), { className: 'menu-head', textContent: 'Recent' });
    const status = Object.assign(document.createElement('div'), { className: 'menu-empty', textContent: 'Loading…' });
    const open = menuItem('folder-open', 'Open file…', () => openPDFFile(), '<span class="keys" data-shortcut="openFile"></span>');
    // The start page is where the app already is when no document is shown.
    const start = state.activeTabId === null ? [] : [separator(), menuItem('history', 'Start page', () => switchToHome())];
    menu.replaceChildren(open, separator(), head, status, ...start);
    renderShortcutHints(menu);

    let files = [];
    try {
        files = (await RecentFilesService.GetRecent()) || [];
    } catch (error) {
        console.error('Error loading recent files:', error);
        status.textContent = 'Couldn’t load recent files';
        return;
    }
    const rows = files.slice(0, recentLimit()).map((file) => {
        const row = menuItem(null, file.fileName, () => openRecentFile(file.filePath),
            `<span class="menu-meta">${escapeHtml(formatRecentDate(file.lastOpened))}</span>`);
        row.dataset.path = file.filePath;
        row.title = file.filePath;
        return row;
    });
    if (rows.length) status.replaceWith(...rows);
    else status.textContent = 'No recent files';
}
