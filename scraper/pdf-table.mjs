// Extracts table-shaped content from a PDF using each text run's actual
// on-page position, not its literal characters — more robust than
// splitting on runs of space characters, since a PDF can place a "column
// gap" either as a wide space glyph OR as a pure cursor move with no glyph
// at all (both happen in real-world tabular PDFs).
//
// Uses pdfjs-dist (Mozilla's actively-maintained PDF.js), not the
// long-abandoned `pdf-parse` package — pdf-parse bundles a PDF.js build
// from 2018 that throws "bad XRef entry" on a meaningful slice of
// perfectly valid modern PDFs (confirmed against pdfkit-generated fixtures
// during development; this is why this module exists instead of a
// one-line pdf-parse call).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// verbosity: 0 silences a harmless "standardFontDataUrl" warning pdf.js
// logs when it can't find AFM metrics for a standard font — irrelevant
// here since we only read text content, never render glyphs.
async function loadTextItemsByLine(buf) {
  const loadingTask = getDocument({ data: new Uint8Array(buf), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  const pdf = await loadingTask.promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    if (!content.items.length) continue;
    // Drop pure-whitespace items — the gap between two REAL items already
    // spans whatever whitespace (glyph or cursor-move) separated them,
    // whether or not a space glyph was even emitted.
    const byY = new Map();
    for (const item of content.items) {
      if (item.str.trim() === '') continue;
      const y = Math.round(item.transform[5] * 5) / 5; // snap to nearest 0.2pt
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: item.transform[4], width: item.width, str: item.str });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a); // top to bottom
    for (const y of ys) {
      lines.push({ page: p, y, items: byY.get(y).sort((a, b) => a.x - b.x) });
    }
  }
  return lines;
}

/**
 * Merges a line's positioned items into cells left-to-right by gap size.
 * @returns {{text:string,x:number,endX:number}[]}
 */
function mergeItemsToCells(items, minGapChars) {
  if (!items.length) return [];
  const avgCharWidth = items.reduce((s, i) => s + (i.width / Math.max(i.str.length, 1)), 0) / items.length || 5;
  const gapThreshold = avgCharWidth * minGapChars;
  const cells = [];
  let current = '', cellStartX = null, prevEndX = null;
  for (const item of items) {
    if (prevEndX !== null) {
      const gap = item.x - prevEndX;
      if (gap > gapThreshold) {
        cells.push({ text: current.trim(), x: cellStartX, endX: prevEndX });
        current = ''; cellStartX = null;
      } else if (current) {
        current += ' ';
      }
    }
    if (cellStartX === null) cellStartX = item.x;
    current += item.str;
    prevEndX = item.x + item.width;
  }
  if (current.trim()) cells.push({ text: current.trim(), x: cellStartX, endX: prevEndX });
  return cells;
}

/**
 * @param {Buffer} buf raw PDF bytes
 * @param {object} [opts]
 * @param {number} [opts.minGapChars=1.6] a horizontal gap wider than this
 *   many "average characters" (estimated per line from the items on it)
 *   starts a new cell instead of continuing the current one. Tuned against
 *   synthetic fixtures — real fia.com PDFs may need this adjusted if a
 *   layout doesn't match (see README's Race Pace Archive honesty notes).
 * @returns {Promise<string[][]>} one array of trimmed cell strings per line
 */
export async function extractRows(buf, opts = {}) {
  const minGapChars = opts.minGapChars ?? 1.6;
  const lines = await loadTextItemsByLine(buf);
  const rows = [];
  for (const line of lines) {
    const cells = mergeItemsToCells(line.items, minGapChars).map(c => c.text);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/**
 * Like extractRows, but keeps each cell's x-position and doesn't merge
 * across lines — needed for tables where a column can be legitimately
 * blank in some rows (e.g. a race leader's "gap to leader" column).
 * Sequential left-to-right cell merging silently misaligns the rest of
 * that row when a column has nothing in it; a caller that hits this shape
 * should instead bucket each row's cells against known column x-positions
 * (usually taken from a header row) rather than by sequential order.
 * @returns {Promise<{page:number,y:number,cells:{text:string,x:number,endX:number}[]}[]>}
 */
export async function extractPositionedRows(buf, opts = {}) {
  const minGapChars = opts.minGapChars ?? 1.6;
  const lines = await loadTextItemsByLine(buf);
  return lines
    .map(line => ({ page: line.page, y: line.y, cells: mergeItemsToCells(line.items, minGapChars) }))
    .filter(l => l.cells.length);
}
