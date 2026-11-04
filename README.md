# Barnes H3 hareline

A hareline that the run organisers update from a Google Sheet. No WordPress posts, no event plugin.
The page reads the sheet directly, so a change shows up within a few minutes of being typed.

```
Google Sheet (Runs + Venues tabs)
        │  published as CSV
        ├──► Hareline page (reads it live in the browser; falls back to a saved copy)
        └──► Nightly build (GitHub Actions) ──► hareline.ics calendar feed + saved copy ──► Azure Static Web Apps
```

There are two ways to use it:

1. **Now:** paste `dist-extra/wordpress-embed.html` into a Custom HTML block on the existing WordPress Hareline page.
2. **Later:** deploy the whole static site (`dist/`) to Azure Static Web Apps and retire WordPress.

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

## 3. Option B: standalone site on Azure Static Web Apps

```bash
# Infrastructure (Free tier)
az group create -n rg-barnesh3 -l westeurope
az deployment group create -g rg-barnesh3 -f infra/main.bicep
az staticwebapp secrets list -n swa-barnesh3 --query properties.apiKey -o tsv
```

In the GitHub repository:

- **Secret** `AZURE_STATIC_WEB_APPS_API_TOKEN`: the token from the last command.
- **Variables** `RUNS_CSV_URL`, `VENUES_CSV_URL`: the published sheet links.
- **Variable** `SITE_URL`: `https://barnesh3.com/`.

Also put the two CSV links into `site/config.js` so the page reads the sheet live.

`.github/workflows/deploy.yml` deploys on every push to `main`, nightly, and on demand (Actions → Run workflow). The nightly run refreshes `hareline.ics` and the saved copy.

**Moving the domain:** add `barnesh3.com` as a custom domain on the Static Web App. The apex domain needs a TXT validation record plus an ALIAS/ANAME record, or point `www` with a CNAME and redirect the apex at the registrar. `staticwebapp.config.json` already 301-redirects the old `/hareline/` and `/events/...` URLs to the new page.

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
| `site/config.js` | Sheet links and calendar URL for the live site |
| `site/data/*.csv` | Saved copy of the sheet, used if Google is unreachable |
| `scripts/build.mjs` | Builds `dist/`, `hareline.ics`, the WordPress embed and a self-contained preview |
| `infra/main.bicep` | Azure Static Web App (Free) |
| `.github/workflows/deploy.yml` | Build and deploy, nightly refresh |

## Things to know

- Google can take up to about 5 minutes to republish a sheet after an edit.
- Calendar apps poll subscribed feeds on their own schedule. Google Calendar can take up to a day, Apple and Outlook are usually quicker. The feed itself is rebuilt nightly, or immediately with Run workflow.
- Times in the feed are written as Europe/London local time, so they stay at 19:30 across the clocks changing.
- Published sheet links are public. Don't put phone numbers or other personal details for members in the sheet.
