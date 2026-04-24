import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildFuse, findBestSchemeMatch, normalizeFundName, SchemeMasterRow } from "./FuzzyMatcher";
import { fetchVerifiedNavFromSources, VerifiedSource } from "./DataFetcher";

export type Fund = {
  fundName: string;
  category?: string;
};

export type NavResult = {
  fundName: string;
  navValue: number | null;
  displayValue: string;
  timestamp: string | null;
  timestampLabel: string;
  schemeCode: string | null;
  isin: string | null;
  source: VerifiedSource | null;
  agreedSources: VerifiedSource[];
  warning: boolean;
  singleSourceOnly: boolean;
  stale: boolean;
  fromCache: boolean;
  error: string | null;
};

const MASTER_CACHE_KEY = "rn_live_nav_master_v1";
const NAV_CACHE_PREFIX = "rn_live_nav_cache_v1:";
const MASTER_TTL_MS = 24 * 60 * 60 * 1000;
const NAV_TTL_MS = 30 * 60 * 1000;

const COMMON_CODE_MAP: Record<string, string> = {
  "sbi large cap": "103504",
  "icici pru large cap": "120503",
  "dsp large cap": "118834",
  "nippon india large cap": "118989",
  "invesco india largecap": "120271",
  "hdfc balanced advantage": "118551",
};

const STATIC_NAV_FALLBACK: Record<string, { nav: number; date: string; schemeCode?: string }> = {
  "sbi large cap": { nav: 95.42, date: "2026-04-22", schemeCode: "103504" },
  "icici pru large cap": { nav: 472.55, date: "2026-04-22", schemeCode: "120503" },
  "dsp large cap": { nav: 321.24, date: "2026-04-22", schemeCode: "118834" },
  "nippon india large cap": { nav: 87.14, date: "2026-04-22", schemeCode: "118989" },
};

function formatCurrency(nav: number | null): string {
  return typeof nav === "number" && Number.isFinite(nav) ? `₹ ${nav.toFixed(2)}` : "--.--";
}

