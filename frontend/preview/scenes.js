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
