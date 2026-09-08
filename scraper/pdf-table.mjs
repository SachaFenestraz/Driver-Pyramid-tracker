// Extracts table-shaped rows of cells from a PDF, using each text run's
// actual position (not the literal characters) to find column boundaries —
// more robust than splitting on runs of space characters, since a PDF can
// place a "column gap" either as a wide space glyph OR as a pure cursor
// move with no glyph at all (both happen in real-world tabular PDFs).
//
// Uses pdfjs-dist (Mozilla's actively-maintained PDF.js), not the
// long-abandoned `pdf-parse` package — pdf-parse bundles a PDF.js build
// from 2018 that throws "bad XRef entry" on a meaningful slice of
// perfectly valid modern PDFs (confirmed against pdfkit-generated fixtures
// during development; this is why this module exists instead of a
// one-line pdf-parse call).
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * @param {Buffer} buf raw PDF bytes
 * @param {object} [opts]
 * @param {number} [opts.minGapChars=1.6] a horizontal gap wider than this
 *   many "average characters" (estimated per line from the items on it)
 *   starts a new cell instead of continuing the current one. Tuned against
 *   synthetic fixtures — real fia.com PDFs may need this adjusted after
 *   the first live run (see README's Race Pace Archive honesty notes).
 * @returns {Promise<string[][]>} one array of trimmed cell strings per line
 */
export async function extractRows(buf, opts = {}) {
  const minGapChars = opts.minGapChars ?? 1.6;
  // verbosity: 0 silences a harmless "standardFontDataUrl" warning pdf.js
  // logs when it can't find AFM metrics for a standard font — irrelevant
  // here since we only read text content, never render glyphs.
  const loadingTask = getDocument({ data: new Uint8Array(buf), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 });
  const pdf = await loadingTask.promise;
  const rows = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    if (!content.items.length) continue;

    // Group items into lines by y-position (rounded to absorb sub-pixel jitter).
    const byY = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5] * 5) / 5; // snap to nearest 0.2pt
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item);
    }
    const ys = [...byY.keys()].sort((a, b) => b - a); // top to bottom

    for (const y of ys) {
      // Drop pure-whitespace items entirely — the gap between two REAL
      // items already spans whatever whitespace (glyph or cursor-move)
      // separated them, whether or not a space glyph was even emitted.
      const items = byY.get(y)
        .filter(i => i.str.trim() !== '')
        .sort((a, b) => a.transform[4] - b.transform[4]);
      if (!items.length) continue;

      const avgCharWidth = items.reduce((s, i) => s + (i.width / Math.max(i.str.length, 1)), 0) / items.length || 5;
      const gapThreshold = avgCharWidth * minGapChars;

      const cells = [];
      let current = '';
      let prevEndX = null;
      for (const item of items) {
        const startX = item.transform[4];
        if (prevEndX !== null) {
          const gap = startX - prevEndX;
          if (gap > gapThreshold) {
            cells.push(current.trim());
            current = '';
          } else if (current) {
            current += ' ';
          }
        }
        current += item.str;
        prevEndX = startX + item.width;
      }
      if (current.trim()) cells.push(current.trim());
      if (cells.length) rows.push(cells);
    }
  }
  return rows;
}
