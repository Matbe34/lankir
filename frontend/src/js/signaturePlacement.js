// Places a visible signature box directly on a pdf.js page. The box is kept
// in PDF points and drawn into the page's div; pdf.js clears that div when it
// re-renders the page, so the box is re-added after each render.

// A profile whose position equals this one has no saved position.
export const BUILT_IN_POSITION = { page: 0, x: 360, y: 50, width: 200, height: 80 };
const MIN_WIDTH = 20;
const MIN_HEIGHT = 10;

/** True when the profile has its own default position (set in the profile editor). */
export function hasSavedPosition(profile) {
    const p = profile?.position;
    if (!p) return false;
    return Object.keys(BUILT_IN_POSITION).some((k) => p[k] !== BUILT_IN_POSITION[k]);
}

/**
 * The box the user starts from: the profile's saved position (page 0 means
 * the last page), else the profile's size centred on the current page.
 * pageBounds(n) returns page n's [x0, y0, x1, y1] in points (pdfPage.view).
 */
export function initialBox(profile, { numPages, currentPage, pageBounds }) {
    const p = profile.position || BUILT_IN_POSITION;
    const width = p.width > 0 ? p.width : BUILT_IN_POSITION.width;
    const height = p.height > 0 ? p.height : BUILT_IN_POSITION.height;
    if (hasSavedPosition(profile)) {
        const page = p.page >= 1 ? Math.min(p.page, numPages) : numPages;
        return clampBox({ page, x: p.x, y: p.y, width, height }, pageBounds(page));
    }
    const bounds = pageBounds(currentPage);
    const [x0, y0, x1, y1] = bounds;
    return clampBox({ page: currentPage, x: x0 + (x1 - x0 - width) / 2, y: y0 + (y1 - y0 - height) / 2, width, height }, bounds);
}

/** Moves and shrinks box so it lies entirely within the page bounds. */
function clampBox(box, [x0, y0, x1, y1]) {
    const width = Math.min(box.width, x1 - x0);
    const height = Math.min(box.height, y1 - y0);
    return {
        page: box.page,
        x: Math.max(x0, Math.min(box.x, x1 - width)),
        y: Math.max(y0, Math.min(box.y, y1 - height)),
        width,
        height
    };
}

const round = (n) => Math.round(n * 100) / 100;

// Start and length of the span from fixed edge a towards p, at least min long.
const span = (a, p, min) => (p >= a ? [a, Math.max(min, p - a)] : [Math.min(p, a - min), Math.max(min, a - p)]);

