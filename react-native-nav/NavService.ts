import { AppState, AppStateStatus, InteractionManager } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Fuse from "fuse.js";
import { readNavStoreEntry, subscribeNavStoreEntry, writeNavStoreEntry } from "./NavStore";

export type FundInfo = {
  schemeCode: string;
  schemeName: string;
  nav: number | null;
  date: string | null;
  isinGrowth?: string | null;
};

export type NavData = {
  nav: number | null;
  date: string | null;
  schemeCode: string | null;
  source: "amfi" | "mfapi" | "static" | "cache" | "none";
};

export type NavResult = {
  nav: number | null;
  error: string | null;
  source: NavData["source"];
  schemeCode: string | null;
  lastUpdated: string | null;
  isStale: boolean;
  displayValue: string;
  timestampLabel: string;
};

type CachedValue<T> = {
  savedAt: number;
  data: T;
};

type StoreEntry = NavResult & {
  savedAt: number;
};

const AMFI_MASTER_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const MFAPI_SEARCH_URL = "https://api.mfapi.in/mf/search";
const MFAPI_LATEST_URL = (schemeCode: string) => `https://api.mfapi.in/mf/${schemeCode}/latest`;
const MFAPI_HISTORY_URL = (schemeCode: string) => `https://api.mfapi.in/mf/${schemeCode}`;

const AMFI_MASTER_CACHE_KEY = "funalytics_rn_amfi_master_v1";
const SCHEME_CODE_CACHE_KEY = "funalytics_rn_scheme_codes_v1";
const NAV_CACHE_PREFIX = "funalytics_rn_nav_v1:";

const AMFI_MASTER_TTL_MS = 6 * 60 * 60 * 1000;
const SCHEME_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NAV_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_CONCURRENT_PREFETCH = 3;
const TODAY_ISO = new Date().toISOString().slice(0, 10);

const STATIC_NAV_FALLBACK: Record<string, { nav: number; date: string; schemeCode: string }> = {
  "icici prudential large cap": { nav: 472.55, date: TODAY_ISO, schemeCode: "120503" },
  "sbi large cap": { nav: 95.42, date: TODAY_ISO, schemeCode: "103504" },
  "dsp large cap": { nav: 321.24, date: TODAY_ISO, schemeCode: "118834" },
  "nippon india large cap": { nav: 87.14, date: TODAY_ISO, schemeCode: "118989" },
  "invesco india largecap": { nav: 63.72, date: TODAY_ISO, schemeCode: "120271" },
  "mirae asset large cap": { nav: 118.62, date: TODAY_ISO, schemeCode: "118825" },
  "hdfc large cap": { nav: 286.14, date: TODAY_ISO, schemeCode: "119066" },
  "kotak bluechip": { nav: 498.87, date: TODAY_ISO, schemeCode: "120716" },
  "aditya birla sun life frontline equity": { nav: 412.28, date: TODAY_ISO, schemeCode: "119476" },
  "canara robeco bluechip equity": { nav: 58.19, date: TODAY_ISO, schemeCode: "118229" },
  "axis bluechip": { nav: 58.42, date: TODAY_ISO, schemeCode: "120465" },
  "parag parikh flexi cap": { nav: 82.14, date: TODAY_ISO, schemeCode: "122639" },
  "hdfc flexi cap": { nav: 1743.33, date: TODAY_ISO, schemeCode: "119114" },
  "jm flexicap": { nav: 109.67, date: TODAY_ISO, schemeCode: "120266" },
  "icici prudential flexicap": { nav: 89.26, date: TODAY_ISO, schemeCode: "120586" },
  "motilal oswal midcap": { nav: 126.34, date: TODAY_ISO, schemeCode: "128810" },
  "hdfc mid cap opportunities": { nav: 190.12, date: TODAY_ISO, schemeCode: "119064" },
  "nippon india growth": { nav: 3648.77, date: TODAY_ISO, schemeCode: "118778" },
  "sbi small cap": { nav: 198.84, date: TODAY_ISO, schemeCode: "125494" },
  "nippon india small cap": { nav: 191.23, date: TODAY_ISO, schemeCode: "125354" }
};

