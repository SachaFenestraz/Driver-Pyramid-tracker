// 2026 round calendar for FIA F2 and FIA F3, with each round's fia.com URL
// slug — timing pages live at:
//   https://www.fia.com/events/formula-2-championship/season-2026/<slug>/eventtiming-information
//   https://www.fia.com/events/fia-formula-3-championship/season-2026/<slug>/eventtiming-information
//
// Slugs marked verified were fetched directly and returned a real timing
// page (HTTP 200) during research (Sept 2026). Unverified slugs follow the
// same naming convention fia.com uses elsewhere but weren't individually
// checked — fetch-race-pace.mjs treats a 404 on any slug as "round not
// found" and skips it with a warning rather than failing the whole run, so
// a wrong guess here just means that one round is silently skipped until
// the slug is corrected (see README).
//
// Race weekends not yet run (no results to fetch) are naturally skipped too
// (their timing page 404s or has no session PDFs yet) — no separate
// "hasRun" flag needed.

export const F2_ROUNDS = [
  { slug: 'melbourne', event: 'Melbourne' },
  { slug: 'miami', event: 'Miami' },
  { slug: 'montreal', event: 'Montreal' },
  { slug: 'monaco', event: 'Monaco' },
  { slug: 'barcelona-catalunya', event: 'Barcelona-Catalunya' },
  { slug: 'spielberg', event: 'Spielberg' },
  { slug: 'silverstone', event: 'Silverstone', verified: true },
  { slug: 'spa-francorchamps', event: 'Spa-Francorchamps', verified: true },
  { slug: 'budapest', event: 'Budapest', verified: true },
  { slug: 'monza', event: 'Monza', verified: true },
  { slug: 'madrid', event: 'Madrid' },
  { slug: 'baku', event: 'Baku' },
  { slug: 'lusail', event: 'Lusail' },
  { slug: 'yas-marina', event: 'Yas Marina' },
];

export const F3_ROUNDS = [
  { slug: 'melbourne', event: 'Melbourne', verified: true },
  { slug: 'monaco', event: 'Monaco', verified: true },
  { slug: 'barcelona-catalunya', event: 'Barcelona-Catalunya', verified: true },
  { slug: 'spielberg', event: 'Spielberg', verified: true },
  { slug: 'silverstone', event: 'Silverstone', verified: true },
  { slug: 'spa-francorchamps', event: 'Spa-Francorchamps', verified: true },
  { slug: 'budapest', event: 'Budapest', verified: true },
  { slug: 'monza', event: 'Monza', verified: true },
  { slug: 'madrid', event: 'Madrid' },
];

export const FIA_BASE = {
  F2: 'https://www.fia.com/events/formula-2-championship/season-2026',
  F3: 'https://www.fia.com/events/fia-formula-3-championship/season-2026',
};

// Race sessions only (this feature deliberately excludes Practice/Qualifying
// pace — see README "Race Pace" section for why and what it would take to add).
export const RACE_SESSIONS = [
  { key: 'sprint', label: 'Sprint Race', codeHint: 'r1' },
  { key: 'feature', label: 'Feature Race', codeHint: 'r2' },
];
