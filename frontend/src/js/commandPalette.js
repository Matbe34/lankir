// Ctrl K: every action in one filterable list, grouped, each with its shortcut.
// Commands call the same functions as the buttons and menus they mirror.
import { state, getActivePDF } from './state.js';
import { openPDFFile, openRecentFile, saveTab, closeTab, switchToHome, switchToNextTab } from './documents.js';
import { signPDF } from './signature.js';
import { zoomIn, zoomOut, setZoom, goToPage } from './navigation.js';
import { openFindBar } from './findBar.js';
import { setSidePanel, switchTab } from './ui.js';
import { setMarkupShown } from './annotationToolbar.js';
import { openSettings, getSetting, saveSetting } from './settings.js';
import { RecentFilesService } from './backend.js';
import { iconSvg } from './icons.js';
import { keysFor, keycaps } from './shortcuts.js';
import { rememberFocus } from './focusManager.js';
import { closeOpenMenu } from './menus.js';

const GROUPS = ['Document', 'View', 'Markup', 'Application'];
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const THEMES = [['light', 'sun', 'Use light theme'], ['dark', 'moon', 'Use dark theme'], ['auto', 'monitor', 'Use the system theme']];

const $ = (id) => document.getElementById(id);
const loaded = () => Boolean(getActivePDF()?.view?.pdfViewer?.pdfDocument);
const enabled = (id) => () => loaded() && $(id)?.disabled === false;
const click = (id) => () => $(id)?.click();

let recent = [];
let rows = [];      // the commands shown, in order
let selected = 0;
let restoreFocus = null;
let openCount = 0;

function folderOf(path) {
    return path.replace(/[/\\][^/\\]*$/, '').replace(/^\/home\/[^/]+/, '~');
}

function showPanel(name) {
    setSidePanel(true);
    switchTab(name);
}

function useTool(tool) {
    setMarkupShown(true);
    document.querySelector(`[data-tool="${tool}"]`)?.click();
}

/** Every command that applies right now; searchOnly ones appear only for a query. */
function commands(query) {
    const tab = getActivePDF();
    const panelOpen = !$('sidePanel')?.classList.contains('hidden');
    const markupShown = $('markupBtn')?.getAttribute('aria-pressed') === 'true';
    const theme = getSetting('theme') || 'dark';
    const page = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;
    const pages = tab?.view?.pdfViewer?.pagesCount ?? 0;

    const list = [
        page && page >= 1 && page <= pages && loaded()
            && { group: 'Document', icon: 'hash', label: `Go to page ${page}`, pinned: true, run: () => goToPage(String(page)) },
        { group: 'Document', icon: 'folder-open', label: 'Open file…', shortcut: 'openFile', run: () => openPDFFile() },
        ...recent.map((file) => ({
            group: 'Document', icon: 'history', label: file.fileName, meta: folderOf(file.filePath), words: 'recent open',
            searchOnly: true, run: () => openRecentFile(file.filePath)
        })),
        loaded() && { group: 'Document', icon: 'save', label: 'Save', keys: 'Ctrl S', run: () => saveTab(tab.id) },
        loaded() && { group: 'Document', icon: 'save-as', label: 'Save as…', keys: 'Ctrl Shift S', words: 'copy export', run: () => saveTab(tab.id, { saveAs: true }) },
        loaded() && { group: 'Document', icon: 'signature', label: 'Sign…', shortcut: 'sign', words: 'signature certificate', run: () => signPDF() },
        loaded() && { group: 'Document', icon: 'search', label: 'Find in document', keys: 'Ctrl F', words: 'search text', run: () => openFindBar() },
        loaded() && { group: 'Document', icon: 'hash', label: 'Go to page…', words: 'jump number', run: () => $('pageInput')?.focus() },
        tab && { group: 'Document', icon: 'x', label: 'Close tab', keys: 'Ctrl W', words: 'document', run: () => closeTab(tab.id) },
        state.openPDFs.size > 1 && { group: 'Document', icon: 'arrow-right-left', label: 'Next tab', shortcut: 'nextTab', words: 'switch document', run: () => switchToNextTab() },
        tab && { group: 'Document', icon: 'house', label: 'Start page', words: 'home welcome recent', run: () => switchToHome() },

        loaded() && { group: 'View', icon: 'panel-left', label: panelOpen ? 'Hide side panel' : 'Show side panel', words: 'toggle sidebar', run: () => setSidePanel(!panelOpen) },
        loaded() && { group: 'View', icon: 'gallery-vertical-end', label: 'Show pages', words: 'thumbnails side panel', run: () => showPanel('pages') },
        loaded() && tab.sidebar?.outline && { group: 'View', icon: 'list-tree', label: 'Show outline', words: 'bookmarks contents side panel', run: () => showPanel('index') },
        loaded() && { group: 'View', icon: 'shield-check', label: 'Show signatures', words: 'properties certificates side panel', run: () => showPanel('signatures') },
        loaded() && { group: 'View', icon: 'zoom-in', label: 'Zoom in', shortcut: 'zoomIn', words: 'bigger larger', run: () => zoomIn() },
        loaded() && { group: 'View', icon: 'zoom-out', label: 'Zoom out', shortcut: 'zoomOut', words: 'smaller', run: () => zoomOut() },
        loaded() && { group: 'View', icon: 'move-horizontal', label: 'Fit width', words: 'zoom', run: () => setZoom('page-width') },
        loaded() && { group: 'View', icon: 'scan', label: 'Fit page', words: 'zoom whole', run: () => setZoom('page-fit') },
        ...(loaded() ? ZOOM_PRESETS : []).map((scale) => ({
            group: 'View', icon: 'zoom-in', label: `Zoom to ${scale * 100}%`, words: 'zoom percent actual size', searchOnly: true,
            run: () => setZoom(String(scale))
        })),

        loaded() && { group: 'Markup', icon: 'pencil', label: markupShown ? 'Hide markup tools' : 'Show markup tools', words: 'annotate toolbar', run: () => setMarkupShown(!markupShown) },
        loaded() && { group: 'Markup', icon: 'pointer', label: 'Select', words: 'text forms fill cursor', run: () => useTool('none') },
        loaded() && { group: 'Markup', icon: 'highlighter', label: 'Highlight', words: 'markup mark', run: () => useTool('highlight') },
        loaded() && { group: 'Markup', icon: 'type', label: 'Add text', words: 'markup free text', run: () => useTool('freetext') },
        loaded() && { group: 'Markup', icon: 'brush', label: 'Draw', words: 'markup ink pen', run: () => useTool('ink') },
        loaded() && { group: 'Markup', icon: 'image', label: 'Add an image', words: 'markup stamp picture', run: () => useTool('stamp') },
        enabled('undoBtn')() && { group: 'Markup', icon: 'undo', label: 'Undo', keys: 'Ctrl Z', run: click('undoBtn') },
        enabled('redoBtn')() && { group: 'Markup', icon: 'redo', label: 'Redo', keys: 'Ctrl Shift Z', run: click('redoBtn') },
        enabled('deleteAnnotationBtn')() && { group: 'Markup', icon: 'trash', label: 'Delete selected', keys: 'Del', words: 'remove annotation', run: click('deleteAnnotationBtn') },

        { group: 'Application', icon: 'app-window', label: 'New window', shortcut: 'newWindow', run: click('newWindowBtn') },
        { group: 'Application', icon: 'settings', label: 'Settings', words: 'preferences options', run: () => openSettings() },
        { group: 'Application', icon: 'keyboard', label: 'Keyboard shortcuts', words: 'keys bindings', run: () => openSettings('shortcuts') },
        ...THEMES.map(([value, icon, label]) => ({
            group: 'Application', icon, label, meta: theme === value ? 'Current' : '', words: 'theme appearance colour color mode',
            run: () => saveSetting('theme', value)
        }))
    ];
    return list.filter(Boolean);
}

