// Each scene drives the real UI into one state, using the app's own code paths
// (the function behind the Open button, real button clicks). When the UI is
// redesigned, update the selectors and helpers here.
import { openPDFFile, resolveUnsaved } from '../src/js/documents.js';
import { openCommandPalette } from '../src/js/commandPalette.js';
import { showPrompt } from '../src/js/messageDialog.js';
import { showToast } from '../src/js/toast.js';
import { showLoading } from '../src/js/loadingIndicator.js';
import { openFindBar } from '../src/js/findBar.js';
import { state, getActivePDF } from '../src/js/state.js';
import { splitDocument, protectDocument, editProperties, insertFromFiles } from '../src/js/documentTools.js';
import { printTab } from '../src/js/print.js';
import { queueOpen, DNIE_FINGERPRINT, SignatureService, addDamagedSignature, setContractRevocation } from './backend.mock.js';

const DOCS = '/home/ferran/Documents';
const CONTRACT = `${DOCS}/Master Services Agreement.pdf`;
const NOTES = `${DOCS}/Meeting notes - kickoff.pdf`;

export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (selector) => document.querySelector(selector);

async function waitFor(check, what, timeout = 40000) {
  const start = performance.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (performance.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** Opens a file the way the Open button does: the native dialog answers with this path. */
async function openDocument(path) {
  queueOpen(path);
  const id = await openPDFFile();
  if (id == null) throw new Error(`could not open ${path}`);
  return id;
}

/** Waits for the active tab's pages to be drawn (text layer included) on screen. */
async function waitForRender(pageNumber = getActivePDF().currentPage) {
  await waitFor(() => {
    const page = getActivePDF()?.view?.container.querySelector(`.page[data-page-number="${pageNumber}"]`);
    return page?.querySelector('canvas') && page.querySelector('.textLayer span');
  }, `page ${pageNumber} to render`);
}

async function goToPage(pageNumber) {
  const tab = getActivePDF();
  // pdf.js lays the pages out a moment after setDocument; scrolling earlier is rejected.
  await waitFor(() => tab.view.pdfViewer.pagesCount >= pageNumber && tab.view.container.offsetParent, 'pages to lay out');
  tab.view.linkService.goToPage(pageNumber);
  await waitFor(() => tab.currentPage === pageNumber, `page ${pageNumber} to become current`);
  await waitForRender(pageNumber);
}

/** contract.pdf and notes.pdf open as tabs, contract active, page 3 in view. */
async function openViewer() {
  await openDocument(NOTES);
  const contract = await openDocument(CONTRACT);
  await waitFor(() => state.activeTabId === contract && getActivePDF().pdfDocument, 'contract to load');
  await goToPage(3);
}

/** The sign panel on the contract with the DNIe and the visible profile chosen. */
async function openSignPanel() {
  await openViewer();
  $('#signBtn').click();
  await waitFor(() => $('#signCertButton'), 'sign panel');
  $('#signCertButton').click();
  [...document.querySelectorAll('#signCertMenu [role="menuitemradio"]')].find((o) => o.dataset.fingerprint === DNIE_FINGERPRINT).click();
  const profile = $('#signProfileSelect');
  profile.value = 'profile-visible';
  profile.dispatchEvent(new Event('change'));
  // The box's page draws after the jump to it.
  await waitForRender(getActivePDF().totalPages);
}

async function waitForThumbnails() {
  await waitFor(() => {
    const thumbs = document.querySelectorAll('#pageList .page-thumbnail canvas');
    return thumbs.length >= 4;
  }, 'thumbnails');
}

/** Sets the side panel's width the way the keyboard does on its handle (Home: narrowest, End: widest). */
async function resizePanel(key) {
  $('#panelResizer').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await nextFrame();
}

/** The panel's default width, whatever an earlier scene left remembered. */
async function defaultPanelWidth() {
  $('#panelResizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await nextFrame();
}

/** Pages at a width, with the thumbnails in view redrawn for it. */
async function pagesAt(key) {
  await openViewer();
  $('#sidePanelBtn').click();
  await resizePanel(key);
  await waitForThumbnails();
  const width = $('#pageList .page-item').offsetWidth;
  await waitFor(() => [...document.querySelectorAll('#pageList .page-thumbnail canvas')]
    .slice(0, 4).every((canvas) => Number(canvas.dataset.width) >= Math.min(width, 220)), 'sharp thumbnails');
}

/** A pointer event at (x, y), default the middle of el. */
function pointer(el, type, { x, y, ...mods } = {}) {
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, isPrimary: true,
    clientX: x ?? rect.left + rect.width / 2, clientY: y ?? rect.top + rect.height / 2, ...mods,
  }));
}