function formatTimestamp(date: string | null): string {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return `As of ${parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}

async function readCache<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // never crash
  }
}

function isFresh(savedAt: number, ttlMs: number): boolean {
  return Date.now() - savedAt <= ttlMs;
}

async function fetchAmfiMaster(): Promise<SchemeMasterRow[]> {
  const cached = await readCache<SchemeMasterRow[]>(MASTER_CACHE_KEY);
  if (cached && isFresh(cached.savedAt, MASTER_TTL_MS)) return cached.data;

  try {
    const response = await fetch("https://www.amfiindia.com/spages/NAVAll.txt");
    const text = await response.text();
    const parsed = text
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
          date: /^\d{2}-\d{2}-\d{4}$/.test(String(date || "").trim())
            ? `${String(date).slice(6, 10)}-${String(date).slice(3, 5)}-${String(date).slice(0, 2)}`
            : null,
        };
      })
      .filter((row) => row.schemeCode && row.schemeName);

    await writeCache(MASTER_CACHE_KEY, parsed);
    return parsed;
  } catch {
    return cached?.data || [];
  }
}

function buildStaticResult(fundName: string): NavResult | null {
  const key = normalizeFundName(fundName);
  const entry = STATIC_NAV_FALLBACK[key];
  if (!entry) return null;
  return {
    fundName,
    navValue: entry.nav,
    displayValue: formatCurrency(entry.nav),
    timestamp: entry.date,
    timestampLabel: formatTimestamp(entry.date),
    schemeCode: entry.schemeCode || COMMON_CODE_MAP[key] || null,
    isin: null,
    source: "static",
    agreedSources: ["static"],
    warning: true,
    singleSourceOnly: true,
    stale: true,
    fromCache: false,
    error: "Using static fallback NAV",
  };
}

export async function discoverSchemeCode(fundName: string): Promise<string | null> {
  try {
    const normalized = normalizeFundName(fundName);
    if (COMMON_CODE_MAP[normalized]) return COMMON_CODE_MAP[normalized];

    const master = await fetchAmfiMaster();
    const fuse = buildFuse(master);
    const match = findBestSchemeMatch(fundName, master, fuse);
    return match?.row.schemeCode || null;
  } catch {
    return null;
  }
}

export async function fetchLiveNav(fundName: string): Promise<NavResult> {
  const cacheKey = `${NAV_CACHE_PREFIX}${normalizeFundName(fundName)}`;

  try {
    const cached = await readCache<NavResult>(cacheKey);
    if (cached && isFresh(cached.savedAt, NAV_TTL_MS)) {
      return { ...cached.data, fromCache: true, stale: false };
    }

    const master = await fetchAmfiMaster();
    const fuse = buildFuse(master);
    const match = findBestSchemeMatch(fundName, master, fuse);
    const schemeCode = match?.row.schemeCode || COMMON_CODE_MAP[normalizeFundName(fundName)] || null;
    const isin = match?.row.isin || null;

    if (!schemeCode) {
      if (cached?.data) return { ...cached.data, fromCache: true, stale: true, warning: true };
      return (
        buildStaticResult(fundName) || {
          fundName,
          navValue: null,
          displayValue: "--.--",
          timestamp: null,
          timestampLabel: "",
          schemeCode: null,
          isin: null,
          source: null,
          agreedSources: [],
          warning: true,
          singleSourceOnly: false,
          stale: true,
          fromCache: false,
          error: "Could not discover scheme code",
        }
      );
    }

    const verified = await fetchVerifiedNavFromSources(schemeCode);
    if (!verified.chosen) {
      if (cached?.data) return { ...cached.data, fromCache: true, stale: true, warning: true };
      return (
        buildStaticResult(fundName) || {
          fundName,
          navValue: null,
          displayValue: "--.--",
          timestamp: null,
          timestampLabel: "",
          schemeCode,
          isin,
          source: null,
          agreedSources: [],
          warning: true,
          singleSourceOnly: false,
          stale: true,
          fromCache: false,
          error: "All sources failed",
        }
      );
    }

    const result: NavResult = {
      fundName,
      navValue: verified.chosen.nav,
      displayValue: formatCurrency(verified.chosen.nav),
      timestamp: verified.chosen.date,
      timestampLabel: formatTimestamp(verified.chosen.date),
      schemeCode,
      isin,
      source: verified.chosen.source,
      agreedSources: verified.agreedSources,
      warning: verified.warning,
      singleSourceOnly: verified.singleSourceOnly,
      stale: false,
      fromCache: false,
      error: null,
    };

    await writeCache(cacheKey, result);
    return result;
  } catch (error: any) {
    const cached = await readCache<NavResult>(cacheKey);
    if (cached?.data) {
      return { ...cached.data, fromCache: true, stale: true, warning: true, error: "Using cached NAV" };
    }
    return (
      buildStaticResult(fundName) || {
        fundName,
        navValue: null,
        displayValue: "--.--",
        timestamp: null,
        timestampLabel: "",
        schemeCode: null,
        isin: null,
        source: null,
        agreedSources: [],
        warning: true,
        singleSourceOnly: false,
        stale: true,
        fromCache: false,
        error: error?.message || "Unexpected NAV error",
      }
    );
  }
}

export async function prefetchNavForFunds(fundList: Fund[]): Promise<Map<string, NavResult>> {
  const results = new Map<string, NavResult>();
  for (const fund of fundList) {
    try {
      const nav = await fetchLiveNav(fund.fundName);
      results.set(fund.fundName, nav);
    } catch {
      // never crash prefetch
    }
  }
  return results;
}

export function useLiveNav(fundName: string) {
  const [nav, setNav] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<VerifiedSource | null>(null);
  const [timestamp, setTimestamp] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLiveNav(fundName);
      if (!mountedRef.current) return;
      setNav(result.navValue);
      setSource(result.source);
      setTimestamp(result.timestamp);
      setError(result.error);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message || "Failed to fetch NAV");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fundName]);

  useEffect(() => {
    run();
  }, [run]);

  return useMemo(
    () => ({
      nav,
      loading,
      error,
      source,
      timestamp,
      refetch: run,
    }),
    [nav, loading, error, source, timestamp, run]
  );
}
