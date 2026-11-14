import { Browser } from '@wailsio/runtime';
import { state } from './state.js';
import { renderPageCanvas } from './viewer.js';
import { iconSvg } from './icons.js';

// The CSS width thumbnails are drawn at; it grows with a wider panel (see
// sharpenThumbnails) and never shrinks, as a larger drawing scales down cleanly.
let thumbWidth = 180;

const emptyState = (text) => {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = '<p></p>';
    div.firstChild.textContent = text;
    return div;
};

/**
 * Builds the nested outline list. Children start collapsed. Returns null for
 * an empty outline. onSelect(item) runs when an entry is clicked.
 */
export function buildOutlineTree(items, onSelect) {
    if (!items?.length) return null;
    const list = document.createElement('ul');
    list.className = 'outline-list';
    for (const item of items) {
        const li = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'outline-row';
        const children = buildOutlineTree(item.items, onSelect);

        const toggle = document.createElement('button');
        toggle.className = 'outline-toggle';
        if (children) {
            children.hidden = true;
            toggle.innerHTML = iconSvg('chevron-right', 'icon-sm');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', `Show the sections in ${item.title}`);
            toggle.addEventListener('click', () => {
                children.hidden = !children.hidden;
                toggle.setAttribute('aria-expanded', String(!children.hidden));
            });
        } else {
            toggle.disabled = true;
            toggle.setAttribute('aria-hidden', 'true');
        }

        const link = document.createElement('button');
        link.className = 'outline-link';
        link.textContent = item.title;
        link.title = item.title;
        if (item.bold) link.style.fontWeight = 'bold';
        if (item.italic) link.style.fontStyle = 'italic';
        link.addEventListener('click', () => onSelect(item));

        row.append(toggle, link);
        li.append(row);
        if (children) li.append(children);
        list.append(li);
    }
    return list;
}

function goToOutlineItem(tab, item) {
    if (item.dest) {
        tab.view.linkService.goToDestination(item.dest);
    } else if (item.url) {
        Browser.OpenURL(item.url).catch((err) => console.error('OpenURL failed:', err));
    }
}

/** Builds a tab's thumbnail list and outline once its document has loaded. */
export function setupSidebar(tab) {
    const pages = document.createElement('div');
    pages.className = 'page-grid';
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            renderThumbnail(tab, entry.target);
        }
    }, { root: document.getElementById('pageList'), rootMargin: '300px 0px' });

    for (let n = 1; n <= tab.totalPages; n++) {
        const item = document.createElement('div');
        item.className = 'page-item';
        item.dataset.pageNumber = n;
        item.title = `Page ${n}`;
        item.innerHTML = '<div class="page-thumbnail"></div><div class="page-number"></div>';
        item.lastChild.textContent = String(n);
        item.classList.toggle('active', n === tab.currentPage);
        item.addEventListener('click', () => tab.view.linkService.goToPage(n));
        pages.append(item);
        observer.observe(item);
    }

    tab.sidebar = { pages, observer, outline: null, outlineReady: null };
    tab.sidebar.outlineReady = tab.pdfDocument.getOutline()
        .then((items) => {
            if (!tab.sidebar) return;
            tab.sidebar.outline = buildOutlineTree(items, (item) => goToOutlineItem(tab, item));
            if (state.activeTabId === tab.id) showSidebarFor(tab);
        })
        .catch((err) => console.error('Failed to read outline:', err));

    tab.view.eventBus.on('pagechanging', ({ pageNumber }) => {
        const current = pages.querySelector('.page-item.active');
        current?.classList.remove('active');
        const item = pages.children[pageNumber - 1];
        if (!item) return;
        item.classList.add('active');
        if (pages.isConnected) item.scrollIntoView?.({ block: 'nearest' });
    });
}

async function renderThumbnail(tab, item) {
    try {
        const page = await tab.pdfDocument.getPage(Number(item.dataset.pageNumber));
        if (!tab.sidebar) return;
        const width = thumbWidth;
        const canvas = await renderPageCanvas(page, width);
        if (!tab.sidebar) return;
        canvas.dataset.width = String(width);
        canvas.style.width = '100%';
        item.firstChild.replaceChildren(canvas);
        // The panel grew while this one was drawing.
        if (width < thumbWidth) tab.sidebar.observer.observe(item);
    } catch (err) {
        if (tab.sidebar) console.debug('Thumbnail failed:', err);
    }
}

/**
 * Draws thumbnails at least width wide from now on, and redraws the ones
 * already drawn smaller as they come near the view; until then the old
 * drawing stays, scaled up.
 */
export function sharpenThumbnails(width) {
    if (width <= thumbWidth) return;
    thumbWidth = width;
    for (const tab of state.openPDFs.values()) {
        if (!tab.sidebar) continue;
        for (const canvas of tab.sidebar.pages.querySelectorAll('.page-thumbnail canvas')) {
            if (Number(canvas.dataset.width) < width) tab.sidebar.observer.observe(canvas.closest('.page-item'));
        }
    }
}

/** Puts a tab's thumbnails and outline into the shared sidebar. */
export function showSidebarFor(tab) {
    const pageList = document.getElementById('pageList');
    const outlineView = document.getElementById('outlineView');
    const indexBtn = document.querySelector('.tab-btn[data-tab="index"]');
    pageList?.replaceChildren(tab.sidebar?.pages ?? emptyState('Loading…'));
    outlineView?.replaceChildren(tab.sidebar?.outline ?? emptyState('No outline'));
    if (!indexBtn) return;
    indexBtn.hidden = !tab.sidebar?.outline;
    if (indexBtn.hidden && indexBtn.classList.contains('active')) {
        document.querySelector('.tab-btn[data-tab="pages"]')?.click();
    }
}

/** Stops thumbnail rendering and drops a closed tab's sidebar content. */
export function disposeSidebar(tab) {
    if (!tab.sidebar) return;
    tab.sidebar.observer.disconnect();
    tab.sidebar.pages.remove();
    tab.sidebar.outline?.remove();
    tab.sidebar = null;
}
