/*
 * Barnes H3 hareline core.
 * Pure functions shared by the browser page and the build script:
 * CSV parsing, run/venue merging and iCalendar generation. No DOM access here.
 */
(function (global) {
  "use strict";

  const TZ = "Europe/London";
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // RFC 4180-ish CSV parser: handles quoted fields, escaped quotes and newlines inside quotes.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    text = String(text || "").replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }

    const nonEmpty = rows.filter(r => r.some(v => v.trim() !== ""));
    if (!nonEmpty.length) return [];
    const header = nonEmpty[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""));
    return nonEmpty.slice(1).map(r => {
      const o = {};
      header.forEach((h, idx) => { if (h) o[h] = (r[idx] || "").trim(); });
      return o;
    });
  }

  // Accepts 2026-11-04, 04/11/2026 (UK order), 4/11/26, "4 Nov 2026", "Wed 4 November 2026".
  function parseDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return mk(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (m) return mk(fullYear(+m[3]), +m[2], +m[1]);
    m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{2,4})/);
    if (m) {
      const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mon >= 0) return mk(fullYear(+m[3]), mon + 1, +m[1]);
    }
    return null;
  }
  function fullYear(y) { return y < 100 ? 2000 + y : y; }
  function mk(y, mo, d) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // reject 31/02 etc.
    return { y, m: mo, d, key: `${y}-${pad(mo)}-${pad(d)}`, weekday: dt.getUTCDay() };
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function parseTime(str, fallback) {
    const m = String(str || "").match(/(\d{1,2})[:.](\d{2})/);
    return m ? { h: +m[1], min: +m[2] } : fallback;
  }

  // Today's date in London, as yyyy-mm-dd, regardless of the viewer's own time zone.
  function todayKey(now) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now || new Date());
    const get = t => parts.find(p => p.type === t).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function daysBetween(fromKey, toKey) {
    const a = Date.parse(fromKey + "T00:00:00Z"), b = Date.parse(toKey + "T00:00:00Z");
    return Math.round((b - a) / 86400000);
  }

  function splitHares(str) {
    return String(str || "")
      .split(/\s*(?:[,;&\/\n+]|\band\b)\s*/i)
      .map(s => s.trim())
      .filter(Boolean);
  }

  const PLACEHOLDER = /^(tba|tbc|tbd|\?+|-+)$/i;
  const HARE_WANTED = /^(hare\s*wanted|hares?\s*needed|wanted|\?+|-+|tba|tbc)$/i;

  function mapUrl(venue, venueName) {
    const q = venue
      ? [venue.name, venue.address, venue.postcode].filter(Boolean).join(", ")
      : venueName;
    return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : "";
  }

  /*
   * runRows:   objects from the Runs tab   (run, date, venue, hares, start, notes, announcements)
   * venueRows: objects from the Venues tab (venue, address, postcode, website, phone)
   */
  function buildRuns(runRows, venueRows, opts) {
    opts = opts || {};
    const defaultStart = parseTime(opts.defaultStart, { h: 19, min: 30 });
    const venues = new Map();
    (venueRows || []).forEach(v => {
      const name = v.venue || v.name || "";
      if (!name) return;
      venues.set(name.toLowerCase(), {
        name,
        address: v.address || "",
        postcode: (v.postcode || "").toUpperCase(),
        website: v.website || "",
        phone: v.phone || "",
        notes: v.notes || ""
      });
    });

    const runs = [];
    (runRows || []).forEach(r => {
      const date = parseDate(r.date);
      if (!date) return; // ignore blank or malformed rows rather than breaking the page
      const rawVenue = (r.venue || r.location || "").trim();
      const venueTba = !rawVenue || PLACEHOLDER.test(rawVenue);
      const venue = venueTba ? null : (venues.get(rawVenue.toLowerCase()) || null);
      const hares = splitHares(r.hares || r.hare).filter(h => !HARE_WANTED.test(h));
      const start = parseTime(r.start || r.time, defaultStart);
      runs.push({
        no: (r.run || r.runno || r.number || "").replace(/^#/, ""),
        date,
        start,
        venueName: venueTba ? "" : (venue ? venue.name : rawVenue),
        venue,
        venueTba,
        hares,
        hareWanted: hares.length === 0,
        notes: r.notes || "",
        // Free text from the Announcements column; may contain line breaks and links.
        announcement: (r.announcements || r.announcement || "").replace(/\r\n?/g, "\n").trim(),
        mapUrl: venueTba ? "" : mapUrl(venue, rawVenue)
      });
    });
    runs.sort((a, b) => a.date.key.localeCompare(b.date.key));
    return runs;
  }

  function splitByToday(runs, now) {
    const today = todayKey(now);
    return {
      today,
      upcoming: runs.filter(r => r.date.key >= today),
      past: runs.filter(r => r.date.key < today).reverse()
    };
  }

  // ---------- iCalendar ----------
  function icsEscape(s) {
    return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }
  // Fold lines at 75 octets as RFC 5545 requires (counting UTF-8 bytes, not characters).
  function fold(line) {
    const out = [];
    let cur = "", bytes = 0;
    for (const ch of line) {
      const b = unescape(encodeURIComponent(ch)).length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  }
  function localStamp(date, t) {
    return `${date.y}${pad(date.m)}${pad(date.d)}T${pad(t.h)}${pad(t.min)}00`;
  }
  function addMinutes(date, t, mins) {
    const dt = new Date(Date.UTC(date.y, date.m - 1, date.d, t.h, t.min + mins));
    return {
      date: { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() },
      t: { h: dt.getUTCHours(), min: dt.getUTCMinutes() }
    };
  }

  function toIcs(runs, opts) {
    opts = opts || {};
    const calName = opts.calName || "Barnes H3 hareline";
    const domain = opts.uidDomain || "barnesh3.com";
    const duration = opts.durationMins || 150;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const L = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Barnes H3//Hareline//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "X-WR-CALNAME:" + icsEscape(calName), "X-WR-TIMEZONE:" + TZ, "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
      "X-PUBLISHED-TTL:PT12H",
      // Europe/London rules: GMT in winter, BST from last Sunday in March to last Sunday in October.
      "BEGIN:VTIMEZONE", "TZID:Europe/London",
      "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "TZNAME:BST", "DTSTART:19700329T010000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
      "BEGIN:STANDARD", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "DTSTART:19701025T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
      "END:VTIMEZONE"
    ];
    runs.forEach(r => {
      const end = addMinutes(r.date, r.start, duration);
      const title = `Barnes H3${r.no ? " run " + r.no : ""}` + (r.venueName ? ` – ${r.venueName}` : " – venue TBA");
      const desc = [
        r.hares.length ? "Hares: " + r.hares.join(" & ") : "Hare wanted!",
        r.announcement,
        r.notes,
        r.mapUrl ? "Map: " + r.mapUrl : "",
        opts.siteUrl ? "Hareline: " + opts.siteUrl : ""
      ].filter(Boolean).join("\n");
      const loc = r.venue ? [r.venue.name, r.venue.address, r.venue.postcode].filter(Boolean).join(", ") : (r.venueName || "TBA");
      L.push(
        "BEGIN:VEVENT",
        `UID:run-${r.no || r.date.key}@${domain}`,
        "DTSTAMP:" + stamp,
        "DTSTART;TZID=Europe/London:" + localStamp(r.date, r.start),
        "DTEND;TZID=Europe/London:" + localStamp(end.date, end.t),
        "SUMMARY:" + icsEscape(title),
        "LOCATION:" + icsEscape(loc),
        "DESCRIPTION:" + icsEscape(desc),
        r.mapUrl ? "URL:" + r.mapUrl : null,
        "END:VEVENT"
      );
    });
    L.push("END:VCALENDAR");
    return L.filter(l => l !== null).map(fold).join("\r\n") + "\r\n";
  }

  /*
   * Rows from the Announcements tab: start, end, announcement (or text), url, order.
   * Returns notices live today in London, ordered by explicit order then newest start.
   * Blank start = live now; blank end = no end date.
   * Rows with a date that can't be read are skipped, so a typo hides one notice rather than breaking the page.
   */
  function activeNotices(rows, now) {
    const today = todayKey(now);
    return (rows || [])
      .map(r => {
        const text = (r.announcement || r.announcements || r.text || r.message || "").replace(/\r\n?/g, "\n").trim();
        const startRaw = (r.start || r.startdate || r.from || "").trim();
        const endRaw = (r.end || r.enddate || r.until || r.to || "").trim();
        const orderRaw = (r.order || "").trim();
        const parsedOrder = orderRaw ? Number(orderRaw) : null;
        const start = startRaw ? parseDate(startRaw) : null;
        const end = endRaw ? parseDate(endRaw) : null;
        const bad = (startRaw && !start) || (endRaw && !end);
        return { text, url: (r.url || r.link || "").trim(), start, end, order: Number.isFinite(parsedOrder) ? parsedOrder : null, bad };
      })
      .filter(n => n.text && !n.bad)
      .filter(n => (!n.start || n.start.key <= today) && (!n.end || n.end.key >= today))
      .sort((a, b) => {
        if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
        if (a.order !== b.order) return a.order === null ? 1 : -1;
        return (b.start ? b.start.key : "").localeCompare(a.start ? a.start.key : "");
      });
  }

  global.HarelineCore = {
    parseCsv, parseDate, parseTime, todayKey, daysBetween, splitHares, buildRuns, splitByToday, toIcs, mapUrl, activeNotices
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