// Space kept between the box and the panel it must stay clear of.
const CLEARANCE = 32;

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Shows the signature box on the tab's pages and lets the user drag, resize
 * or redraw it until stop(). position() is the box in PDF points.
 * onChange(page) runs when the box lands on another page. avoid() returns the
 * screen rect the box must not sit under (the sign panel), or null; reveal()
 * scrolls the box into view clear of it. stamp (stampPreview.js's stampParts)
 * is what the signature will draw, shown faintly inside the box; setStamp()
 * swaps it.
 */
export function startPlacement(tab, profile, { onChange, avoid, stamp = null } = {}) {
    const { pdfViewer, eventBus, container } = tab.view;
    const pageView = (n) => pdfViewer.getPageView(n - 1);
    // The page's view box before its pdfPage has loaded is the viewport's.
    const pageBounds = (n) => pageView(n).pdfPage?.view ?? pageView(n).viewport.viewBox;
    let box = initialBox(profile, { numPages: pdfViewer.pagesCount, currentPage: pdfViewer.currentPageNumber, pageBounds });
    let shownPage = null;

    const el = document.createElement('div');
    el.className = 'signature-box';
    el.innerHTML = '<div class="signature-stamp" aria-hidden="true"></div><span class="signature-box-label">Signature</span><span class="signature-box-handle" title="Drag to resize"></span>';
    const stampEl = el.firstElementChild;
    let fittedTo = '';

    // Sized the way the stamp is drawn (appearance.go): a 2 pt margin (1 pt in a
    // small box), then the height split over the lines plus one, at 80%, made
    // smaller until the lines fit. ratio is screen pixels per PDF point.
    const fitStamp = () => {
        const width = parseFloat(el.style.width);
        const height = parseFloat(el.style.height);
        const size = `${width}x${height}`;
        if (!stamp || size === fittedTo || !(width * height * box.width * box.height > 0)) return;
        fittedTo = size;
        const ratio = Math.sqrt((width * height) / (box.width * box.height));
        const pad = (box.height < 30 || box.width < 60 ? 1 : 2) * ratio;
        stampEl.style.setProperty('--stamp-pad', `${pad}px`);
        if (!stamp.lines) return;
        let font = Math.max(ratio, ((height - pad * 2) / (stamp.lines + 1)) * 0.8);
        for (let i = 0; i < 30; i++) {
            stampEl.style.setProperty('--stamp-font', `${font}px`);
            const overflows = stampEl.scrollHeight > stampEl.clientHeight + 1 || stampEl.scrollWidth > stampEl.clientWidth + 1;
            if (!overflows || font <= ratio) break;
            font = Math.max(ratio, font * 0.9);
        }
    };

    const setStamp = (next) => {
        stamp = next?.html ? next : null;
        stampEl.hidden = !stamp;
        stampEl.className = `signature-stamp ${stamp?.layout ?? ''}`.trim();
        stampEl.innerHTML = stamp?.html ?? '';
        fittedTo = '';
        fitStamp();
    };

    const render = () => {
        const view = pageView(box.page);
        if (!view?.div) return;
        const [x1, y1] = view.viewport.convertToViewportPoint(box.x, box.y);
        const [x2, y2] = view.viewport.convertToViewportPoint(box.x + box.width, box.y + box.height);
        Object.assign(el.style, {
            left: `${Math.min(x1, x2)}px`,
            top: `${Math.min(y1, y2)}px`,
            width: `${Math.abs(x2 - x1)}px`,
            height: `${Math.abs(y2 - y1)}px`
        });
        if (el.parentNode !== view.div) view.div.append(el);
        fitStamp();
        if (box.page !== shownPage) {
            shownPage = box.page;
            onChange?.(box.page);
        }
    };

    // The box on screen with its label above it and its handle.
    const screenRect = () => {
        const rects = [el, ...el.children].map((node) => node.getBoundingClientRect());
        return {
            left: Math.min(...rects.map((r) => r.left)),
            top: Math.min(...rects.map((r) => r.top)),
            right: Math.max(...rects.map((r) => r.right)),
            bottom: Math.max(...rects.map((r) => r.bottom))
        };
    };

    // Scrolls sideways so the box ends left of the panel. Pages that fit the
    // window can't scroll sideways, so the viewer first gets room on the right.
    const keepClear = (smooth) => {
        const cover = avoid?.();
        if (!cover || !el.isConnected || !overlaps(screenRect(), cover)) return;
        container.classList.add('sign-room');
        const shift = screenRect().right + CLEARANCE - cover.left;
        if (shift <= 0) return;
        if (smooth && container.scrollTo) container.scrollTo({ left: container.scrollLeft + shift, behavior: 'smooth' });
        else container.scrollLeft += shift;
    };

    // PDF point under the pointer on page n, clamped to the page so a drag
    // past an edge or into the gap between pages stays on it. The page div
    // has a border.
    const pdfPoint = (e, n) => {
        const view = pageView(n);
        const rect = view.div.getBoundingClientRect();
        const [x, y] = view.viewport.convertToPdfPoint(e.clientX - rect.left - view.div.clientLeft, e.clientY - rect.top - view.div.clientTop);
        const [x0, y0, x1, y1] = pageBounds(n);
        return [Math.max(x0, Math.min(x, x1)), Math.max(y0, Math.min(y, y1))];
    };

    let drag = null;
    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        const pageDiv = e.target.closest?.('.page');
        if (!pageDiv) return;
        e.preventDefault();
        e.stopPropagation();
        const page = Number(pageDiv.dataset.pageNumber);
        const start = { ...box };
        if (e.target.closest('.signature-box-handle')) {
            // The handle is the box's bottom-right corner on screen, whatever
            // the page's rotation; the top-left one stays put.
            const { viewport } = pageView(box.page);
            const [x1, y1] = viewport.convertToViewportPoint(box.x, box.y);
            const [x2, y2] = viewport.convertToViewportPoint(box.x + box.width, box.y + box.height);
            drag = { mode: 'resize', start, anchor: viewport.convertToPdfPoint(Math.min(x1, x2), Math.min(y1, y2)) };
        } else if (e.target.closest('.signature-box')) {
            const [px, py] = pdfPoint(e, box.page);
            drag = { mode: 'move', start, dx: px - box.x, dy: py - box.y };
        } else {
            const [px, py] = pdfPoint(e, page);
            drag = { mode: 'draw', start, anchor: [px, py] };
            box = { page, x: px, y: py, width: 0, height: 0 };
            render();
        }
    };
    const onPointerMove = (e) => {
        if (!drag) return;
        e.preventDefault();
        const [px, py] = pdfPoint(e, box.page);
        const bounds = pageBounds(box.page);
        if (drag.mode === 'move') {
            box = clampBox({ ...box, x: px - drag.dx, y: py - drag.dy }, bounds);
        } else {
            const resize = drag.mode === 'resize';
            const [x, width] = span(drag.anchor[0], px, resize ? MIN_WIDTH : 0);
            const [y, height] = span(drag.anchor[1], py, resize ? MIN_HEIGHT : 0);
            box = { ...box, x, y, width, height };
            if (resize) box = clampBox(box, bounds);
        }
        render();
    };
    const onPointerUp = () => {
        if (!drag) return;
        if (drag.mode === 'draw' && (box.width < MIN_WIDTH || box.height < MIN_HEIGHT)) {
            // A click (or a tiny drag) moves the current box there instead.
            const [ax, ay] = drag.anchor;
            box = clampBox({ ...drag.start, page: box.page, x: ax - drag.start.width / 2, y: ay - drag.start.height / 2 }, pageBounds(box.page));
            render();
        }
        drag = null;
        keepClear(true);
    };
    const onRendered = ({ pageNumber }) => {
        if (pageNumber === box.page) render();
    };

    container.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    eventBus.on('pagerendered', onRendered);
    eventBus.on('scalechanging', render);
    container.classList.add('placing-signature');
    setStamp(stamp);
    render();

    let stopped = false;
    return {
        setStamp,
        position: () => ({ page: box.page, x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) }),
        reveal() {
            el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
            keepClear(false);
        },
        stop() {
            if (stopped) return;
            stopped = true;
            container.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('pointermove', onPointerMove, true);
            window.removeEventListener('pointerup', onPointerUp, true);
            eventBus.off('pagerendered', onRendered);
            eventBus.off('scalechanging', render);
            container.classList.remove('placing-signature', 'sign-room');
            el.remove();
        }
    };
}
