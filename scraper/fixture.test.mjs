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
/*      offline. The History Chart fixture (Test 5) mirrors the REAL       */
/*      fia.com layout confirmed against a live 2026 F2 Sprint Race PDF    */
/*      (see race-pace-parsers.mjs's header comment): a wide table, one    */
/*      "LAP n / GAP / TIME" column-triplet per lap, rows are POSITIONS    */
/*      not fixed cars, and the lap leader's GAP cell is genuinely absent. */
import PDFDocument from 'pdfkit';
import { extractRows, extractPositionedRows } from './pdf-table.mjs';
import { parseProvisionalClassification, parseHistoryChart, averagePace, lapTimeToSeconds, rankPaceByCar } from './race-pace-parsers.mjs';

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
  // Reproduces the real wide layout: 2 laps per header block, 2 cars.
  // Car 24 leads both laps (blank GAP cell, genuinely omitted — no
  // placeholder text at all, same as the real PDF). Car 8 runs P2 lap 1,
  // then pits lap 2 (GAP cell literally "PIT").
  const col = (s, w) => s.padEnd(w);
  const buf = await makePdf([
    col('LAP 1', 10) + col('GAP', 10) + col('TIME', 10) + col('LAP 2', 10) + col('GAP', 10) + 'TIME',
    col('24', 10) + col('', 10) + col('1:38.204', 10) + col('24', 10) + col('', 10) + '1:38.900',
    col('8', 10) + col('+1.203', 10) + col('1:39.500', 10) + col('8', 10) + col('PIT', 10) + '2:45.671',
  ]);
  const positionedRows = await extractPositionedRows(buf);
  const byCar = parseHistoryChart(positionedRows);
  assert.ok(byCar, 'history chart: should find laps');
  const car24 = byCar.get(24);
  assert.ok(car24, 'car 24 (leader, blank GAP both laps) should be found');
  assert.equal(car24.length, 2);
  assert.equal(lapTimeToSeconds('1:38.204'), 98.204);
  assert.equal(car24.find(l => l.lap === 1).timeSeconds, 98.204);
  assert.equal(car24.find(l => l.lap === 2).timeSeconds, 98.9);
  assert.equal(car24.every(l => !l.pit), true, 'leader laps should never be flagged PIT');
  const car8 = byCar.get(8);
  assert.ok(car8, 'car 8 (P2 lap1, pits lap2) should be found');
  assert.equal(car8.length, 2);
  assert.equal(car8.find(l => l.lap === 1).pit, false);
  assert.equal(car8.find(l => l.lap === 2).pit, true);
  console.log('OK  history chart parser (real fia.com wide-table shape: position-based rows, blank-GAP leader handled)');
}

/* ---- Test 6: rankPaceByCar — grid-wide pace ranking ---- */
/* Doesn't need a PDF — operates directly on the byCar Map shape that      */
/* parseHistoryChart() produces (car -> array of {lap,timeSeconds,pit}).   */
/* Builds a 5-car field, one car with too few clean laps to rank, and a    */
/* pit lap that should be excluded from that car's average (and therefore  */
/* not drag its rank around).                                              */
{
  const lap = (n, t, pit = false) => ({ lap: n, timeSeconds: t, pit });
  const byCar = new Map([
    [24, [lap(1, 90.0), lap(2, 90.2), lap(3, 89.8)]],       // avg 90.0 -> fastest
    [8,  [lap(1, 91.5), lap(2, 91.0), lap(3, 91.0), lap(4, 150.0, true)]], // pit lap excluded, avg 91.166..
    [15, [lap(1, 92.0), lap(2, 92.0), lap(3, 92.0)]],       // avg 92.0
    [3,  [lap(1, 93.0), lap(2, 93.5)]],                     // only 2 clean laps -> no rank
    [77, [lap(1, 95.0), lap(2, 95.0), lap(3, 95.0)]],       // avg 95.0 -> slowest
  ]);
  const ranked = rankPaceByCar(byCar);
  assert.equal(ranked.size, 4, 'car with <3 clean laps should be excluded from ranking entirely');
  assert.equal(ranked.get(3), undefined);
  assert.equal(ranked.get(24).rank, 1); assert.equal(ranked.get(24).of, 4);
  assert.equal(ranked.get(8).rank, 2, 'car 8s pit lap should be excluded, not counted toward its average');
  assert.equal(ranked.get(15).rank, 3);
  assert.equal(ranked.get(77).rank, 4);
  assert.ok(Math.abs(ranked.get(8).avgSeconds - 91.1666666) < 1e-4);
  console.log('OK  rankPaceByCar (grid-wide pace ranking, pit laps excluded, thin fields dropped)');
}

console.log('\n✅ all fixture tests passed');
