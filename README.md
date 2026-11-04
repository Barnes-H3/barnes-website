# Barnes H3 hareline

A hareline that the run organisers update from a Google Sheet. No WordPress posts, no event plugin.
The page reads the sheet directly, so a change shows up within a few minutes of being typed.

```
Google Sheet (Runs + Venues tabs)
        │  published as CSV
        ├──► Hareline page (reads it live in the browser; falls back to a saved copy)
        └──► Nightly build (GitHub Actions) ──► hareline.ics calendar feed + saved copy ──► GitHub Pages
```

There are two ways to use it:

1. **Now:** paste `dist-extra/wordpress-embed.html` into a Custom HTML block on the existing WordPress Hareline page.
2. **Later:** publish the whole static site (`dist/`) on GitHub Pages (free) and retire WordPress.

Both read the same sheet, so the organisers' routine doesn't change when you switch.

---

## 1. Set up the Google Sheet (one-off)

1. Create a Google Sheet with two tabs named **Runs** and **Venues**.
2. Import `sheet-template/Runs.csv` and `sheet-template/Venues.csv` into them (File → Import → Replace current sheet).
3. **Runs** columns:

   | Column | What to put in it |
   |---|---|
   | Run | Run number, e.g. `2145` |
   | Date | The Wednesday. Format the column as a date; `2026-11-11` or `11/11/2026` both work |
   | Venue | Pick from the Venues tab. Leave blank or type `TBA` if it isn't known yet |
   | Hares | Hash names separated by `&` or commas. Blank or `Hare wanted` shows a "Hare wanted" badge |
   | Start | Leave blank for 19:30. Fill in only for a different start time |
   | Notes | Anything else: parking, special run, fancy dress |

4. **Venues** columns: Venue, Address, Postcode, Website, Phone, Notes. Each pub or car park is entered once and reused.
5. Make Venue a dropdown. Select the Runs → Venue column, then Data → Data validation → Dropdown (from a range) → `Venues!A2:A`.
6. Pre-fill the Run and Date columns for the year. Type the first two rows, select both, and drag down. The organisers then only fill in Venue and Hares.
7. Share the sheet with edit access for the run organisers and one committee backup.
8. Publish the data. Go to File → Share → **Publish to web**, choose the **Runs** tab and **Comma-separated values (.csv)**, then Publish. Copy the link. Repeat for **Venues**.

Past runs drop off the hareline automatically, and the page shows up to 12 recent runs under a fold. Don't delete old rows; they're the club's run history.

## 2. Option A: drop into the current WordPress site

1. Open `dist-extra/wordpress-embed.html` and replace `PASTE-RUNS-CSV-LINK-HERE` and `PASTE-VENUES-CSV-LINK-HERE` with the two published links.
2. Edit the Hareline page, remove the event-list block, and add a **Custom HTML** block with the file's contents.
3. Stop creating event posts. The organisers now edit the sheet only.

WordPress only allows `<script>` in Custom HTML blocks for administrators. If it gets stripped, add the snippet with a code-snippet plugin such as WPCode instead.

## 3. Option B: standalone site on GitHub Pages

1. Push this folder to a GitHub repository, for example `barnes-hareline`. A public repo is simplest; Pages on private repos needs a paid plan.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions → Variables**, add:
   - `RUNS_CSV_URL` and `VENUES_CSV_URL`: the published sheet links.
   - `SITE_URL`: where the site will live. Start with `https://<github-user>.github.io/barnes-hareline/`, then change it to `https://barnesh3.com/` once the domain points at Pages.
4. Put the two CSV links into `site/config.js` too, so the page reads the sheet live.
5. Push to `main`, or use Actions → **Build and deploy hareline** → Run workflow.

The workflow deploys on every push to `main`, nightly, and on demand. The nightly run refreshes `hareline.ics` and the saved copy. Nothing needs secrets: the only inputs are the public sheet links.

**Moving the domain:**

1. In Settings → Pages → Custom domain, enter `barnesh3.com` and tick **Enforce HTTPS** once the certificate is issued.
2. At the domain registrar, add four `A` records on the apex pointing at GitHub's Pages addresses: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
3. Add a `CNAME` record for `www` pointing at `<github-user>.github.io`.
4. Set the `SITE_URL` variable to `https://barnesh3.com/` and run the workflow again.

Verifying the domain under your GitHub account settings (Settings → Pages → Verified domains) stops anyone else claiming it.

**Old WordPress links:** GitHub Pages can't do server-side redirects. The build writes forwarding pages at `/hareline/`, `/events/` and `/about/`. Old run pages such as `/events/run-no-2144/` hit `404.html`, which sends them to the hareline.

## Build and run locally

```bash
node scripts/build.mjs                                   # uses site/data/*.csv
RUNS_CSV_URL=... VENUES_CSV_URL=... node scripts/build.mjs   # uses the live sheet
npx serve dist                                           # http://localhost:3000
```

Node 22, no npm dependencies.

## What's in the repo

| Path | Purpose |
|---|---|
| `site/core.js` | Pure logic: CSV parsing, date parsing, venue lookup, iCalendar output. Shared by page, embed and build |
| `site/app.js` | Renders the hareline into the page |
| `site/styles.css` | Page styles. Everything after `/* @components` is reused by the WordPress embed |
| `site/config.js` | Sheet links for the live site (the build fills in the calendar URL) |
| `site/data/*.csv` | Saved copy of the sheet, used if Google is unreachable |
| `scripts/build.mjs` | Builds `dist/` (site, `hareline.ics`, redirect pages, `404.html`), the WordPress embed and a self-contained preview |
| `.github/workflows/deploy.yml` | Build and deploy to GitHub Pages, nightly refresh |

## Things to know

- Google can take up to about 5 minutes to republish a sheet after an edit.
- GitHub Pages caches pages for about 10 minutes, so a fresh deploy can take that long to show.
- Calendar apps poll subscribed feeds on their own schedule. Google Calendar can take up to a day, Apple and Outlook are usually quicker. The feed itself is rebuilt nightly, or immediately with Run workflow.
- Times in the feed are written as Europe/London local time, so they stay at 19:30 across the clocks changing.
- Published sheet links are public. Don't put phone numbers or other personal details for members in the sheet.