/**
 * How well query matches text, or null when it doesn't: every character in
 * order, with more for word starts and runs of adjacent characters.
 */
export function fuzzyScore(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (!q) return 0;
    let score = 0;
    let from = 0;
    let last = -2;
    for (const ch of q) {
        const at = t.indexOf(ch, from);
        if (at < 0) return null;
        const wordStart = at === 0 || /[\s\-_/.(“]/.test(t[at - 1]);
        score += at === last + 1 ? 3 : wordStart ? 2 : 0.5;
        last = at;
        from = at + 1;
    }
    if (t.startsWith(q)) score += 4;
    else if (t.includes(q)) score += 2;
    return score - t.length * 0.01;
}

/** Each word of the query must match the label (or, worth less, the command's other words). */
function scoreCommand(command, query) {
    if (command.pinned) return Infinity;
    let total = 0;
    for (const word of query.trim().split(/\s+/)) {
        const inLabel = fuzzyScore(word, command.label);
        const inWords = fuzzyScore(word, `${command.words ?? ''} ${command.meta ?? ''}`);
        if (inLabel === null && inWords === null) return null;
        total += Math.max(inLabel ?? -Infinity, inWords === null ? -Infinity : inWords * 0.5);
    }
    return total;
}

/** The label with the characters the query matched in bold. */
function highlight(label, query) {
    const out = document.createElement('span');
    out.className = 'palette-label';
    const wanted = query.toLowerCase().replace(/\s+/g, '');
    let qi = 0;
    for (const ch of label) {
        if (qi < wanted.length && ch.toLowerCase() === wanted[qi]) {
            out.append(Object.assign(document.createElement('b'), { textContent: ch }));
            qi++;
        } else {
            out.append(ch);
        }
    }
    return out;
}

function filter(query) {
    const all = commands(query);
    if (!query.trim()) return all.filter((c) => !c.searchOnly).map((c) => ({ ...c, score: 0 }));
    const matched = all.map((c) => ({ ...c, score: scoreCommand(c, query) })).filter((c) => c.score !== null);
    // Best group first, best match first within it, so the top row is the best
    // match; groups that match equally well keep their usual order.
    const best = Object.fromEntries(GROUPS.map((g) => [g, Math.max(-Infinity, ...matched.filter((c) => c.group === g).map((c) => c.score))]));
    return matched.sort((a, b) => (a.group === b.group
        ? b.score - a.score
        : best[b.group] - best[a.group] || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)));
}