const CATEGORY_HINTS: Record<string, string[]> = {
  "large cap fund": ["large cap", "bluechip", "top 100"],
  "mid cap fund": ["mid cap", "midcap"],
  "small cap fund": ["small cap", "smallcap"],
  "flexi cap fund": ["flexi cap", "flexicap"],
  "multi cap fund": ["multi cap", "multicap"],
  "balanced advantage fund": ["balanced advantage", "dynamic asset allocation"],
  "balanced advantage": ["balanced advantage", "dynamic asset allocation"],
  "liquid fund": ["liquid"],
  "hybrid fund": ["hybrid", "asset allocation"],
  "short term fund": ["short duration", "short term"],
  "ultra short duration fund": ["ultra short"],
  "large & mid cap fund": ["large mid cap", "large and mid cap", "large midcap"]
};

const STOP_WORDS = new Set([
  "fund",
  "plan",
  "option",
  "growth",
  "regular",
  "reg",
  "direct",
  "dir",
  "idcw",
  "dividend",
  "reinvestment",
  "payout",
  "bonus",
  "g",
  "gp"
]);

const pendingFetches = new Map<string, Promise<NavResult>>();
const categoryPrefetches = new Map<string, Promise<Map<string, NavResult>>>();
const trackedFunds = new Map<string, { category: string; fundName: string }>();
let lastKnownAppState: AppStateStatus = AppState.currentState;
let appStateListenerBound = false;

const runAfterInteractionsAsync = async <T>(task: () => Promise<T> | T): Promise<T> =>
  new Promise((resolve, reject) => {
    InteractionManager.runAfterInteractions(() => {
      Promise.resolve(task()).then(resolve).catch(reject);
    });
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeFundName = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bpru\b/g, "prudential")
    .replace(/\badv\b/g, "advantage")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .join(" ")
    .trim();

const normalizeCategory = (value: string) => normalizeFundName(value);
const navStoreKey = (category: string, fundName: string) => `${normalizeCategory(category)}::${normalizeFundName(fundName)}`;

const looksRegular = (value: string) => /(?:\bregular\b|\breg\b|\(g\))/i.test(String(value || ""));
const looksDirect = (value: string) => /(?:\bdirect\b|\bdir\b)/i.test(String(value || ""));

const toIsoDate = (value?: string | null) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ddmmyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};

const formatCurrency = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value)
    ? `\u20B9 ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "--.--";

const formatTimestamp = (value: string | null) => {
  if (!value) return "";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return `As of ${parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
};

const categoryMatches = (category: string, schemeName: string) => {
  const normalizedCategory = normalizeCategory(category);
  const normalizedName = normalizeFundName(schemeName);
  const hints = CATEGORY_HINTS[normalizedCategory] || [normalizedCategory];
  return hints.some((hint) => normalizedName.includes(normalizeFundName(hint)));
};

const prefixOfFund = (fundName: string) => normalizeFundName(fundName).split(" ").slice(0, 2).join(" ");

const withPlanBias = (inputName: string, candidateName: string, score: number) => {
  let nextScore = score;
  const inputIsRegular = looksRegular(inputName);
  const inputIsDirect = looksDirect(inputName);
  const candidate = String(candidateName || "");

  if (inputIsRegular) {
    if (/regular/i.test(candidate)) nextScore += 0.22;
    if (/growth/i.test(candidate)) nextScore += 0.1;
    if (/direct/i.test(candidate)) nextScore -= 0.22;
  }

  if (inputIsDirect) {
    if (/direct/i.test(candidate)) nextScore += 0.22;
    if (/regular/i.test(candidate)) nextScore -= 0.12;
  }

  if (/idcw|dividend|bonus|payout/i.test(candidate)) nextScore -= 0.15;
  return nextScore;
};

async function readCache<T>(key: string): Promise<CachedValue<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Avoid crashing on cache write failures.
  }
}

const isFresh = (savedAt: number, ttlMs: number) => Date.now() - savedAt <= ttlMs;

const trackFundKey = (category: string, fundName: string) => {
  trackedFunds.set(navStoreKey(category, fundName), { category, fundName });
};

const updateNavStore = (key: string, result: NavResult, savedAt = Date.now()) => {
  writeNavStoreEntry(key, result, savedAt);
};

const readNavStore = (key: string) => readNavStoreEntry<NavResult>(key) as StoreEntry | null;

