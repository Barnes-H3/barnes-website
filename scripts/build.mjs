// Build the Barnes H3 static site into dist/.
//   RUNS_CSV_URL / VENUES_CSV_URL / ANNOUNCEMENTS_CSV_URL
//                                   published Google Sheet CSV links (optional; falls back to site/data)
//   SITE_URL                        public base URL, e.g. https://barnesh3.com/ or https://user.github.io/repo/
// Outputs:
//   dist/                            GitHub Pages site: / (home), /hareline/, /about/, hareline.ics
//   dist-extra/preview.html          self-contained preview of all three pages (hash routing, sample data)
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const dist = path.join(root, "dist");
const extra = path.join(root, "dist-extra");
const SITE_URL = (process.env.SITE_URL || "https://barnesh3.com/").replace(/\/?$/, "/");
const BASE = new URL(SITE_URL).pathname;               // "/" or "/repo-name/"
const ICS_URL = SITE_URL + "hareline.ics";

const read = f => readFile(path.join(site, f), "utf8");
await import(pathToFileURL(path.join(site, "core.js")).href);
const C = globalThis.HarelineCore;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const userCfg = await read("config.js");
const configuredUrl = key => {
  const match = userCfg.match(new RegExp(`\\b${key}:\\s*("(?:\\\\.|[^"])*")`));
  return match ? JSON.parse(match[1]) : "";
};
const csvField = value => `"${String(value ?? "").replace(/"/g, '""')}"`;

// ---------- data ----------
async function csv(envVar, file, optional, configuredCsvUrl = "") {
  const url = process.env[envVar] || configuredCsvUrl;
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${envVar}: ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (!/^﻿?\s*[A-Za-z]/.test(text) || /<html/i.test(text.slice(0, 200)))
      throw new Error(`${envVar} did not return CSV. Check the sheet is published to the web as CSV.`);
    console.log(`Fetched ${file} from the sheet (${text.length} bytes)`);
    return text;
  }
  console.log(`Using saved ${file}`);
  if (optional && !existsSync(path.join(site, "data", file))) return "";
  return read("data/" + file);
}

const runsCsv = await csv("RUNS_CSV_URL", "runs.csv");
const venuesCsv = await csv("VENUES_CSV_URL", "venues.csv");
const announcementsCsv = await csv("ANNOUNCEMENTS_CSV_URL", "announcements.csv", true);
const configuredHareRequestsUrl = process.env.HARE_REQUESTS_CSV_URL || configuredUrl("hareRequestsCsvUrl");
const rawHareRequestsCsv = await csv("HARE_REQUESTS_CSV_URL", "hare-requests.csv", true, configuredUrl("hareRequestsCsvUrl"));
let hareRequestsCsv = "Date,Hash Name\n";
let liveHareRequestsUrl = "";
if (rawHareRequestsCsv) {
  const bookingRows = C.parseCsv(rawHareRequestsCsv + "\n__validation__,__validation__");
  const headers = Object.keys(bookingRows[0] || {});
  const dateHeader = headers.find(h => h === "date" || h === "rundate" || h.startsWith("whendoyouwanttosettherun"));
  const nameHeader = headers.find(h => h === "hashname");
  if (!dateHeader || !nameHeader)
    throw new Error("Hare requests CSV must contain a run date and Hash Name column.");
  if (headers.length === 2) liveHareRequestsUrl = configuredHareRequestsUrl;
  const safeRows = bookingRows.flatMap(row => {
    const date = C.parseDate(row[dateHeader]);
    if (!date) return [];
    return [`${date.key},${csvField(row[nameHeader])}`];
  });
  hareRequestsCsv += safeRows.join("\n") + (safeRows.length ? "\n" : "");
}
const runs = C.buildRuns(C.parseCsv(runsCsv), C.parseCsv(venuesCsv));
if (!runs.length) throw new Error("No valid runs found. Is the Date column filled in?");

const organisers = C.parseCsv(await read("content/organisers.csv")).filter(o => o.name || o.role);
const [core, app, css] = await Promise.all(["core.js", "app.js", "styles.css"].map(read));
const pageHtml = Object.fromEntries(await Promise.all(
  ["home", "hareline", "about"].map(async p => [p, await read(`pages/${p}.html`)])
));

// ---------- images ----------
const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
const logoFile = ["logo.svg", "logo.png", "logo.gif", "logo.jpg", "logo.webp"].find(f => existsSync(path.join(site, "images", f)));

// mode "site": absolute URL under BASE. mode "preview": inline data URI so the single-file preview works.
async function imageSrc(rel, mode) {
  if (mode === "site") return BASE + "images/" + rel;
  const buf = await readFile(path.join(site, "images", rel));
  return `data:${MIME[path.extname(rel).toLowerCase()] || "application/octet-stream"};base64,${buf.toString("base64")}`;
}

function initials(text) {
  const words = String(text).replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
}

