// src/resume/docx.ts
// Dependency-free DOCX writer for GigRadar.
// Builds a minimal OOXML package (stored ZIP entries + CRC32) so the exact same
// code runs in Node (scripts/ats-check.ts) and inside a Cloudflare Worker where
// there is no filesystem and no zip library.
//
// Layout follows the ATS checklist: single column, standard headings, contact
// block inside the body, plain dash bullets, no tables / tabs / text boxes.

import { HEADERS } from './ats';
import { ResumeDoc } from './tailor';

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Minimal ZIP writer using STORED (uncompressed) entries. */
function zipStore(entries: ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const DOS_TIME = 0;
  const DOS_DATE = 0x5c21; // 2026-01-01, fixed so output is byte-stable
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);

    parts.push(local, entry.data);
    central.push(cen);
    offset += local.length + size;
  }

  let cdSize = 0;
  for (const c of central) cdSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  parts.push(...central, eocd);

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// OOXML parts
// ---------------------------------------------------------------------------

const BODY_COLOR = '222222';
const MUTED_COLOR = '555555';
const ACCENT_COLOR = '1F2B5B';

function esc(s: any): string {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface RunOpts {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string;
}

function run(text: string, o: RunOpts = {}): string {
  const half = (o.size || 11) * 2;
  let rpr = '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>';
  if (o.bold) rpr += '<w:b/>';
  if (o.italic) rpr += '<w:i/>';
  rpr += '<w:color w:val="' + (o.color || BODY_COLOR) + '"/>';
  rpr += '<w:sz w:val="' + half + '"/><w:szCs w:val="' + half + '"/>';
  rpr += '</w:rPr>';
  return '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
}

function para(runs: string, o: { before?: number; after?: number } = {}): string {
  const pr = '<w:pPr><w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 0) + '"/></w:pPr>';
  return '<w:p>' + pr + runs + '</w:p>';
}

function cleanList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim());
}

function body(r: ResumeDoc): string {
  const out: string[] = [];
  const h = (r && r.header) || ({} as any);

  out.push(para(run(h.name || 'Candidate', { bold: true, size: 18 }), { after: 30 }));
  if (h.headline) out.push(para(run(h.headline, { size: 11 }), { after: 20 }));
  if (h.location) out.push(para(run(h.location, { size: 10, color: MUTED_COLOR }), { after: 10 }));

  const contacts = cleanList([h.email, h.phone, h.website, h.github, h.linkedin, h.telegram]);
  if (contacts.length) out.push(para(run(contacts.join(' | '), { size: 10, color: MUTED_COLOR }), { after: 120 }));

  const heading = (label: string) =>
    para(run(label, { bold: true, size: 12, color: ACCENT_COLOR }), { before: 140, after: 60 });

  if (r && r.summary) {
    out.push(heading(HEADERS.summary));
    out.push(para(run(r.summary, { size: 11 }), { after: 60 }));
  }

  const skills = Array.isArray(r && r.skills) ? r.skills : [];
  if (skills.length) {
    out.push(heading(HEADERS.skills));
    for (const g of skills) {
      const items = cleanList(g && g.items);
      if (!items.length) continue;
      out.push(
        para(run(String((g && g.category) || 'Skills') + ': ', { bold: true, size: 11 }) + run(items.join(', '), { size: 11 }), {
          after: 20,
        })
      );
    }
  }

  const exp = Array.isArray(r && r.experience) ? r.experience : [];
  if (exp.length) {
    out.push(heading(HEADERS.experience));
    for (const e of exp) {
      const title = [e && e.title, e && e.company].filter(Boolean).join(' - ');
      const years = [e && e.start, e && e.end].filter(Boolean).join(' - ');
      const meta = [e && e.location, years].filter(Boolean).join(' | ');
      out.push(
        para(
          run(title, { bold: true, size: 11 }) + (meta ? run('  ' + meta, { size: 10, color: MUTED_COLOR }) : ''),
          { before: 80, after: 20 }
        )
      );
      const stack = cleanList(e && e.stack);
      if (stack.length) out.push(para(run('Tech: ' + stack.join(', '), { size: 10, color: MUTED_COLOR }), { after: 10 }));
      for (const b of (e && e.bullets) || []) {
        const t = typeof b === 'string' ? b : b && b.text;
        if (t) out.push(para(run('- ' + t, { size: 11 }), { after: 10 }));
      }
    }
  }

  const proj = Array.isArray(r && r.projects) ? r.projects : [];
  if (proj.length) {
    out.push(heading(HEADERS.projects));
    for (const p of proj) {
      const stack = cleanList(p && p.stack).join(', ');
      out.push(
        para(run(String((p && p.name) || '') + (stack ? ' | ' + stack : ''), { bold: true, size: 11 }), {
          before: 80,
          after: 20,
        })
      );
      for (const b of (p && p.bullets) || []) {
        const t = typeof b === 'string' ? b : b && b.text;
        if (t) out.push(para(run('- ' + t, { size: 11 }), { after: 10 }));
      }
    }
  }

  const edu = Array.isArray(r && r.education) ? r.education : [];
  if (edu.length) {
    out.push(heading(HEADERS.education));
    for (const d of edu) {
      out.push(
        para(run([d && d.degree, d && d.school].filter(Boolean).join(' - '), { bold: true, size: 11 }), {
          before: 60,
          after: 10,
        })
      );
      const yrs = [d && d.start, d && d.end].filter(Boolean).join(' - ');
      if (yrs) out.push(para(run(yrs, { size: 10, color: MUTED_COLOR }), { after: 20 }));
    }
  }

  return out.join('');
}

export function buildDocumentXml(r: ResumeDoc): string {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return (
    head +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body(r) +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const DOC_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/>' +
  '</w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>';

export function buildDocx(r: ResumeDoc): Uint8Array {
  return zipStore([
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'word/document.xml', data: encoder.encode(buildDocumentXml(r)) },
    { name: 'word/styles.xml', data: encoder.encode(STYLES_XML) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOC_RELS) },
  ]);
}

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** ATS-friendly file name: FirstName_LastName_Resume_<tag>.docx */
export function resumeFilename(name: string, tag: string): string {
  const who =
    slug(name)
      .split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('_') || 'Candidate';
  const what = slug(tag) || 'tailored';
  return who + '_Resume_' + what + '.docx';
}
