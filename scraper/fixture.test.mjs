// Offline sanity checks for each table parser, built from the real
// structures confirmed against the live sites (see comments in
// fetch-standings.mjs and sources.mjs for how each was verified). This
// sandbox can't reach the live sites directly, so these fixtures stand in
// for "did the site change shape" regression coverage — run this after
// touching any parser, and the CI workflow runs it before every real scrape.
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';

function normalizeName(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim(); }
function cellText($cell) { return $cell.text().replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(); }

function parseFiaOfficial(html, candidateSurnames) {
  const $ = cheerio.load(html);
  const tables = $('table').toArray();
  let best = null;
  for (const table of tables) {
    const rows = $(table).find('tr').toArray();
    const matchedRows = [];
    for (const row of rows) {
      const cells = $(row).find('td,th').toArray();
      if (cells.length < 2) continue;
      const firstText = cellText($(cells[0]));
      const m = firstText.match(/^(\d{1,2})\s*[.:]?\s*(.+)$/);
      if (!m) continue;
      const pos = parseInt(m[1], 10);
      const namePart = normalizeName(m[2]);
      const surname = candidateSurnames.find(s => new RegExp(`\\b${s}\\b`).test(namePart));
      if (!surname) continue;
      const lastText = cellText($(cells[cells.length - 1]));
      const ptsMatch = lastText.match(/^-?\d+(\.\d+)?$/);
      if (!ptsMatch) continue;
      matchedRows.push({ surname, pos, pts: parseFloat(ptsMatch[0]) });
    }
    if (matchedRows.length >= 3 && (!best || matchedRows.length > best.length)) best = matchedRows;
  }
  return best;
}

function parseFrecaOfficial(html, candidateSurnames) {
  const $ = cheerio.load(html);
  const rows = $('table tr').toArray();
  const matchedRows = [];
  for (const row of rows) {
    const $row = $(row);
    const driverLink = $row.find('a[href*="/driver/"]').first();
    if (!driverLink.length) continue;
    const name = cellText(driverLink);
    const surname = candidateSurnames.find(s => new RegExp(`\\b${s}\\b`).test(normalizeName(name)));
    if (!surname) continue;
    const rowText = cellText($row);
    const ptsMatch = rowText.match(/(\d+(?:\.\d+)?)\s*pts/i);
    if (!ptsMatch) continue;
    const pts = parseFloat(ptsMatch[1]);
    let pos = null;
    const cells = $row.find('td,th').toArray();
    if (cells.length) {
      const firstText = cellText($(cells[0]));
      const posMatch = firstText.match(/^(\d+)$/);
      if (posMatch) pos = parseInt(posMatch[1], 10);
    }
    matchedRows.push({ surname, pos, pts });
  }
  return matchedRows.length >= 3 ? matchedRows : null;
}

function parseWikipedia(html, candidateSurnames) {
  const $ = cheerio.load(html);
  const tables = $('table.wikitable').toArray();
  let best = null;
  for (const table of tables) {
    const rows = $(table).find('tr').toArray();
    if (rows.length < 2) continue;
    const looksLikeStandings = rows.slice(0, 3).some(r =>
      $(r).find('th,td').toArray().some(c => /^pts\.?$/i.test(cellText($(c))) || /^points$/i.test(cellText($(c))))
    );
    if (!looksLikeStandings) continue;
    const matchedRows = [];
    for (const row of rows) {
      const cells = $(row).find('th,td').toArray();
      if (cells.length < 3) continue;
      const rowText = normalizeName(cellText($(row)));
      const surname = candidateSurnames.find(s => new RegExp(`\\b${s}\\b`).test(rowText));
      if (!surname) continue;
      let pts = null;
      for (let c = cells.length - 1; c >= 0 && pts === null; c--) {
        const t = cellText($(cells[c]));
        const m = t.match(/^-?\d+(\.\d+)?$/);
        if (m) pts = parseFloat(m[0]);
      }
      if (pts === null) continue;
      let pos = null;
      for (let c = 0; c < cells.length; c++) {
        const t = cellText($(cells[c]));
        const m = t.match(/^(\d+)(st|nd|rd|th)?\.?$/i);
        if (m) { pos = parseInt(m[1], 10); break; }
        if (t) break;
      }
      matchedRows.push({ surname, pos, pts });
    }
    if (matchedRows.length >= 3 && (!best || matchedRows.length > best.length)) best = matchedRows;
  }
  if (!best) return null;
  if (best.some(r => r.pos === null)) {
    best.sort((a, b) => b.pts - a.pts);
    best.forEach((r, i) => { r.pos = i + 1; });
  }
  return best;
}

