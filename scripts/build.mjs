// Build the static hareline site into dist/.
//   RUNS_CSV_URL / VENUES_CSV_URL  published Google Sheet CSV links (optional; falls back to site/data)
//   SITE_URL                        public base URL, e.g. https://barnesh3.com/
// Outputs: dist/ (deployable site + hareline.ics), dist-extra/wordpress-embed.html, dist-extra/preview.html
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const dist = path.join(root, "dist");
const extra = path.join(root, "dist-extra");
const SITE_URL = (process.env.SITE_URL || "https://barnesh3.com/").replace(/\/?$/, "/");
const ICS_URL = SITE_URL + "hareline.ics";

const read = f => readFile(path.join(site, f), "utf8");
await import(path.join(site, "core.js"));
const C = globalThis.HarelineCore;

async function csv(envVar, file) {
  const url = process.env[envVar];
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
  return read("data/" + file);
}

const runsCsv = await csv("RUNS_CSV_URL", "runs.csv");
const venuesCsv = await csv("VENUES_CSV_URL", "venues.csv");
const runs = C.buildRuns(C.parseCsv(runsCsv), C.parseCsv(venuesCsv));
if (!runs.length) throw new Error("No valid runs found. Is the Date column filled in?");

const [core, app, css, body] = await Promise.all(["core.js", "app.js", "styles.css", "partials-body.html"].map(read));
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Big+Shoulders+Display:wght@600;700;800&family=JetBrains+Mono:wght@500;700&display=swap">`;

// ---- dist/: the deployable site ----
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "data"), { recursive: true });
for (const f of ["core.js", "app.js", "styles.css", "config.js", "staticwebapp.config.json", "about.html"]) {
  try { await cp(path.join(site, f), path.join(dist, f)); } catch { /* optional file */ }
}
await writeFile(path.join(dist, "data/runs.csv"), runsCsv);       // saved copy used if the sheet is unreachable
await writeFile(path.join(dist, "data/venues.csv"), venuesCsv);
await writeFile(path.join(dist, "hareline.ics"), C.toIcs(runs, { siteUrl: SITE_URL }));
await writeFile(path.join(dist, "index.html"), `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Barnes H3 Hareline</title>
<meta name="description" content="Barnes Hash House Harriers: upcoming Wednesday runs, venues and hares.">
<meta name="theme-color" content="#1a5c00">
<link rel="alternate" type="text/calendar" title="Barnes H3 hareline" href="hareline.ics">
${fonts}
<link rel="stylesheet" href="styles.css">
</head>
<body>
${body}
<script src="config.js"></script>
<script src="core.js"></script>
<script src="app.js"></script>
</body>
</html>
`);

// ---- WordPress embed: one Custom HTML block, styles scoped to #barnes-hareline ----
await mkdir(extra, { recursive: true });
const [tokens, components] = css.split("/* @components");
const lightTokens = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
const scopedComponents = "/* @components" + components;
await writeFile(path.join(extra, "wordpress-embed.html"), `<!-- Barnes H3 hareline: paste into a Custom HTML block on the Hareline page.
     Update RUNS/VENUES links below once the Google Sheet is published as CSV. -->
<div id="barnes-hareline"><p>Loading the hareline…</p></div>
${fonts}
<style>
#barnes-hareline {${lightTokens}
  --card: #ffffff; --paper: #f2f5ef;
}
${scopedComponents}
#barnes-hareline .bh-next { margin-top: 0; }
</style>
<script>
window.HARELINE_CONFIG = {
  mount: "#barnes-hareline",
  runsCsvUrl: "PASTE-RUNS-CSV-LINK-HERE",
  venuesCsvUrl: "PASTE-VENUES-CSV-LINK-HERE",
  fallbackRunsUrl: "", fallbackVenuesUrl: "",
  icsUrl: ""
};
${core}
${app}
</script>
`);

// ---- preview.html: self-contained page with sample data, for the Claude artifact ----
await writeFile(path.join(extra, "preview.html"), `<title>Barnes H3 Hareline</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
${body}
<script>
window.HARELINE_CONFIG = { icsUrl: ${JSON.stringify(ICS_URL)}, inline: { runs: ${JSON.stringify(runsCsv)}, venues: ${JSON.stringify(venuesCsv)} } };
${core}
${app}
</script>
`);

console.log(`Built ${runs.length} runs → dist/ (+ hareline.ics), dist-extra/wordpress-embed.html, dist-extra/preview.html`);
