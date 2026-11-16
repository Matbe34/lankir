// Stand-in for src/js/backend.js in the browser preview: fixture data, no Go.
// Methods not listed resolve to null; nothing throws for an unknown method.
const lenient = (impl) => new Proxy(impl, {
  get: (target, key) => {
    if (key in target) return target[key];
    if (typeof key === 'symbol' || key === 'then') return undefined;
    return async () => null;
  },
});

const HOME = '/home/ferran/Documents';

// Which fixture a path shows: anything named like notes, else the contract.
export const fixtureFor = (path) => (/notes/i.test(path) ? 'notes' : 'contract');
const PAGES = { contract: 12, notes: 2 };
const basename = (p) => p.split('/').pop();

// Scenes script what the next native "Open" dialog returns (a path) or fails with (an Error).
const openQueue = [];
export const queueOpen = (pathOrError) => openQueue.push(pathOrError);

let docCounter = 0;
const docs = new Map(); // id -> { path, work: [bytes], undone: [bytes], replaced: [bytes] }, like Go's working copies
const register = (path) => {
  const fixture = fixtureFor(path);
  const id = `${fixture}-${++docCounter}`;
  docs.set(id, { path, work: [], undone: [], replaced: [] });
  return { id, path, fileName: basename(path), size: 25351, modTime: '2026-11-10T09:14:00Z' };
};

// Go's Document as the page operations return it.
const docState = (id) => {
  const { path, work, undone } = docs.get(id);
  return {
    id, path, fileName: basename(path), size: 25351, modTime: '2026-11-10T09:14:00Z',
    modified: work.length > 0, undoSteps: work.length, redoSteps: undone.length,
  };
};

// The page routes Go serves: /doc/<id> is the newest working copy, else the
// fixture (from the dev server); a PUT with ?work=1 pushes a working copy,
// one without saves (and so drops the copies), ?export= writes nothing.
const fixtureFetch = window.fetch.bind(window);
const docRoute = (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const match = /^\/doc\/([\w-]+)$/.exec(url.pathname);
  return match && docs.has(match[1]) ? { id: match[1], url } : null;
};
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
window.fetch = async (input, init = {}) => {
  const route = docRoute(input);
  if (!route) return fixtureFetch(input, init);
  const doc = docs.get(route.id);
  if ((init.method ?? 'GET') === 'GET') {
    const bytes = doc.work.at(-1);
    return bytes ? new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } }) : fixtureFetch(input, init);
  }
  const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
  if (route.url.searchParams.has('export')) return json({});
  if (route.url.searchParams.has('work')) {
    doc.work.push(bytes);
    doc.replaced = doc.undone;
    doc.undone = [];
  } else {
    doc.work = [];
    doc.undone = [];
    doc.replaced = [];
  }
  return json(docState(route.id));
};

/** The document's current bytes, for operations the mock can't really do. */
const currentBytes = async (id) => docs.get(id).work.at(-1) ?? new Uint8Array(await (await fixtureFetch(`/doc/${id}`)).arrayBuffer());

// Resolves once the app has finished its startup (TakeStartupFiles is its last step).
let appReady;
export const appReadyPromise = new Promise((resolve) => { appReady = resolve; });

export const FIXTURE_FILES = {
  recent: [
    { filePath: `${HOME}/Master Services Agreement.pdf`, fileName: 'Master Services Agreement.pdf', lastOpened: '2026-11-12T16:40:00Z', pageCount: 12 },
    { filePath: `${HOME}/Meeting notes - kickoff.pdf`, fileName: 'Meeting notes - kickoff.pdf', lastOpened: '2026-11-11T10:05:00Z', pageCount: 2 },
    { filePath: `${HOME}/Invoice 2026-0412.pdf`, fileName: 'Invoice 2026-0412.pdf', lastOpened: '2026-11-07T08:30:00Z', pageCount: 12 },
    { filePath: `${HOME}/Lease agreement - Carrer Major 14.pdf`, fileName: 'Lease agreement - Carrer Major 14.pdf', lastOpened: '2026-10-29T18:22:00Z', pageCount: 12 },
    { filePath: `${HOME}/Tax return 2025 (draft).pdf`, fileName: 'Tax return 2025 (draft).pdf', lastOpened: '2026-10-15T12:00:00Z', pageCount: 12 },
  ],
};