/* ---- Test 1: fiaformula2.com/fiaformula3.com shape ---- */
/* Real confirmed shape: first cell "1N. Tsolov" (pos+abbreviated name, no
   separator), per-round SR/FR cells in between, last cell = total points. */
const fiaHtml = `
<table>
<tr><td>1N. Tsolov</td><td>2</td><td>1</td><td>1</td><td>3</td><td>177</td></tr>
<tr><td>2R. Câmara</td><td>1</td><td>4</td><td>3</td><td>2</td><td>166</td></tr>
<tr><td>3G. Mini</td><td>5</td><td>2</td><td>4</td><td>1</td><td>147</td></tr>
<tr><td>4A. Dunne</td><td>—</td><td>—</td><td>6</td><td>5</td><td>118</td></tr>
</table>`;
{
  const rows = parseFiaOfficial(fiaHtml, ['tsolov', 'camara', 'mini', 'dunne', 'leon']);
  assert.ok(rows, 'fia-official: should find rows');
  assert.equal(rows.length, 4);
  const tsolov = rows.find(r => r.surname === 'tsolov');
  assert.equal(tsolov.pos, 1); assert.equal(tsolov.pts, 177);
  const camara = rows.find(r => r.surname === 'camara');
  assert.equal(camara.pos, 2); assert.equal(camara.pts, 166);
  console.log('OK  fia-official parser (fiaformula2.com/fiaformula3.com shape)');
}

/* ---- Test 2: fiafrec.com shape ---- */
const frecaHtml = `
<table>
<tr><td>1</td><td><img alt="x"></td><td>#1</td><td><a href="https://fiafrec.com/driver/kean-nakamura-berta/">Kean Nakamura-Berta</a></td><td><a href="https://fiafrec.com/team/prema-racing/">PREMA Racing</a></td><td>172 pts</td></tr>
<tr><td>2</td><td><img alt="x"></td><td>#2</td><td><a href="https://fiafrec.com/driver/emanuele-olivieri/">Emanuele Olivieri</a></td><td><a href="https://fiafrec.com/team/r-ace-gp/">R-ace GP</a></td><td>180 pts</td></tr>
<tr><td>3</td><td><img alt="x"></td><td>#3</td><td><a href="https://fiafrec.com/driver/sebastian-wheldon/">Sebastian Wheldon</a></td><td><a href="https://fiafrec.com/team/mp-motorsport/">MP Motorsport</a></td><td>177 pts</td></tr>
</table>
<table>
<tr><td>1</td><td><a href="https://fiafrec.com/team/prema-racing/">PREMA Racing</a></td><td>512 pts</td></tr>
</table>`;
{
  const rows = parseFrecaOfficial(frecaHtml, ['nakamuraberta', 'olivieri', 'wheldon', 'aldhaheri', 'francot']);
  assert.ok(rows, 'freca-official: should find rows');
  assert.equal(rows.length, 3, 'should ignore the teams table (no /driver/ links)');
  const oli = rows.find(r => r.surname === 'olivieri');
  assert.equal(oli.pos, 2); assert.equal(oli.pts, 180);
  console.log('OK  freca-official parser (fiafrec.com shape)');
}

