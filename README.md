# Pick Your Pyramid

A comparison site for the current top 5 in FIA Formula 2, FIA Formula 3, FRECA
and Italian F4 — karting roots, the career ladder, results by year and every
team each driver has raced for. This is a standalone, static site: no Claude
account, server, or database needed to run it.

**Live example of the page this repo produces:** it's the same page you've
already seen — this repo just makes it keep itself current on its own.

## How it stays up to date, with no one asking Claude

Four pieces, on purpose kept as simple as possible:

1. **`data/drivers.json`** — the slow-changing stuff: each driver's karting
   history, career-so-far by season, standout result, source links. Edited by
   hand, occasionally (a few times a year at most).
2. **`data/standings.json`** — the fast-changing stuff: each driver's current
   position and points. Rewritten automatically.
3. **`data/karting-spotlight.json`** — one hand-picked standout karting drive
   from the latest weekend. This one genuinely can't be automated (see
   "Karting Spotlight" below) — it's a short weekly copy-paste, not a script.
4. **`scraper/fetch-standings.mjs`** — a small Node script that reads the
   current drivers'-championship standings for each of the four series and
   rewrites `data/standings.json`.

(There's a fifth piece, the **Race Pace Archive** — its own data file and
scraper, documented in its own section below since it works quite
differently and only covers FIA F2/F3.)

A GitHub Actions workflow (`.github/workflows/update-standings.yml`) runs the
scraper on a schedule, and commits `data/standings.json` back to the repo if
anything changed. GitHub Pages serves the site straight from the repo, so a
new commit **is** the site updating — nothing else to deploy.

`index.html` loads all three JSON files at page-load and merges them, so
every visitor always sees whatever is currently committed.

### Where the standings actually come from

Each series' **own official site** is tried first; Wikipedia is the
automatic fallback if the official source is unreachable or its page layout
has changed since this was built (checked per-run — see the warnings in
`data/standings.json` after any run):

| Series | Primary source | Why |
|---|---|---|
| FIA F2 | fiaformula2.com | Confirmed server-rendered HTML table, no JS/API needed |
| FIA F3 | fiaformula3.com | Same platform as F2, same approach |
| FRECA | fiafrec.com/standings/ | Plain WordPress HTML table |
| Italian F4 | *(Wikipedia directly)* | ACI Sport, the actual official source, publishes standings **only as PDFs** with no stable page structure — not worth building a PDF-scraping pipeline for one category. Wikipedia's Italian F4 standings table is the practical stand-in. |

If you'd rather have a maintainer parse the Italian F4 PDFs properly later,
`scraper/sources.mjs` is where that would plug in — the PDF links are on
`acisport.it`'s F4 standings page, refreshed after each round.

## Race Pace Archive (FIA F2 / FIA F3 only)