const organizeTile = (n) => $(`#organizeView .organize-tile[data-page="${n}"]`);

/** Clicks pages in the organize grid, the first plainly and the rest with Ctrl. */
function pickPages(...pages) {
  pages.forEach((n, i) => {
    pointer(organizeTile(n), 'pointerdown', { ctrlKey: i > 0 });
    pointer(organizeTile(n), 'pointerup', { ctrlKey: i > 0 });
  });
}

/** The contract organizing, its first pages drawn, pages selected. */
async function openOrganize(...pages) {
  await openViewer();
  $('#organizePagesBtn').click();
  await waitFor(() => document.querySelectorAll('#organizeView .organize-paper canvas').length >= 8, 'organize thumbnails');
  pickPages(...pages);
}

/** Runs a bar action and, for the first change, goes ahead past the signed warning. */
async function organizeAction(id) {
  const tab = getActivePDF();
  const steps = tab.undoSteps;
  $(`#${id}`).click();
  await waitFor(() => tab.undoSteps > steps || !$('#messageDialog').classList.contains('hidden'), `${id} to run`);
  if (!$('#messageDialog').classList.contains('hidden')) {
    [...document.querySelectorAll('#messageDialog button')].find((b) => b.textContent.trim() === 'Change anyway').click();
  }
  await waitFor(() => tab.undoSteps > steps && !tab.busy, `${id} to finish`);
}

