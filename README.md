# Barnes H3 website

A three-page club site whose run list the organisers update from a Google Sheet. No WordPress posts, no event plugin.

| Page | URL | What's on it | Who changes it, and how often |
|---|---|---|---|
| Home | `/` | Club intro, the **next two runs**, current **announcements**, first-timer and hash cash info | Runs: the sheet, weekly. Text: `site/pages/home.html`, rarely |
| Hareline | `/hareline/` | Every upcoming run, recent runs, calendar subscription | The sheet, weekly |
| About | `/about/` | Club story and **who runs the club**, with photos | `site/pages/about.html` and `site/content/organisers.csv`, a few times a year |

The run pages read the sheet directly, so a change shows up within a few minutes of being typed.

```
Google Sheet (Runs + Venues + Announcements tabs)
        │  published as CSV
        ├──► Home + Hareline pages (read it live in the browser; fall back to a saved copy)
        └──► Nightly build (GitHub Actions) ──► hareline.ics calendar feed + saved copy ──► GitHub Pages
```

There are two ways to use it:

1. **Now:** paste `dist-extra/wordpress-embed.html` into a Custom HTML block on the existing WordPress Hareline page (and, with `data-hareline="home"`, on the home page).
2. **Later:** publish the whole static site (`dist/`) on GitHub Pages (free) and retire WordPress.

Both read the same sheet, so the organisers' routine doesn't change when you switch.

---

## 1. Set up the Google Sheet (one-off)

1. Create a Google Sheet with three tabs named **Runs**, **Venues** and **Announcements**.
2. Import `sheet-template/Runs.csv`, `Venues.csv` and `Announcements.csv` into them (File → Import → Replace current sheet).
3. **Runs** columns:

   | Column | What to put in it |
   |---|---|
   | Run | Run number, e.g. `2145` |
   | Date | The Wednesday. Format the column as a date; `2026-11-11` or `11/11/2026` both work |
   | Venue | Pick from the Venues tab. Leave blank or type `TBA` if it isn't known yet |
   | Hares | Hash names separated by `&` or commas. Blank or `Hare wanted` shows a "Hare wanted" badge |
   | Start | Leave blank for 19:30. Fill in only for a different start time |
   | Notes | Short practical detail shown under the venue: parking, start point |
   | Announcements | News for that run, shown in a highlighted box: AGM, Christmas run, fancy dress, a dinner to book. Press Ctrl+Enter (Cmd+Enter on a Mac) in the cell for a new line; web addresses become links automatically. It's also added to the calendar entry |

4. **Venues** columns: Venue, Address, Postcode, Website, Phone, Notes. Each pub or car park is entered once and reused.
   **Announcements** columns are for front-page notices that aren't tied to one run, such as subs being due or a dinner to book:

   | Column | What to put in it |
   |---|---|
   | Order | Optional number; lower numbers appear first. Leave blank to show the notice after numbered notices |
   | Start | First day it shows on the home page. Blank shows it straight away |
   | End | Last day it shows. Blank keeps it up until you delete the row or add an end date |
   | Announcement | The text. Ctrl+Enter (Cmd+Enter on a Mac) for a new line; web addresses become links |
   | URL | Optional link, shown as "More details" |

   Notices with an Order value show in ascending order; blank Order values are placed last and sorted by newest Start date first. The Order column can be omitted from existing sheets. Old rows can stay in the tab; once the End date passes they disappear from the site. A date the site can't read hides that one notice, so if one doesn't appear, check its dates.

5. Make Venue a dropdown. Select the Runs → Venue column, then Data → Data validation → Dropdown (from a range) → `Venues!A2:A`.
6. Pre-fill the Run and Date columns for the year. Type the first two rows, select both, and drag down. The organisers then only fill in Venue and Hares.
7. Share the sheet with edit access for the run organisers and one committee backup.
8. Publish the data. Go to File → Share → **Publish to web**, choose the **Runs** tab and **Comma-separated values (.csv)**, then Publish. Copy the link. Repeat for **Venues** and **Announcements**.

Past runs drop off the hareline automatically, and the page shows up to 12 recent runs under a fold. Don't delete old rows; they're the club's run history.

## 2. Option A: drop into the current WordPress site

1. Open `dist-extra/wordpress-embed.html` and replace `PASTE-RUNS-CSV-LINK-HERE` `PASTE-VENUES-CSV-LINK-HERE` and `PASTE-ANNOUNCEMENTS-CSV-LINK-HERE` with the published links. Announcements only appear in the home view (`data-hareline="home"`).
2. Edit the Hareline page, remove the event-list block, and add a **Custom HTML** block with the file's contents.
3. Stop creating event posts. The organisers now edit the sheet only.

WordPress only allows `<script>` in Custom HTML blocks for administrators. If it gets stripped, add the snippet with a code-snippet plugin such as WPCode instead.

