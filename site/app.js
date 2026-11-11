/*
 * Barnes H3 hareline renderer.
 * Reads window.HARELINE_CONFIG, loads the Runs and Venues sheets (live Google Sheet first,
 * saved copy second) and renders into the element matching config.mount.
 */
(function () {
  "use strict";
  const C = window.HarelineCore;
  const cfg = Object.assign({
    mount: "[data-hareline]",  // every matching element is filled; data-hareline="home" or "full"
    harelineUrl: "hareline/",  // where the home page's "full hareline" link points
    runsCsvUrl: "",            // Google Sheet "Publish to web" CSV link for the Runs tab
    venuesCsvUrl: "",          // ... and for the Venues tab
    fallbackRunsUrl: "data/runs.csv",
    fallbackVenuesUrl: "data/venues.csv",
    announcementsCsvUrl: "",   // ... and for the Announcements tab (front-page notices)
    fallbackAnnouncementsUrl: "data/announcements.csv",
    hareRequestsCsvUrl: "",    // public CSV of requested run dates and hash names only
    hareRequestsCsv: "",       // sanitized, inline CSV for standalone embeds
    icsUrl: "",                // absolute https URL of hareline.ics; omit to hide the calendar block
    defaultStart: "19:30",
    inline: null               // { runs, venues, announcements } CSV text, for previews
  }, window.HARELINE_CONFIG || {});
  const HARE_REQUESTS_REFRESH_MS = 60 * 1000;

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const HARE_SIGNUP_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScYPS5Kng1Ed1WJfY4t_RS7EJGBrFwSgi-_TzkdEkRZ7toSFg/viewform?usp=preview";
  const HARE_SIGNUP_DATE_ENTRY = "entry.1356401552";

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const textWithLineBreaks = s => esc(s).replace(/\r\n?|\n/g, "<br>");
  const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
  // Escape, turn web addresses into links and keep the line breaks typed in the sheet.
  const annText = s => esc(s)
    .replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, "")}</a>`)
    .replace(/\r\n?|\n/g, "<br>");
  const time = t => `${String(t.h).padStart(2, "0")}:${String(t.min).padStart(2, "0")}`;

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.text();
  }

  async function loadPair(runsUrl, venuesUrl) {
    const [runs, venues] = await Promise.all([fetchText(runsUrl), venuesUrl ? fetchText(venuesUrl) : ""]);
    return { runs, venues };
  }

  // Announcements are optional: a missing tab or failed fetch just means no notices.
  async function loadAnnouncements(live) {
    for (const url of [live && cfg.announcementsCsvUrl, cfg.fallbackAnnouncementsUrl]) {
      if (!url) continue;
      try { return await fetchText(url); } catch (e) { console.warn("Announcements unavailable from " + url, e); }
    }
    return "";
  }

  async function loadHareRequests(live = false) {
    if (!live && cfg.hareRequestsCsv) return parseHareRequests(cfg.hareRequestsCsv, false);
    if (!cfg.hareRequestsCsvUrl) return new Map();
    try {
      return parseHareRequests(await fetchText(cfg.hareRequestsCsvUrl), true);
    } catch (e) {
      console.warn("Hare requests unavailable", e);
      return null;
    }
  }

  function parseHareRequests(csv, live) {
    const rows = C.parseCsv(csv.replace(/(?:\r\n|\r|\n)+$/, "") + "\n__validation__,__validation__");
    const headers = Object.keys(rows[0] || {});
    const dateHeader = headers.find(h => h === "date" || h === "rundate" || h.startsWith("whendoyouwanttosettherun"));
    const nameHeader = headers.find(h => h === "hashname");
    if (!dateHeader || !nameHeader || (live && headers.length !== 2))
      throw new Error("Hare requests feed must expose only the run date and hash name.");
    const requests = new Map();
    rows.forEach(row => {
      const rawDate = row[dateHeader];
      if (rawDate === "__validation__") return;
      const date = C.parseDate(rawDate);
      if (!date) {
        if (rawDate) console.warn(`Ignoring hare request with invalid date: ${rawDate}`);
        return;
      }
      const names = requests.get(date.key) || [];
      const name = (row[nameHeader] || "").trim();
      if (name && !names.includes(name)) names.push(name);
      requests.set(date.key, names);
    });
    return requests;
  }

  async function refreshHareRequests(runs, els) {
    if (!cfg.hareRequestsCsvUrl) return;
    try {
      const requests = await loadHareRequests(true);
      if (!requests) return;
      runs.forEach(run => {
        run.hareRequests = requests.get(run.date.key) || [];
        els.forEach(el => {
          el.querySelectorAll("[data-hare-date]").forEach(node => {
            if (node.getAttribute("data-hare-date") === run.date.key)
              node.innerHTML = haresHtml(run);
          });
        });
      });
    } catch (e) {
      console.warn("Hare request refresh failed", e);
    }
  }

  async function load(wantAnnouncements) {
    if (cfg.inline) return Object.assign({ source: "sample", announcements: "" }, cfg.inline);
    const ann = wantAnnouncements ? loadAnnouncements(true) : Promise.resolve("");
    if (cfg.runsCsvUrl) {
      try { return Object.assign({ source: "live" }, await loadPair(cfg.runsCsvUrl, cfg.venuesCsvUrl), { announcements: await ann }); }
      catch (e) { console.warn("Live hareline unavailable, using saved copy.", e); }
    }
    if (!cfg.fallbackRunsUrl) throw new Error("No hareline source configured");
    return Object.assign({ source: "saved" }, await loadPair(cfg.fallbackRunsUrl, cfg.fallbackVenuesUrl), { announcements: await ann });
  }

  function noticesHtml(notices) {
    if (!notices.length) return "";
    const until = n => n.end ? `Expires ${DAYS[n.end.weekday]} ${n.end.d} ${MONTHS[n.end.m - 1]}` : "";
    return `
      <section class="bh-notices" aria-labelledby="bh-notices-title">
        <h3 class="bh-notices__title" id="bh-notices-title">Announcements</h3>
        <ul class="bh-notices__list">
          ${notices.map(n => `
            <li class="bh-notice">
              <p class="bh-notice__text">${annText(n.text)}</p>
              ${safeUrl(n.url) || until(n) ? `<p class="bh-notice__meta">
                ${safeUrl(n.url) ? `<a class="bh-notice__link" href="${esc(n.url)}" target="_blank" rel="noopener">More details<span aria-hidden="true"> →</span></a>` : ""}
                ${until(n) ? `<span class="bh-notice__until">${esc(until(n))}</span>` : ""}
              </p>` : ""}
            </li>`).join("")}
        </ul>
      </section>`;
  }

  function whenLabel(today, run) {
    const days = C.daysBetween(today, run.date.key);
    if (days === 0) return "Tonight";
    if (days === 1) return "Tomorrow";
    if (days < 7) return "This week";
    if (days < 14) return "Next week";
    return `In ${Math.round(days / 7)} weeks`;
  }

  function hareSignupUrl(run) {
    const url = new URL(HARE_SIGNUP_FORM_URL);
    url.searchParams.set(`${HARE_SIGNUP_DATE_ENTRY}_day`, String(run.date.d));
    url.searchParams.set(`${HARE_SIGNUP_DATE_ENTRY}_month`, String(run.date.m));
    url.searchParams.set(`${HARE_SIGNUP_DATE_ENTRY}_year`, String(run.date.y));
    return url.toString();
  }

  function hareRequestPendingHtml(run) {
    if (!run.hareWanted || !run.hareRequests || !run.hareRequests.length) return "";
    const names = run.hareRequests.map(esc).join(", ");
    return `<span class="bh-chip bh-chip--pending">Hare request pending${names ? `: ${names}` : ""}</span>`;
  }

  function haresHtml(run) {
    const hares = run.hareWanted
      ? `<a class="bh-chip bh-chip--wanted" href="${esc(hareSignupUrl(run))}" target="_blank" rel="noopener" aria-label="I want to be the Hare for the run on ${DAYS[run.date.weekday]} ${run.date.d} ${MONTHS[run.date.m - 1]} ${run.date.y}">I want to be the Hare!</a>`
      : run.hares.map(h => `<span class="bh-hare">${esc(h)}</span>`).join(`<span class="bh-amp" aria-hidden="true">&amp;</span>`);
    return `${hares}${hareRequestPendingHtml(run)}`;
  }

  function venueHtml(run) {
    if (run.venueTba) return `<span class="bh-tba">Venue to be announced</span>`;
    return esc(run.venueName);
  }

  function venueNotesHtml(run) {
    // Only shown alongside run notes; when there are none, venue notes take their place (see runNotes).
    const notes = run.notes && run.venue && run.venue.notes;
    if (!notes) return "";
    const flat = notes.replace(/\s+/g, " ").trim();
    const preview = flat.length > 10 ? `${flat.slice(0, 10).trimEnd()}…` : flat;
    return `<details class="bh-venue-notes"><summary>${esc(preview)}</summary><p>${textWithLineBreaks(notes)}</p></details>`;
  }

  function runNotes(run) {
    return run.notes || (run.venue && run.venue.notes) || "";
  }

  function nextRunHtml(run, today, eyebrow, idSuffix) {
    idSuffix = idSuffix || "";
    const v = run.venue;
    const addr = v ? [v.address, v.postcode].filter(Boolean).join(", ") : "";
    const links = [];
    if (run.mapUrl) links.push(`<a class="bh-btn bh-btn--primary" href="${esc(run.mapUrl)}" target="_blank" rel="noopener">Map...</a>`);
    if (v && safeUrl(v.website)) links.push(`<a class="bh-btn" href="${esc(v.website)}" target="_blank" rel="noopener">Pub website</a>`);
    return `
      <article class="bh-next" aria-labelledby="bh-next-title${idSuffix}">
        <div class="bh-next__date">
          <span class="bh-next__when">${esc(whenLabel(today, run))}</span>
          <span class="bh-next__day">${DAYS[run.date.weekday]}</span>
          <span class="bh-next__num">${run.date.d}</span>
          <span class="bh-next__mon">${MONTHS[run.date.m - 1]}</span>
          <span class="bh-next__time">${time(run.start)}</span>
        </div>
        <div class="bh-next__body">
          <p class="bh-eyebrow">${esc(eyebrow || "Next run")}${run.no ? ` · Run ${esc(run.no)}` : ""}</p>
          <h2 class="bh-next__venue" id="bh-next-title${idSuffix}">${venueHtml(run)}</h2>
          ${addr ? `<p class="bh-next__addr">${esc(addr)}</p>` : ""}
          <div class="bh-next__hares"><span class="bh-label">${run.hares.length > 1 ? "Hares" : "Hare"}</span><span class="bh-hares" data-hare-date="${run.date.key}">${haresHtml(run)}</span></div>
          ${runNotes(run) ? `<p class="bh-next__notes">${textWithLineBreaks(runNotes(run))}</p>` : ""}
          ${venueNotesHtml(run)}
          ${links.length ? `<div class="bh-actions">${links.join("")}</div>` : ""}
        </div>
      </article>`;
  }

  function rowHtml(run, today) {
    const v = run.venue;
    const addr = v ? [v.address, v.postcode].filter(Boolean).join(", ") : "";
    return `
      <li class="bh-row${run.hareWanted ? " is-wanted" : ""}">
        <div class="bh-row__date" aria-label="${DAYS[run.date.weekday]} ${run.date.d} ${MONTHS[run.date.m - 1]} ${run.date.y}">
          <span class="bh-row__num">${run.date.d}</span>
          <span class="bh-row__mon">${MONTHS[run.date.m - 1]}</span>
        </div>
        <div class="bh-row__main">
          <p class="bh-row__meta">${run.no ? `Run ${esc(run.no)} · ` : ""}${DAYS[run.date.weekday]} ${time(run.start)}${today ? ` · ${esc(whenLabel(today, run))}` : ""}</p>
          <p class="bh-row__venue">${run.mapUrl ? `<a href="${esc(run.mapUrl)}" target="_blank" rel="noopener">${venueHtml(run)}</a>` : venueHtml(run)}</p>
          ${addr ? `<p class="bh-row__addr">${esc(addr)}</p>` : ""}
          ${runNotes(run) ? `<p class="bh-row__notes">${textWithLineBreaks(runNotes(run))}</p>` : ""}
          ${venueNotesHtml(run)}
        </div>
        <div class="bh-row__hares" data-hare-date="${run.date.key}">${haresHtml(run)}</div>
      </li>`;
  }

  function calendarHtml() {
    if (!cfg.icsUrl) return "";
    const webcal = cfg.icsUrl.replace(/^https?:/i, "webcal:");
    return `
      <section class="bh-cal" aria-labelledby="bh-cal-title">
        <div>
          <h3 class="bh-cal__title" id="bh-cal-title">Put the hareline in your calendar</h3>
          <p class="bh-cal__text">Subscribe once and new runs, venues and hares appear on their own. In Google Calendar choose <em>Other calendars → From URL</em> and paste this address.</p>
        </div>
        <div class="bh-cal__row">
          <code class="bh-cal__url bh-select" id="bh-ics-url">${esc(cfg.icsUrl)}</code>
          <button type="button" class="bh-btn" id="bh-copy">Copy link</button>
          <a class="bh-btn bh-btn--primary" href="${esc(webcal)}">Subscribe</a>
        </div>
      </section>`;
  }

  function sourceNote(source) {
    return { live: "From the current live runlist", saved: "Showing the last saved copy", sample: "Sample runs from the current site, with example announcements" }[source];
  }

  function renderHome(el, runs, source, notices) {
    const { today, upcoming } = C.splitByToday(runs);
    const [first, second] = upcoming;
    const later = Math.max(upcoming.length - 2, 0);
    el.innerHTML = `
      <div class="bh">
        ${first ? `
          <div class="bh-pair">
            ${nextRunHtml(first, today, "Next run", "-1")}
            ${second ? `<div class="bh-pair__secondary">${nextRunHtml(second, today, "The week after", "-2")}</div>` : ""}
          </div>` : `<p class="bh-empty">No runs are listed yet. Check back soon.</p>`}
        <p class="bh-more">
          <a class="bh-btn" href="${esc(cfg.harelineUrl)}">See the full hareline${later ? ` (${later} more run${later === 1 ? "" : "s"})` : ""}</a>
          <span class="bh-source">${esc(sourceNote(source))}</span>
        </p>
        ${noticesHtml(notices || [])}
      </div>`;
  }

  function renderFull(el, runs, source) {
    const { today, upcoming, past } = C.splitByToday(runs);
    const [next, ...rest] = upcoming;
    el.innerHTML = `
      <div class="bh">
        ${next ? nextRunHtml(next, today, "Next run", "-full") : `<p class="bh-empty">No runs are listed yet. Check back soon.</p>`}
        ${rest.length ? `
          <section class="bh-list" aria-labelledby="bh-list-title">
            <div class="bh-list__head">
              <h3 class="bh-list__title" id="bh-list-title">Coming up</h3>
              <p class="bh-list__count">${rest.length} more run${rest.length === 1 ? "" : "s"} listed</p>
            </div>
            <ol class="bh-rows">${rest.map(r => rowHtml(r, today)).join("")}</ol>
          </section>` : ""}
        ${past.length ? `
          <details class="bh-past">
            <summary>Recent runs (${Math.min(past.length, 12)})</summary>
            <ol class="bh-rows">${past.slice(0, 12).map(r => rowHtml(r, null)).join("")}</ol>
          </details>` : ""}
        ${calendarHtml()}
        <p class="bh-source">${esc(sourceNote(source))}</p>
      </div>`;

    const btn = el.querySelector("#bh-copy");
    if (btn) btn.addEventListener("click", () => {
      const done = () => { btn.textContent = "Copied"; setTimeout(() => (btn.textContent = "Copy link"), 2000); };
      const selectIt = () => {
        const r = document.createRange();
        r.selectNodeContents(el.querySelector("#bh-ics-url"));
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        btn.textContent = "Press Ctrl+C";
      };
      try { navigator.clipboard.writeText(cfg.icsUrl).then(done, selectIt); } catch (e) { selectIt(); }
    });
  }

  async function start() {
    document.querySelectorAll("[data-hareline-config-href]").forEach(el => {
      const key = el.getAttribute("data-hareline-config-href");
      const url = cfg[key];
      if (safeUrl(url)) el.setAttribute("href", url);
      else {
        console.error(`Missing or invalid HARELINE_CONFIG.${key}`);
        el.removeAttribute("href");
      }
    });

    const els = Array.from(document.querySelectorAll(cfg.mount));
    if (!els.length) return;
    try {
      const viewOf = el => (el.getAttribute("data-hareline") || cfg.view || "full").toLowerCase();
      const data = await load(els.some(el => viewOf(el) === "home"));
      const runs = C.buildRuns(C.parseCsv(data.runs), C.parseCsv(data.venues), { defaultStart: cfg.defaultStart });
      const hareRequests = await loadHareRequests();
      runs.forEach(run => { run.hareRequests = hareRequests && hareRequests.get(run.date.key) || []; });
      const notices = C.activeNotices(C.parseCsv(data.announcements));
      els.forEach(el => {
        if (viewOf(el) === "home") renderHome(el, runs, data.source, notices);
        else renderFull(el, runs, data.source);
      });
      if (cfg.hareRequestsCsvUrl) {
        const refresh = () => {
          if (document.visibilityState === "hidden") return;
          return refreshHareRequests(runs, els);
        };
        refresh();
        window.setInterval(refresh, HARE_REQUESTS_REFRESH_MS);
      }
    } catch (e) {
      console.error(e);
      els.forEach(el => { el.innerHTML = `<p class="bh-empty">The hareline couldn't be loaded. Refresh the page, or try again in a few minutes.</p>`; });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