export const SCENES = {
  async welcome() {
    await waitFor(() => $('#recentFilesGrid .recent-file-card') && !$('.file-thumbnail-loading'), 'recent files and their thumbnails');
  },

  viewer: openViewer,

  async panels() {
    await openViewer();
    $('#sidePanelBtn').click();
    await waitForThumbnails();
    openFindBar();
    const input = $('#findInput');
    input.value = 'Provider';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => /of \d+/.test($('#findCount').textContent), 'find results');
  },

  async annotate() {
    await openViewer();
    $('#markupBtn').click();
    $('[data-tool="highlight"]').click();
    await waitFor(() => $('[data-tool="highlight"]').classList.contains('active'), 'highlight tool');
  },

  // The DNIe chosen, the visible profile's box on the last page, a PIN typed.
  async sign() {
    await openSignPanel();
    const pin = $('#signPinInput');
    pin.value = '482913';
    pin.focus();
  },

  // Not scored: the certificate list open, with one that can't sign.
  async 'sign-menu'() {
    await openSignPanel();
    $('#signCertButton').click();
    await waitFor(() => !$('#signCertMenu').classList.contains('hidden'), 'certificate list');
  },

  // Not scored: a long file name, so the signed copy's name loses its middle.
  async 'sign-long-name'() {
    const long = await openDocument(`${DOCS}/Acuerdo marco de prestacion de servicios profesionales Northwind Contoso 2026 v3.pdf`);
    await waitFor(() => state.activeTabId === long && getActivePDF().pdfDocument, 'document to load');
    await waitForRender(1);
    $('#signBtn').click();
    await waitFor(() => $('#signDest'), 'sign panel');
  },

  // Not scored: a wrong PIN.
  async 'sign-pin-error'() {
    SignatureService.SignPDF = async () => { throw new Error('cannot log in to the card: incorrect PIN or password'); };
    await openSignPanel();
    $('#signPinInput').value = '0000';
    $('#signSubmit').click();
    await waitFor(() => $('#signPinError').textContent, 'PIN error');
  },

  // Not scored: signing in progress.
  async 'sign-busy'() {
    SignatureService.SignPDF = () => new Promise(() => {});
    await openSignPanel();
    $('#signPinInput').value = '482913';
    $('#signSubmit').click();
    await waitFor(() => $('#signSubmit').getAttribute('aria-busy') === 'true', 'busy Sign button');
  },

  // Not scored: the chosen certificate was revoked, so it can't sign.
  async 'sign-revoked'() {
    SignatureService.CheckCertificateRevocation = async () => ({ status: 'revoked', check: 'OCSP checked online with the certificate authority', revokedAt: '2026-10-30T12:00:00Z' });
    await openSignPanel();
    await waitFor(() => $('#signCertStatus .notice'), 'revoked notice');
    $('#signPinInput').focus();
  },

  // Not scored: the certificate authority didn't answer about the chosen certificate.
  async 'sign-revocation-unchecked'() {
    SignatureService.CheckCertificateRevocation = async () => ({ status: 'unavailable', check: 'Couldn\'t reach the certificate authority\'s revocation service', revokedAt: '' });
    await openSignPanel();
    await waitFor(() => $('#signCertStatus .field-hint'), 'unchecked note');
    $('#signPinInput').focus();
  },

  // Not scored: no certificate can sign.
  async 'sign-empty'() {
    SignatureService.ListCertificates = async () => [];
    await openViewer();
    $('#signBtn').click();
    await waitFor(() => $('#signOpenCertSettings'), 'empty sign panel');
  },

  // Settings opens on Signing: plain settings rows above the profiles list.
  async settings() {
    $('#settingsBtn').click();
    $('.settings-tab[data-section="signatures"]').click();
    await waitFor(() => document.querySelectorAll('#signatureProfilesList .profile-list-item').length === 3, 'profile list');
  },

  // Certificates with one row's details open, scrolled up to that row: the
  // page rests on a row edge, nothing cut through a heading or a line of text.
  async certificates() {
    $('#settingsBtn').click();
    $('.settings-tab[data-section="certificates"]').click();
    await waitFor(() => document.querySelectorAll('#certificatesList .certificate-item').length === 3, 'certificate list');
    const row = document.querySelectorAll('#certificatesList .certificate-item')[1];
    row.open = true;
    const body = $('#settingsMain .prefs-body');
    body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top;
  },

  async 'settings-appearance'() {
    $('#settingsBtn').click();
    $('.settings-tab[data-section="appearance"]').click();
  },

  async 'profile-editor'() {
    await SCENES.settings();
    document.querySelector('.profile-edit-btn[data-profile-id="profile-visible"]').click();
    await waitFor(() => $('#signaturePreview .signature-preview-box'), 'profile preview');
  },

  // The lower half of the editor: image and a fixed position switched on.
  async 'profile-editor-position'() {
    await SCENES['profile-editor']();
    for (const id of ['#profileShowIcon', '#profileDefinePosition']) {
      $(id).checked = true;
      $(id).dispatchEvent(new Event('change'));
    }
    const body = $('#profileEditorModal .prefs-body');
    body.scrollTop = body.scrollHeight;
  },

  // Changing Sign document to Ctrl O, which Open file already uses.
  async 'shortcut-capture'() {
    $('#settingsBtn').click();
    $('.settings-tab[data-section="shortcuts"]').click();
    $('#settingShortcutSign').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true }));
  },

  async tabs() {
    const names = [
      'Master Services Agreement.pdf',
      'Meeting notes - kickoff.pdf',
      'Acuerdo marco de prestacion de servicios profesionales Northwind Contoso 2026 v3 FINAL firmado.pdf',
      'Lease agreement - Carrer Major 14.pdf',
      'Informe trimestral de resultados consolidados del grupo y sus filiales (borrador para revision del consejo).pdf',
      'Invoice 2026-0412.pdf',
    ];
    for (const name of names) await openDocument(`${DOCS}/${name}`);
    await waitFor(() => getActivePDF().pdfDocument, 'last tab to load');
    await waitForRender(1);
  },

  async error() {
    await SCENES.welcome(); // let the background thumbnails settle first
    queueOpen(new Error(`open ${DOCS}/Quarterly report.pdf: permission denied`));
    await openPDFFile();
    await waitFor(() => !$('#messageDialog').classList.contains('hidden'), 'error dialog');
  },

  // Not scored; for checking the palette and the other dialogs.
  async palette() {
    await openViewer();
    openCommandPalette();
  },

  async 'palette-search'() {
    await openViewer();
    openCommandPalette();
    const input = $('#paletteInput');
    input.value = 'zo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },

  async 'confirm-unsaved'() {
    await openViewer();
    resolveUnsaved(getActivePDF());
    await waitFor(() => !$('#messageDialog').classList.contains('hidden'), 'unsaved dialog');
  },

  async password() {
    await SCENES.welcome();
    showPrompt('This document is protected. Enter its password to open it.', '“Tax return 2025 (draft).pdf” needs a password', {
      type: 'password', label: 'Password', error: 'That password isn’t right. Try again.', confirmLabel: 'Open', icon: 'lock'
    });
    await waitFor(() => document.activeElement?.id === 'messageDialogInput', 'password field');
  },

  async toasts() {
    await openViewer();
    showToast('Saved Master Services Agreement.pdf', { tone: 'success' });
    showToast('Signed and saved as Master Services Agreement_signed.pdf', { tone: 'success', action: { label: 'Show', run() {} } });
    showToast('Couldn’t reach the timestamp server', { tone: 'warning' });
    showLoading('Saving');
  },

  // The side panel's Info segment: the document's facts and its signature.
  async properties() {
    await openViewer();
    $('#sidePanelBtn').click();
    $('.tab-btn[data-tab="signatures"]').click();
    await waitFor(() => $('#signatureInfo .signature-item'), 'signature info');
  },

  // Not scored: the side panel at its narrowest (one column) and widest (three or four).
  'panels-narrow': () => pagesAt('Home'),
  'panels-wide': () => pagesAt('End'),

  // Not scored: Info at the panel's narrowest and widest.
  async 'properties-narrow'() {
    await SCENES.properties();
    await resizePanel('Home');
  },

  async 'properties-wide'() {
    await SCENES.properties();
    await resizePanel('End');
  },

  // Not scored: a signature's See more open, a damaged signature below it.
  async 'signature-more'() {
    addDamagedSignature();
    await SCENES.properties();
    await defaultPanelWidth();
    const more = $('#signatureInfo .signature-more-btn');
    more.click();
    more.scrollIntoView({ block: 'start' });
  },

  async 'signature-more-narrow'() {
    await SCENES['signature-more']();
    await resizePanel('Home');
    $('#signatureInfo .signature-more-btn').scrollIntoView({ block: 'start' });
  },

  // Not scored: the damaged signature's See more: the danger states.
  async 'signature-more-invalid'() {
    addDamagedSignature();
    await SCENES.properties();
    await defaultPanelWidth();
    const [, damaged] = document.querySelectorAll('#signatureInfo .signature-item');
    const more = damaged.querySelector('.signature-more-btn');
    more.click();
    more.scrollIntoView({ block: 'start' });
  },

  // Not scored: the first signature's checks, revocation answered online.
  async 'signature-checks'() {
    await SCENES.properties();
    await defaultPanelWidth();
    $('#signatureInfo .signature-more-btn').click();
    $('#signatureInfo .signature-checks').scrollIntoView({ block: 'end' });
  },

  // Not scored: the checks after an online revocation check that got no answer.
  async 'signature-checks-offline'() {
    setContractRevocation('unavailable', 'Couldn\'t reach the certificate authority\'s revocation service');
    await SCENES['signature-checks']();
  },

  // Not scored: the "N more" list of open documents.
  async 'tabs-menu'() {
    await SCENES.tabs();
    $('#tabOverflowBtn').click();
    await waitFor(() => !$('#tabOverflowMenu').classList.contains('hidden'), 'tab list');
  },

  // Not scored: text passing under the markup tools and the page pill.
  async 'hud-over-text'() {
    await SCENES.annotate();
    getActivePDF().view.container.scrollTop += 142;
    await nextFrame();
  },

  // Not scored: the main menu, a popover over the page.
  async 'main-menu'() {
    await openViewer();
    $('#mainMenuBtn').click();
    await waitFor(() => !$('#mainMenu').classList.contains('hidden'), 'main menu');
  },

  // Not scored: the main menu open on its Document section, Split under the pointer.
  async 'menu-document'() {
    await openViewer();
    $('#mainMenuBtn').click();
    await waitFor(() => !$('#mainMenu').classList.contains('hidden'), 'main menu');
    $('#splitBtn').focus();
  },

  // Not scored: Split with three ranges typed and a folder chosen.
  async split() {
    await openViewer();
    splitDocument(getActivePDF());
    const input = await waitFor(() => $('#splitRanges'), 'split dialog');
    input.value = '1-3, 4-9, 10-12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    $('#splitFolderBtn').click();
    await waitFor(() => !$('#splitDialog .btn-primary').disabled, 'a chosen folder');
    input.focus();
  },

  // Not scored: Protect with password, past the signed-file warning, both fields typed.
  async protect() {
    await openViewer();
    await waitFor(() => getActivePDF().signatures, 'signature check');
    protectDocument(getActivePDF());
    await waitFor(() => !$('#messageDialog').classList.contains('hidden'), 'signed-file warning');
    [...document.querySelectorAll('#messageDialogFooter button')].find((b) => b.textContent === 'Change anyway').click();
    const [password, confirm] = await waitFor(() => $('#protectConfirm') && [$('#protectPassword'), $('#protectConfirm')], 'protect dialog');
    password.value = 'correct horse';
    confirm.value = 'correct horse';
    await sleep(50);
    confirm.focus();
  },

  // Not scored: the Properties dialog (the side panel's Info is the scored "properties").
  async 'document-properties'() {
    await openViewer();
    await waitFor(() => getActivePDF().signatures, 'signature check');
    editProperties(getActivePDF());
    await waitFor(() => $('#propTitle'), 'properties dialog');
  },

  // Not scored: preparing to print, held at page 5 of 12.
  async 'print-progress'() {
    await openViewer();
    const doc = getActivePDF().pdfDocument;
    const getPage = doc.getPage.bind(doc);
    let calls = 0;
    // The first call sizes the sheet; then pages 1 to 4 render and page 5 never arrives.
    doc.getPage = (n) => (++calls > 5 ? new Promise(() => {}) : getPage(n));
    printTab(getActivePDF());
    await waitFor(() => /page 5 of/.test($('#toastRegion .toast-text')?.textContent ?? ''), 'print progress');
  },

  // Not scored: Insert pages, notes.pdf picked.
  async insert() {
    await openViewer();
    await waitFor(() => getActivePDF().signatures, 'signature check');
    insertFromFiles(getActivePDF());
    await waitFor(() => !$('#messageDialog').classList.contains('hidden'), 'signed-file warning');
    [...document.querySelectorAll('#messageDialogFooter button')].find((b) => b.textContent === 'Change anyway').click();
    await waitFor(() => $('#insertDialog'), 'insert dialog');
  },

  // Organize pages: the grid with three pages selected and the page tools.
  organize: () => openOrganize(4, 5, 8),

  // Mid-drag: the three pages dimmed, the line after page 9, the pill in words.
  async 'organize-drag'() {
    await openOrganize(4, 5, 8);
    const from = organizeTile(4).getBoundingClientRect();
    pointer(organizeTile(4), 'pointerdown');
    const target = organizeTile(10).querySelector('.organize-paper').getBoundingClientRect();
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const x = from.left + from.width / 2 + ((target.left + 12 - (from.left + from.width / 2)) * i) / steps;
      const y = from.top + from.height / 2 + ((target.top + target.height * 0.55 - (from.top + from.height / 2)) * i) / steps;
      pointer($('#organizeView'), 'pointermove', { x, y });
      await nextFrame();
    }
    await waitFor(() => !$('#organizeView .organize-drop-line').hidden, 'insertion line');
  },

  // Not scored: right-clicking a page that wasn't selected.
  async 'organize-menu'() {
    await openOrganize(1);
    const rect = organizeTile(3).getBoundingClientRect();
    organizeTile(3).dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2, detail: 1, clientX: rect.right - 40, clientY: rect.top + 140,
    }));
  },

  // Not scored: a rubber band over empty space selecting two rows' worth.
  async 'organize-band'() {
    await openOrganize();
    const view = $('#organizeView');
    const a = organizeTile(2).getBoundingClientRect();
    const b = organizeTile(9).getBoundingClientRect();
    pointer(view, 'pointerdown', { x: a.left - 14, y: a.top - 20 });
    pointer(view, 'pointermove', { x: a.left + 10, y: a.top });
    pointer(view, 'pointermove', { x: b.left + 60, y: b.top + 80 });
  },

  // The first change to a signed document names whose signature breaks.
  async 'organize-signed'() {
    await openOrganize(2);
    $('#organizeDelete').click();
    await waitFor(() => !$('#messageDialog').classList.contains('hidden'), 'signed warning');
  },

  // Done after three page changes: reading again, the tab dirty, the toast.
  async 'organize-done'() {
    await openOrganize(3);
    await organizeAction('organizeRotateRight');
    await organizeAction('organizeDuplicate');
    await organizeAction('organizeRotateLeft');
    $('#organizeDone').click();
    await waitFor(() => $('#toastRegion .toast'), 'page changes toast');
    await waitForRender(getActivePDF().currentPage);
  },

  // Not scored: find alone at a narrow width moves the page clear of the box.
  async 'find-only'() {
    await openViewer();
    openFindBar();
    const input = $('#findInput');
    input.value = 'nominate';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => /of \d+/.test($('#findCount').textContent), 'find results');
  },
};
