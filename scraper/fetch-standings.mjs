// Fetches current drivers'-championship standings for each tracked series,
// preferring each series' own official site, and merges the result into
// ../data/standings.json.
//
// Each source in sources.mjs declares a `type` (which parser below handles
// its page) and a `wikiFallback` (a Wikipedia page to retry against if the
// primary source comes back empty/unparseable — a redesign, a network
// hiccup, or new bot-detection shouldn't silently freeze a whole category).
//
// This script updates ONLY: position, points, and the "series" label for
// each driver's *current* season. It does not update wins/poles/podiums
// breakdowns, karting history, or anything else in data/drivers.json.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { SOURCES } from './sources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVERS_PATH = path.join(__dirname, '..', 'data', 'drivers.json');
const STANDINGS_PATH = path.join(__dirname, '..', 'data', 'standings.json');

const UA = 'Mozilla/5.0 (compatible; pyramid-tracker-scraper/1.0; +https://github.com/) personal-project';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchWikipediaHtml(page) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&format=json&prop=text&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Wikipedia fetch failed for ${page}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`Wikipedia API error for ${page}: ${json.error.info || json.error.code}`);
  return json.parse.text;
}

function normalizeName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
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

/* ---------------------------------------------------------------------- */
/* Parser: fiaformula2.com / fiaformula3.com                              */
/*                                                                        */
/* Confirmed shape (checked against a live render, since the page is      */
/* server-rendered but has quirky header colspans that don't line up      */
/* with body columns — see README): each body row's FIRST cell is         */
/* "1N. Tsolov" (rank + abbreviated name, no separator), and the LAST     */
/* cell is the season points total, e.g. "177". Everything in between is  */
/* per-round Sprint/Feature points and isn't used here.                   */
/* ---------------------------------------------------------------------- */
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
      const m = firstText.match(/^(\d{1,2})\s*[.:]?\s*(.+)$/); // "1N. Tsolov" / "1. N. Tsolov"
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
  return best; // null if nothing usable found
}

/* ---------------------------------------------------------------------- */
/* Parser: fiafrec.com/standings/                                         */
/*                                                                        */
/* Confirmed shape: plain WordPress table, one row per driver, containing */
/* an <a href*="/driver/"> with the driver's full name as link text, and  */
/* a "NNN pts" cell elsewhere in the row. Distinguishing from the teams'  */
/* table on the same page by requiring that driver-link.                  */
/* ---------------------------------------------------------------------- */
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

/* ---------------------------------------------------------------------- */
/* Parser: generic Wikipedia season-standings table                       */
/* (see comment history — colspan-safe: Pos. is first cell, Points last)  */
/* ---------------------------------------------------------------------- */
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

const PARSERS = {
  'fia-official': parseFiaOfficial,
  'freca-official': parseFrecaOfficial,
};

async function getRowsForSource(src, surnames, warnings) {
  if (src.type !== 'wikipedia') {
    try {
      const html = await fetchHtml(src.url);
      const rows = PARSERS[src.type](html, surnames);
      if (rows) return { rows, usedFallback: false };
      warnings.push(`${src.category}: official source "${src.url}" returned no recognizable table — falling back to Wikipedia`);
    } catch (err) {
      warnings.push(`${src.category}: official source failed (${err.message}) — falling back to Wikipedia`);
    }
  }
  // Wikipedia primary or fallback.
  try {
    const html = await fetchWikipediaHtml(src.wikiFallback);
    const rows = parseWikipedia(html, surnames);
    if (rows) return { rows, usedFallback: src.type !== 'wikipedia' };
    warnings.push(`${src.category}: Wikipedia fallback ("${src.wikiFallback}") also returned no recognizable table`);
  } catch (err) {
    warnings.push(`${src.category}: Wikipedia fallback failed too (${err.message})`);
  }
  return { rows: null, usedFallback: true };
}

async function main() {
  const drivers = JSON.parse(await readFile(DRIVERS_PATH, 'utf8'));
  const standings = JSON.parse(await readFile(STANDINGS_PATH, 'utf8'));

  const results = { updated: new Date().toISOString(), source: 'mixed (official sites + Wikipedia fallback)', drivers: { ...standings.drivers }, warnings: [] };

  for (const src of SOURCES) {
    const catDrivers = drivers.filter(d => d.category === src.category);
    const surnames = catDrivers.map(d => surnameOf(d.name));

    const { rows, usedFallback } = await getRowsForSource(src, surnames, results.warnings);
    if (!rows) continue; // warnings already recorded; leave this category's standings untouched

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
    console.log(`${src.category}: updated ${updatedCount}/${catDrivers.length} drivers from ${rows.length} matched rows${usedFallback ? ' (via Wikipedia fallback)' : ' (official site)'}`);
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
