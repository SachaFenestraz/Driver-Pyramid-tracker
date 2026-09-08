// Builds the season "Race Pace" archive for the 10 tracked FIA F2 / FIA F3
// drivers: per round, per race session (Sprint/Feature), each driver's
// official finishing position + points (from the Provisional Classification
// PDF) and their average race pace (from the History Chart PDF — see
// race-pace-parsers.mjs for why that's the substitute, not a "Lap Times"
// doc). FRECA and Italian F4 aren't covered — fia.com doesn't publish this
// level of official timing detail for them.
//
// Re-fetches every round on every run rather than trying to cache
// incrementally — simpler, and cheap enough (a few dozen small PDF
// requests every scheduled run) not to bother with a "what's new" diff.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { extractRows, extractPositionedRows } from './pdf-table.mjs';
import { F2_ROUNDS, F3_ROUNDS, FIA_BASE, RACE_SESSIONS } from './race-calendar.mjs';
import { parseProvisionalClassification, parseHistoryChart, averagePace } from './race-pace-parsers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVERS_PATH = path.join(__dirname, '..', 'data', 'drivers.json');
const OUT_PATH = path.join(__dirname, '..', 'data', 'race-pace.json');
const UA = 'Mozilla/5.0 (compatible; pyramid-tracker-scraper/1.0; +https://github.com/) personal-project';

function normalizeName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
}
function surnameOf(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return normalizeName(parts[parts.length - 1]);
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

async function fetchPdfBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
async function fetchPdfRows(url) {
  return extractRows(await fetchPdfBuffer(url));
}
async function fetchPdfPositionedRows(url) {
  return extractPositionedRows(await fetchPdfBuffer(url));
}

// Finds the PDF href on a round's timing page whose link text/filename
// matches a document-type hint, scoped to a given session code (r1/r2).
function findPdfUrl($, sessionCode, docTypeHints) {
  const links = $('a[href$=".pdf"]').toArray();
  for (const a of links) {
    const href = $(a).attr('href') || '';
    const lower = href.toLowerCase();
    if (!lower.includes(`_${sessionCode}_`)) continue;
    if (docTypeHints.some(hint => lower.includes(hint))) {
      return href.startsWith('http') ? href : new URL(href, 'https://www.fia.com').toString();
    }
  }
  return null;
}

async function fetchRound(category, round, catDrivers, warnings) {
  const base = FIA_BASE[category];
  const pageUrl = `${base}/${round.slug}/eventtiming-information`;
  let html;
  try {
    html = await fetchText(pageUrl);
  } catch (err) {
    warnings.push(`${category} ${round.event}: timing page unreachable (${err.message}) — skipped`);
    return null;
  }
  const $ = cheerio.load(html);
  const surnames = catDrivers.map(d => surnameOf(d.name));
  const sessions = {};

  for (const sess of RACE_SESSIONS) {
    const classUrl = findPdfUrl($, sess.codeHint, ['provisionalclassification', 'classification']);
    const historyUrl = findPdfUrl($, sess.codeHint, ['historychart']);
    if (!classUrl && !historyUrl) continue; // session hasn't run yet, or page shape changed

    const entry = { label: sess.label, classification: [], pace: [] };

    let carToSurname = new Map();
    if (classUrl) {
      try {
        const pdfRows = await fetchPdfRows(classUrl);
        const rows = parseProvisionalClassification(pdfRows, surnames);
        if (rows) {
          for (const r of rows) carToSurname.set(r.carNumber, r.surname);
          for (const d of catDrivers) {
            const surname = surnameOf(d.name);
            const row = rows.find(r => r.surname === surname);
            if (row) entry.classification.push({ driverId: d.id, pos: row.pos, pts: row.pts });
          }
        } else {
          warnings.push(`${category} ${round.event} ${sess.label}: classification PDF had no recognizable rows`);
        }
      } catch (err) {
        warnings.push(`${category} ${round.event} ${sess.label}: classification fetch failed (${err.message})`);
      }
    }

    if (historyUrl) {
      try {
        const positionedRows = await fetchPdfPositionedRows(historyUrl);
        const byCar = parseHistoryChart(positionedRows);
        if (byCar) {
          for (const [carNumber, laps] of byCar) {
            const surname = carToSurname.get(carNumber);
            if (!surname) continue; // car not one of our tracked drivers (or no classification match)
            const d = catDrivers.find(dd => surnameOf(dd.name) === surname);
            if (!d) continue;
            const pace = averagePace(laps);
            if (pace) entry.pace.push({ driverId: d.id, avgSeconds: Math.round(pace.avgSeconds * 1000) / 1000, lapsCounted: pace.lapsCounted, lapsExcluded: pace.lapsExcluded });
          }
        } else {
          warnings.push(`${category} ${round.event} ${sess.label}: history chart PDF had no recognizable laps`);
        }
      } catch (err) {
        warnings.push(`${category} ${round.event} ${sess.label}: history chart fetch failed (${err.message})`);
      }
    }

    if (entry.classification.length || entry.pace.length) sessions[sess.key] = entry;
  }

  return Object.keys(sessions).length ? { event: round.event, slug: round.slug, sessions } : null;
}

async function main() {
  const drivers = JSON.parse(await readFile(DRIVERS_PATH, 'utf8'));
  const warnings = [];
  const out = { updated: new Date().toISOString(), warnings, rounds: { F2: [], F3: [] } };

  for (const [category, rounds] of [['F2', F2_ROUNDS], ['F3', F3_ROUNDS]]) {
    const catDrivers = drivers.filter(d => d.category === category);
    for (const round of rounds) {
      const result = await fetchRound(category, round, catDrivers, warnings);
      if (result) {
        out.rounds[category].push(result);
        console.log(`${category} ${round.event}: recorded ${Object.keys(result.sessions).length} race session(s)`);
      }
      // Be polite to fia.com — small gap between rounds.
      await new Promise(r => setTimeout(r, 300));
    }
  }

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  if (warnings.length) {
    console.log('\nWarnings:');
    warnings.forEach(w => console.log(' - ' + w));
  }
}

main().catch(err => {
  console.error('Race-pace scraper failed:', err);
  process.exitCode = 1;
});
