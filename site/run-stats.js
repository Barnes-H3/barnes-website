(function () {
  "use strict";

  const cfg = window.HARELINE_CONFIG || {};
  const tableBody = document.getElementById("run-stats-rows");
  const search = document.getElementById("run-stats-search");
  const status = document.getElementById("run-stats-status");
  if (!tableBody || !search || !status) return;

  const headers = Array.from(document.querySelectorAll("[data-sort]"));
  const numberFormat = new Intl.NumberFormat("en-GB");
  let rows = [];
  let sortKey = "name";
  let sortDirection = 1;
  let statsDate = "";
  let settingsLoaded = false;
  let statsLoadError = false;

  function parseCount(value, rowNumber, column) {
    const raw = String(value || "").replace(/,/g, "").trim();
    const count = raw === "" ? 0 : Number(raw);
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error(`Invalid ${column} value in Run Stats row ${rowNumber}.`);
    return count;
  }

  function parseRunStats(csv) {
    const records = window.HarelineCore.parseCsv(csv);
    if (!records.length) return [];
    if (!["name", "grandtotal", "yeartodate"].every(key => Object.hasOwn(records[0], key)))
      throw new Error("Run Stats CSV must include Name, Grand Total, and Year to Date columns.");

    return records.flatMap((record, index) => {
      const name = (record.name || "").trim();
      if (!name) return [];
      const rowNumber = index + 2;
      return [{
        name,
        grandtotal: parseCount(record.grandtotal, rowNumber, "Grand Total"),
        yeartodate: parseCount(record.yeartodate, rowNumber, "Year to Date")
      }];
    });
  }

  function parseWebsiteSettings(csv) {
    const records = window.HarelineCore.parseCsv(csv);
    if (!records.length) return "";
    if (!Object.hasOwn(records[0], "name") || !Object.hasOwn(records[0], "value"))
      throw new Error("Website Settings CSV must include Name and Value columns.");
    return (records.find(row => (row.name || "").trim().toLocaleLowerCase() === "run stats date")?.value || "").trim();
  }

  function showRunStatsDate(value) {
    const ukDate = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const isoDate = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    statsDate = ukDate
      ? `${Number(ukDate[1])}/${Number(ukDate[2])}/${ukDate[3]}`
      : isoDate ? `${Number(isoDate[3])}/${Number(isoDate[2])}/${isoDate[1]}` : String(value || "").trim();
    settingsLoaded = true;
    render();
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = rows
      .filter(row => row.name.toLocaleLowerCase().includes(query))
      .sort((a, b) => {
        const order = sortKey === "name"
          ? a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" })
          : a[sortKey] - b[sortKey];
        return order * sortDirection;
      });

    tableBody.replaceChildren(...visible.map(row => {
      const tr = document.createElement("tr");
      [row.name, numberFormat.format(row.grandtotal), numberFormat.format(row.yeartodate)]
        .forEach((value, index) => {
          const cell = document.createElement(index ? "td" : "th");
          if (!index) cell.scope = "row";
          cell.textContent = value;
          tr.append(cell);
        });
      return tr;
    }));

    const countLabel = statsLoadError
      ? "Run statistics could not be loaded. Please try again later."
      : visible.length
      ? `${visible.length} ${visible.length === 1 ? "Hasher" : "Hashers"}${query ? " found" : ""}`
      : query ? "No hashers match your search." : "No run statistics are available.";
    const dateLabel = statsDate
      ? ` - stats to ${statsDate}`
      : settingsLoaded ? " - stats date unavailable" : "";
    status.textContent = countLabel + dateLabel;

    headers.forEach(button => {
      const th = button.closest("th");
      th.setAttribute("aria-sort", button.dataset.sort === sortKey
        ? (sortDirection > 0 ? "ascending" : "descending")
        : "none");
    });
  }

  async function fetchText(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.text();
  }

  async function load() {
    if (typeof cfg.inlineRunStats === "string") {
      rows = parseRunStats(cfg.inlineRunStats);
      render();
      showRunStatsDate(parseWebsiteSettings(cfg.inlineWebsiteSettings || ""));
      return;
    }

    const settingsPromise = loadWebsiteSettings();
    let lastError;
    for (const url of [cfg.runStatsCsvUrl, cfg.fallbackRunStatsUrl].filter(Boolean)) {
      try {
        rows = parseRunStats(await fetchText(url));
        render();
        await settingsPromise;
        return;
      } catch (error) {
        lastError = error;
        console.warn(`Run Stats unavailable from ${url}`, error);
      }
    }
    console.error("Could not load Run Stats.", lastError);
    statsLoadError = true;
    render();
    await settingsPromise;
  }

  async function loadWebsiteSettings() {
    if (typeof cfg.inlineWebsiteSettings === "string") {
      showRunStatsDate(parseWebsiteSettings(cfg.inlineWebsiteSettings));
      return;
    }

    let lastError;
    for (const url of [cfg.websiteSettingsCsvUrl, cfg.fallbackWebsiteSettingsUrl].filter(Boolean)) {
      try {
        showRunStatsDate(parseWebsiteSettings(await fetchText(url)));
        return;
      } catch (error) {
        lastError = error;
        console.warn(`Website Settings unavailable from ${url}`, error);
      }
    }
    console.error("Could not load Website Settings.", lastError);
    showRunStatsDate("");
  }

  search.addEventListener("input", render);
  headers.forEach(button => button.addEventListener("click", () => {
    const nextKey = button.dataset.sort;
    if (sortKey === nextKey) sortDirection *= -1;
    else {
      sortKey = nextKey;
      sortDirection = nextKey === "name" ? 1 : -1;
    }
    render();
  }));
  load();
})();