export const DNIE_FINGERPRINT = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4';

const certificates = [
  {
    name: 'GARCIA LOPEZ MARIA - DNI 12345678Z (FIRMA)',
    issuer: 'AC DNIE 004',
    subject: 'CN=GARCIA LOPEZ MARIA - DNI 12345678Z, SERIALNUMBER=IDCES-12345678Z, C=ES',
    serialNumber: '3F2A91C07B',
    validFrom: '2024-03-02 09:00:00 +0000 UTC',
    validTo: '2029-03-02 09:00:00 +0000 UTC',
    fingerprint: DNIE_FINGERPRINT,
    source: 'pkcs11',
    keyUsage: ['Digital Signature', 'Non Repudiation'],
    isValid: true,
    pkcs11Url: 'pkcs11:model=DNIe;manufacturer=DGP',
    pkcs11Module: '/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so',
    filePath: '',
    nssNickname: '',
    canSign: true,
    requiresPin: true,
    pinOptional: false,
  },
  {
    name: 'Maria Garcia - Northwind Consulting',
    issuer: 'Northwind Internal CA',
    subject: 'CN=Maria Garcia, O=Northwind Consulting S.L., C=ES',
    serialNumber: '0B77D4',
    validFrom: '2025-06-01 00:00:00 +0000 UTC',
    validTo: '2026-12-01 00:00:00 +0000 UTC',
    fingerprint: '5D:0E:41:99:7A:10:CC:3B:82:F4:6E:21:AD:90:0B:57:3C:E8:11:42',
    source: 'pkcs12',
    keyUsage: ['Digital Signature'],
    isValid: true,
    filePath: '/home/ferran/.pki/certs/maria-northwind.p12',
    nssNickname: '',
    canSign: true,
    requiresPin: true,
    pinOptional: false,
  },
  {
    name: 'Contoso Logistics Root CA',
    issuer: 'Contoso Logistics Root CA',
    subject: 'CN=Contoso Logistics Root CA, O=Contoso Logistics S.A., C=ES',
    serialNumber: '01',
    validFrom: '2020-01-15 00:00:00 +0000 UTC',
    validTo: '2030-01-15 00:00:00 +0000 UTC',
    fingerprint: '9E:22:B0:6C:D5:14:8A:F7:30:4D:C9:A2:E1:68:5B:03:7F:AA:19:D6',
    source: 'nss',
    keyUsage: ['Certificate Sign', 'CRL Sign'],
    isValid: true,
    nssNickname: 'Contoso Logistics Root CA',
    filePath: '',
    canSign: false,
    requiresPin: false,
    pinOptional: false,
  },
];

const profiles = [
  {
    id: 'profile-invisible', name: 'Invisible signature', description: 'Recorded in the PDF, not drawn on the page',
    visibility: 'invisible', position: null, appearance: null, location: '', isDefault: true,
  },
  {
    id: 'profile-visible', name: 'Corporate - visible stamp', description: 'Name and date, bottom right of the last page',
    visibility: 'visible', position: { page: 0, x: 345, y: 64, width: 200, height: 72 },
    appearance: { showSignerName: true, showSigningTime: true, showLocation: false, showLogo: false, logoPath: '', logoPosition: 'left', customText: 'Approved for Northwind Consulting', fontSize: 10, backgroundColor: '#ffffff', textColor: '#000000' },
    location: 'Barcelona', isDefault: false,
  },
  {
    id: 'profile-initials', name: 'Initials with reason', description: 'Small visible box, any page',
    visibility: 'visible', position: null,
    appearance: { showSignerName: true, showSigningTime: false, showLocation: true, showLogo: false, logoPath: '', logoPosition: 'left', customText: '', fontSize: 9, backgroundColor: '#ffffff', textColor: '#000000' },
    location: '', isDefault: false,
  },
];