async function organisersHtml(mode) {
  if (!organisers.length) return `<p class="crew__empty">Organisers will be listed here.</p>`;
  const cards = await Promise.all(organisers.map(async o => {
    const photo = o.photo && existsSync(path.join(site, "images/organisers", o.photo))
      ? `<img class="crew__photo" src="${await imageSrc("organisers/" + o.photo, mode)}" alt="" loading="lazy" width="400" height="400">`
      : `<span class="crew__photo crew__photo--blank" aria-hidden="true">${esc(initials(o.name || o.role))}</span>`;
    if (o.photo && !photo.startsWith("<img")) console.warn(`Organiser photo not found: site/images/organisers/${o.photo}`);
    return `
      <li class="crew__card">
        ${photo}
        <div class="crew__text">
          <p class="crew__role">${esc(o.role)}</p>
          <p class="crew__name${o.name ? "" : " is-blank"}">${esc(o.name || "Name to be added")}</p>
          ${o.about ? `<p class="crew__about">${esc(o.about)}</p>` : ""}
        </div>
      </li>`;
  }));
  return `<ul class="crew__grid">${cards.join("")}</ul>`;
}

// ---------- layout ----------
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gothic+A1:wght@400;700;800&family=JetBrains+Mono:wght@500;700&display=swap">`;

const PAGES = [
  {
    key: "home", out: "index.html", title: "Barnes H3", nav: "Home",
    heading: "Barnes Hash<br>House Harriers",
    sub: "Hashing along the M25 in Surrey &amp; Sussex. <strong>Every Wednesday at 19:30.</strong>",
    description: "Barnes Hash House Harriers: social trail runs every Wednesday at 19:30 along the M25 in Surrey and Sussex."
  },
  {
    key: "hareline", out: "hareline/index.html", title: "Hareline · Barnes H3", nav: "Hareline",
    heading: "Receding<br>hareline",
    sub: "Every run we have planned. <strong>All runs start at 19:30 promptly.</strong>",
    description: "Barnes H3 upcoming runs: dates, venues and hares."
  },
  {
    key: "about", out: "about/index.html", title: "About · Barnes H3", nav: "About",
    heading: "About<br>the club",
    sub: "Who we are and who to ask.",
    description: "About Barnes Hash House Harriers and the people who run the club."
  }
];

// links: { home, hareline, about } hrefs; logo: src or null
function mast(page, links, logoSrc) {
  const navItems = PAGES.map(p =>
    `<li><a href="${links[p.key]}"${p.key === page.key ? ' aria-current="page"' : ""}>${p.nav}</a></li>`).join("");
  const emblem = logoSrc
    ? `<img class="mast__logo" src="${logoSrc}" alt="">`
    : `<span class="mast__logo mast__logo--roundel" aria-hidden="true">BH3</span>`;
  return `
<header class="mast mast--${page.key}">
  <div class="wrap">
    <nav class="mast__nav" aria-label="Main">
      <a class="mast__brand" href="${links.home}">${emblem}<span>Barnes H3</span></a>
      <ul class="mast__links">${navItems}<li><a href="${configuredUrl("contactFormUrl")}" target="_blank" rel="noopener">Contact us</a></li></ul>
    </nav>
    <h1 class="mast__title">${page.heading}</h1>
    <p class="mast__sub">${page.sub}</p>
    <svg class="mast__trail" viewBox="0 0 320 48" fill="none" aria-hidden="true">
      <circle cx="22" cy="24" r="14" stroke="currentColor" stroke-width="3"/>
      <circle cx="22" cy="24" r="3" fill="currentColor"/>
      <path d="M52 24 H262" stroke="currentColor" stroke-width="3" stroke-dasharray="2 14" stroke-linecap="round"/>
      <path d="M268 24 H304 M290 10 L306 24 L290 38" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>
</header>`;
}

const footer = links => `
<footer class="foot">
  <div class="wrap">
    <p class="foot__motto">Rain or shine, the trail is on!</p>
    <nav aria-label="Footer"><a href="${links.home}">Home</a> · <a href="${links.hareline}">Hareline</a> · <a href="${links.about}">About</a></nav>
  </div>
</footer>`;

async function main(page, mode) {
  let html = pageHtml[page.key];
  if (page.key === "about") html = html.replace("<!-- ORGANISERS -->", await organisersHtml(mode));
  return `<main class="wrap page page--${page.key}">\n${html}\n</main>`;
}

// ---------- dist/: the deployable site ----------
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "data"), { recursive: true });
for (const f of ["core.js", "app.js", "styles.css"]) await cp(path.join(site, f), path.join(dist, f));
await cp(path.join(site, "images"), path.join(dist, "images"), {
  recursive: true, filter: src => !src.endsWith("README.txt")
});
await writeFile(path.join(dist, "data/runs.csv"), runsCsv);       // saved copy, used if the sheet is unreachable
await writeFile(path.join(dist, "data/venues.csv"), venuesCsv);
await writeFile(path.join(dist, "data/announcements.csv"), announcementsCsv || "Order,Start,End,Announcement,URL\n");
await writeFile(path.join(dist, "data/hare-requests.csv"), hareRequestsCsv);
await writeFile(path.join(dist, "hareline.ics"), C.toIcs(runs, { siteUrl: SITE_URL + "hareline/" }));

