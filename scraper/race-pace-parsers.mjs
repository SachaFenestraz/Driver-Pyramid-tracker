// Pure parsing functions for the two FIA timing PDFs this feature depends on
// (kept separate from fetch-race-pace.mjs so fixture.test.mjs can exercise
// them without any network access).
//
// IMPORTANT HONESTY NOTE: fia.com publishes race sessions (Sprint/Feature)
// with NO dedicated "Lap Times" PDF — only Practice and Qualifying get one.
// The closest thing for a race is the "History Chart" PDF, which is
// structured completely differently: one block per LAP NUMBER, listing
// every car's gap-to-leader (or "PIT") and lap time for that lap — not one
// block per driver. These parsers were built from a *lossy, summarized*
// reading of real 2026 PDFs (the tool used to research them can't do exact
// text extraction), not a byte-for-byte confirmed spec. Treat the exact
// regexes here as a best-effort first pass — data/race-pace.json's
// `warnings` array is where a real mismatch will show up, and
// fixture.test.mjs is what to fix first if a live run starts warning.

// A driver name in the classification PDF is usually an abbreviated form
// like "F.SLATER" or "F. SLATER" — match by surname the same way the
// standings scraper does.
function normalizeName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
}

/**
 * Provisional Classification PDF text -> [{carNumber, surname, pos, pts}]
 * Expected row shape (one per finisher), something like:
 *   "1  24  F. SLATER  TRIDENT  20  41:23.456  25"
 * i.e. Pos, Car#, abbreviated driver name, team, laps, race time, points.
 * Points aren't always present for a Sprint Race row in every FIA format,
 * so pts is nullable.
 */
export function parseProvisionalClassification(text, candidateSurnames) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    // Columns in these PDFs are separated by runs of 2+ spaces — splitting
    // on that is far more reliable than trying to regex the whole row in
    // one shot (a single \D+ greedily eats across column boundaries).
    const cols = line.split(/\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (cols.length < 4) continue;
    if (!/^\d{1,2}$/.test(cols[0]) || !/^\d{1,3}$/.test(cols[1])) continue;
    const pos = parseInt(cols[0], 10);
    const carNumber = parseInt(cols[1], 10);
    const namePart = normalizeName(cols[2]);
    const surname = candidateSurnames.find(s => new RegExp(`\\b${s}\\b`).test(namePart) || namePart.endsWith(s));
    if (!surname) continue;
    // Points: last column on the line, if it's a plain whole number (kept
    // loose on purpose — see note above; not every race format lists
    // points on the same row).
    const last = cols[cols.length - 1];
    const pts = /^\d+$/.test(last) ? parseInt(last, 10) : null;
    rows.push({ carNumber, surname, pos, pts });
  }
  return rows.length ? rows : null;
}

/**
 * History Chart PDF text -> Map<carNumber, [{lap, timeSeconds, pit}]>
 * Expected shape: repeated blocks like
 *   LAP 6
 *   24   +1.203   1:38.204
 *   7    PIT      2:45.671
 *   ...
 *   LAP 7
 *   ...
 * i.e. a "LAP n" header line, then one row per car: car number, then either
 * a gap (ignored here) or the literal "PIT", then that car's lap time for
 * lap n. Only carNumber + lap time + pit-flag are used.
 */
export function parseHistoryChart(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const byCar = new Map();
  let currentLap = null;
  const lapHeaderRe = /^LAP\s+(\d+)/i;
  const rowRe = /^(\d{1,3})\s+(PIT|[+\-0-9][^\s]*)\s+(\d{1,2}:\d{2}\.\d{3})\s*$/i;

  for (const line of lines) {
    const lapMatch = line.match(lapHeaderRe);
    if (lapMatch) {
      currentLap = parseInt(lapMatch[1], 10);
      continue;
    }
    if (currentLap === null) continue;
    const row = line.match(rowRe);
    if (!row) continue;
    const carNumber = parseInt(row[1], 10);
    const isPit = /^pit$/i.test(row[2]);
    const timeSeconds = lapTimeToSeconds(row[3]);
    if (timeSeconds === null) continue;
    if (!byCar.has(carNumber)) byCar.set(carNumber, []);
    byCar.get(carNumber).push({ lap: currentLap, timeSeconds, pit: isPit });
  }
  return byCar.size ? byCar : null;
}

export function lapTimeToSeconds(t) {
  const m = t.match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3], 10) / 1000;
}

/**
 * Average race pace for one driver: mean of all non-pit-lap times.
 * Excludes pit-in/out laps (they're not representative of pace) but does
 * NOT try to detect or exclude safety car / VSC laps — those would show up
 * as anomalously slow laps mixed in with real pace, which is a known
 * limitation (see README). Returns null if fewer than 3 clean laps exist.
 */
export function averagePace(laps) {
  const clean = laps.filter(l => !l.pit);
  if (clean.length < 3) return null;
  const sum = clean.reduce((acc, l) => acc + l.timeSeconds, 0);
  return { avgSeconds: sum / clean.length, lapsCounted: clean.length, lapsExcluded: laps.length - clean.length };
}