/* ---- Test 3: Wikipedia shape (colspan header quirk) ---- */
const wikiHtml = `
<table class="wikitable">
<tr><th rowspan="2">Pos.</th><th rowspan="2">Driver</th><th colspan="2">ALB AUS</th><th rowspan="2">Points</th></tr>
<tr><th>SR</th><th>FR</th></tr>
<tr><td>1</td><td><a href="#">Luka Sammalisto</a></td><td>2</td><td>1</td><td><b>288</b></td></tr>
<tr><td>2</td><td><a href="#">David Cosma Cristofor</a></td><td>1</td><td>4</td><td>233</td></tr>
<tr><td>3</td><td><a href="#">Alp Aksoy</a></td><td>5</td><td>2</td><td>214</td></tr>
</table>`;
{
  const rows = parseWikipedia(wikiHtml, ['sammalisto', 'cristofor', 'aksoy', 'bansal', 'savinkov']);
  assert.ok(rows, 'wikipedia: should find rows');
  assert.equal(rows.length, 3);
  const sam = rows.find(r => r.surname === 'sammalisto');
  assert.equal(sam.pos, 1); assert.equal(sam.pts, 288);
  console.log('OK  wikipedia parser (colspan header quirk)');
}

/* ---- Test 4/5: race-pace parsers (Provisional Classification + History  */
/*      Chart PDFs) — built from a synthetic PDF via pdfkit so this stays   */
/*      offline, since these are less certain than the standings parsers   */
/*      (see race-pace-parsers.mjs's honesty note: built from a lossy      */
/*      summarized reading of real PDFs, not confirmed byte-for-byte).     */
import PDFDocument from 'pdfkit';
import { extractRows } from './pdf-table.mjs';
import { parseProvisionalClassification, parseHistoryChart, averagePace, lapTimeToSeconds } from './race-pace-parsers.mjs';

function makePdf(lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Courier').fontSize(9);
    for (const line of lines) doc.text(line);
    doc.end();
  });
}

{
  const buf = await makePdf([
    '1  24  F. SLATER  TRIDENT  20  41:23.456  25',
    '2  8   U. UGOCHUKWU  CAMPOS RACING  20  41:25.901  18',
    '3  15  E. RIVERA  CAMPOS RACING  20  41:29.113  15',
  ]);
  const pdfRows = await extractRows(buf);
  const rows = parseProvisionalClassification(pdfRows, ['slater', 'ugochukwu', 'rivera', 'nael', 'badoer']);
  assert.ok(rows, 'provisional classification: should find rows');
  assert.equal(rows.length, 3);
  const slater = rows.find(r => r.surname === 'slater');
  assert.equal(slater.pos, 1); assert.equal(slater.carNumber, 24); assert.equal(slater.pts, 25);
  console.log('OK  provisional classification parser (synthetic FIA-shape PDF)');
}

{
  const buf = await makePdf([
    'LAP 1',
    '24   -        1:38.204',
    '8    +1.203   1:39.500',
    'LAP 2',
    '24   -        1:38.900',
    '8    PIT      2:45.671',
    'LAP 3',
    '24   -        1:38.650',
    '8    +5.442   1:39.100',
    'LAP 4',
    '24   -        1:38.777',
    '8    +5.900   1:39.050',
  ]);
  const pdfRows = await extractRows(buf);
  const byCar = parseHistoryChart(pdfRows);
  assert.ok(byCar, 'history chart: should find laps');
  const car24 = byCar.get(24);
  assert.equal(car24.length, 4);
  assert.equal(lapTimeToSeconds('1:38.204'), 98.204);
  const pace24 = averagePace(car24);
  assert.ok(pace24 && pace24.lapsCounted === 4 && pace24.lapsExcluded === 0);
  const car8 = byCar.get(8);
  const pace8 = averagePace(car8); // has 1 PIT lap among 4 -> excluded
  assert.ok(pace8 && pace8.lapsCounted === 3 && pace8.lapsExcluded === 1);
  console.log('OK  history chart parser + averagePace (synthetic FIA-shape PDF, PIT lap excluded)');
}

console.log('\n✅ all fixture tests passed');
