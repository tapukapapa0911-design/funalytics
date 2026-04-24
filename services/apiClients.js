window.LiveDataVersion = window.LiveDataVersion || {};

window.LiveDataVersion.apiClients = (() => {
  const schema = window.LiveDataVersion.schema;

  // ─── Fetch helpers ────────────────────────────────────────────────────────

  const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    } finally {
      window.clearTimeout(timer);
    }
  };

  const fetchJson = async (url, options = {}) => {
    const response = await fetchWithTimeout(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
  };

  const fetchText = async (url, options = {}) => {
    const response = await fetchWithTimeout(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.text();
  };

  const fetchBackendFunds = async (baseUrl) => {
    if (!baseUrl) return null;
    const cleanBase = String(baseUrl).replace(/\/+$/, "");
    const firstPage = await fetchJson(`${cleanBase}/funds?limit=5000&page=1`);
    const items = Array.isArray(firstPage?.items) ? [...firstPage.items] : [];
    const total = Number(firstPage?.total || items.length);
    const limit = Number(firstPage?.limit || 5000);
    const pageCount = Math.max(1, Math.ceil(total / Math.max(limit, 1)));

    for (let page = 2; page <= pageCount; page += 1) {
      try {
        const nextPage = await fetchJson(`${cleanBase}/funds?limit=5000&page=${page}`);
        if (Array.isArray(nextPage?.items) && nextPage.items.length) {
          items.push(...nextPage.items);
        }
      } catch {
        break;
      }
    }

    return items.length ? items : null;
  };

  const parseDisplayDate = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
      const [day, month, year] = raw.split("-");
      return `${year}-${month}-${day}`;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toISOString().slice(0, 10);
  };

  const toNavPayload = (nav, date, source) => ({
    nav: Number(nav),
    date: parseDisplayDate(date),
    source
  });

  // ─── AMFI NAVAll.txt ──────────────────────────────────────────────────────
  // URL: https://www.amfiindia.com/spages/NAVAll.txt
  // Returns latest NAV for all schemes + ISIN codes used for RapidAPI lookup

  const parseAmfiLatestNav = (text) => text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\d+;/.test(line))
    .map((line) => {
      const [schemeCode, isinGrowth, isinReinvestment, schemeName, nav, date] = line.split(";");
      return {
        schemeCode: String(schemeCode || "").trim(),
        isinGrowth: String(isinGrowth || "").trim(),
        isinReinvestment: String(isinReinvestment || "").trim(),
        schemeName: String(schemeName || "").trim(),
        nav: Number(nav),
        date: String(date || "").trim()
      };
    })
    .filter((row) => row.schemeCode && row.schemeName && Number.isFinite(row.nav));

  const fetchAmfiLatestNav = async () => {
    const text = await fetchText(schema.liveSources[0].url);
    return parseAmfiLatestNav(text);
  };

  const fetchMfApiLatest = async (schemeCode) => {
    const url = `https://api.mfapi.in/mf/${schemeCode}/latest`;
    const json = await fetchJson(url);
    const latest = json?.data || json;
    const nav = Number(latest?.nav ?? latest?.latest_nav ?? latest?.latestNav);
    const date = latest?.date ?? latest?.nav_date ?? latest?.latestDate;
    if (!Number.isFinite(nav)) throw new Error(`mfapi latest invalid for ${schemeCode}`);
    return toNavPayload(nav, date, "mfapi");
  };

  const fetchMfDataScheme = async (schemeCode) => {
    const url = `https://mfdata.in/api/v1/schemes/${schemeCode}`;
    const json = await fetchJson(url);
    const candidate = Array.isArray(json?.data) ? json.data[0] : (json?.data || json);
    const nav = Number(
      candidate?.nav ??
      candidate?.latest_nav ??
      candidate?.latestNav ??
      candidate?.scheme_nav ??
      candidate?.current_nav
    );
    const date = candidate?.date ?? candidate?.nav_date ?? candidate?.latestDate ?? candidate?.updated_at;
    if (!Number.isFinite(nav)) throw new Error(`mfdata invalid for ${schemeCode}`);
    return toNavPayload(nav, date, "mfdata");
  };

  const fetchMfDataSearch = async (query) => {
    const url = `https://mfdata.in/api/v1/search?q=${encodeURIComponent(query)}`;
    const json = await fetchJson(url);
    return Array.isArray(json?.data) ? json.data : [];
  };

  const fetchMfApiSearch = async (query) => {
    const url = `https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`;
    const json = await fetchJson(url);
    return Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
  };

  const fetchAmfiHistoryLatest = async (schemeCode) => {
    const now = new Date();
    const from = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const format = (date) => {
      const day = String(date.getDate()).padStart(2, "0");
      const month = date.toLocaleString("en-US", { month: "short" });
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    };
    const url = `${schema.liveSources[2]?.url || "https://portal.amfiindia.com/NavHistoryReport_Rpt_Po.aspx"}?frmdt=${encodeURIComponent(format(from))}&todt=${encodeURIComponent(format(now))}&schemecode=${encodeURIComponent(schemeCode)}`;
    const text = await fetchText(url);
    const rows = parseAmfiLatestNav(text);
    const row = rows.find((item) => String(item.schemeCode) === String(schemeCode)) || rows[0];
    if (!row || !Number.isFinite(Number(row.nav))) throw new Error(`amfi history invalid for ${schemeCode}`);
    return toNavPayload(row.nav, row.date, "amfi-history");
  };

  const fetchIsinNav = async (isin, apiKey) => {
    if (!isin || !apiKey) return null;

    const attempts = [
      {
        url: `https://latest-mutual-fund-nav.p.rapidapi.com/fetchLatestNAV?Isin=${encodeURIComponent(isin)}`,
        options: {
          headers: {
            "x-rapidapi-key": apiKey,
            "x-rapidapi-host": "latest-mutual-fund-nav.p.rapidapi.com"
          }
        }
      },
      {
        url: `https://api.api-ninjas.com/v1/mutualfund?isin=${encodeURIComponent(isin)}`,
        options: {
          headers: {
            "X-Api-Key": apiKey
          }
        }
      }
    ];

    for (const attempt of attempts) {
      try {
        const json = await fetchJson(attempt.url, attempt.options);
        const candidate = Array.isArray(json) ? json[0] : (json?.data || json);
        const nav = Number(
          candidate?.nav ??
          candidate?.latest_nav ??
          candidate?.latestNav ??
          candidate?.latestNavValue ??
          candidate?.current_nav
        );
        const date = candidate?.date ?? candidate?.nav_date ?? candidate?.latestDate ?? candidate?.updated_at;
        if (Number.isFinite(nav)) return toNavPayload(nav, date, "isin");
      } catch {
        // try next endpoint
      }
    }

    return null;
  };

  // ─── mfapi.in NAV History ─────────────────────────────────────────────────
  // URL: https://api.mfapi.in/mf/{schemeCode}
  // Free, no API key, CORS-friendly, full historical NAV
  // Dates in DD-MM-YYYY format, data sorted newest-first

  const parseMfApiDate = (dateStr) => {
    // "22-04-2026" → "2026-04-22"
    const [day, month, year] = String(dateStr || "").split("-");
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const fetchMfApiHistory = async (schemeCode) => {
    const url = `https://api.mfapi.in/mf/${schemeCode}`;
    const json = await fetchJson(url);
    if (!Array.isArray(json?.data)) throw new Error(`mfapi: invalid response for ${schemeCode}`);
    // Convert to ascending (oldest first) with ISO dates
    return json.data
      .map((item) => ({ date: parseMfApiDate(item.date), nav: Number(item.nav) }))
      .filter((item) => Number.isFinite(item.nav) && item.date.length === 10)
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  // ─── RapidAPI PE/PB ───────────────────────────────────────────────────────
  // URL: https://latest-mutual-fund-nav.p.rapidapi.com/fetchMutualFundDetailsByISIN
  // Requires RAPIDAPI_KEY. Falls back to backup if unavailable.
  // Returns portfolioPE and portfolioPB for equity funds.

  const fetchPePbByIsin = async (isin, rapidApiKey) => {
    if (!rapidApiKey || !isin || isin === "-") return null;
    const url = `https://latest-mutual-fund-nav.p.rapidapi.com/fetchMutualFundDetailsByISIN?Isin=${isin}`;
    const json = await fetchJson(url, {
      headers: {
        "x-rapidapi-key": rapidApiKey,
        "x-rapidapi-host": "latest-mutual-fund-nav.p.rapidapi.com"
      }
    });
    const data = Array.isArray(json) ? json[0] : json;
    if (!data) return null;
    const pe = Number(data.portfolioPE ?? data.PE ?? data.pe);
    const pb = Number(data.portfolioPB ?? data.PB ?? data.pb);
    return {
      pe: Number.isFinite(pe) && pe > 0 ? pe : null,
      pb: Number.isFinite(pb) && pb > 0 ? pb : null
    };
  };

  return {
    fetchBackendFunds,
    fetchAmfiLatestNav,
    fetchAmfiHistoryLatest,
    fetchMfApiLatest,
    fetchMfApiSearch,
    fetchMfDataScheme,
    fetchMfDataSearch,
    fetchIsinNav,
    fetchMfApiHistory,
    fetchPePbByIsin,
    parseAmfiLatestNav,
    parseDisplayDate
  };
})();
