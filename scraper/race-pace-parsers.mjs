// Pure parsing functions for the two FIA timing PDFs this feature depends
// on. Operate on ROWS OF CELLS (string[][]) produced by pdf-table.mjs's
// coordinate-based extraction, not raw text — see that file for why
// (column gaps in a real PDF aren't reliably literal space characters).
//
// IMPORTANT HONESTY NOTE: fia.com publishes race sessions (Sprint/Feature)
// with NO dedicated "Lap Times" PDF — only Practice and Qualifying get one.
// The closest thing for a race is the "History Chart" PDF, which is
// structured completely differently: one block per LAP NUMBER, listing
// every car's gap-to-leader (or "PIT") and lap time for that lap — not one
// block per driver. These parsers were built from a *lossy, summarized*
// reading of real 2026 PDFs (the tool used to research them can't do exact
// text extraction), not a byte-for-byte confirmed spec. Treat the exact
// cell-shape assumptions here as a best-effort first pass —
// data/race-pace.json's `warnings` array is where a real mismatch will
// show up, and fixture.test.mjs is what to fix first if a live run starts
// warning.

function normalizeName(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
}

/**
 * rows (string[][]) -> [{carNumber, surname, pos, pts}]
 * Expected row shape (one per finisher):
 *   ["1", "24", "F. SLATER", "TRIDENT", "20", "41:23.456", "25"]
 * i.e. Pos, Car#, abbreviated driver name, team, laps, race time, points.
 * Points aren't always present for a Sprint Race row in every FIA format,
 * so pts is nullable.
 */
export function parseProvisionalClassification(rows, candidateSurnames) {
  const out = [];
  for (const cells of rows) {
    if (cells.length < 4) continue;
    if (!/^\d{1,2}$/.test(cells[0]) || !/^\d{1,3}$/.test(cells[1])) continue;
    const pos = parseInt(cells[0], 10);
    const carNumber = parseInt(cells[1], 10);
    // The name is whichever of the remaining cells matches a tracked
    // surname — don't assume it's always cells[2] (team name could come
    // first in some layouts).
    let surname = null;
    for (const cell of cells.slice(2)) {
      const namePart = normalizeName(cell);
      const match = candidateSurnames.find(s => new RegExp(`\\b${s}\\b`).test(namePart) || (namePart && namePart.endsWith(s)));
      if (match) { surname = match; break; }
    }
    if (!surname) continue;
    const last = cells[cells.length - 1];
    const pts = /^\d+$/.test(last) ? parseInt(last, 10) : null;
    out.push({ carNumber, surname, pos, pts });
  }
  return out.length ? out : null;
}

/**
 * rows (string[][]) -> Map<carNumber, [{lap, timeSeconds, pit}]>
 * Expected shape: a row that's just "LAP n" (its own line), followed by
 * rows shaped [carNumber, gapOrPIT, lapTime] until the next "LAP n" row.
 */
export function parseHistoryChart(rows) {
  const byCar = new Map();
  let currentLap = null;
  const lapHeaderRe = /^LAP\s*(\d+)$/i;

  for (const cells of rows) {
    if (cells.length === 1) {
      const m = cells[0].match(lapHeaderRe);
      if (m) { currentLap = parseInt(m[1], 10); continue; }
    } else if (cells.length >= 2 && /^LAP$/i.test(cells[0]) && /^\d+$/.test(cells[1])) {
      currentLap = parseInt(cells[1], 10);
      continue;
    }
    if (currentLap === null) continue;
    if (cells.length < 3) continue;
    if (!/^\d{1,3}$/.test(cells[0])) continue;
    const carNumber = parseInt(cells[0], 10);
    const isPit = /^pit$/i.test(cells[1]);
    const timeSeconds = lapTimeToSeconds(cells[cells.length - 1]);
    if (timeSeconds === null) continue;
    if (!byCar.has(carNumber)) byCar.set(carNumber, []);
    byCar.get(carNumber).push({ lap: currentLap, timeSeconds, pit: isPit });
  }
  return byCar.size ? byCar : null;
}

export function lapTimeToSeconds(t) {
  const m = String(t).match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
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