async function fetchWithRetry(url: string, responseType: "text" | "json" = "json") {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await axios.get(url, { timeout: REQUEST_TIMEOUT_MS, responseType });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

function parseAmfiMaster(text: string): FundInfo[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\d+;/.test(line))
    .map((line) => {
      const [schemeCode, isinGrowth, , schemeName, nav, date] = line.split(";");
      return {
        schemeCode: String(schemeCode || "").trim(),
        schemeName: String(schemeName || "").trim(),
        nav: Number.isFinite(Number(nav)) ? Number(nav) : null,
        date: toIsoDate(date),
        isinGrowth: String(isinGrowth || "").trim() || null
      };
    })
    .filter((row) => row.schemeCode && row.schemeName);
}

function buildFuse(rows: FundInfo[]) {
  return new Fuse(rows, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.32,
    keys: [{ name: "schemeName", weight: 1 }]
  });
}

async function readSchemeCodeCache(): Promise<Record<string, string>> {
  const cached = await readCache<Record<string, string>>(SCHEME_CODE_CACHE_KEY);
  if (cached && isFresh(cached.savedAt, SCHEME_CACHE_TTL_MS)) return cached.data;
  return cached?.data || {};
}

async function writeSchemeCodeCache(nextMap: Record<string, string>) {
  await writeCache(SCHEME_CODE_CACHE_KEY, nextMap);
}

function buildStaticNavResult(fundName: string): NavResult {
  const normalized = normalizeFundName(fundName);
  const fallback = STATIC_NAV_FALLBACK[normalized];
  return {
    nav: fallback?.nav ?? null,
    error: fallback ? "Using static fallback NAV" : "NAV unavailable",
    source: fallback ? "static" : "none",
    schemeCode: fallback?.schemeCode ?? null,
    lastUpdated: fallback?.date ?? null,
    isStale: true,
    displayValue: formatCurrency(fallback?.nav ?? null),
    timestampLabel: formatTimestamp(fallback?.date ?? null)
  };
}

function toNavResult(data: NavData, error: string | null = null): NavResult {
  return {
    nav: data.nav,
    error,
    source: data.source,
    schemeCode: data.schemeCode,
    lastUpdated: data.date,
    isStale: data.date !== TODAY_ISO,
    displayValue: formatCurrency(data.nav),
    timestampLabel: formatTimestamp(data.date)
  };
}

export function getCachedNAVForFund(category: string, fundName: string): NavResult | null {
  trackFundKey(category, fundName);
  const memory = readNavStore(navStoreKey(category, fundName));
  return memory || null;
}

export async function refreshStaleNAVsOnForeground() {
  const tracked = [...trackedFunds.values()];
  const queue = tracked.filter(({ category, fundName }) => {
    const memory = readNavStore(navStoreKey(category, fundName));
    if (!memory) return true;
    return !isFresh(memory.savedAt, NAV_TTL_MS) || memory.lastUpdated !== TODAY_ISO;
  });

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_PREFETCH, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      await sleep(100);
      await refreshNavSilently(next.category, next.fundName);
    }
  });

  await Promise.all(workers);
}

function ensureAppStateListener() {
  if (appStateListenerBound) return;
  appStateListenerBound = true;

  AppState.addEventListener("change", (nextState) => {
    const wasBackgrounded = lastKnownAppState === "background" || lastKnownAppState === "inactive";
    lastKnownAppState = nextState;
    if (wasBackgrounded && nextState === "active") {
      runAfterInteractionsAsync(async () => {
        await refreshStaleNAVsOnForeground();
      }).catch(() => {
        // Keep the last known good NAV visible if refresh fails.
      });
    }
  });
}

function rankCandidate(inputName: string, row: FundInfo, rawScore: number | undefined) {
  let score = 1 - (rawScore ?? 1);
  const normalizedInput = normalizeFundName(inputName);
  const normalizedRow = normalizeFundName(row.schemeName);

  if (normalizedRow.startsWith(prefixOfFund(inputName))) score += 0.24;
  score = withPlanBias(inputName, row.schemeName, score);
  if (normalizedInput === normalizedRow) score += 0.5;
  return score;
}

export async function fetchAndParseAMFIMaster(): Promise<Map<string, FundInfo>> {
  return runAfterInteractionsAsync(async () => {
    const cached = await readCache<FundInfo[]>(AMFI_MASTER_CACHE_KEY);
    if (cached && isFresh(cached.savedAt, AMFI_MASTER_TTL_MS)) {
      return new Map(cached.data.map((row) => [normalizeFundName(row.schemeName), row]));
    }

    try {
      const response = await fetchWithRetry(AMFI_MASTER_URL, "text");
      const rows = parseAmfiMaster(String(response.data || ""));
      await writeCache(AMFI_MASTER_CACHE_KEY, rows);
      return new Map(rows.map((row) => [normalizeFundName(row.schemeName), row]));
    } catch {
      return new Map((cached?.data || []).map((row) => [normalizeFundName(row.schemeName), row]));
    }
  });
}

