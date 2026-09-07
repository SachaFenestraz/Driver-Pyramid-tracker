// Fetches current drivers'-championship standings for each tracked series from
// Wikipedia and merges them into ../data/standings.json.
//
// Why Wikipedia and not the official series sites: the official standings
// pages (fiaformula2.com etc.) render their tables client-side from an
// internal API that isn't public/stable enough to depend on here, and
// scraping a commercial site's markup is exactly the kind of thing that
// breaks silently. Wikipedia's season-standings tables are community
// maintained, usually updated within a day or two of a race weekend, openly
// licensed, and have a fairly consistent table shape across seasons/series.
// Trade-off: it can lag official live timing by up to a day or two, and this
// script's table-parsing is heuristic, not a real API contract — see the
// README for what to do if a source page's layout changes and this starts
// coming back empty for a series.
//
// This script updates ONLY: position, points, and the "series" label for
// each driver's *current* season. It does not update wins/poles/podiums
// breakdowns, karting history, or anything else in data/drivers.json —
// those are refreshed by hand periodically (they change far less often and
// aren't reliably table-shaped on Wikipedia).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { SOURCES } from './sources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVERS_PATH = path.join(__dirname, '..', 'data', 'drivers.json');
const STANDINGS_PATH = path.join(__dirname, '..', 'data', 'standings.json');

const UA = 'pyramid-tracker-scraper/1.0 (personal project; contact via GitHub repo issues)';

async function fetchWikipediaHtml(page) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&format=json&prop=text&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Wikipedia fetch failed for ${page}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Wikipedia API error for ${page}: ${json.error.info || json.error.code}`);
  return json.parse.text;
}

function normalizeName(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim();
}

function surnameOf(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return normalizeName(parts[parts.length - 1]);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function cellText($cell) {
  return $cell.text().replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

// Finds the best-looking "drivers' championship standings" table on the page
// and extracts {surnameMatch -> {pos, pts}} for rows that match one of the
// candidate surnames.
//
// Deliberately does NOT try to line up a "Points" header with a column index:
// these tables use colspan on grouped round headers (one <th> covering both
// a Sprint and Feature Race sub-column), so the header row has fewer cells
// than the body rows and index-matching silently misaligns. Instead this
// relies on a convention that holds across every WikiProject Motorsport
// standings table checked so far: **Pos. is the first cell of a body row,
// Points is the last.** That's more robust to how many round columns exist
// in between than trying to resolve colspans.
function extractStandingsFromHtml(html, candidateSurnames) {
  const $ = cheerio.load(html);
  const tables = $('table.wikitable').toArray();
  let best = null; // {matches, rows}

  for (const table of tables) {
    const $table = $(table);
    const rows = $table.find('tr').toArray();
    if (rows.length < 2) continue;

    // Confirm this table is a standings table at all: some header row within
    // the first few rows must mention points/pts. We don't use its column
    // index — just its presence, to avoid matching an unrelated table.
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

      // Points: last cell in the row that parses as a number.
      let pts = null;
      for (let c = cells.length - 1; c >= 0 && pts === null; c--) {
        const t = cellText($(cells[c]));
        const m = t.match(/^-?\d+(\.\d+)?$/); // whole-cell number only — avoids grabbing a stray digit from a name/note
        if (m) pts = parseFloat(m[0]);
      }
      if (pts === null) continue;

      // Position: first cell in the row that parses as a plain integer.
      let pos = null;
      for (let c = 0; c < cells.length; c++) {
        const t = cellText($(cells[c]));
        const m = t.match(/^(\d+)(st|nd|rd|th)?\.?$/i);
        if (m) { pos = parseInt(m[1], 10); break; }
        if (t) break; // first non-empty cell wasn't a position — stop looking
      }
      matchedRows.push({ surname, pos, pts });
    }

    if (matchedRows.length >= 3 && (!best || matchedRows.length > best.matches)) {
      best = { matches: matchedRows.length, rows: matchedRows };
    }
  }

  if (!best) return null;

  // If we couldn't read an explicit position for everyone, rank by points desc.
  const rows = [...best.rows];
  if (rows.some(r => r.pos === null)) {
    rows.sort((a, b) => b.pts - a.pts);
    rows.forEach((r, i) => { r.pos = i + 1; });
  }
  return rows;
}

async function main() {
  const drivers = JSON.parse(await readFile(DRIVERS_PATH, 'utf8'));
  const standings = JSON.parse(await readFile(STANDINGS_PATH, 'utf8'));

  const results = { updated: new Date().toISOString(), source: 'wikipedia (automated)', drivers: { ...standings.drivers }, warnings: [] };

  for (const src of SOURCES) {
    const catDrivers = drivers.filter(d => d.category === src.category);
    const surnames = catDrivers.map(d => surnameOf(d.name));

    let html;
    try {
      html = await fetchWikipediaHtml(src.page);
    } catch (err) {
      results.warnings.push(`${src.category}: fetch failed — ${err.message}`);
      continue;
    }

    const rows = extractStandingsFromHtml(html, surnames);
    if (!rows) {
      results.warnings.push(`${src.category}: no recognizable standings table found on "${src.page}" — left unchanged`);
      continue;
    }

    let updatedCount = 0;
    for (const d of catDrivers) {
      const surname = surnameOf(d.name);
      const row = rows.find(r => r.surname === surname);
      if (!row) {
        results.warnings.push(`${src.category}: "${d.name}" not found in standings table — left unchanged`);
        continue;
      }
      results.drivers[d.id] = { pos: `${ordinal(row.pos)}*`, pts: row.pts, series: src.series };
      updatedCount++;
    }
    console.log(`${src.category}: updated ${updatedCount}/${catDrivers.length} drivers from ${rows.length} matched rows`);
  }

  await writeFile(STANDINGS_PATH, JSON.stringify(results, null, 2) + '\n');

  if (results.warnings.length) {
    console.log('\nWarnings:');
    results.warnings.forEach(w => console.log(' - ' + w));
  }
}

main().catch(err => {
  console.error('Scraper failed:', err);
  process.exitCode = 1;
});
