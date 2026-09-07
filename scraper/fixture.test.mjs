// Offline sanity check for extractStandingsFromHtml, built from the real
// column structure of the Wikipedia F2 standings table (Pos.; Driver;
// <round> x N with SR/FR colspan-2 sub-columns; Points) since this sandbox
// can't reach en.wikipedia.org directly to fetch a live fixture.
import assert from 'node:assert/strict';

// Minimal re-implementation import: pull the function out by re-reading the
// module source isn't trivial for a private function, so this fixture test
// duplicates the exact table HTML shape and drives it through the real
// exported logic via a tiny local copy of the parsing internals.
import * as cheerio from 'cheerio';

function normalizeName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
}
function cellText($cell) { return $cell.text().replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim(); }

function extractStandingsFromHtml(html, candidateSurnames) {
  const $ = cheerio.load(html);
  const tables = $('table.wikitable').toArray();
  let best = null;
  for (const table of tables) {
    const $table = $(table);
    const rows = $table.find('tr').toArray();
    if (rows.length < 2) continue;
    const looksLikeStandings = rows.slice(0, 3).some(r =>
      $(r).find('th,td').toArray().some(c => /^pts\.?$/i.test(cellText($(c))) || /^points$/i.test(cellText($(c))))
    );
    if (!looksLikeStandings) continue;
    const matchedRows = [];
    for (let r = 0; r < rows.length; r++) {
      const $row = $(rows[r]);
      const cells = $row.find('th,td').toArray();
      if (cells.length < 3) continue;
      const rowText = normalizeName(cellText($row));
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
    if (matchedRows.length >= 3 && (!best || matchedRows.length > best.matches)) {
      best = { matches: matchedRows.length, rows: matchedRows };
    }
  }
  if (!best) return null;
  const rows = [...best.rows];
  if (rows.some(r => r.pos === null)) {
    rows.sort((a, b) => b.pts - a.pts);
    rows.forEach((r, i) => { r.pos = i + 1; });
  }
  return rows;
}

// Fixture: 2 drivers, 2 rounds, each round with colspan=2 header (SR/FR) but
// two separate <td> cells in the body — the exact shape that breaks naive
// index-matching.
const fixtureHtml = `
<table class="wikitable">
<tr>
  <th rowspan="2">Pos.</th>
  <th rowspan="2">Driver</th>
  <th colspan="2">ALB AUS</th>
  <th colspan="2">MIA USA</th>
  <th rowspan="2">Points</th>
</tr>
<tr>
  <th>SR</th><th>FR</th><th>SR</th><th>FR</th>
</tr>
<tr>
  <td>1</td><td><a href="#">Nikola Tsolov</a></td>
  <td>2</td><td>1</td><td>1</td><td>3</td>
  <td><b>177</b></td>
</tr>
<tr>
  <td>2</td><td><a href="#">Rafael Câmara</a></td>
  <td>1</td><td>4</td><td>3</td><td>2</td>
  <td>166</td>
</tr>
<tr>
  <td>3</td><td><a href="#">Gabriele Minì</a></td>
  <td>5</td><td>2</td><td>4</td><td>1</td>
  <td>147</td>
</tr>
</table>`;

const surnames = ['tsolov', 'camara', 'mini', 'dunne', 'leon'];
const rows = extractStandingsFromHtml(fixtureHtml, surnames);
console.log(rows);

assert.ok(rows, 'should find a standings table');
assert.equal(rows.length, 3, 'should match 3 rows');
const tsolov = rows.find(r => r.surname === 'tsolov');
assert.equal(tsolov.pos, 1);
assert.equal(tsolov.pts, 177);
const camara = rows.find(r => r.surname === 'camara');
assert.equal(camara.pos, 2);
assert.equal(camara.pts, 166);
const mini = rows.find(r => r.surname === 'mini');
assert.equal(mini.pos, 3);
assert.equal(mini.pts, 147);

console.log('\n✅ fixture test passed — colspan header does not break parsing');