export async function getNAVByCategoryAndPrefix(category: string, fundNamePrefix: string): Promise<NavData | null> {
  try {
    const master = await fetchAndParseAMFIMaster();
    const rows = [...master.values()].filter((row) => categoryMatches(category, row.schemeName));
    const prefix = normalizeFundName(fundNamePrefix);

    const ranked = rows
      .filter((row) => normalizeFundName(row.schemeName).includes(prefix))
      .map((row) => ({
        row,
        score: withPlanBias(fundNamePrefix, row.schemeName, normalizeFundName(row.schemeName).startsWith(prefix) ? 1.2 : 0.8)
      }))
      .sort((left, right) => right.score - left.score);

    const chosen = ranked[0]?.row || null;
    if (!chosen) return null;

    return {
      nav: chosen.nav,
      date: chosen.date,
      schemeCode: chosen.schemeCode,
      source: "amfi"
    };
  } catch {
    return null;
  }
}

async function discoverSchemeCode(category: string, fundName: string): Promise<FundInfo | null> {
  const cacheKey = navStoreKey(category, fundName);
  const schemeCache = await readSchemeCodeCache();

  if (schemeCache[cacheKey]) {
    const master = await fetchAndParseAMFIMaster();
    const exact = [...master.values()].find((row) => row.schemeCode === schemeCache[cacheKey]);
    if (exact) return exact;
  }

  const master = await fetchAndParseAMFIMaster();
  const masterRows = [...master.values()].filter((row) => categoryMatches(category, row.schemeName));

  const prefix = prefixOfFund(fundName);
  const prefixCandidate = masterRows
    .filter((row) => normalizeFundName(row.schemeName).includes(prefix))
    .map((row) => ({ row, score: withPlanBias(fundName, row.schemeName, normalizeFundName(row.schemeName).startsWith(prefix) ? 1.2 : 0.8) }))
    .sort((left, right) => right.score - left.score)[0]?.row || null;

  if (prefixCandidate) {
    schemeCache[cacheKey] = prefixCandidate.schemeCode;
    await writeSchemeCodeCache(schemeCache);
    return prefixCandidate;
  }

  const fuse = buildFuse(masterRows.length ? masterRows : [...master.values()]);
  const fused = fuse.search(fundName, { limit: 5 })
    .map((entry) => ({ row: entry.item, score: rankCandidate(fundName, entry.item, entry.score) }))
    .sort((left, right) => right.score - left.score)[0]?.row || null;

  if (fused) {
    schemeCache[cacheKey] = fused.schemeCode;
    await writeSchemeCodeCache(schemeCache);
    return fused;
  }

  try {
    const response = await fetchWithRetry(`${MFAPI_SEARCH_URL}?q=${encodeURIComponent(fundName)}`);
    const rows = Array.isArray(response.data) ? response.data : Array.isArray(response.data?.data) ? response.data.data : [];
    const mapped: FundInfo[] = rows
      .map((row: any) => ({
        schemeCode: String(row.schemeCode || row.scheme_code || ""),
        schemeName: String(row.schemeName || row.scheme_name || ""),
        nav: null,
        date: null
      }))
      .filter((row: FundInfo) => row.schemeCode && row.schemeName)
      .filter((row) => !category || categoryMatches(category, row.schemeName) || normalizeFundName(row.schemeName).includes(prefix));

    const searched = mapped
      .map((row) => ({ row, score: withPlanBias(fundName, row.schemeName, normalizeFundName(row.schemeName).startsWith(prefix) ? 1.1 : 0.7) }))
      .sort((left, right) => right.score - left.score)[0]?.row || null;

    if (searched) {
      schemeCache[cacheKey] = searched.schemeCode;
      await writeSchemeCodeCache(schemeCache);
      return searched;
    }
  } catch {
    // Graceful fallback only.
  }

  return null;
}

