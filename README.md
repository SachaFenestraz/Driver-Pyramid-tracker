# Pick Your Pyramid

A comparison site for the current top 5 in FIA Formula 2, FIA Formula 3, FRECA
and Italian F4 — karting roots, the career ladder, results by year and every
team each driver has raced for. This is a standalone, static site: no Claude
account, server, or database needed to run it.

**Live example of the page this repo produces:** it's the same page you've
already seen — this repo just makes it keep itself current on its own.

## How it stays up to date, with no one asking Claude

Three pieces, on purpose kept as simple as possible:

1. **`data/drivers.json`** — the slow-changing stuff: each driver's karting
   history, career-so-far by season, standout result, source links. Edited by
   hand, occasionally (a few times a year at most).
2. **`data/standings.json`** — the fast-changing stuff: each driver's current
   position and points. Rewritten automatically.
3. **`scraper/fetch-standings.mjs`** — a small Node script that reads the
   current drivers'-championship standings tables on Wikipedia for each of
   the four series and rewrites `data/standings.json`.

A GitHub Actions workflow (`.github/workflows/update-standings.yml`) runs that
script on a schedule, and commits `data/standings.json` back to the repo if
anything changed. GitHub Pages serves the site straight from the repo, so a
new commit **is** the site updating — nothing else to deploy.

`index.html` loads both JSON files at page-load and merges them, so every
visitor always sees whatever is currently committed.

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
write-ups, or the wins/podiums breakdown used in the "Signature Pace" bars for
the *current* in-progress season. Wikipedia's standings tables reliably give
position and points; they don't reliably give a clean wins/poles/podiums
column to scrape. Update those by hand in `data/drivers.json` every so often
(e.g. once a season finishes, or whenever you want the pace chart to catch
up) — just edit the last entry in a driver's `headline` array.

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

Each season, edit `scraper/sources.mjs` and update the four `page` values to
next year's Wikipedia article titles (e.g. `2027_Formula_2_Championship`).
Also update `series` labels there and start a fresh top-5 list in
`data/drivers.json` for the new season.

## Honesty notes / limitations

- **Source**: this reads Wikipedia's standings tables, not the official
  series' own live-timing sites. Wikipedia is community-maintained and
  usually catches up within a day or two of a race weekend, but it is not
  official live timing — treat it as "current, not live."
- **The scraper is heuristic, not a real API.** It looks for the first cell
  of a row as position and the last numeric cell as points, on any table that
  has a header mentioning "Points". This is robust to the row-span/col-span
  quirks in Wikipedia's standings-table template (see the comment at the top
  of `fetch-standings.mjs` for why), but if Wikipedia's editors restructure a
  page's tables significantly, matching can silently stop working for that
  one series. `fetch-standings.mjs` logs a warning (visible in the Actions
  run log, and surfaced in the page's status bar) whenever it can't find a
  driver in a table, rather than guessing — check there first if a category
  looks stuck.
- **`fixture.test.mjs`** is a small offline regression test (no network
  needed) that the workflow runs before the real scrape, specifically to
  catch this kind of breakage early. Run it locally with
  `node scraper/fixture.test.mjs` after changing the parser.
- This project isn't affiliated with the FIA, Formula 2, Formula 3, FRECA,
  Italian F4, or Wikipedia. It's a fan-made tracker built on public data.
