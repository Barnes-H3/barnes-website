const rawBaseUrl = process.argv[2] || process.env.SITE_URL;
if (!rawBaseUrl) throw new Error("Pass the deployed site URL as an argument or set SITE_URL.");

const baseUrl = new URL(rawBaseUrl);
baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/`;

const checks = [
  { path: "", label: "home page", includes: "Barnes H3" },
  { path: "hareline/", label: "hareline page", includes: "Receding" },
  { path: "about/", label: "about page", includes: "About" },
  { path: "run-stats/", label: "Run Stats page", includes: "Run stats" },
  { path: "config.js", label: "site configuration", includes: "fallbackWebsiteSettingsUrl" },
  { path: "core.js", label: "shared site script", includes: "HarelineCore" },
  { path: "app.js", label: "hareline app script", includes: "function renderFull" },
  { path: "run-stats.js", label: "Run Stats app script", includes: "function parseRunStats" },
  { path: "styles.css", label: "site stylesheet", includes: ".mast {" },
  { path: "data/runs.csv", label: "Runs feed", firstLine: "Run,Date,Venue,Hares,Start,Notes" },
  { path: "data/venues.csv", label: "Venues feed", firstLine: "Venue,Address,Postcode,Website,Phone,Notes" },
  { path: "data/announcements.csv", label: "Announcements feed", firstLine: "Order,Start,End,Announcement,URL" },
  { path: "data/run-stats.csv", label: "Run Stats feed", firstLine: "Name,Grand Total,Year to Date" },
  { path: "data/website-settings.csv", label: "Website Settings feed", firstLine: "Name,Value", includes: "Run stats date" },
  { path: "hareline.ics", label: "calendar feed", includes: "BEGIN:VCALENDAR", alsoIncludes: "BEGIN:VEVENT" },
  { path: "docs/HaresPack.docx", label: "hares' pack" },
  { path: "docs/StandingOrder.docx", label: "standing order" }
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchCheck({ path, label, firstLine, includes, alsoIncludes }) {
  const url = new URL(path, baseUrl);
  let lastError;

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

      const body = await response.text();
      const actualFirstLine = body.split(/\r?\n/, 1)[0].replace(/^\uFEFF/, "");
      if (firstLine && actualFirstLine !== firstLine)
        throw new Error(`unexpected first line: ${actualFirstLine}`);
      if (includes && !body.includes(includes))
        throw new Error(`response does not contain ${JSON.stringify(includes)}`);
      if (alsoIncludes && !body.includes(alsoIncludes))
        throw new Error(`response does not contain ${JSON.stringify(alsoIncludes)}`);

      console.log(`PASS ${label}: ${url}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) {
        console.warn(`Retry ${attempt}/5 for ${label}: ${error.message}`);
        await delay(10000);
      }
    }
  }

  throw new Error(`${label} failed at ${url}: ${lastError.message}`);
}

await Promise.all(checks.map(fetchCheck));
console.log(`Smoke test passed: ${checks.length} deployed-site checks.`);