const config = () => ({
  theme: window.__PREVIEW_THEME || 'dark',
  accentColor: '#3b82f6',
  defaultZoom: 100,
  showLeftSidebar: false,
  showRightSidebar: false,
  defaultViewMode: 'scroll',
  recentFilesLength: 5,
  autosaveInterval: 0,
  certificateStores: ['/home/ferran/.pki/certs', '/etc/ssl/lankir-certs'],
  tokenLibraries: ['/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so', '/usr/lib/libpkcs11-dnie.so'],
  tsaUrl: 'http://timestamp.digicert.com',
  signatureLocationLookup: false,
  checkRevocationOnline: true,
  lastCertificateFingerprint: '',
  lastSignatureProfileId: '',
  debugMode: false,
  hardwareAccel: true,
});

export const App = lenient({
  TakeStartupFiles: async () => {
    setTimeout(appReady, 0);
    return [];
  },
  OpenFileDialog: async () => '',
  OpenDirectoryDialog: async () => '',
  LogFrontend: async () => {},
  Version: async () => '1.0.0',
});

export const PDFService = lenient({
  OpenPDF: async () => {
    const next = openQueue.shift();
    if (next === undefined) return null;
    if (next instanceof Error) throw next;
    return register(next);
  },
  OpenPDFByPath: async (path) => register(path),
  ClosePDF: async (id) => { docs.delete(id); },
  ChooseSavePath: async (_id, name) => ({ path: `${HOME}/${name}`, exists: false }),
  ChooseExportFolder: async () => `${HOME}/Contracts`,
  OpenPDFs: async () => [register(`${HOME}/Meeting notes - kickoff.pdf`)],
  // pdfcpu's rotate and blank page can't run here: they push the content unchanged, as an undo step.
  RotatePages: async (id) => {
    const doc = docs.get(id);
    doc.work.push(await currentBytes(id));
    doc.replaced = doc.undone;
    doc.undone = [];
    return docState(id);
  },
  InsertBlankPage: async (id) => PDFService.RotatePages(id),
  SetMetadata: async (id) => PDFService.RotatePages(id),
  RevertToSaved: async (id) => {
    Object.assign(docs.get(id), { work: [], undone: [], replaced: [] });
    return docState(id);
  },
  UndoPageOp: async (id) => {
    const doc = docs.get(id);
    if (!doc.work.length) throw new Error('nothing to undo');
    doc.replaced = [];
    doc.undone.push(doc.work.pop());
    return docState(id);
  },
  DropPageOp: async (id) => {
    const doc = docs.get(id);
    if (!doc.work.length) throw new Error('nothing to drop');
    doc.work.pop();
    doc.undone = doc.replaced;
    doc.replaced = [];
    return docState(id);
  },
  RedoPageOp: async (id) => {
    const doc = docs.get(id);
    if (!doc.undone.length) throw new Error('nothing to redo');
    doc.replaced = [];
    doc.work.push(doc.undone.pop());
    return docState(id);
  },
});

export const RecentFilesService = lenient({
  GetRecent: async () => FIXTURE_FILES.recent.map((f) => ({ ...f })),
  RemoveRecent: async () => {},
  AddRecent: async () => {},
});

// The contract's signature: a person's FNMT certificate under a root this
// system trusts, no timestamp, and FNMT's OCSP responder asked online.
const FNMT_CHAIN = [
  { subject: 'PUIG FERRER JORDI - 47110824K', issuer: 'AC FNMT Usuarios' },
  { subject: 'AC FNMT Usuarios', issuer: 'AC RAIZ FNMT-RCM' },
  { subject: 'AC RAIZ FNMT-RCM', issuer: 'AC RAIZ FNMT-RCM' },
];

let contractRevocation = {};
/** The contract's revocation check from now on, e.g. an offline one. */
export function setContractRevocation(revocationStatus, revocationCheck) {
  contractRevocation = { revocationStatus, revocationCheck };
}