A season-by-season archive of every Sprint/Feature race the 10 tracked F2/F3
drivers have run: official finishing position + points per round, an
average race-pace figure per round shown as a gap to the fastest of your
currently-selected drivers (not raw lap time — different circuits have
different lap lengths, so raw seconds aren't comparable round to round), and
a "Pace Rk" column showing where that average pace ranked against the
**whole grid** that started the session — not just the other tracked
drivers (e.g. "P4/22" = 4th-fastest average pace out of 22 cars with usable
lap data that race). Hovering a rank cell shows the exact average and lap
count. FRECA and Italian F4 aren't covered here — fia.com doesn't publish
this level of official per-round timing for either series.

**Pieces:**
- **`data/race-pace.json`** — the data this section reads. Starts empty
  (`rounds: {F2:[], F3:[]}`) until the first scrape runs.
- **`scraper/race-calendar.mjs`** — the list of 2026 rounds and their
  fia.com URL slugs for each series. A few slugs are marked `verified` (
  fetched directly during development); the rest follow fia.com's naming
  convention but weren't individually checked. A wrong slug just makes that
  one round silently skip (404 → warning), not a hard failure — fix it here
  if a round you know happened isn't showing up.
- **`scraper/fetch-race-pace.mjs`** — for each round, opens its
  `eventtiming-information` page, finds that round's **Provisional
  Classification** PDF (finishing pos/points) and **History Chart** PDF
  (lap-by-lap gaps, used to compute average pace), and downloads them.
- **`scraper/pdf-table.mjs`** — turns a PDF into rows of table cells using
  each text run's actual on-page position, not its literal characters (a
  "column gap" in a real PDF isn't reliably a run of space characters — it
  can just be a cursor move with no space glyph at all). Built on
  `pdfjs-dist` (Mozilla's actively-maintained PDF.js). An earlier version of
  this used the `pdf-parse` package instead; it was dropped after its
  bundled 2018-era PDF.js build threw `bad XRef entry` on some
  perfectly-valid modern PDFs (this **broke the very first CI run** of this
  feature — caught and fixed the same day, see git history if curious).
- **`scraper/race-pace-parsers.mjs`** — the actual table-parsing logic
  (works on the rows-of-cells `pdf-table.mjs` produces), covered by fixture
  tests (synthetic PDFs built with `pdfkit`) the same way the standings
  parsers are. Also exports `rankPaceByCar()`, which ranks every car's
  average pace within a session (fastest first) — `parseHistoryChart()`
  already extracts laps for every car in the PDF, not just the tracked 10,
  so this just runs `averagePace()` over the whole field and sorts. That's
  what the site's "Pace Rk" column reads.

**Why "History Chart" and not "Lap Times":** fia.com publishes a dedicated
Lap Times PDF for Practice and Qualifying, but **not** for race sessions —
races only get Provisional Classification, History Chart, Sector Analysis,
Pit Stop Summary, and Maximum Speeds. The History Chart is the closest
substitute, confirmed against a real live 2026 PDF: it's a wide table, a
few laps per page, three columns per lap ("LAP n" / "GAP" / "TIME"), and
each *row* is a running **position** for that lap — not a fixed car, since
the driver in P3 changes lap to lap. Whoever leads a given lap gets a
blank GAP cell (no gap to itself), which is genuinely absent from the
page rather than blank text — `pdf-table.mjs` + `race-pace-parsers.mjs`
handle this by anchoring every cell to the nearest known column position
(read off each lap-block's own header) instead of assuming a fixed
left-to-right cell order, which is what a naive parse gets wrong.

**Known limitations, plainly stated:**
- Pit-in/out laps are excluded from the average (they're not representative
  of pace), but **safety car and VSC laps are not detected** — a round run
  behind the safety car for several laps will show an inflated "gap," not a
  real pace difference. Read this chart as a rough comparison, not a precise
  one.
- The column-gap threshold (`minGapChars` in `pdf-table.mjs`) that decides
  where one cell ends and the next begins was tuned against synthetic
  fixtures reproducing the real layout, then verified against one live
  round (2026 F2 Melbourne Sprint Race). A different round or session
  could still lay out slightly differently — check `data/race-pace.json`'s
  `warnings` array after any run, and treat a warning there as "this
  round's PDF didn't match, go look at it," the same troubleshooting loop
  as the standings scraper.
- This step runs after the standings scraper in the same workflow but with
  `continue-on-error: true` — a bad round or a fia.com hiccup here won't
  block the standings update from landing.
- Re-fetches every round from scratch on every run rather than caching
  incrementally. Simple, and cheap enough not to bother optimizing.

## One-time setup (~10 minutes)

1. **Create a GitHub repo** (github.com → New repository). Public is fine and
   free; private also works but needs GitHub Pages on a paid plan.
2. **Push everything in this folder** to that repo (the whole `pyramid-tracker/`
   folder becomes the repo root):
   ```
   cd pyramid-tracker
   git init
   git add .
   git commit -m "Initial import"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo-name>.git
   git push -u origin main
   ```
3. **Turn on GitHub Pages**: repo → Settings → Pages → "Build and deployment"
   → Source: **Deploy from a branch** → Branch: **main**, folder **/(root)**
   → Save. GitHub gives you a URL like
   `https://<you>.github.io/<repo-name>/` within a minute or two — that's the
   link you share with your manager or anyone else.
4. **Check Actions is enabled**: repo → Actions tab. If it asks you to enable
   workflows, click to enable them. The scheduled job will now run on its own.
5. **(Optional) Run it once by hand** to confirm it works end to end: Actions
   tab → "Update standings" → **Run workflow** → Run workflow. Watch it go
   green, then check `data/standings.json`'s `updated` timestamp changed.

That's it — from here it runs itself.

## The two ways it "refreshes"

- **Automatic, on a schedule**: by default, Mondays and Thursdays at 06:00 UTC
  (`.github/workflows/update-standings.yml`). Change the `cron:` line to
  whatever cadence you want — [crontab.guru](https://crontab.guru) helps write
  the expression. Race weekends are usually Friday–Sunday, so twice a week
  catches results within a day or two of any of the four series racing.
- **On demand, with an actual button**: repo → **Actions** tab → "Update
  standings" → **Run workflow**. This is a real button, no waiting for the
  schedule — anyone with write access to the repo can click it. This is the
  honest answer to "a button that refreshes it": GitHub's own UI already has
  one; there's no need to build a second one.

The page itself also has a **"↻ Reload latest data"** button in the header.
Be clear with people about what that does and doesn't do: it re-fetches
`data/standings.json` from the site right now, in case your browser (or
GitHub's CDN) was showing a slightly stale cached copy. It does **not**
trigger a new scrape — a static page genuinely cannot reach out to Wikipedia
or any other outside site on its own (browsers block that, not Claude, not
this code). Only the GitHub Actions workflow above can start a fresh scrape.

## What updates automatically, and what doesn't

Every scheduled or manual run updates each driver's **current position,
points, and series label** — the numbers on the picker rows, the ID cards, and
the last row of the "Career & Teams" table.

It does **not** touch: karting history, past-season stats, standout
write-ups, the karting spotlight, or the wins/podiums breakdown used in the
"Signature Pace" bars for the *current* in-progress season. Every source here
reliably gives position and points; none of them give a clean, consistently
formatted wins/poles/podiums column worth scraping. Update those by hand in
`data/drivers.json` every so often (e.g. once a season finishes, or whenever
you want the pace chart to catch up) — just edit the last entry in a driver's
`headline` array.

## Adding, removing, or swapping a driver

Edit `data/drivers.json` directly — it's a plain array of driver objects, one
object per driver, each with `id`, `name`, `code`, `nat`, `born`, `team`,
`category` (`F2`/`F3`/`FRECA`/`F4`), `karting[]`, `headline[]`, `standout`,
and `sources[]`. Copy an existing entry as a template. Then also add a
starting `current` value for the new driver's `id` in `data/standings.json`
(the next scrape will overwrite it, but the page needs *something* there
until it runs). If you add or remove drivers, the picker groups and totals in
`index.html` update automatically — no code changes needed there.

## Moving to a new season

Each season, edit `scraper/sources.mjs`: update the `wikiFallback` values to
next year's Wikipedia article titles (e.g. `2027_Formula_2_Championship`),
double-check the official-site `url`s still point at the current season (the
F2/F3 seasonId in the query string and FRECA's standings path shouldn't
change, but confirm), and update `series` labels. Then start a fresh top-5
list in `data/drivers.json` for the new season.

## Karting Spotlight — the one part a script can't do

`data/karting-spotlight.json` holds a single hand-picked standout drive from
the go-kart world's latest race weekend — deliberately just karting (OK,
OKJ, X30, KZ2 and similar), not F2/F3/FRECA/F4. "Impressive" is a judgment
call — a dominant win, a comeback drive, a photo finish — not a stat a script
can compute, so this one is genuinely refreshed by a person (with Claude's
research) each week rather than by the Actions workflow:

1. Weekly, Claude checks the latest karting race weekend results and sends a
   short write-up plus a ready-to-paste JSON snippet in this shape:
   ```json
   {
     "weekOf": "2026-09-09",
     "event": "Name of the event/round",
     "driver": "Driver Name",
     "nat": "ITA",
     "class": "OKJ",
     "result": "One-line result",
     "whyItMattered": "A couple of sentences on why this drive stood out.",
     "stat": "A short stat line, e.g. '5th in heats → Final winner, +2.0s'",
     "source": "https://...",
     "pickedBy": "Weekly judgment call, compiled from public race reports",
     "compiledAt": "2026-09-09"
   }
   ```
2. Whoever manages the repo (you, or your manager) replaces the contents of
   `data/karting-spotlight.json` with that snippet and commits it — same as
   any other edit:
   ```
   git add data/karting-spotlight.json
   git commit -m "Karting spotlight: week of 2026-09-09"
   git push
   ```
3. The site picks it up on next load — no rebuild step, same as the
   standings data.

If a week goes by with nothing sent, the page just keeps showing the last
pick — it never goes blank.

## Honesty notes / limitations

- **Official sources, with a Wikipedia safety net.** F2, F3 and FRECA are
  scraped from their own official sites (see the table above); Italian F4
  goes to Wikipedia directly since its official source is PDF-only. Any
  category automatically falls back to Wikipedia if its primary source fails
  outright or its page structure no longer matches what this was built
  against — a run never just skips a category silently; check
  `data/standings.json`'s `warnings` array (and the Actions run log) if a
  category looks stuck.
- **All of this is heuristic scraping, not a real API contract**, on both
  the official sites and Wikipedia. Each parser in `fetch-standings.mjs` is
  commented with exactly what real page structure it was built against and
  why (e.g. the official F2/F3 sites combine position and name into one cell
  like `"1N. Tsolov"`; FRECA's official site is matched by its
  `a[href*="/driver/"]` links; Wikipedia's tables use a colspan header that
  doesn't line up with the body rows). None of these are contracts the sites
  promise to keep — a redesign on any of them can break its parser, which is
  exactly why the Wikipedia fallback and the warnings array exist.
- **`fixture.test.mjs`** is a small offline regression test (no network
  needed) covering all three parsers against fixtures built from each site's
  confirmed real structure. The workflow runs it before every real scrape, so
  a parser that's been broken by a site change fails the build loudly instead
  of silently writing bad data. Run it locally with
  `node scraper/fixture.test.mjs` after changing any parser.
- This project isn't affiliated with the FIA, Formula 2, Formula 3, FRECA,
  Italian F4, ACI Sport, or Wikipedia. It's a fan-made tracker built on
  public data.
