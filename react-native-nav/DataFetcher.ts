import axios from "axios";

export type VerifiedSource = "amfi-master" | "amfi-history" | "mfapi" | "mfdata" | "cache" | "static";

export type SourceNavResult = {
  source: VerifiedSource;
  nav: number;
  date: string | null;
};

const REQUEST_TIMEOUT_MS = 7000;
const AGREEMENT_TOLERANCE = 0.005;

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const dash = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dash) return `${dash[3]}-${dash[2]}-${dash[1]}`;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

async function safeJson(url: string): Promise<any | null> {
  try {
    const response = await axios.get(url, { timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  } catch {
    return null;
  }
}

async function safeText(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      responseType: "text",
    });
    return String(response.data || "");
  } catch {
    return null;
  }
}

function parseAmfiMaster(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\d+;/.test(line))
    .map((line) => {
      const [schemeCode, isinGrowth, isinReinvestment, schemeName, nav, date] = line.split(";");
      return {
        schemeCode: String(schemeCode || "").trim(),
        isin: String(isinGrowth || isinReinvestment || "").trim() || null,
        schemeName: String(schemeName || "").trim(),
        nav: Number.isFinite(Number(nav)) ? Number(nav) : null,
        date: toIsoDate(date),
      };
    });
}

function formatAmfiHistoryDate(date: Date): string {
  return date
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/ /g, "-");
}

async function fetchAmfiMasterNav(schemeCode: string): Promise<SourceNavResult | null> {
  const text = await safeText("https://www.amfiindia.com/spages/NAVAll.txt");
  if (!text) return null;
  const row = parseAmfiMaster(text).find((item) => item.schemeCode === schemeCode);
  if (!row || !Number.isFinite(Number(row.nav))) return null;
  return {
    source: "amfi-master",
    nav: Number(row.nav),
    date: row.date || null,
  };
}

async function fetchAmfiHistoryNav(schemeCode: string): Promise<SourceNavResult | null> {
  const now = new Date();
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const url =
    `https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx?frmdt=${encodeURIComponent(formatAmfiHistoryDate(from))}` +
    `&todt=${encodeURIComponent(formatAmfiHistoryDate(now))}` +
    `&schemecode=${encodeURIComponent(schemeCode)}`;

  const text = await safeText(url);
  if (!text) return null;
  const row = parseAmfiMaster(text).find((item) => item.schemeCode === schemeCode);
  if (!row || !Number.isFinite(Number(row.nav))) return null;
  return {
    source: "amfi-history",
    nav: Number(row.nav),
    date: row.date || null,
  };
}

async function fetchMfApiNav(schemeCode: string): Promise<SourceNavResult | null> {
  const json = await safeJson(`https://api.mfapi.in/mf/${schemeCode}/latest`);
  const data = json?.data || json;
  const nav = Number(data?.nav ?? data?.latest_nav);
  if (!Number.isFinite(nav)) return null;
  return {
    source: "mfapi",
    nav,
    date: toIsoDate(data?.date),
  };
}

async function fetchMfDataNav(schemeCode: string): Promise<SourceNavResult | null> {
  const json = await safeJson(`https://mfdata.in/api/v1/schemes/${schemeCode}`);
  const data = json?.data || json;
  const nav = Number(data?.nav ?? data?.latest_nav);
  if (!Number.isFinite(nav)) return null;
  return {
    source: "mfdata",
    nav,
    date: toIsoDate(data?.nav_date || data?.date),
  };
}

function agrees(a: number, b: number): boolean {
  const base = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / base <= AGREEMENT_TOLERANCE;
}

export function chooseVerifiedNav(values: SourceNavResult[]): {
  chosen: SourceNavResult | null;
  agreedSources: VerifiedSource[];
  warning: boolean;
  singleSourceOnly: boolean;
} {
  const valid = values.filter((item) => Number.isFinite(Number(item?.nav)));
  if (!valid.length) {
    return { chosen: null, agreedSources: [], warning: true, singleSourceOnly: false };
  }
  if (valid.length === 1) {
    return {
      chosen: valid[0],
      agreedSources: [valid[0].source],
      warning: false,
      singleSourceOnly: true,
    };
  }

  for (let i = 0; i < valid.length; i += 1) {
    const base = valid[i];
    const agreeing = valid.filter((item) => agrees(base.nav, item.nav));
    if (agreeing.length >= 2) {
      const avg = agreeing.reduce((sum, item) => sum + item.nav, 0) / agreeing.length;
      return {
        chosen: {
          ...base,
          nav: Number(avg.toFixed(4)),
        },
        agreedSources: agreeing.map((item) => item.source),
        warning: false,
        singleSourceOnly: false,
      };
    }
  }

  const amfi = valid.find((item) => item.source === "amfi-master" || item.source === "amfi-history");
  return {
    chosen: amfi || valid[0],
    agreedSources: [amfi?.source || valid[0].source],
    warning: true,
    singleSourceOnly: false,
  };
}

export async function fetchVerifiedNavFromSources(schemeCode: string): Promise<{
  values: SourceNavResult[];
  chosen: SourceNavResult | null;
  agreedSources: VerifiedSource[];
  warning: boolean;
  singleSourceOnly: boolean;
}> {
  const values = (
    await Promise.all([
      fetchAmfiMasterNav(schemeCode),
      fetchAmfiHistoryNav(schemeCode),
      fetchMfApiNav(schemeCode),
      fetchMfDataNav(schemeCode),
    ])
  ).filter(Boolean) as SourceNavResult[];

  const decision = chooseVerifiedNav(values);
  return {
    values,
    chosen: decision.chosen,
    agreedSources: decision.agreedSources,
    warning: decision.warning,
    singleSourceOnly: decision.singleSourceOnly,
  };
}