## 3. Option B: standalone site on GitHub Pages

1. Push this folder to a GitHub repository, for example `barnes-hareline`. A public repo is simplest; Pages on private repos needs a paid plan.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. In **Settings → Secrets and variables → Actions → Variables**, add `RUNS_CSV_URL`, `VENUES_CSV_URL` and `ANNOUNCEMENTS_CSV_URL`: the published sheet links. The site address is picked up from the Pages settings automatically.
4. Put the three CSV links into `site/config.js` too, so the page reads the sheet live.
5. Push to `main`, or use Actions → **Build and deploy hareline** → Run workflow.

The workflow deploys on every push to `main`, nightly, and on demand. The nightly run refreshes `hareline.ics` and the saved copy. Nothing needs secrets: the only inputs are the public sheet links.

**Moving the domain:**

1. In Settings → Pages → Custom domain, enter `barnesh3.com` and tick **Enforce HTTPS** once the certificate is issued.
2. At the domain registrar, add four `A` records on the apex pointing at GitHub's Pages addresses: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
3. Add a `CNAME` record for `www` pointing at `<github-user>.github.io`.
4. Run the workflow again, so the site's links and `hareline.ics` use the new domain.

Verifying the domain under your GitHub account settings (Settings → Pages → Verified domains) stops anyone else claiming it.

**Old WordPress links:** `/hareline/` and `/about/` keep the same addresses as on WordPress. GitHub Pages can't do server-side redirects, so old run pages such as `/events/run-no-2144/` hit `404.html`, which sends them to the hareline.

## 4. Changing the About page and organisers

These change rarely, so they live in the repository rather than the sheet. Edit them on github.com: open the file, click the pencil, then **Commit changes**. The site rebuilds itself within a couple of minutes.

**Organisers:** `site/content/organisers.csv`

| Column | What to put in it |
|---|---|
| Name | Hash name (or real name if they prefer). Blank shows "Name to be added" |
| Role | Grand Master, Hare Raiser, On Sec, Hash Cash… Shown above the name |
| Photo | File name of their photo in `site/images/organisers/`, e.g. `grand-master.jpg`. Blank shows the role's initials |
| About | Optional one-liner |

Rows appear in the order they're listed. To add a photo, open `site/images/organisers/` on github.com, choose **Add file → Upload files**, then put the file name in the Photo column. Square photos around 400 × 400 pixels work best. Get each person's OK before putting their photo on a public site.

**Club text:** `site/pages/about.html` (and `home.html` for the home page boxes). It's plain HTML: change the words between the `<p>` and `</p>` tags. Leave the `<!-- ORGANISERS -->` line where the organiser list should appear.

**Logo:** upload the club owl as `site/images/logo.gif` (or `.png`/`.svg`). It replaces the "BH3" roundel in the header and becomes the browser-tab icon.

## Build and run locally

```bash
node scripts/build.mjs                                   # uses site/data/*.csv
RUNS_CSV_URL=... VENUES_CSV_URL=... ANNOUNCEMENTS_CSV_URL=... node scripts/build.mjs   # uses the live sheet
npx serve dist                                           # http://localhost:3000
```

Node 22, no npm dependencies.

## What's in the repo

| Path | Purpose |
|---|---|
| `site/core.js` | Pure logic: CSV parsing, date parsing, venue lookup, iCalendar output. Shared by page, embed and build |
| `site/app.js` | Renders the runs: `data-hareline="home"` for the next two, `"full"` for the hareline |
| `site/pages/*.html` | The main content of Home, Hareline and About |
| `site/content/organisers.csv` | Who runs the club, shown on About |
| `site/images/` | Logo and organiser photos |
| `site/styles.css` | Page styles. Everything after `/* @components` is reused by the WordPress embed |
| `site/config.js` | Sheet links for the live site (the build fills in the calendar URL) |
| `site/data/*.csv` | Saved copy of the sheet, used if Google is unreachable |
| `scripts/build.mjs` | Wraps each page in the shared header and footer and builds `dist/` (pages, `hareline.ics`, `404.html`), the WordPress embed and a self-contained preview |
| `.github/workflows/deploy.yml` | Build and deploy to GitHub Pages, nightly refresh |

## Things to know

- Google can take up to about 5 minutes to republish a sheet after an edit.
- GitHub Pages caches pages for about 10 minutes, so a fresh deploy can take that long to show.
- Calendar apps poll subscribed feeds on their own schedule. Google Calendar can take up to a day, Apple and Outlook are usually quicker. The feed itself is rebuilt nightly, or immediately with Run workflow.
- Times in the feed are written as Europe/London local time, so they stay at 19:30 across the clocks changing.
- Published sheet links are public. Don't put phone numbers or other personal details for members in the sheet.