async function fetchLatestNAVFromMFAPI(schemeCode: string): Promise<NavData | null> {
  try {
    const latestResponse = await fetchWithRetry(MFAPI_LATEST_URL(schemeCode));
    const latest = latestResponse.data?.data || latestResponse.data;
    const latestNav = Number(latest?.nav ?? latest?.latest_nav);
    if (Number.isFinite(latestNav)) {
      return { nav: latestNav, date: toIsoDate(latest?.date), schemeCode, source: "mfapi" };
    }
  } catch {
    // fall through to history
  }

  try {
    const historyResponse = await fetchWithRetry(MFAPI_HISTORY_URL(schemeCode));
    const point = Array.isArray(historyResponse.data?.data) ? historyResponse.data.data[0] : null;
    const nav = Number(point?.nav);
    if (Number.isFinite(nav)) {
      return { nav, date: toIsoDate(point?.date), schemeCode, source: "mfapi" };
    }
  } catch {
    // caller handles final fallback
  }

  return null;
}

async function readNavResultFromAsyncCache(category: string, fundName: string) {
  const cached = await readCache<NavResult>(`${NAV_CACHE_PREFIX}${navStoreKey(category, fundName)}`);
  if (!cached?.data) return null;
  const result = cached.data;
  updateNavStore(navStoreKey(category, fundName), result, cached.savedAt);
  return { savedAt: cached.savedAt, result };
}

async function persistNavResult(category: string, fundName: string, result: NavResult) {
  const key = navStoreKey(category, fundName);
  updateNavStore(key, result);
  await writeCache(`${NAV_CACHE_PREFIX}${key}`, result);
}

async function resolveLiveNav(category: string, fundName: string): Promise<NavResult> {
  const amfiData = await getNAVByCategoryAndPrefix(category, prefixOfFund(fundName));
  if (amfiData?.schemeCode && Number.isFinite(Number(amfiData.nav))) {
    return toNavResult(amfiData, null);
  }

  const discovered = await discoverSchemeCode(category, fundName);
  if (discovered?.schemeCode) {
    const mfapiData = await fetchLatestNAVFromMFAPI(discovered.schemeCode);
    if (mfapiData?.nav !== null && Number.isFinite(Number(mfapiData.nav))) {
      return toNavResult(mfapiData, null);
    }
  }

  return buildStaticNavResult(fundName);
}

export async function getLiveNAVForFund(category: string, fundName: string): Promise<NavResult> {
  const key = navStoreKey(category, fundName);
  trackFundKey(category, fundName);
  ensureAppStateListener();
  if (pendingFetches.has(key)) return pendingFetches.get(key)!;

  const task = (async () => {
    const memory = readNavStore(key);
    if (memory && isFresh(memory.savedAt, NAV_TTL_MS)) {
      return memory;
    }

    const asyncCached = await readNavResultFromAsyncCache(category, fundName);
    if (asyncCached?.result && isFresh(asyncCached.savedAt, NAV_TTL_MS)) {
      return { ...asyncCached.result, source: "cache", isStale: asyncCached.result.lastUpdated !== TODAY_ISO };
    }

    const liveResult = await resolveLiveNav(category, fundName);
    await persistNavResult(category, fundName, liveResult);
    return liveResult;
  })().finally(() => {
    pendingFetches.delete(key);
  });

  pendingFetches.set(key, task);
  return task;
}

async function refreshNavSilently(category: string, fundName: string) {
  try {
    const liveResult = await resolveLiveNav(category, fundName);
    await persistNavResult(category, fundName, liveResult);
    return liveResult;
  } catch {
    return null;
  }
}

export async function prefetchCategoryNAVs(category: string, funds: Array<{ category?: string; fundName: string }>) {
  const normalizedCategory = normalizeCategory(category);
  ensureAppStateListener();
  if (categoryPrefetches.has(normalizedCategory)) {
    return categoryPrefetches.get(normalizedCategory)!;
  }

  const task = runAfterInteractionsAsync(async () => {
    const results = new Map<string, NavResult>();
    const queue = funds.filter((fund) => normalizeCategory(fund.category || category) === normalizedCategory);
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_PREFETCH, queue.length) }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) return;
        trackFundKey(next.category || category, next.fundName);
        await sleep(100);
        const result = await getLiveNAVForFund(next.category || category, next.fundName);
        results.set(navStoreKey(next.category || category, next.fundName), result);
      }
    });

    await Promise.all(workers);
    return results;
  }).finally(() => {
    categoryPrefetches.delete(normalizedCategory);
  });

  categoryPrefetches.set(normalizedCategory, task);
  return task;
}