function render() {
    const query = $('paletteInput').value;
    const list = $('paletteList');
    rows = filter(query);
    selected = Math.min(selected, Math.max(rows.length - 1, 0));
    list.replaceChildren();
    if (rows.length === 0) {
        list.append(Object.assign(document.createElement('div'), { className: 'palette-empty', textContent: 'No matching commands' }));
        $('paletteInput').removeAttribute('aria-activedescendant');
        return;
    }
    let group = null;
    rows.forEach((command, index) => {
        if (command.group !== group) {
            group = command.group;
            list.append(Object.assign(document.createElement('div'), { className: 'palette-group', role: 'presentation', textContent: group }));
        }
        const row = document.createElement('div');
        row.className = 'palette-row';
        row.id = `palette-option-${index}`;
        row.setAttribute('role', 'option');
        row.innerHTML = iconSvg(command.icon);
        row.append(highlight(command.label, query));
        if (command.meta) row.append(Object.assign(document.createElement('span'), { className: 'palette-meta', textContent: command.meta }));
        const keys = keysFor({ dataset: { keys: command.keys ?? '', shortcut: command.shortcut ?? '' } });
        if (keys.length) row.append(keycaps(keys));
        row.addEventListener('pointermove', () => select(index));
        row.addEventListener('click', () => run(index));
        list.append(row);
    });
    select(selected);
}

function select(index) {
    if (rows.length === 0) return;
    selected = (index + rows.length) % rows.length;
    for (const row of $('paletteList').querySelectorAll('[role="option"]')) {
        row.setAttribute('aria-selected', String(row.id === `palette-option-${selected}`));
    }
    const row = $(`palette-option-${selected}`);
    $('paletteInput').setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView?.({ block: 'nearest' });
}

function run(index) {
    const command = rows[index];
    if (!command) return;
    closeCommandPalette();
    Promise.resolve(command.run()).catch((err) => console.error(`Command "${command.label}" failed:`, err));
}

export function isCommandPaletteOpen() {
    return $('commandPalette')?.classList.contains('hidden') === false;
}

/** Opens the palette with an empty query; focus returns where it was when it closes. */
export function openCommandPalette() {
    const palette = $('commandPalette');
    if (!palette || isCommandPaletteOpen()) return;
    closeOpenMenu({ focusButton: true });
    restoreFocus = rememberFocus();
    const input = $('paletteInput');
    input.value = '';
    selected = 0;
    const tab = getActivePDF();
    $('paletteContext').textContent = tab ? tab.fileName : '';
    palette.classList.remove('hidden');
    render();
    input.focus();

    const token = ++openCount;
    RecentFilesService.GetRecent()
        .then((files) => {
            recent = (files || []).slice(0, Number(getSetting('recentFilesLength')) || 10);
            if (token === openCount && isCommandPaletteOpen() && $('paletteInput').value.trim()) render();
        })
        .catch((err) => console.error('Loading recent files for the palette failed:', err));
}

export function closeCommandPalette() {
    if (!isCommandPaletteOpen()) return;
    $('commandPalette').classList.add('hidden');
    openCount++;
    restoreFocus?.();
    restoreFocus = null;
}

function onKeyDown(e) {
    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            select(selected + 1);
            break;
        case 'ArrowUp':
            e.preventDefault();
            select(selected - 1);
            break;
        case 'Enter':
            e.preventDefault();
            run(selected);
            break;
        case 'Escape':
        case 'Esc':
            e.preventDefault();
            e.stopPropagation();
            closeCommandPalette();
            break;
        case 'Tab':
            // The field is the palette's only stop.
            e.preventDefault();
            break;
    }
}

let initialized = false;

/** Binds the palette and everything that opens it ([data-action="command-palette"]). */
export function initCommandPalette() {
    if (initialized) return;
    initialized = true;
    document.addEventListener('click', (e) => {
        if (e.target.closest?.('[data-action="command-palette"]')) {
            openCommandPalette();
            return;
        }
        if (e.target === $('commandPalette')) closeCommandPalette();
    });
    // Pressing anywhere in the palette but the field keeps the typing focus in it.
    document.addEventListener('mousedown', (e) => {
        if (e.target.closest?.('#commandPalette') && e.target.id !== 'paletteInput') e.preventDefault();
    });
    document.addEventListener('input', (e) => {
        if (e.target.id !== 'paletteInput') return;
        selected = 0;
        render();
    });
    document.addEventListener('keydown', (e) => {
        if (e.target.closest?.('#commandPalette')) onKeyDown(e);
    }, true);
}