// config.js: the editors' sheet links, plus the paths this build knows about
const publicCfg = userCfg
  .replace(/hareRequestsCsvUrl:\s*"[^"]*"/, 'hareRequestsCsvUrl: ""')
  .replace(/icsUrl:\s*"[^"]*"/, `icsUrl: ${JSON.stringify(ICS_URL)}`);
await writeFile(path.join(dist, "config.js"), publicCfg + `
Object.assign(window.HARELINE_CONFIG, {
  fallbackRunsUrl: ${JSON.stringify(BASE + "data/runs.csv")},
  fallbackVenuesUrl: ${JSON.stringify(BASE + "data/venues.csv")},
  fallbackAnnouncementsUrl: ${JSON.stringify(BASE + "data/announcements.csv")},
  hareRequestsCsv: ${JSON.stringify(hareRequestsCsv)},
  hareRequestsCsvUrl: ${JSON.stringify(liveHareRequestsUrl || BASE + "data/hare-requests.csv")},
  harelineUrl: ${JSON.stringify(BASE + "hareline/")}
});
`);

const siteLinks = { home: BASE, hareline: BASE + "hareline/", about: BASE + "about/" };
const siteLogo = logoFile ? BASE + "images/" + logoFile : null;
for (const page of PAGES) {
  const hasRuns = page.key !== "about";
  const out = path.join(dist, page.out);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${page.title}</title>
<meta name="description" content="${esc(page.description)}">
<meta name="theme-color" content="#1a5c00">
<link rel="canonical" href="${SITE_URL}${page.out.replace(/index\.html$/, "")}">
<link rel="alternate" type="text/calendar" title="Barnes H3 hareline" href="${BASE}hareline.ics">
${siteLogo ? `<link rel="icon" href="${siteLogo}">` : ""}
${fonts}
<link rel="stylesheet" href="${BASE}styles.css">
</head>
<body>
${mast(page, siteLinks, siteLogo)}
${await main(page, "site")}
${footer(siteLinks)}
${hasRuns ? `<script src="${BASE}config.js"></script>
<script src="${BASE}core.js"></script>
<script src="${BASE}app.js"></script>` : ""}
</body>
</html>
`);
}

// ---------- GitHub Pages extras ----------
await writeFile(path.join(dist, ".nojekyll"), "");    // serve files as built, no Jekyll
await writeFile(path.join(dist, "404.html"), `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · Barnes H3</title>
<meta name="robots" content="noindex">
${fonts}
<link rel="stylesheet" href="${BASE}styles.css">
</head><body>
${mast({ key: "404", heading: "Lost<br>the trail?", sub: "That page doesn't exist. Try the hareline." }, siteLinks, siteLogo)}
<main class="wrap page"><p><a class="bh-btn bh-btn--primary" href="${BASE}hareline/">Go to the hareline</a></p></main>
${footer(siteLinks)}
</body></html>
`);

// ---------- preview.html: all three pages in one file, switched by #home / #hareline / #about ----------
await mkdir(extra, { recursive: true });
const pvLinks = { home: "#home", hareline: "#hareline", about: "#about" };
const pvLogo = logoFile ? await imageSrc(logoFile, "preview") : null;
const pvSections = await Promise.all(PAGES.map(async p =>
  `<div class="pv-page" data-page="${p.key}"${p.key === "home" ? "" : " hidden"}>${mast(p, pvLinks, pvLogo)}${await main(p, "preview")}</div>`));
await writeFile(path.join(extra, "preview.html"), `<title>Barnes H3 Hareline</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
${pvSections.join("\n")}
${footer(pvLinks)}
<script>
window.HARELINE_CONFIG = {
  icsUrl: ${JSON.stringify(ICS_URL)},
  harelineUrl: "#hareline",
  hareRequestsCsv: ${JSON.stringify(hareRequestsCsv)},
  inline: { runs: ${JSON.stringify(runsCsv)}, venues: ${JSON.stringify(venuesCsv)}, announcements: ${JSON.stringify(announcementsCsv)} }
};
(function () {
  function show() {
    var key = (location.hash || "#home").slice(1);
    var pages = document.querySelectorAll(".pv-page");
    if (!document.querySelector('.pv-page[data-page="' + key + '"]')) key = "home";
    pages.forEach(function (el) { el.hidden = el.getAttribute("data-page") !== key; });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", show);
  show();
})();
${core}
${app}
</script>
`);

console.log(`Built ${runs.length} runs, ${organisers.length} organisers → dist/ (home, hareline, about, hareline.ics), dist-extra/preview.html`);