export async function prefetchAllFundsNAV(funds: Array<{ category: string; fundName: string }>) {
  const results = new Map<string, NavResult>();
  const grouped = new Map<string, Array<{ category: string; fundName: string }>>();
  funds.forEach((fund) => {
    const key = normalizeCategory(fund.category);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(fund);
  });

  for (const [category, categoryFunds] of grouped.entries()) {
    const categoryResults = await prefetchCategoryNAVs(category, categoryFunds);
    categoryResults.forEach((value, key) => results.set(key, value));
  }

  return results;
}

export function useLiveNav(category: string, fundName: string) {
  const key = navStoreKey(category, fundName);
  const mountedRef = useRef(true);
  const [state, setState] = useState(() => {
    const memory = readNavStore(key);
    return {
      nav: memory?.nav ?? null,
      loading: !memory,
      error: memory?.error ?? null,
      source: memory?.source ?? "none",
      lastUpdated: memory?.lastUpdated ?? null,
      isStale: memory ? !isFresh(memory.savedAt, NAV_TTL_MS) || memory.lastUpdated !== TODAY_ISO : false
    };
  });

  useEffect(() => {
    mountedRef.current = true;
    trackFundKey(category, fundName);
    ensureAppStateListener();
    return () => {
      mountedRef.current = false;
    };
  }, [category, fundName]);

  useEffect(() => {
    setState((current) => {
      const memory = readNavStore(key);
      if (!memory) {
        return {
          nav: null,
          loading: true,
          error: null,
          source: "none",
          lastUpdated: null,
          isStale: false
        };
      }
      return {
        nav: memory.nav,
        loading: false,
        error: memory.error,
        source: memory.source,
        lastUpdated: memory.lastUpdated,
        isStale: !isFresh(memory.savedAt, NAV_TTL_MS) || memory.lastUpdated !== TODAY_ISO
      };
    });

    const unsubscribe = subscribeNavStoreEntry(key, () => {
      const memory = readNavStore(key);
      if (!memory || !mountedRef.current) return;
      setState({
        nav: memory.nav,
        loading: false,
        error: memory.error,
        source: memory.source,
        lastUpdated: memory.lastUpdated,
        isStale: !isFresh(memory.savedAt, NAV_TTL_MS) || memory.lastUpdated !== TODAY_ISO
      });
    });

    return unsubscribe;
  }, [key]);

  const load = useCallback(async (force = false) => {
    const memory = readNavStore(key);
    if (memory && !force) {
      setState({
        nav: memory.nav,
        loading: false,
        error: memory.error,
        source: memory.source,
        lastUpdated: memory.lastUpdated,
        isStale: !isFresh(memory.savedAt, NAV_TTL_MS) || memory.lastUpdated !== TODAY_ISO
      });
    } else {
      setState((current) => ({ ...current, loading: !current.nav }));
    }

    const asyncCached = await readNavResultFromAsyncCache(category, fundName);
    if (asyncCached?.result && mountedRef.current) {
      setState({
        nav: asyncCached.result.nav,
        loading: false,
        error: asyncCached.result.error,
        source: "cache",
        lastUpdated: asyncCached.result.lastUpdated,
        isStale: !isFresh(asyncCached.savedAt, NAV_TTL_MS) || asyncCached.result.lastUpdated !== TODAY_ISO
      });
    }

    const shouldRefresh = force
      || !asyncCached?.result
      || !isFresh(asyncCached.savedAt, NAV_TTL_MS)
      || asyncCached.result.lastUpdated !== TODAY_ISO;

    if (!shouldRefresh) return;

    const refreshed = asyncCached?.result
      ? refreshNavSilently(category, fundName)
      : getLiveNAVForFund(category, fundName);

    const result = await refreshed;
    if (!result || !mountedRef.current) return;

    setState({
      nav: result.nav,
      loading: false,
      error: result.error,
      source: result.source,
      lastUpdated: result.lastUpdated,
      isStale: result.lastUpdated !== TODAY_ISO
    });
    console.log("[NavService] NAV resolved", { category, fundName, source: result.source, nav: result.nav, lastUpdated: result.lastUpdated });
  }, [category, fundName, key]);

  useEffect(() => {
    load(false);
  }, [load]);

  return useMemo(
    () => ({
      nav: state.nav,
      loading: state.loading,
      error: state.error,
      source: state.source,
      lastUpdated: state.lastUpdated,
      isStale: state.isStale,
      refetch: () => load(true)
    }),
    [state, load]
  );
}