const contractSignature = () => ({
  signerName: 'PUIG FERRER JORDI - 47110824K',
  signerDN: 'CN=PUIG FERRER JORDI - 47110824K,SERIALNUMBER=IDCES-47110824K,OU=CIUDADANOS,O=FNMT-RCM,C=ES',
  signingTime: '2026-11-09T11:32:00Z',
  signingTimeSource: 'signer',
  signingHashAlgorithm: '',
  signatureType: 'SHA256-RSA',
  isValid: true,
  certificateValid: true,
  issuerTrusted: true,
  validationMessage: 'Signature is cryptographically valid',
  certificateValidationMessage: 'Certificate is valid and trusted',
  reason: 'I approve this document',
  location: 'Barcelona',
  contactInfo: '',
  keyAlgorithm: 'RSA 2048',
  issuerName: 'AC FNMT Usuarios',
  issuerDN: 'CN=AC FNMT Usuarios,OU=Ceres,O=FNMT-RCM,C=ES',
  certificateSerial: '5B:1E:93:0C:4F:A2:71:D8:60:0E:3C:B9:12:47:AF:D5',
  certificateValidFrom: '2024-05-20T08:14:31Z',
  certificateValidUntil: '2028-05-20T08:14:31Z',
  timestampTime: '',
  timestampStatus: 'none',
  revocationStatus: 'good',
  revocationCheck: 'OCSP checked online with the certificate authority',
  ...contractRevocation,
  chain: FNMT_CHAIN.map((c) => ({ ...c })),
  warnings: [],
});

// A later signature over a changed document, signed with an expired certificate
// whose revocation an embedded CRL reports; shown when a scene asks for it.
const damagedSignature = () => ({
  ...contractSignature(),
  signerName: 'Northwind Consulting S.L.',
  signerDN: 'CN=Northwind Consulting S.L.,O=Northwind Consulting S.L.,L=Girona,C=ES',
  signingTime: '2026-11-12T16:05:00Z',
  isValid: false,
  validationMessage: 'Signature validation failed: hash of the signed bytes does not match the signature',
  certificateValid: false,
  issuerTrusted: false,
  certificateValidationMessage: 'Certificate has been revoked on 2026-10-30 12:00:00',
  reason: 'Counter-signed',
  location: 'Girona',
  issuerName: 'Northwind Internal CA',
  issuerDN: 'CN=Northwind Internal CA,O=Northwind Consulting S.L.,C=ES',
  certificateSerial: '0B:77:D4',
  certificateValidFrom: '2023-06-01T00:00:00Z',
  certificateValidUntil: '2026-06-01T00:00:00Z',
  keyAlgorithm: 'ECDSA P-256',
  signatureType: 'ECDSA-SHA256',
  revocationStatus: 'revoked',
  revocationCheck: 'Embedded in the PDF',
  chain: [{ subject: 'Northwind Consulting S.L.', issuer: 'Northwind Internal CA' }],
  warnings: ['Certificate revoked, but cannot determine if revocation occurred before or after signing without trusted timestamp'],
});

let withDamagedSignature = false;
/** The contract carries a second, damaged signature from now on. */
export function addDamagedSignature() {
  withDamagedSignature = true;
}

const contractSignatures = () => (withDamagedSignature ? [contractSignature(), damagedSignature()] : [contractSignature()]);

export const SignatureService = lenient({
  ListCertificates: async () => certificates.map((c) => ({ ...c })),
  ListSignatureProfiles: async () => profiles.map((p) => ({ ...p })),
  GetDefaultCertificateSources: async () => ({ system: ['/etc/ssl/certs'], user: ['/home/ferran/.pki/certs'] }),
  GetDefaultTokenLibraries: async () => ['/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so'],
  VerifySignatures: async (path) => (fixtureFor(path) === 'contract' ? contractSignatures() : []),
  VerifySignaturesOffline: async (path) => (fixtureFor(path) === 'contract' ? contractSignatures() : []),
});

export const ConfigService = lenient({
  Get: async () => config(),
  Update: async () => {},
});
