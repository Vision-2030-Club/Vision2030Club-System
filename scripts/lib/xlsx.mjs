/**
 * A minimal .xlsx reader with no dependency — an .xlsx is a zip of XML parts.
 *
 * Shared by build-member-csv.mjs, import-timeline.mjs and
 * import-mock-interviews.mjs. The one thing to know: it reads the zip's
 * CENTRAL DIRECTORY rather than the local file headers. An entry written in
 * streaming mode carries zero sizes in its local header and puts the real
 * ones in a trailing data descriptor; the central directory always has them,
 * so this reads every part instead of silently skipping some.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

export function readZip(path) {
  const buf = readFileSync(path);
  const files = {};

  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`${path} is not a readable zip`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed);

    try {
      files[name] = method === 0 ? raw.toString('utf8') : inflateRawSync(raw).toString('utf8');
    } catch {
      /* a binary part we do not need */
    }

    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Opens a workbook. Returns the sheet names in order and a `rows(name)` that
 * yields each row as an object keyed by column letter, cells already
 * resolved through the shared-strings table and trimmed.
 */
export function openWorkbook(path) {
  const parts = readZip(path);

  const shared = [];
  for (const si of (parts['xl/sharedStrings.xml'] ?? '').match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
  }

  // Sheet names, in workbook order, mapped to their part via the rels file.
  const names = [];
  const rels = {};
  for (const [, id, target] of (parts['xl/_rels/workbook.xml.rels'] ?? '').matchAll(
    /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g,
  )) {
    rels[id] = target.replace(/^\/?xl\//, '');
  }
  for (const [, name, rid] of (parts['xl/workbook.xml'] ?? '').matchAll(
    /<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g,
  )) {
    names.push({ name: decode(name), part: `xl/${rels[rid] ?? ''}` });
  }

  function rows(sheetName) {
    const sheet = names.find((s) => s.name === sheetName);
    const xml = sheet ? parts[sheet.part] : undefined;
    if (!xml) throw new Error(`No sheet named "${sheetName}" in ${path}`);

    const out = [];
    for (const [, rnum, body] of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      for (const [, ref, attrs, inner] of body.matchAll(
        /<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g,
      )) {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        let value = '';
        if (attrs.includes('t="s"') && v) value = shared[Number(v[1])] ?? '';
        else if (t) value = t[1];
        else if (v) value = v[1];
        cells[ref] = decode(value).trim();
      }
      out.push({ row: Number(rnum), cells });
    }
    return out.sort((a, b) => a.row - b.row);
  }

  /** Rows as objects keyed by the header in row 1. */
  function records(sheetName) {
    const all = rows(sheetName);
    if (all.length === 0) return [];
    const header = all[0].cells;
    const keys = Object.entries(header).map(([col, name]) => [col, name]);
    return all.slice(1).map(({ row, cells }) => {
      const record = { __row: row };
      for (const [col, name] of keys) record[name] = cells[col] ?? '';
      return record;
    });
  }

  return { sheetNames: names.map((s) => s.name), rows, records };
}
