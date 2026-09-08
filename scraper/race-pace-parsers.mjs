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
 * Real fia.com History Chart layout (confirmed against a live 2026 F2
 * Sprint Race PDF — see git history for the raw debug dump this was built
 * from): a WIDE table, several laps per page, three columns per lap
 * ("LAP n" / "GAP" / "TIME"), and each ROW is a running POSITION for that
 * lap, not a fixed car — the car in a given row differs lap to lap as the
 * order changes. Whoever is leading a given lap has a BLANK "GAP" cell
 * (gap-to-leader is meaningless for the leader), which — critically — is
 * genuinely absent from the page, not just blank text. That means
 * naively merging a row's cells left-to-right misassigns everything after
 * a leader's row for that lap-block.
 *
 * The fix: read each lap-block's column x-positions off its own "LAP n /
 * GAP / TIME" header, then for every data row bucket each of THAT row's
 * cells to whichever column anchor is closest on the x-axis, rather than
 * assuming a fixed left-to-right cell order. A missing cell just leaves
 * that (lap, column) slot empty for that row — it can't shift anything
 * else out of place.
 *
 * @param {{page:number,y:number,cells:{text:string,x:number,endX:number}[]}[]} positionedRows
 *   from pdf-table.mjs's extractPositionedRows
 * @returns {Map<number, {lap:number,timeSeconds:number,pit:boolean}[]>|null}
 */
export function parseHistoryChart(positionedRows) {
  const byCar = new Map();
  let anchors = null; // [{x, kind:'car'|'gap'|'time', lap}]

  for (const { cells } of positionedRows) {
    // Header row: one or more "LAP n" cells, each followed by GAP/TIME.
    const hasLap = cells.some(c => /^LAP\s*\d+$/i.test(c.text));
    const hasGap = cells.some(c => /^GAP$/i.test(c.text));
    const hasTime = cells.some(c => /^TIME$/i.test(c.text));
    if (hasLap && hasGap && hasTime) {
      anchors = [];
      for (let i = 0; i < cells.length; i++) {
        const m = cells[i].text.match(/^LAP\s*(\d+)$/i);
        if (!m) continue;
        const lap = parseInt(m[1], 10);
        anchors.push({ x: cells[i].x, kind: 'car', lap });
        if (cells[i + 1] && /^GAP$/i.test(cells[i + 1].text)) anchors.push({ x: cells[i + 1].x, kind: 'gap', lap });
        if (cells[i + 2] && /^TIME$/i.test(cells[i + 2].text)) anchors.push({ x: cells[i + 2].x, kind: 'time', lap });
      }
      continue;
    }
    if (!anchors || !anchors.length) continue; // haven't seen a header yet — skip title/prose lines

    const byLap = new Map();
    for (const cell of cells) {
      let nearest = null, bestDist = Infinity;
      for (const a of anchors) {
        const d = Math.abs(cell.x - a.x);
        if (d < bestDist) { bestDist = d; nearest = a; }
      }
      if (!nearest) continue;
      if (!byLap.has(nearest.lap)) byLap.set(nearest.lap, {});
      byLap.get(nearest.lap)[nearest.kind] = cell.text;
    }
    for (const [lap, vals] of byLap) {
      if (!vals.car || !/^\d{1,3}$/.test(vals.car)) continue;
      const timeSeconds = lapTimeToSeconds(vals.time);
      if (timeSeconds === null) continue;
      const carNumber = parseInt(vals.car, 10);
      const isPit = /pit/i.test(vals.gap || '');
      if (!byCar.has(carNumber)) byCar.set(carNumber, []);
      byCar.get(carNumber).push({ lap, timeSeconds, pit: isPit });
    }
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
