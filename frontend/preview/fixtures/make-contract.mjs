// Generates the fixture PDFs used by the browser preview: node make-contract.mjs
// Hand-written PDF syntax, uncompressed and fixed, so the output is byte-identical every run.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const W = 595;
const H = 842;

const esc = (s) => s.replace(/[\\()]/g, '\\$&');

const LOREM = [
  'The Provider shall perform the services described in Schedule A with reasonable skill and care, in accordance with generally accepted professional standards and all applicable laws.',
  'The Client shall give the Provider timely access to the information, personnel and premises that the Provider reasonably needs to perform the services, and shall nominate one representative for day to day communication.',
  'Fees are payable within thirty days of the date of each invoice. Late payments accrue interest at the statutory rate. Either party may suspend its performance while an undisputed payment is overdue.',
  'Each party shall keep confidential all non public information it receives from the other party and shall use it only to perform this Agreement. This obligation survives termination for five years.',
  'Neither party is liable for delay or failure caused by events beyond its reasonable control. The affected party shall notify the other promptly and resume performance as soon as practicable.',
];

function wrap(text, max = 88) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if ((line + ' ' + word).trim().length > max) {
      lines.push(line);
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Content stream for one page: [{ size, bold, text }] blocks stacked top to bottom. */
function pageStream(blocks) {
  let y = H - 80;
  let out = '';
  for (const b of blocks) {
    const font = b.bold ? '/F2' : '/F1';
    const lead = b.size * 1.5;
    for (const line of b.heading ? [b.text] : wrap(b.text)) {
      out += `BT ${font} ${b.size} Tf 60 ${y} Td (${esc(line)}) Tj ET\n`;
      y -= lead;
    }
    y -= b.gap ?? 10;
  }
  return out;
}

/**
 * pages: [{ blocks, fields?, signature? }]; fields: [{ name, label, y, value }] drawn as text widgets;
 * signature: an invisible signature field on the page, signed by that name (a placeholder value,
 * the preview's mock backend reports the signature itself).
 * outline: [{ title, page }] (1-based).
 */
function buildPdf({ title, pages, outline = [] }) {
  const objs = []; // index = object number - 1
  const add = (body) => objs.push(body) && objs.length;
  const reserve = () => add(null);
  const set = (n, body) => { objs[n - 1] = body; };

  const catalog = reserve();
  const pagesRoot = reserve();
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const info = add(`<< /Title (${esc(title)}) /Producer (lankir preview fixtures) >>`);

  const pageNums = [];
  const fieldNums = [];
  for (const p of pages) {
    const content = pageStream(p.blocks);
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    const pageNum = reserve();
    const widgets = (p.fields ?? []).map((f) => {
      const w = add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (${esc(f.name)}) /V (${esc(f.value ?? '')}) /DA (/Helv 11 Tf 0 g) /F 4 /Rect [60 ${f.y} 360 ${f.y + 22}] /BS << /W 1 /S /S >> /MK << /BC [0.4 0.4 0.4] /BG [0.96 0.96 0.98] >> /P ${pageNum} 0 R >>`);
      fieldNums.push(w);
      return w;
    });
    if (p.signature) {
      const v = add(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (${esc(p.signature)}) /M (D:20261109113200Z) /ByteRange [0 0 0 0] /Contents <${'0'.repeat(64)}> >>`);
      const w = add(`<< /Type /Annot /Subtype /Widget /FT /Sig /T (signature_${fieldNums.length + 1}) /V ${v} 0 R /F 132 /Rect [0 0 0 0] /P ${pageNum} 0 R >>`);
      fieldNums.push(w);
      widgets.push(w);
    }
    set(pageNum, `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R${widgets.length ? ` /Annots [${widgets.map((w) => `${w} 0 R`).join(' ')}]` : ''} >>`);
    pageNums.push(pageNum);
  }
  set(pagesRoot, `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`);

  let outlinesRef = '';
  if (outline.length) {
    const root = reserve();
    const items = outline.map(() => reserve());
    outline.forEach((o, i) => {
      set(items[i], `<< /Title (${esc(o.title)}) /Parent ${root} 0 R /Dest [${pageNums[o.page - 1]} 0 R /Fit]${i > 0 ? ` /Prev ${items[i - 1]} 0 R` : ''}${i < items.length - 1 ? ` /Next ${items[i + 1]} 0 R` : ''} >>`);
    });
    set(root, `<< /Type /Outlines /First ${items[0]} 0 R /Last ${items[items.length - 1]} 0 R /Count ${items.length} >>`);
    outlinesRef = ` /Outlines ${root} 0 R /PageMode /UseOutlines`;
  }

  const signed = pages.some((p) => p.signature);
  const acro = fieldNums.length
    ? ` /AcroForm << /Fields [${fieldNums.map((n) => `${n} 0 R`).join(' ')}] /NeedAppearances true${signed ? ' /SigFlags 3' : ''} /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv ${f1} 0 R >> >> >>`
    : '';
  set(catalog, `<< /Type /Catalog /Pages ${pagesRoot} 0 R${outlinesRef}${acro} >>`);

  let pdf = '%PDF-1.7\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const sections = [
  'Definitions and interpretation', 'Services', 'Client obligations', 'Fees and payment',
  'Confidentiality', 'Intellectual property', 'Warranties', 'Limitation of liability',
  'Term and termination', 'General provisions',
];

const contractPages = [];
contractPages.push({
  blocks: [
    { size: 26, bold: true, heading: true, text: 'Master Services Agreement', gap: 14 },
    { size: 13, text: 'between Northwind Consulting S.L. (the Provider) and Contoso Logistics S.A. (the Client).', gap: 24 },
    { size: 12, bold: true, heading: true, text: 'Contents', gap: 8 },
    ...sections.map((s, i) => ({ size: 11, heading: true, text: `${i + 1}. ${s}`, gap: 2 })),
  ],
});
sections.forEach((s, i) => {
  contractPages.push({
    blocks: [
      { size: 18, bold: true, heading: true, text: `${i + 1}. ${s}`, gap: 14 },
      ...[0, 1, 2].flatMap((k) => [
        { size: 11, text: `${i + 1}.${k + 1} ${LOREM[(i + k) % LOREM.length]}`, gap: 12 },
        { size: 11, text: LOREM[(i + k + 2) % LOREM.length], gap: 16 },
      ]),
    ],
  });
});
contractPages.push({
  blocks: [
    { size: 18, bold: true, heading: true, text: 'Signature page', gap: 14 },
    { size: 11, text: 'By completing the fields below, each party confirms that it has read and agrees to this Agreement.', gap: 18 },
    { size: 11, heading: true, text: 'Full name of the Client representative', gap: 54 },
    { size: 11, heading: true, text: 'Position', gap: 54 },
    { size: 11, heading: true, text: 'Date of signature', gap: 20 },
  ],
  fields: [
    { name: 'client_name', value: 'Maria Garcia', y: 642 },
    { name: 'client_position', value: 'Chief Operating Officer', y: 566 },
    { name: 'signature_date', value: '', y: 492 },
  ],
  signature: 'PUIG FERRER JORDI - 47110824K',
});

writeFileSync(join(here, 'contract.pdf'), buildPdf({
  title: 'Master Services Agreement',
  pages: contractPages,
  outline: [
    ...sections.map((s, i) => ({ title: `${i + 1}. ${s}`, page: i + 2 })),
    { title: 'Signature page', page: 12 },
  ],
}));

writeFileSync(join(here, 'notes.pdf'), buildPdf({
  title: 'Meeting notes',
  pages: [
    { blocks: [
      { size: 20, bold: true, heading: true, text: 'Meeting notes - project kickoff', gap: 14 },
      { size: 11, text: 'Attendees: Maria, Jordi, Anna, Pau. The team agreed on the scope, the delivery calendar and the review process for the first milestone.', gap: 12 },
      { size: 11, text: LOREM[3], gap: 12 },
    ] },
    { blocks: [
      { size: 20, bold: true, heading: true, text: 'Action items', gap: 14 },
      { size: 11, text: 'Jordi to send the revised agreement to the Client. Anna to book the review meeting. Pau to prepare the signing certificates before the contract is sent.', gap: 12 },
    ] },
  ],
}));
