// One entry per championship this tracker follows.
//
// `type` picks which parser in fetch-standings.mjs handles the page:
//   - 'fia-official'  fiaformula2.com / fiaformula3.com share a platform:
//                     server-rendered HTML, first cell of each body row is
//                     "1N. Tsolov" (position + abbreviated name combined),
//                     last cell is the season points total.
//   - 'freca-official' fiafrec.com/standings/: a plain HTML table with a
//                     dedicated driver-name link (`a[href*="/driver/"]`)
//                     and a "NNN pts" points cell.
//   - 'wikipedia'     generic season-standings Wikipedia table (Pos. first
//                     cell, Points last cell) — see parseWikipedia().
//
// Every source also carries `wikiFallback`: if the primary source fails to
// return a usable table (site redesign, network hiccup, bot-detection),
// the scraper automatically retries against that Wikipedia page instead of
// leaving a category stale. Italian F4's *official* source (ACI Sport) only
// publishes standings as PDFs with no stable structure worth parsing, so F4
// goes straight to Wikipedia as its primary source — see README for why.
export const SOURCES = [
  {
    category: 'F2',
    type: 'fia-official',
    url: 'https://www.fiaformula2.com/Standings/Driver?seasonId=183',
    series: '2026 FIA F2',
    wikiFallback: '2026_Formula_2_Championship',
  },
  {
    category: 'F3',
    type: 'fia-official',
    url: 'https://www.fiaformula3.com/Standings/Driver?seasonId=183',
    series: '2026 FIA F3',
    wikiFallback: '2026_FIA_Formula_3_Championship',
  },
  {
    category: 'FRECA',
    type: 'freca-official',
    url: 'https://fiafrec.com/standings/',
    series: '2026 FRECA',
    wikiFallback: '2026_Formula_Regional_European_Championship',
  },
  {
    category: 'F4',
    type: 'wikipedia',
    url: null, // Italian F4's official standings (ACI Sport) are PDF-only — no stable structure to scrape. See README.
    series: '2026 Italian F4',
    wikiFallback: '2026_Italian_F4_Championship',
  },
];
