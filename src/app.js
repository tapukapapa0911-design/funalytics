let appData = loadStoredData() || window.FUND_APP_DATA;

const APP_NAME = "Funalytics";
const APP_DESCRIPTION = "Funalytics is a smart mutual fund analytics platform that transforms Excel-based data into clear rankings, performance insights, and decision-ready dashboards.";

const state = {
  theme: localStorage.getItem("fundpulse-live-theme-v1") || "dark",
  category: "Large Cap Fund",
  tab: "dashboard",
  sort: "rank",
  horizon: "oneYear",
  dataset: "new",
  period: "1Y",
  fundView: localStorage.getItem("fundpulse-live-fund-view") || "all",
  query: "",
  pickerTarget: "category",
  selectedFundId: null,
  compareFundAId: null,
  compareFundBId: null,
  topInsightOpen: false
};

let deferredInstallPrompt = null;
let canShowInstall = false;
let isAppReady = false;
const INSTALL_FLOW_KEY = "live_install_flow_done";
const ONBOARDING_KEY = "funalytics_live_onboarding_done";
const LEGACY_ONBOARDING_KEY = "live_onboarding_done";
const BROWSER_INSTALL_CTA_KEY = "live_browser_install_cta_enabled";
const FAVORITES_KEY = "fundpulse-live-favorite-funds";
const UPDATE_BANNER_DISMISSED_KEY = "live-funalytics-update-banner-dismissed";
const UPDATE_VERSION_KEY = "live-funalytics-app-version";
const UPDATE_CHECK_URL = "./update.json";
const UPDATE_CHECK_INTERVAL = 10 * 60 * 1000;
const ONBOARDING_STEPS = 5;
const LAST_ONBOARDING_INDEX = 4;
let currentOnboardingIndex = 0;
let previousHorizonValue = state.horizon;
const MODAL_ANIMATION_MS = 220;
const MODAL_HISTORY_KEY = "__funalyticsModal";
let modalHistoryArmed = false;
let modalHistoryNavigating = false;
let serverUpdateVersion = null;
let updateCheckTimer = null;
const deferredRenderJobs = new Map();
let controlStateFrame = 0;
let searchInputTimer = 0;
const APP_DATA_STORAGE_KEY = "fundpulse-live-data-v8";
const UI_IDLE_APPLY_MS = 900;
const DAILY_SYNC_DATE_KEY = "fundpulse-daily-sync-date";
const DAILY_SYNC_COMPLETED_KEY = "fundpulse-daily-sync-completed";
const DAILY_SYNC_AT_KEY = "fundpulse-daily-synced-at";
const DAILY_SYNC_FACT_ORDER_KEY = "fundpulse-daily-sync-fact-order";
const DAILY_SYNC_FACT_CURSOR_KEY = "fundpulse-daily-sync-fact-cursor";
const DAILY_SYNC_MIN_VISIBLE_MS = 1500;
const DAILY_SYNC_FACT_INTERVAL_MS = 2800;
const DAILY_SYNC_FACTS = [
  "NAV updates daily based on market closing prices.",
  "SIP helps reduce risk through rupee cost averaging.",
  "Diversification reduces overall portfolio risk.",
  "Equity funds often reward patience over long horizons.",
  "Debt funds are generally steadier than pure equity funds.",
  "Expense ratio quietly shapes long-term compounding.",
  "Large-cap funds usually swing less than small-cap funds.",
  "Asset allocation matters as much as fund selection.",
  "A lower drawdown can improve staying power in volatile markets.",
  "Sharpe ratio compares return earned for each unit of risk.",
  "Sortino ratio focuses only on downside volatility.",
  "A consistent fund can outperform a flashy one over time.",
  "Rebalancing helps keep portfolio risk aligned to goals.",
  "Index funds usually shine when costs stay low.",
  "Rolling returns reveal consistency better than point returns.",
  "Market dips can improve SIP averaging opportunities.",
  "Longer holding periods can smooth short-term noise.",
  "Fund category matters when comparing performance fairly.",
  "Risk-adjusted returns often matter more than raw returns.",
  "Cash flow discipline is part of investment performance too.",
  "Portfolio overlap can quietly reduce diversification benefits.",
  "A strong process often outlasts short-term outperformance."
];

const markUserInteraction = () => {
  window.__fundpulseLastInteractionAt = Date.now();
};

const runWhenUiIdle = (task, delay = 180) => {
  const attempt = () => {
    const lastInteractionAt = Number(window.__fundpulseLastInteractionAt || 0);
    const elapsed = Date.now() - lastInteractionAt;
    if (lastInteractionAt && elapsed < UI_IDLE_APPLY_MS) {
      window.setTimeout(attempt, delay);
      return;
    }
    task();
  };
  attempt();
};

window.__fundpulseRunWhenUiIdle = runWhenUiIdle;
window.__fundpulseMarkInteraction = markUserInteraction;

const isoDateValue = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 2000) return 0;
  return parsed.getTime();
};

const navDateOf = (data) => {
  const explicitDate = String(data?.liveNavDate || data?.latestDate || "").trim();
  if (isoDateValue(explicitDate)) return explicitDate;

  const fundDates = Array.isArray(data?.funds)
    ? data.funds
        .map((fund) => String(fund?.liveNavDate || fund?.latestNavDate || fund?.navDate || "").trim())
        .filter((date) => isoDateValue(date))
    : [];

  if (!fundDates.length) return "";
  return fundDates.sort((a, b) => isoDateValue(b) - isoDateValue(a))[0] || "";
};

const cancelDeferredRenderJob = (key) => {
  const active = deferredRenderJobs.get(key);
  if (!active) return;
  if (active.type === "idle" && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(active.id);
  } else {
    window.clearTimeout(active.id);
  }
  deferredRenderJobs.delete(key);
};

const scheduleDeferredRenderJob = (key, task, timeout = 60) => {
  cancelDeferredRenderJob(key);
  const runner = () => {
    deferredRenderJobs.delete(key);
    task();
  };
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(runner, { timeout });
    deferredRenderJobs.set(key, { type: "idle", id });
    return;
  }
  const id = window.setTimeout(runner, 16);
  deferredRenderJobs.set(key, { type: "timeout", id });
};

const $ = (id) => document.getElementById(id);
const modalRoot = () => $("global-modal");
const modalContent = () => $("global-modal-content");
const modalCard = () => $("global-modal-card");
const modalBackdrop = () => $("global-modal-backdrop");
const onboardingEl = () => $("onboarding");
const onboardContainerEl = () => $("onboardContainer");
const splashScreenEl = () => $("splashScreen");
const profileInstallButtonEl = () => $("installAppBtn");
const dailySyncModalEl = () => $("dailySyncModal");
const dailySyncProgressBarEl = () => $("dailySyncProgressBar");
const dailySyncProgressTextEl = () => $("dailySyncProgressText");
const dailySyncDescriptionEl = () => $("dailySyncDescription");
const dailySyncFactEl = () => $("dailySyncFact");

const ensureHashRoute = () => {
  if (!window.location.hash) {
    window.location.hash = "#dashboard";
  }
};

const routeFromHash = () => {
  const raw = String(window.location.hash || "").replace(/^#/, "").trim();
  return ["dashboard", "funds", "insights", "compare", "planner", "profile", "portfolio", "saved-plans"].includes(raw) ? raw : "dashboard";
};

const localTodayIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function loadStoredData() {
  try {
    const raw = localStorage.getItem("fundpulse-live-data-v8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const dataset = parsed?.data && Array.isArray(parsed.data?.funds) ? parsed.data : parsed;
    if (!dataset || !Array.isArray(dataset.funds) || !Array.isArray(dataset.summaries)) return null;
    const liveDate = String(dataset.liveNavDate || "").trim();
    if (liveDate && (!/^\d{4}-\d{2}-\d{2}$/.test(liveDate) || Number(liveDate.slice(0, 4)) < 2000)) return null;
    return dataset;
  } catch (error) {
    console.warn("Funalytics cached live data read skipped", error);
    return null;
  }
}

const saveStoredData = (data) => {
  if (!data || !Array.isArray(data.funds) || !Array.isArray(data.summaries)) return;
  localStorage.setItem(APP_DATA_STORAGE_KEY, JSON.stringify({
    savedAt: Date.now(),
    data
  }));
};

function selectPreferredData(stored, injected) {
  if (!stored) return injected;
  if (!injected) return stored;

  const storedDate = isoDateValue(navDateOf(stored));
  const injectedDate = isoDateValue(navDateOf(injected));
  if (injectedDate > storedDate) return injected;
  if (storedDate > injectedDate) return stored;

  const storedFunds = Array.isArray(stored.funds) ? stored.funds.length : 0;
  const injectedFunds = Array.isArray(injected.funds) ? injected.funds.length : 0;
  return injectedFunds >= storedFunds ? injected : stored;
}

function standardizeFundName(value) {
  return String(value || "")
    .replace(/\bIcici\b/g, "ICICI")
    .replace(/\bPru\b/g, "Prudential");
}

function extractVolatility(fund) {
  const direct = Number(fund?.volatility);
  if (Number.isFinite(direct)) return direct;

  const sources = [
    ...(fund?.parameterBreakdown || []),
    ...((fund?.analysisHistory?.old || []).flatMap((point) => point?.parameters || [])),
    ...((fund?.analysisHistory?.new || []).flatMap((point) => point?.parameters || []))
  ];
  const match = sources.find((item) => item?.metric === "volatility" && Number.isFinite(Number(item?.value)));
  return match ? Number(match.value) : null;
}

function normalizeAppData(data) {
  if (!data || !Array.isArray(data.funds) || !Array.isArray(data.summaries)) return data;
  const duplicateFundName = "Parag Parikh Elss Tax Saver Fund Tax Saver Fund (G)";
  return {
    ...data,
    summaries: data.summaries.map((summary) => ({
      ...summary,
      topPerformer: standardizeFundName(summary.topPerformer)
    })),
    funds: data.funds
      .filter((fund) => String(fund?.fundName || "") !== duplicateFundName)
      .map((fund) => ({
      ...fund,
      fundName: standardizeFundName(fund.fundName),
      rawFundName: standardizeFundName(fund.rawFundName),
      volatility: extractVolatility(fund),
      analysisHistory: {
        old: (fund?.analysisHistory?.old || []).map((point) => ({
          ...point,
          parameters: (point?.parameters || []).map((parameter) => ({ ...parameter }))
        })),
        new: (fund?.analysisHistory?.new || []).map((point) => ({
          ...point,
          parameters: (point?.parameters || []).map((parameter) => ({ ...parameter }))
        }))
      },
      history: (fund?.history || []).map((point) => ({ ...point })),
      parameterBreakdown: (fund?.parameterBreakdown || []).map((parameter) => ({ ...parameter }))
    }))
  };
}

appData = selectPreferredData(loadStoredData(), window.FUND_APP_DATA);
appData = normalizeAppData(appData);

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const formatPct = (value, digits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(digits)}%`;
};

const safeIsoDate = (value) => {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number(raw.slice(0, 4)) >= 2000 ? raw : "";
};

const formatDateValue = (iso) => {
  const safeIso = safeIsoDate(iso);
  if (!safeIso) return "Latest NAV syncing";
  const [year, month, day] = safeIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "Latest NAV syncing";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

const navDateSuffix = () => appData?.liveNavStatus === "last-available" ? " (last available)" : "";
const formatDate = (iso) => iso ? `Data as of ${formatDateValue(iso)}${navDateSuffix()}` : "Latest NAV syncing";
const hasLiveNav = (fund) => Number.isFinite(Number(fund?.latestNav)) && Boolean(String(fund?.liveNavDate || "").trim());
const LAST_SYNC_ATTEMPT_KEY = "lastSyncAttempt";
const LAST_SYNC_WINDOW_KEY = "lastSyncWindow";
const MORNING_SYNC_HOUR = 6;
const SYNC_BADGE_SESSION_PREFIX = "fundpulse-sync-badge-seen:";

const currentSyncWindow = () => new Date().getHours() >= MORNING_SYNC_HOUR ? "morning" : "midnight";
const currentSyncWindowLabel = () => currentSyncWindow() === "morning" ? "6 AM check" : "12 AM check";
const currentSyncWindowToken = () => `${localTodayIso()}:${currentSyncWindow()}`;

let heroSyncNotice = null;
let heroSyncNoticeTimer = 0;
let dailySyncVisible = false;
let dailySyncStartedAt = 0;
let dailySyncProgress = 10;
let dailySyncProgressTimer = 0;
let dailySyncFactTimer = 0;
let dailySyncFactIndex = 0;

const renderHeroSyncBadge = () => {
  const badge = $("heroSyncBadge");
  if (!badge) return;
  if (!heroSyncNotice?.text) {
    badge.hidden = true;
    badge.classList.remove("is-visible", "is-fading");
    badge.textContent = "";
    return;
  }
  badge.hidden = false;
  badge.textContent = heroSyncNotice.text;
  badge.dataset.tone = heroSyncNotice.tone || "good";
  badge.classList.remove("is-fading");
  badge.classList.add("is-visible");
};

const clearHeroSyncNotice = () => {
  if (heroSyncNoticeTimer) {
    window.clearTimeout(heroSyncNoticeTimer);
    heroSyncNoticeTimer = 0;
  }
  heroSyncNotice = null;
  renderHeroSyncBadge();
};

const setHeroSyncNotice = (text, tone = "good", duration = 3400) => {
  const badge = $("heroSyncBadge");
  heroSyncNotice = { text, tone };
  renderHeroSyncBadge();
  if (!badge) return;
  if (heroSyncNoticeTimer) {
    window.clearTimeout(heroSyncNoticeTimer);
  }
  heroSyncNoticeTimer = window.setTimeout(() => {
    badge.classList.add("is-fading");
    window.setTimeout(() => {
      clearHeroSyncNotice();
    }, 260);
  }, duration);
};

const maybeShowWindowSyncNotice = () => {
  const liveDate = safeIsoDate(appData?.liveNavDate);
  if (!liveDate || appData?.liveNavStatus === "syncing") return;
  let lastWindow = "";
  try {
    lastWindow = String(localStorage.getItem(LAST_SYNC_WINDOW_KEY) || "").trim();
  } catch {}
  const currentToken = currentSyncWindowToken();
  if (lastWindow !== currentToken) return;
  const sessionKey = `${SYNC_BADGE_SESSION_PREFIX}${currentToken}`;
  try {
    if (sessionStorage.getItem(sessionKey) === "true") return;
    sessionStorage.setItem(sessionKey, "true");
  } catch {}
  setHeroSyncNotice(`Updated in ${currentSyncWindowLabel()}`, "good", 2800);
};

const hasCompletedDailySyncToday = () => {
  try {
    return localStorage.getItem(DAILY_SYNC_DATE_KEY) === localTodayIso()
      && localStorage.getItem(DAILY_SYNC_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
};

const updateDailySyncProgressUi = () => {
  const bar = dailySyncProgressBarEl();
  const label = dailySyncProgressTextEl();
  if (bar) bar.style.width = `${Math.max(10, Math.min(100, dailySyncProgress))}%`;
  if (label) label.textContent = `${Math.round(Math.max(10, Math.min(100, dailySyncProgress)))}%`;
};

const setDailySyncDescription = (text) => {
  const el = dailySyncDescriptionEl();
  if (el) el.textContent = text;
};

const readFactSequence = () => {
  try {
    const order = JSON.parse(localStorage.getItem(DAILY_SYNC_FACT_ORDER_KEY) || "[]");
    const cursor = Number(localStorage.getItem(DAILY_SYNC_FACT_CURSOR_KEY) || 0);
    if (Array.isArray(order) && order.length === DAILY_SYNC_FACTS.length && Number.isFinite(cursor)) {
      return { order, cursor };
    }
  } catch {}
  const order = DAILY_SYNC_FACTS.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  try {
    localStorage.setItem(DAILY_SYNC_FACT_ORDER_KEY, JSON.stringify(order));
    localStorage.setItem(DAILY_SYNC_FACT_CURSOR_KEY, "0");
  } catch {}
  return { order, cursor: 0 };
};

const nextDailySyncFact = () => {
  const { order, cursor } = readFactSequence();
  const safeCursor = Math.max(0, Math.min(cursor, order.length - 1));
  const factIndex = order[safeCursor] ?? 0;
  const nextCursor = safeCursor + 1;
  try {
    if (nextCursor >= order.length) {
      localStorage.removeItem(DAILY_SYNC_FACT_ORDER_KEY);
      localStorage.removeItem(DAILY_SYNC_FACT_CURSOR_KEY);
    } else {
      localStorage.setItem(DAILY_SYNC_FACT_CURSOR_KEY, String(nextCursor));
    }
  } catch {}
  return DAILY_SYNC_FACTS[factIndex] || DAILY_SYNC_FACTS[0];
};

const setDailySyncFact = (text) => {
  const el = dailySyncFactEl();
  if (!el) return;
  el.classList.remove("is-visible");
  window.setTimeout(() => {
    el.textContent = text;
    el.classList.add("is-visible");
  }, 90);
};

const stopDailySyncTimers = () => {
  if (dailySyncProgressTimer) {
    window.clearInterval(dailySyncProgressTimer);
    dailySyncProgressTimer = 0;
  }
  if (dailySyncFactTimer) {
    window.clearInterval(dailySyncFactTimer);
    dailySyncFactTimer = 0;
  }
};

const hideDailySyncModal = () => {
  stopDailySyncTimers();
  const modal = dailySyncModalEl();
  if (!modal) return;
  modal.classList.remove("is-visible");
  modal.setAttribute("aria-hidden", "true");
  window.setTimeout(() => {
    modal.hidden = true;
    dailySyncVisible = false;
    releaseInteractionLocks();
  }, 240);
};

const completeDailySyncModal = async ({ success = true } = {}) => {
  const remaining = Math.max(0, DAILY_SYNC_MIN_VISIBLE_MS - (Date.now() - dailySyncStartedAt));
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
  dailySyncProgress = 100;
  updateDailySyncProgressUi();
  if (success) {
    setDailySyncDescription("You're all up to date");
  } else {
    setDailySyncDescription("Sync failed, using last available data");
  }
  await new Promise((resolve) => window.setTimeout(resolve, success ? 1100 : 1400));
  hideDailySyncModal();
};

const startDailySyncProgressSimulation = () => {
  stopDailySyncTimers();
  dailySyncProgressTimer = window.setInterval(() => {
    if (dailySyncProgress >= 85) return;
    const bump = dailySyncProgress < 45 ? 5 : dailySyncProgress < 70 ? 3 : 1.2;
    dailySyncProgress = Math.min(85, dailySyncProgress + bump);
    updateDailySyncProgressUi();
  }, 240);

  dailySyncFactTimer = window.setInterval(() => {
    setDailySyncFact(nextDailySyncFact());
  }, DAILY_SYNC_FACT_INTERVAL_MS);
};

const showDailySyncModal = () => {
  if (dailySyncVisible || hasCompletedDailySyncToday()) return;
  const modal = dailySyncModalEl();
  if (!modal) return;
  dailySyncVisible = true;
  dailySyncStartedAt = Date.now();
  dailySyncProgress = 10;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  setDailySyncDescription("Gathering current NAV values for your assets.");
  updateDailySyncProgressUi();
  const fact = nextDailySyncFact();
  const factEl = dailySyncFactEl();
  if (factEl) {
    factEl.textContent = fact;
    factEl.classList.add("is-visible");
  }
  window.requestAnimationFrame(() => {
    modal.classList.add("is-visible");
  });
  startDailySyncProgressSimulation();
};

const handleDailySyncLifecycle = async (event) => {
  const phase = event.detail?.phase;
  if (phase === "started") {
    try {
      localStorage.setItem(DAILY_SYNC_DATE_KEY, localTodayIso());
      localStorage.setItem(DAILY_SYNC_COMPLETED_KEY, "false");
    } catch {}
    showDailySyncModal();
    return;
  }
  if (phase === "completed") {
    try {
      localStorage.setItem(DAILY_SYNC_DATE_KEY, localTodayIso());
      localStorage.setItem(DAILY_SYNC_COMPLETED_KEY, "true");
      localStorage.setItem(DAILY_SYNC_AT_KEY, new Date().toISOString());
    } catch {}
    if (dailySyncVisible) {
      await completeDailySyncModal({ success: true });
    }
    setHeroSyncNotice(`Updated in ${currentSyncWindowLabel()}`, "good", 2400);
    return;
  }
  if (phase === "failed") {
    try {
      localStorage.setItem(DAILY_SYNC_COMPLETED_KEY, "false");
    } catch {}
    if (dailySyncVisible) {
      await completeDailySyncModal({ success: false });
    }
  }
};

const releaseInteractionLocks = () => {
  const global = modalRoot();
  const globalModalOpen = Boolean(global && !global.hidden && global.classList.contains("open"));
  if (!globalModalOpen) {
    document.body.classList.remove("modal-open");
  }

  const daily = dailySyncModalEl();
  if (daily && !dailySyncVisible && !daily.classList.contains("is-visible")) {
    daily.hidden = true;
    daily.setAttribute("aria-hidden", "true");
  }

  const onboarding = onboardingEl();
  if (onboarding && typeof hasSeenOnboarding === "function" && hasSeenOnboarding()) {
    onboarding.hidden = true;
    onboarding.style.display = "none";
    onboarding.setAttribute("aria-hidden", "true");
  }
};

const scoreLabel = (value) => String(Math.round(value || 0));
const scoreOf = (fund) => fund?.dashboardScore ?? 0;
const consistencyOf = (fund) => {
  const raw = Number(fund?.consistency);
  return Number.isFinite(raw) ? raw : null;
};
const volatilityOf = (fund) => {
  const raw = Number(fund?.volatility);
  if (!Number.isFinite(raw)) return null;
  return Math.abs(raw) <= 1 ? raw * 100 : raw;
};
const riskOf = (fund) => {
  const volatility = volatilityOf(fund);
  if (volatility !== null) return volatility;
  const fallback = Number(fund?.consistency);
  return Number.isFinite(fallback) ? fallback : null;
};
const riskLabel = (fund) => {
  const value = riskOf(fund);
  return value === null ? "—" : `${value.toFixed(1)} vol`;
};
const riskBandLabel = (fund) => {
  const value = riskOf(fund);
  if (value === null) return "—";
  if (value <= 4) return "Low";
  if (value <= 8) return "Moderate";
  return "High";
};
const consistencyBandLabel = (fund) => {
  const value = consistencyOf(fund);
  if (value === null) return "—";
  if (value >= 8) return "High";
  if (value >= 5) return "Medium";
  return "Low";
};
const horizonLabel = () => ({ oneYear: "1Y", threeYear: "3Y", fiveYear: "5Y" })[state.horizon];
const periodCount = () => ({ "1M": 2, "3M": 3, "6M": 4, "1Y": 5 })[state.period] || 5;
const datasetLabel = () => state.dataset === "new" ? "Latest dataset" : "Historical dataset";
const trendTone = (trend) => trend === "Improving" ? "trend-up" : (trend === "Declining" ? "trend-down" : "trend-stable");
const trendMarkup = (trend) => `<span class="trend-chip ${trendTone(trend)}"><i aria-hidden="true"></i><span>${escapeHtml(trend)}</span></span>`;

const metricAt = (point) => {
  const value = point?.[state.horizon];
  return typeof value === "number" ? value * 100 : null;
};

const allCategoryFunds = () => appData.funds
  .filter((fund) => fund.category === state.category)
  .sort((a, b) => (a.rank || 999) - (b.rank || 999));

const allFunds = () => [...(appData?.funds || [])];

const loadFavoriteFundIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
};

const saveFavoriteFundIds = (ids) => {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
};

const favoriteFundIds = () => loadFavoriteFundIds();

const isFavoriteFund = (fundId) => favoriteFundIds().has(fundId);

const toggleFavoriteFund = (fundId) => {
  const ids = favoriteFundIds();
  if (ids.has(fundId)) ids.delete(fundId);
  else ids.add(fundId);
  saveFavoriteFundIds(ids);
};

const horizonValueOf = (fund) => {
  const value = fund?.[state.horizon];
  return typeof value === "number" ? value : null;
};
const fundMetricReturnLabel = (fund) => {
  const horizonValue = horizonValueOf(fund);
  if (horizonValue !== null) return formatPct(horizonValue);
  if (typeof fund?.threeYear === "number") return formatPct(fund.threeYear);
  if (typeof fund?.oneYear === "number") return formatPct(fund.oneYear);
  if (typeof fund?.fiveYear === "number") return formatPct(fund.fiveYear);
  return "—";
};

const horizonRankMap = (funds = allCategoryFunds()) => {
  const ordered = [...funds].sort((a, b) => {
    const aValue = horizonValueOf(a);
    const bValue = horizonValueOf(b);
    if (aValue === null && bValue === null) return (a.fundOrder || 999999) - (b.fundOrder || 999999);
    if (aValue === null) return 1;
    if (bValue === null) return -1;
    if (bValue !== aValue) return bValue - aValue;
    return (a.fundOrder || 999999) - (b.fundOrder || 999999);
  });
  return new Map(ordered.map((fund, index) => [fund.id, index + 1]));
};

const consistencyRankMap = (funds = allCategoryFunds()) => {
  const ordered = [...funds].sort((a, b) => {
    const aValue = consistencyOf(a);
    const bValue = consistencyOf(b);
    if (aValue === null && bValue === null) return (a.fundOrder || 999999) - (b.fundOrder || 999999);
    if (aValue === null) return 1;
    if (bValue === null) return -1;
    if (aValue !== bValue) return bValue - aValue;
    return (a.fundOrder || 999999) - (b.fundOrder || 999999);
  });
  return new Map(ordered.map((fund, index) => [fund.id, index + 1]));
};

const currentRankingMap = (funds = allCategoryFunds()) => {
  if (state.sort === "return") return horizonRankMap(funds);
  if (state.sort === "consistency") return consistencyRankMap(funds);
  return new Map(funds.map((fund) => [fund.id, fund.rank || 999]));
};

const summaryForCategory = () => appData.summaries.find((item) => item.category === state.category) || appData.summaries[0];

const latestNavDateForFunds = (funds = []) => {
  return funds
    .filter((fund) => hasLiveNav(fund))
    .map((fund) => String(fund?.liveNavDate || "").trim())
    .filter((candidate) => candidate && isoDateValue(candidate))
    .sort((left, right) => isoDateValue(left) - isoDateValue(right))
    .at(-1) || null;
};

const latestNavDateForCategory = (category = state.category) => {
  const funds = allFunds().filter((fund) => fund.category === category);
  const fundDate = latestNavDateForFunds(funds);
  if (fundDate) return fundDate;
  if (appData?.liveNavStatus === "syncing") return null;
  return appData?.liveNavDate || appData?.latestDate || null;
};

const historyFor = (fund) => {
  const datasetHistory = fund?.analysisHistory?.[state.dataset] || [];
  return (datasetHistory.length ? datasetHistory : (fund?.history || [])).slice(-periodCount());
};

const mergedFundHistory = (fund) => {
  const buckets = new Map();
  const collect = (points = [], source = "unknown") => {
    points.forEach((point, index) => {
      const rawDate = point?.date || `${source}-${index}`;
      const key = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : `${source}-${index}`;
      const existing = buckets.get(key) || { date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null, score: null, oneYear: null, threeYear: null, fiveYear: null, source };
      buckets.set(key, {
        ...existing,
        date: existing.date || (/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null),
        score: point?.score ?? existing.score ?? scoreOf(fund),
        oneYear: typeof point?.oneYear === "number" ? point.oneYear : existing.oneYear ?? fund?.oneYear ?? null,
        threeYear: typeof point?.threeYear === "number" ? point.threeYear : existing.threeYear ?? fund?.threeYear ?? null,
        fiveYear: typeof point?.fiveYear === "number" ? point.fiveYear : existing.fiveYear ?? fund?.fiveYear ?? null,
        sharpe: point?.sharpe ?? existing.sharpe ?? fund?.sharpe ?? null,
        parameters: point?.parameters || existing.parameters || fund?.parameterBreakdown || []
      });
    });
  };

  collect(fund?.analysisHistory?.old, "historical");
  collect(fund?.history, "combined");
  collect(fund?.analysisHistory?.new, "latest");

  const merged = [...buckets.values()].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (merged.length) return merged;

  return [{
    date: fund?.latestDate || null,
    score: scoreOf(fund),
    oneYear: fund?.oneYear ?? null,
    threeYear: fund?.threeYear ?? null,
    fiveYear: fund?.fiveYear ?? null,
    parameters: fund?.parameterBreakdown || []
  }];
};

const chartHistoryFor = (fund) => {
  const mergedHistory = mergedFundHistory(fund);
  const datedBuckets = new Map();

  const addPoint = (key, label, point) => {
    const value = metricAt(point);
    if (value === null) return;
    datedBuckets.set(key, { key, label, value });
  };

  mergedHistory.forEach((point, index) => {
    const rawDate = point?.date;
    const key = rawDate ? `date:${rawDate}` : `fallback:${index}`;
    const label = rawDate ? rawDate.slice(5) : `P${index + 1}`;
    addPoint(key, label, point);
  });

  const datedSeries = [...datedBuckets.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (datedSeries.length >= 2) return datedSeries.slice(-periodCount());

  const fallbackSeries = [];
  const oldPoint = fund?.analysisHistory?.old?.at(-1);
  const combinedPoint = fund?.history?.at(-1);
  const newPoint = fund?.analysisHistory?.new?.at(-1);

  if (oldPoint && metricAt(oldPoint) !== null) fallbackSeries.push({ key: "source:historical", label: "Historical", value: metricAt(oldPoint) });
  if (combinedPoint && metricAt(combinedPoint) !== null) fallbackSeries.push({ key: "source:combined", label: "Combined", value: metricAt(combinedPoint) });
  if (newPoint && metricAt(newPoint) !== null) fallbackSeries.push({ key: "source:latest", label: "Latest", value: metricAt(newPoint) });

  return fallbackSeries.slice(-Math.max(2, Math.min(periodCount(), fallbackSeries.length)));
};

const selectedFund = () => {
  const funds = allCategoryFunds();
  if (!funds.length) return null;
  const found = funds.find((fund) => fund.id === state.selectedFundId);
  if (found) return found;
  state.selectedFundId = funds[0].id;
  return funds[0];
};

const ensureCompareFunds = () => {
  const funds = allCategoryFunds();
  const ids = new Set(funds.map((fund) => fund.id));
  if (!ids.has(state.compareFundAId)) state.compareFundAId = funds[0]?.id || null;
  if (!ids.has(state.compareFundBId)) state.compareFundBId = funds[1]?.id || funds[0]?.id || null;
};

const compareFunds = () => {
  ensureCompareFunds();
  const funds = allCategoryFunds();
  return {
    fundA: funds.find((fund) => fund.id === state.compareFundAId) || funds[0] || null,
    fundB: funds.find((fund) => fund.id === state.compareFundBId) || funds[1] || funds[0] || null
  };
};

const visibleFunds = () => {
  const categoryFunds = allCategoryFunds();
  const displayRanks = currentRankingMap(categoryFunds);
  const query = state.query.trim().toLowerCase();
  const selectedCategory = state.category;
  const favorites = favoriteFundIds();
  const sourceFunds = query
    ? allFunds()
    : state.fundView === "favorites"
      ? allFunds().filter((fund) => favorites.has(fund.id))
      : categoryFunds;
  let funds = sourceFunds.filter((fund) => {
    if (state.fundView === "favorites" && !favorites.has(fund.id)) return false;
    if (!query) return true;
    return fund.fundName.toLowerCase().includes(query);
  });

  const sorters = {
    rank: (a, b) => {
      if (scoreOf(b) !== scoreOf(a)) return scoreOf(b) - scoreOf(a);
      return (a.rank || 999) - (b.rank || 999);
    },
    return: (a, b) => {
      const aValue = horizonValueOf(a);
      const bValue = horizonValueOf(b);
      if (aValue === null && bValue === null) return (displayRanks.get(a.id) || 999) - (displayRanks.get(b.id) || 999);
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (bValue !== aValue) return bValue - aValue;
      return (displayRanks.get(a.id) || 999) - (displayRanks.get(b.id) || 999);
    },
    consistency: (a, b) => {
      const aValue = consistencyOf(a);
      const bValue = consistencyOf(b);
      if (aValue === null && bValue === null) return (displayRanks.get(a.id) || 999) - (displayRanks.get(b.id) || 999);
      if (aValue === null) return 1;
      if (bValue === null) return -1;
      if (aValue !== bValue) return bValue - aValue;
      return (displayRanks.get(a.id) || 999) - (displayRanks.get(b.id) || 999);
    }
  };

  const queryRank = (fund) => {
    if (!query) return 0;
    const name = fund.fundName.toLowerCase();
    if (name === query) return 0;
    if (name.startsWith(query)) return 1;
    const index = name.indexOf(query);
    return index === -1 ? 999 : 2 + index;
  };

  const categoryPriority = (fund) => (fund.category === selectedCategory ? 0 : 1);

  funds = [...funds]
    .sort((a, b) => {
      if (query) {
        const queryDiff = queryRank(a) - queryRank(b);
        if (queryDiff) return queryDiff;
      }
      const categoryDiff = categoryPriority(a) - categoryPriority(b);
      if (categoryDiff) return categoryDiff;
      return sorters[state.sort](a, b);
    })
    .map((fund) => ({ ...fund, displayRank: displayRanks.get(fund.id) || fund.rank || 999 }));
  return query || state.fundView === "favorites" ? funds.slice(0, 60) : funds.slice(0, 10);
};

const renderFallback = (targetId, title, body) => {
  const target = $(targetId);
  if (!target) return;
  target.innerHTML = `<article class="insight-card fallback-card"><p class="eyebrow">Unavailable</p><h3>${escapeHtml(title)}</h3><p class="story-copy">${escapeHtml(body)}</p></article>`;
};

const resetModalState = () => {
  const card = modalCard();
  const backdrop = modalBackdrop();
  if (card) {
    card.style.transform = "";
    card.style.opacity = "";
  }
  if (backdrop) {
    backdrop.style.opacity = "";
  }
};

const openGlobalModal = (html, options = {}) => {
  const root = modalRoot();
  const content = modalContent();
  const card = modalCard();
  if (!root || !content || !card) return false;
  resetModalState();
  root.classList.remove("open");
  root.hidden = false;
  root.setAttribute("aria-hidden", "false");
  content.innerHTML = "";
  card.dataset.modalKind = options.kind || "default";
  card.dataset.modalSize = options.size || "default";
  content.innerHTML = html;
  if (!options.skipHistory && !modalHistoryArmed) {
    window.history.pushState({ ...(window.history.state || {}), [MODAL_HISTORY_KEY]: true }, "");
    modalHistoryArmed = true;
  }
  requestAnimationFrame(() => root.classList.add("open"));
  document.body.classList.add("modal-open");
  return true;
};

const closeGlobalModal = (immediate = false, options = {}) => {
  const root = modalRoot();
  const content = modalContent();
  const card = modalCard();
  if (!root || !content || !card) return;
  if (!options.fromHistory && modalHistoryArmed && !modalHistoryNavigating) {
    modalHistoryNavigating = true;
    window.history.back();
    return;
  }
  root.classList.remove("open");
  root.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  card.dataset.modalKind = "default";
  card.dataset.modalSize = "default";
  const finalize = () => {
    if (!root.classList.contains("open")) {
      resetModalState();
      content.innerHTML = "";
      root.hidden = true;
      modalHistoryArmed = false;
      modalHistoryNavigating = false;
    }
  };
  if (immediate) {
    finalize();
    return;
  }
  setTimeout(finalize, MODAL_ANIMATION_MS);
};

const bottomNavEl = () => document.querySelector(".bottom-nav");

const optionValue = (type) => {
  if (type === "tab") return state.tab;
  if (type === "horizon") return state.horizon;
  if (type === "sort") return state.sort;
  if (type === "period") return state.period;
  return null;
};

const applyOptionValue = (type, value, direction = 0) => {
  if (!value || optionValue(type) === value) return;
  if (type === "tab") {
    switchTab(value, direction);
    return;
  }
  if (type === "horizon") {
    previousHorizonValue = state.horizon;
    state.horizon = value;
    renderCurrentView();
    syncControlState();
    return;
  }
  if (type === "sort") {
    state.sort = value;
    renderFunds();
    syncControlState();
    return;
  }
  if (type === "period") {
    state.period = value;
    renderCurrentView();
    syncControlState();
  }
};

const bindFundCardInteractions = (card, openCard) => {
  card.addEventListener("click", openCard);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCard();
    }
  });
};

const methodologyMarkup = () => `
  <div class="detail-hero">
    <p class="eyebrow">Methodology</p>
    <h2>Insights &amp; Methodology</h2>
    <p class="muted">A complete guide to how ${APP_NAME} reads the workbook, builds rankings, explains category performance, and turns the data into usable insights.</p>
  </div>
  <div class="accordion-list">
    <details open><summary>Overview</summary><ul><li>${APP_NAME} is a data-driven mutual fund dashboard built on top of an Excel workbook backend.</li><li>The dashboard score is a quick category-relative quality read for each fund.</li><li>The app is designed to help users compare performance, ranking, and stability more clearly.</li></ul></details>
    <details><summary>Key Factors</summary><ul><li>Returns across <strong>1Y</strong>, <strong>3Y</strong>, and <strong>5Y</strong> windows.</li><li><strong>Consistency</strong> through volatility and steadiness of results.</li><li><strong>Relative performance</strong> inside the selected category.</li></ul></details>
    <details><summary>Scoring Logic</summary><ul><li>The workbook converts the available metrics into a combined weighted score.</li><li>Category filtering and ranking happen inside the workbook-backed data pipeline.</li><li>Higher score means a stronger overall read for the current category framework.</li></ul></details>
    <details><summary>Interpretation Guide</summary><ul><li><strong>70+</strong> -> Strong</li><li><strong>50-70</strong> -> Average</li><li><strong>Below 50</strong> -> Weak</li></ul></details>
    <details><summary>Ranking Methodology</summary><ul><li>Funds are ranked within their category rather than across the full market.</li><li>The app mirrors workbook-style filtering and sorting so ranks update with category changes.</li><li>Rank helps explain who leads the category right now.</li></ul></details>
    <details><summary>Consistency &amp; Risk</summary><ul><li>Consistency reflects how stable a fund has been across the visible return history.</li><li>Risk is inferred from volatility and variation in outcomes.</li><li>A high-return fund with weak consistency may still deserve caution.</li></ul></details>
    <details><summary>Data &amp; Excel Logic</summary><ul><li>Data comes from workbook-backed sheets including historical analysis, latest analysis, and processed dashboard data.</li><li>The app mirrors Excel-style <strong>FILTER</strong>, <strong>UNIQUE</strong>, and <strong>SORT</strong> behavior.</li><li>Users can upload an updated workbook extract to refresh the analysis.</li></ul></details>
    <details><summary>AI Insights</summary><ul><li>Insight cards translate ranking, trend, and category comparisons into simple human-readable takeaways.</li><li>They are meant to support interpretation, not replace user judgment.</li><li>The goal is clarity, not prediction.</li></ul></details>
    <details><summary>Disclaimer</summary><ul><li>Past performance does not guarantee future results.</li><li>This app is for educational and informational use only.</li><li>It should not be treated as financial advice.</li></ul></details>
  </div>
`;

const setTheme = (theme) => {
  state.theme = theme;
  document.body.classList.toggle("light", theme === "light");
  $("profileThemeValue").textContent = theme === "light" ? "Light" : "Dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#EEF2FB" : "#070A12");
  localStorage.setItem("fundpulse-live-theme-v1", theme);
};

const latestMetric = (series, key) => {
  const point = [...series].reverse().find((item) => typeof item?.[key] === "number");
  return point?.[key] ?? null;
};

const categoryLatest = (funds) => {
  const category = categorySeries(funds);
  return category.at(-1)?.avg ?? null;
};

const normalizeProgress = (value, ceiling = 100) => Math.max(0, Math.min(100, (value / ceiling) * 100));
const scoreTone = (value) => (value >= 70 ? "strong" : value >= 50 ? "neutral" : "weak");

const buildStorySignals = (fund, funds) => {
  const currentReturn = typeof fund?.[state.horizon] === "number" ? fund[state.horizon] * 100 : null;
  const categoryReturn = categoryLatest(funds);
  const score = scoreOf(fund);
  const scoreLead = score - (summaryForCategory()?.categoryAverageScore || 0);
  const tags = [];

  if (score >= 75) tags.push({ label: "Strong Performer", tone: "good" });
  else if (score <= 45) tags.push({ label: "Watchlist", tone: "warn" });

  if (fund.trend === "Improving") tags.push({ label: "Improving", tone: "good" });
  if (fund.trend === "Declining") tags.push({ label: "Declining Trend", tone: "bad" });
  if (fund.trend === "Stable") tags.push({ label: "Stable", tone: "neutral" });

  const latestComparison = currentReturn !== null && categoryReturn !== null ? currentReturn - categoryReturn : null;

  return { score, scoreLead, currentReturn, categoryReturn, latestComparison, tags };
};

const buildHeadlineInsight = (fund, funds) => {
  const peerPct = allCategoryFunds().length ? Math.round(((allCategoryFunds().length - fund.rank + 1) / allCategoryFunds().length) * 100) : 0;
  const trendPhrase = fund.trend === "Improving"
    ? "showing fresh momentum"
    : fund.trend === "Declining"
      ? "showing recent slowdown"
      : "holding a steady trend";
  return `${fund.fundName} is outperforming ${peerPct}% of peers in ${state.category}, ${trendPhrase}.`;
};

const storySentence = (fund, funds) => {
  const signals = buildStorySignals(fund, funds);
  const returnStrength = typeof fund.threeYear === "number" && typeof fund.fiveYear === "number" && fund.threeYear > 0.12 && fund.fiveYear > 0.12
    ? "Strong 3Y and 5Y performance keep the long-term picture healthy."
    : "Long-term performance is more balanced, so short-term moves matter more here.";
  const shortTermRead = typeof fund.oneYear === "number" && fund.oneYear < 0.02
    ? "Recent 1Y softness suggests near-term weakness."
    : "Recent 1Y returns remain supportive.";
  const compareRead = signals.latestComparison === null
    ? "Category comparison is limited for the visible period."
    : signals.latestComparison >= 0
      ? `It is running ${signals.latestComparison.toFixed(1)} pts ahead of the category average.`
      : `It is trailing the category average by ${Math.abs(signals.latestComparison).toFixed(1)} pts.`;
  return `${returnStrength} ${shortTermRead} ${compareRead}`;
};

const clampValue = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const normalizeInsightMetric = (value, peers, { invert = false } = {}) => {
  const numbers = peers.filter((item) => Number.isFinite(item));
  if (!numbers.length || !Number.isFinite(value)) return 0.5;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  if (Math.abs(max - min) < 0.0001) return 0.7;
  const normalized = (value - min) / (max - min);
  const adjusted = invert ? 1 - normalized : normalized;
  return clampValue(0.18 + adjusted * 0.72, 0.16, 0.98);
};

const fundReturnStrength = (fund) => {
  const slices = [
    typeof fund?.oneYear === "number" ? { value: fund.oneYear * 100, weight: 0.28 } : null,
    typeof fund?.threeYear === "number" ? { value: fund.threeYear * 100, weight: 0.34 } : null,
    typeof fund?.fiveYear === "number" ? { value: fund.fiveYear * 100, weight: 0.38 } : null
  ].filter(Boolean);
  if (!slices.length) return null;
  const totalWeight = slices.reduce((sum, slice) => sum + slice.weight, 0) || 1;
  return slices.reduce((sum, slice) => sum + slice.value * slice.weight, 0) / totalWeight;
};

const topPerformerTrendSignal = (fund) => {
  const shortTerm = typeof fund?.oneYear === "number" ? fund.oneYear * 100 : null;
  const longTerms = [fund?.threeYear, fund?.fiveYear].filter((value) => typeof value === "number").map((value) => value * 100);
  const longTerm = longTerms.length ? longTerms.reduce((sum, value) => sum + value, 0) / longTerms.length : null;
  const delta = shortTerm !== null && longTerm !== null
    ? shortTerm - longTerm
    : Number.isFinite(Number(fund?.trendDelta))
      ? Number(fund.trendDelta)
      : 0;
  const strengthening = fund?.trend === "Improving" || (fund?.trend !== "Declining" && delta >= 0);
  return strengthening
    ? {
        tone: "strengthening",
        emoji: "🔥",
        title: "Strengthening",
        summary: "Recent return momentum is holding up against the longer-term track."
      }
    : {
        tone: "weakening",
        emoji: "📉",
        title: "Weakening",
        summary: "Recent return momentum has cooled versus the longer-term base."
      };
};

const buildFundDna = (fund, funds) => {
  const returnStrength = fundReturnStrength(fund);
  const returnPeers = funds.map(fundReturnStrength);
  const consistencyValue = consistencyOf(fund);
  const consistencyPeers = funds.map(consistencyOf);
  const riskValue = volatilityOf(fund);
  const riskPeers = funds.map(volatilityOf);
  const shortTerm = typeof fund?.oneYear === "number" ? fund.oneYear * 100 : null;
  const mediumTerm = typeof fund?.threeYear === "number" ? fund.threeYear * 100 : null;
  const longTerm = typeof fund?.fiveYear === "number" ? fund.fiveYear * 100 : null;
  const momentumValue = shortTerm !== null && mediumTerm !== null ? shortTerm - mediumTerm : Number(fund?.trendDelta) || 0;
  const momentumPeers = funds.map((item) => {
    const short = typeof item?.oneYear === "number" ? item.oneYear * 100 : null;
    const medium = typeof item?.threeYear === "number" ? item.threeYear * 100 : null;
    return short !== null && medium !== null ? short - medium : Number(item?.trendDelta) || 0;
  });
  const stabilityValue = consistencyValue !== null && riskValue !== null ? consistencyValue - riskValue : consistencyValue;
  const stabilityPeers = funds.map((item) => {
    const itemConsistency = consistencyOf(item);
    const itemRisk = volatilityOf(item);
    return itemConsistency !== null && itemRisk !== null ? itemConsistency - itemRisk : itemConsistency;
  });
  return [
    {
      key: "return",
      label: "Return",
      note: returnStrength === null ? "Limited history" : `${returnStrength >= 12 ? "Strong" : returnStrength >= 8 ? "Balanced" : "Measured"} return profile`,
      scale: normalizeInsightMetric(returnStrength, returnPeers),
      accent: "teal",
      displayValue: returnStrength === null ? "—" : `${returnStrength.toFixed(1)}%`
    },
    {
      key: "risk",
      label: "Risk",
      note: riskValue === null ? "No volatility read" : `${normalizeInsightMetric(riskValue, riskPeers, { invert: true }) >= 0.6 ? "Controlled" : "Elevated"} category risk`,
      scale: normalizeInsightMetric(riskValue, riskPeers, { invert: true }),
      accent: "violet",
      displayValue: riskValue === null ? "—" : `${riskValue.toFixed(1)}`
    },
    {
      key: "consistency",
      label: "Consistency",
      note: consistencyValue === null ? "Limited history" : `${normalizeInsightMetric(consistencyValue, consistencyPeers) >= 0.62 ? "Above average" : "Category aligned"} consistency`,
      scale: normalizeInsightMetric(consistencyValue, consistencyPeers),
      accent: "blue",
      displayValue: consistencyValue === null ? "—" : consistencyValue.toFixed(1)
    },
    {
      key: "stability",
      label: "Stability",
      note: stabilityValue === null ? "Limited history" : `${normalizeInsightMetric(stabilityValue, stabilityPeers) >= 0.6 ? "Steady" : "Mixed"} behaviour across cycles`,
      scale: normalizeInsightMetric(stabilityValue, stabilityPeers),
      accent: "indigo",
      displayValue: stabilityValue === null ? "—" : stabilityValue.toFixed(1)
    },
    {
      key: "momentum",
      label: "Momentum",
      note: momentumValue >= 0 ? "Short-term trend improving" : "Short-term trend cooling",
      scale: normalizeInsightMetric(momentumValue, momentumPeers),
      accent: "purple",
      displayValue: `${momentumValue >= 0 ? "+" : ""}${momentumValue.toFixed(1)}`
    }
  ];
};

const renderFundDnaRadar = (dimensions) => {
const isLight = document.body.classList.contains("light");
  const width = 290;
  const height = 290;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 105;
  const count = dimensions.length;
  const angleFor = (index) => (-Math.PI / 2) + ((Math.PI * 2) / count) * index;
  const pointFor = (scale, index) => {
    const angle = angleFor(index);
    return {
      x: cx + Math.cos(angle) * radius * scale,
      y: cy + Math.sin(angle) * radius * scale
    };
  };
  const rings = [0.2, 0.4, 0.6, 0.8, 1].map((ring) => {
    const points = dimensions.map((_, index) => {
      const point = pointFor(ring, index);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    }).join(" ");
    return `<polygon points="${points}" fill="none" stroke="${isLight ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.08)'}" opacity="1" stroke-width="${ring === 1 ? 1.1 : 1}"/>`;
  }).join("");
  const axes = dimensions.map((item, index) => {
    const outer = pointFor(1, index);
    const label = pointFor(1.12, index);
    const labelDelay = 150 + (index * 80);
    return `
      <line class="fund-radar__axis" style="--axis-delay:${80 + (index * 45)}ms" x1="${cx}" y1="${cy}" x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}" stroke="currentColor" opacity="0.12"/>
      <text class="fund-radar__label" data-label-index="${index}" style="--label-delay:${labelDelay}ms" x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" fill="${isLight ? '#0f172a' : '#e2e8f0'}"
opacity="1" font-size="12" font-weight="700">${escapeHtml(item.label)}</text>
    `;
  }).join("");
  const areaPoints = dimensions.map((item, index) => {
    const point = pointFor(item.scale, index);
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(" ");
  const nodes = dimensions.map((item, index) => {
    const point = pointFor(item.scale, index);
    return `<circle class="fund-radar__node" style="--node-delay:${160 + (index * 60)}ms" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5" fill="#fff" filter="url(#glow)" stroke="url(#fundRadarStroke)" stroke-width="2"/>`;
  }).join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" class="fund-radar fund-radar--animated" role="img" aria-label="Fund DNA radar chart">
      <defs>
        <linearGradient id="fundRadarFill" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#58d0ff" stop-opacity="0.24"/>
          <stop offset="55%" stop-color="#4a63ff" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#9fc8ff" stop-opacity="0.26"/>
        </linearGradient>
        <linearGradient id="fundRadarStroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#58d0ff"/>
          <stop offset="52%" stop-color="#4a63ff"/>
          <stop offset="100%" stop-color="#9fc8ff"/>
        </linearGradient>
        <radialGradient id="fundRadarGlow" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stop-color="#58d0ff" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#58d0ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${radius * 0.94}" fill="${isLight ? 'rgba(88,208,255,0.08)' : 'url(#fundRadarGlow)'}"/>
      ${rings}
      ${axes}
      <polygon class="fund-radar__area" points="${areaPoints}" fill="${isLight ? 'rgba(74,99,255,0.2)' : 'url(#fundRadarFill)'}"
stroke="${isLight ? '#4a63ff' : 'url(#fundRadarStroke)'}" stroke-width="2.4"/>
      ${nodes}
    </svg>
  `;
};

const buildWhyThisFund = (fund, funds, summary) => {
  const insights = [];
  const avgThreeYear = funds.map((item) => typeof item?.threeYear === "number" ? item.threeYear * 100 : null).filter(Number.isFinite);
  const avgFiveYear = funds.map((item) => typeof item?.fiveYear === "number" ? item.fiveYear * 100 : null).filter(Number.isFinite);
  const avgConsistency = funds.map(consistencyOf).filter(Number.isFinite);
  const avgVolatility = funds.map(volatilityOf).filter(Number.isFinite);
  const threeYear = typeof fund?.threeYear === "number" ? fund.threeYear * 100 : null;
  const fiveYear = typeof fund?.fiveYear === "number" ? fund.fiveYear * 100 : null;
  const consistencyValue = consistencyOf(fund);
  const volatilityValue = volatilityOf(fund);
  const trendSignal = topPerformerTrendSignal(fund);

  if ((fund.rank || 999) === 1 || scoreOf(fund) >= Number(summary?.topScore || 0)) {
    insights.push("Top-ranked in the category on the current dashboard score.");
  }
  if (fiveYear !== null && avgFiveYear.length && fiveYear > (avgFiveYear.reduce((sum, value) => sum + value, 0) / avgFiveYear.length)) {
    insights.push("Strong long-term performance versus category peers.");
  } else if (threeYear !== null && avgThreeYear.length && threeYear > (avgThreeYear.reduce((sum, value) => sum + value, 0) / avgThreeYear.length)) {
    insights.push("Recent medium-term returns are running ahead of category peers.");
  }
  if (consistencyValue !== null && avgConsistency.length && consistencyValue > (avgConsistency.reduce((sum, value) => sum + value, 0) / avgConsistency.length)) {
    insights.push("Above-average consistency inside this category.");
  }
  if (volatilityValue !== null && avgVolatility.length && volatilityValue < (avgVolatility.reduce((sum, value) => sum + value, 0) / avgVolatility.length)) {
    insights.push("Lower volatility than most funds in the same category.");
  }
  insights.push(trendSignal.tone === "strengthening"
    ? "Recent performance momentum is improving against its own long-term baseline."
    : "Recent trend is weakening even though the broader history stays relevant.");
  if (scoreOf(fund) > Number(summary?.categoryAverageScore || 0)) {
    insights.push(`Dashboard score sits ${(scoreOf(fund) - Number(summary?.categoryAverageScore || 0)).toFixed(1)} points above the category average.`);
  }
  return [...new Set(insights)].slice(0, 4);
};

const topPerformerDetailMarkup = (fund, funds, summary) => {
  const trend = topPerformerTrendSignal(fund);
  const dna = buildFundDna(fund, funds);
  const whyThisFund = buildWhyThisFund(fund, funds, summary);
  const metricRows = [
    ["1Y Return", formatPct(fund.oneYear)],
    ["3Y Return", formatPct(fund.threeYear)],
    ["5Y Return", formatPct(fund.fiveYear)],
    ["Consistency", consistencyOf(fund) === null ? "—" : consistencyOf(fund).toFixed(1)],
    ["Risk / Volatility", riskLabel(fund)]
  ];
  return `
    <div class="detail-hero">
      <p class="eyebrow">${escapeHtml(state.category)} | Top Performer</p>
      <h2>${escapeHtml(fund.fundName)}</h2>
      <span class="rank-badge">Top performer</span>
    </div>
    <article class="insight-card top-performer-inline-card top-performer-detail-card">
      <div class="inline-insight-trend inline-insight-trend--${trend.tone}">
        <div class="inline-insight-trend__lead">
          <strong>${trend.emoji} ${trend.title}</strong>
        </div>
        <p>${escapeHtml(trend.summary)}</p>
      </div>
      <div class="inline-insight-section">
        <div class="section-head compact">
          <div>
            <p class="eyebrow">Fund DNA</p>
          </div>
        </div>
        <div class="inline-dna-layout">
          <div class="inline-dna-radar">
            ${renderFundDnaRadar(dna)}
          </div>
          <div class="fund-dna-list inline-dna-list">
          ${dna.map((item, index) => `
            <div class="fund-dna-row fund-dna-row--${item.accent}" data-dna-index="${index}">
              <div class="fund-dna-row__head">
                <strong>${escapeHtml(item.label)}</strong>
                <span>${escapeHtml(item.displayValue)}</span>
              </div>
              <div class="fund-dna-track">
                <i class="fund-dna-fill" style="--dna-scale:${item.scale.toFixed(3)}; --dna-delay:${140 + (index * 100)}ms"></i>
              </div>
            </div>
          `).join("")}
          </div>
        </div>
      </div>
      <div class="inline-insight-section">
        <div class="section-head compact">
          <div>
            <p class="eyebrow">Metrics</p>
          </div>
        </div>
        <div class="inline-metric-grid">

  <div class="inline-metric-card">
    <span>Score</span>
    <strong>${scoreLabel(scoreOf(fund))}</strong>
  </div>

  <div class="inline-metric-card">
    <span>Consistency</span>
    <strong>${consistencyOf(fund)?.toFixed(1) || "—"}</strong>
  </div>

  <div class="inline-metric-card">
    <span>Volatility</span>
    <strong>${riskLabel(fund)}</strong>
  </div>

  <div class="inline-metric-card">
    <span>1Y</span>
    <strong>${formatPct(fund.oneYear)}</strong>
  </div>

  <div class="inline-metric-card">
    <span>3Y</span>
    <strong>${formatPct(fund.threeYear)}</strong>
  </div>

  <div class="inline-metric-card">
    <span>5Y</span>
    <strong>${formatPct(fund.fiveYear)}</strong>
  </div>

</div>
      </div>
      <div class="inline-insight-section">
        <div class="fund-insight-why">
          <div class="section-head compact">
            <div>
              <h3>💡 Why this fund?</h3>
            </div>
          </div>
          <ul class="fund-insight-list">
            ${whyThisFund.map((insight) => `<li>${escapeHtml(insight)}</li>`).join("")}
          </ul>
        </div>
      </div>
    </article>
  `;
};

const openTopPerformerInsight = () => {
  const summary = summaryForCategory();
  const funds = allCategoryFunds();
  const fund = funds[0] || selectedFund();
  if (!summary || !fund) return;
  openGlobalModal(topPerformerDetailMarkup(fund, funds, summary), { kind: "detail", size: "wide" });
};

const openPicker = (target) => {
  state.pickerTarget = target;
  const html = renderPicker();
  if (!openGlobalModal(html, { kind: "picker" })) return;
  document.querySelectorAll("[data-picker-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset.pickerChoice;
      if (state.pickerTarget === "compareFundA") {
        state.compareFundAId = selected;
      } else if (state.pickerTarget === "compareFundB") {
        state.compareFundBId = selected;
      } else {
        state.category = selected;
        state.selectedFundId = null;
        state.compareFundAId = null;
        state.compareFundBId = null;
        state.query = "";
        if ($("searchInput")) $("searchInput").value = "";
      }
      closeGlobalModal();
      renderCurrentView();
    });
  });
};

const closePicker = () => {
  closeGlobalModal();
};

const tabOrder = ["dashboard", "funds", "insights", "compare", "planner", "profile", "portfolio", "saved-plans"];

const navigateToTab = (tab) => {
  const btn = document.querySelector(`.bottom-nav [data-tab="${tab}"]`);
  if (btn) {
    btn.click();
  } else {
    switchTab(tab, 0);
  }
};

const syncTabUi = () => {
  document.querySelectorAll(".bottom-nav button").forEach((item) => item.classList.toggle("active", item.dataset.tab === state.tab));
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === `screen-${state.tab}`));
};

const resetViewScroll = (behavior = "auto") => {
  const app = $("app");
  if (app) app.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo({ top: 0, behavior });
};

const switchTab = (tab, direction = 0) => {
  if (!tab || tab === state.tab) return;
  const nextScreen = $(`screen-${tab}`);
  if (!nextScreen) return;
  state.tab = tab;
  window.location.hash = `#${tab}`;
  syncTabUi();
  nextScreen.style.setProperty("--tab-shift", `${direction * 12}px`);
  renderCurrentView();
  requestAnimationFrame(() => resetViewScroll("auto"));
};

const renderPicker = () => {
  const isFundPicker = state.pickerTarget === "compareFundA" || state.pickerTarget === "compareFundB";
  const categoryOptions = Array.isArray(appData?.categories) ? appData.categories : [];
  const items = isFundPicker ? allCategoryFunds().map((fund) => ({ value: fund.id, label: fund.fundName })) : categoryOptions.map((category) => ({ value: category, label: category }));
  const current = state.pickerTarget === "compareFundA"
    ? state.compareFundAId
    : state.pickerTarget === "compareFundB"
      ? state.compareFundBId
      : state.category;
  if (!items.length) {
    return `
      <div class="picker-modal">
        <div class="picker-header">
          <div>
            <p class="eyebrow">${isFundPicker ? "Fund" : "Category"}</p>
            <h3>${isFundPicker ? "Choose fund" : "Choose Category"}</h3>
          </div>
        </div>
        <div class="picker-scroll">
          <div class="empty-chart">No options are available for this selection yet.</div>
        </div>
      </div>
    `;
  }
  return `
    <div class="picker-modal">
      <div class="picker-header">
        <div>
          <p class="eyebrow">${isFundPicker ? "Fund" : "Category"}</p>
          <h3>${isFundPicker ? "Choose fund" : "Choose Category"}</h3>
        </div>
      </div>
      <div class="picker-scroll">
        <div class="picker-list">
          ${items.map((item) => `
            <button class="${item.value === current ? "active" : ""}" data-picker-choice="${escapeHtml(item.value)}">
              <span>${escapeHtml(item.label)}</span>
              <i aria-hidden="true"></i>
            </button>
          `).join("")}
        </div>
      </div>
    </div>
  `;
};

const renderChrome = () => {
  const showControls = ["dashboard", "funds", "insights", "compare"].includes(state.tab);
  const isSubpage = ["profile", "portfolio", "saved-plans"].includes(state.tab);
  document.querySelector(".controls-strip").classList.toggle("hidden", !showControls);
  document.body.classList.toggle("subpage-active", isSubpage);
};

const syncOverlayState = () => {};

const closeAllOverlays = () => closeGlobalModal();

const updateSegmentedPill = (group) => {
  if (!(group instanceof HTMLElement)) return;
  const buttons = [...group.querySelectorAll("button")];
  const active = buttons.find((button) => button.classList.contains("active"));
  if (!active) {
    group.style.setProperty("--pill-visible", "0");
    return;
  }
  if (group.matches(".dashboard-return-tabs, .ranking-filter, .compare-return-filter") && buttons.length === 3) {
    const activeIndex = Math.max(0, buttons.indexOf(active));
    group.style.setProperty("--pill-visible", "1");
    group.style.setProperty("--selector-shift", `${activeIndex * 100}%`);
    return;
  }
  const setPillFrame = (button) => {
    group.style.setProperty("--pill-visible", "1");
    group.style.setProperty("--pill-x", `${button.offsetLeft - group.scrollLeft}px`);
    group.style.setProperty("--pill-y", `${button.offsetTop}px`);
    group.style.setProperty("--pill-w", `${button.offsetWidth}px`);
    group.style.setProperty("--pill-h", `${button.offsetHeight}px`);
  };
  setPillFrame(active);
};

const updateAllSegmentedPills = () => {
  document.querySelectorAll(".dashboard-return-tabs, .ranking-filter, .compare-return-filter, .chip-row, .time-filter, .fund-view-toggle").forEach(updateSegmentedPill);
};

const bindSegmentedPillTracking = () => {
  document.querySelectorAll(".dashboard-return-tabs, .ranking-filter, .compare-return-filter, .chip-row, .time-filter, .fund-view-toggle").forEach((group) => {
    if (!(group instanceof HTMLElement) || group.dataset.pillBound === "true") return;
    group.dataset.pillBound = "true";
    group.addEventListener("scroll", () => updateSegmentedPill(group), { passive: true });
  });
};

const syncControlState = () => {
  syncTabUi();
  document.querySelectorAll("[data-horizon]").forEach((button) => {
    button.classList.toggle("active", button.dataset.horizon === state.horizon);
  });
  document.querySelectorAll(".time-filter button").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === state.period);
  });
  document.querySelectorAll(".chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sort);
  });
  document.querySelectorAll("[data-fund-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.fundView === state.fundView);
  });
  if (controlStateFrame) {
    cancelAnimationFrame(controlStateFrame);
  }
  controlStateFrame = requestAnimationFrame(() => {
    controlStateFrame = 0;
    bindSegmentedPillTracking();
    updateAllSegmentedPills();
  });
};

const renderHeaderControls = () => {
  const categories = Array.isArray(appData?.categories) ? appData.categories : [];
  if (!categories.length) return;
  if (!categories.includes(state.category)) state.category = categories[0];
  $("categoryValue").textContent = state.category;
  const { fundA, fundB } = compareFunds();
  if ($("compareFundAValue")) $("compareFundAValue").textContent = fundA?.fundName || "Select fund";
  if ($("compareFundBValue")) $("compareFundBValue").textContent = fundB?.fundName || "Select fund";
};

const renderDashboard = () => {
  const summary = summaryForCategory();
  const funds = allCategoryFunds();
  const fund = funds[0] || selectedFund();
  if (!summary || !fund) {
    renderFallback("screen-dashboard", "Dashboard data unavailable", "Choose a category with valid workbook data to see the dashboard.");
    return;
  }
  const categoryAvgReturn = funds.map((item) => item[state.horizon]).filter((value) => typeof value === "number");
  const avgReturn = categoryAvgReturn.length ? categoryAvgReturn.reduce((a, b) => a + b, 0) / categoryAvgReturn.length : null;

  $("heroCategory").textContent = state.category;
  $("heroDate").textContent = formatDate(latestNavDateForCategory(state.category));
  renderHeroSyncBadge();
  const heroScoreValue = scoreOf(fund);
  $("heroScore").textContent = scoreLabel(heroScoreValue);
  $("heroScoreBadge")?.setAttribute("data-score-tone", scoreTone(heroScoreValue));
  $("topPerformer").textContent = fund.fundName;
  $("avgReturn").textContent = formatPct(avgReturn);
  $("categoryAverage").textContent = scoreLabel(summary.categoryAverageScore);
  $("consistency").textContent = Number.isFinite(Number(fund?.consistency)) ? `${Number(fund.consistency).toFixed(1)} vol` : "—";
  $("totalFunds").textContent = summary.totalFunds;
  $("dashboardInsight").textContent = `${fund.fundName} is loading live category insight...`;

  const insightMount = $("topPerformerInsightMount");
  if (insightMount) {
    insightMount.innerHTML = "";
    insightMount.classList.remove("is-open");
    insightMount.setAttribute("aria-hidden", "true");
  }

  const chartTarget = $("lineChart");
  const tooltip = $("performanceTooltip");
  if (chartTarget) {
    chartTarget.innerHTML = `<div class="empty-chart">Loading performance chart...</div>`;
  }
  if (tooltip) {
    tooltip.hidden = false;
    tooltip.textContent = `Loading live comparison for ${fund.fundName}...`;
  }

  const categoryKey = `${state.category}|${state.horizon}|${state.period}|${fund.id}`;
  scheduleDeferredRenderJob(`dashboard:${categoryKey}`, () => {
    if (state.tab !== "dashboard" || state.category !== summary.category) return;
    const history = historyFor(fund);
    const signals = buildStorySignals(fund, funds);
    const categoryAverage = categorySeries(funds);
    const outperformCount = history.filter((point) => {
      const label = point.date ? point.date.slice(5) : point.label;
      const cat = categoryAverage.find((item) => item.label === label);
      return metricAt(point) !== null && cat && metricAt(point) >= cat.avg;
    }).length;
    $("dashboardInsight").textContent = `${buildHeadlineInsight(fund, funds)} ${storySentence(fund, funds)} It beat the category average in ${outperformCount} of ${history.length} visible periods.`;
    renderPerformanceChart("lineChart", fund, funds, categoryAverage);
    if (tooltip) {
      tooltip.hidden = false;
      tooltip.textContent = `Top fund: ${fund.fundName} | Return view: ${horizonLabel()} | Score lead: ${signals.scoreLead >= 0 ? "+" : ""}${signals.scoreLead.toFixed(1)}`;
    }
  }, 90);
};

const categorySeries = (funds) => {
  const buckets = new Map();
  funds.forEach((fund) => {
    chartHistoryFor(fund).forEach((point) => {
      if (!buckets.has(point.key)) buckets.set(point.key, { label: point.label, values: [] });
      buckets.get(point.key).values.push(point.value);
    });
  });
  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      avg: bucket.values.reduce((a, b) => a + b, 0) / bucket.values.length
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-periodCount());
};

const renderPerformanceChart = (id, fund, funds, category = null) => {
  const target = $(id);
  if (!target || !fund) return;
  const fundHistory = chartHistoryFor(fund);
  const categoryData = Array.isArray(category) ? category : categorySeries(funds);
  const slotCount = Math.max(2, Math.min(periodCount(), Math.max(fundHistory.length, categoryData.length)));
  const fundSlots = Array(Math.max(0, slotCount - fundHistory.length)).fill(null).concat(fundHistory).slice(-slotCount);
  const categorySlots = Array(Math.max(0, slotCount - categoryData.length)).fill(null).concat(categoryData).slice(-slotCount);
  const labels = Array.from({ length: slotCount }, (_, index) => fundSlots[index]?.label || categorySlots[index]?.label || `P${index + 1}`);
  const selectedValues = fundSlots.map((point) => point?.value ?? null);
  const categoryValues = categorySlots.map((point) => point?.avg ?? null);
  const tooltip = id === "insightsLineChart" ? $("insightsPerformanceTooltip") : $("performanceTooltip");
  renderMultiLineSvg(target, [
    { name: "Top fund", values: selectedValues, color: "#0D9488" },
    { name: "Category average", values: categoryValues, color: "#2F73FF" }
  ], labels, tooltip);
};

const renderMultiLineSvg = (target, series, labels, tooltipEl = null) => {
  const width = 390;
  const height = 238;
  const padding = { top: 24, right: 18, bottom: 36, left: 40 };
  target.classList.add("performance-chart");
  target.classList.add("chart-updating");
  const values = series.flatMap((item) => item.values).filter((value) => value !== null && value !== undefined);
  if (!values.length) {
    target.classList.remove("chart-updating");
    target.innerHTML = `<div class="empty-chart">Performance history is unavailable for the selected view.</div>`;
    return;
  }
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 1);
  const spread = Math.max(4, rawMax - rawMin);
  const min = Math.floor((rawMin - spread * 0.18) / 2) * 2;
  const max = Math.ceil((rawMax + spread * 0.18) / 2) * 2;
  const denom = max - min || 1;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index) => padding.left + index * (plotWidth / Math.max(1, labels.length - 1));
  const y = (value) => padding.top + (1 - ((value - min) / denom)) * plotHeight;
  const pathFor = (valuesList) => {
    let d = "";
    valuesList.forEach((value, index) => {
      if (value === null || value === undefined) return;
      const command = d ? "L" : "M";
      d += `${command}${x(index).toFixed(2)} ${y(value).toFixed(2)} `;
    });
    return d.trim();
  };
  const ticks = [max, (min + max) / 2, min];
  const grid = ticks.map((tick) => `<g class="chart-grid-row"><line class="chart-grid-line" x1="${padding.left}" y1="${y(tick)}" x2="${width - padding.right}" y2="${y(tick)}"/><text class="chart-axis-label" x="${padding.left - 14}" y="${y(tick) + 4}" text-anchor="end">${tick.toFixed(0)}%</text></g>`).join("");
  const lines = series.map((item) => {
    const isPrimary = item === series[0];
    const d = pathFor(item.values);
    if (!d) return "";
    const dots = item.values.map((value, index) => value === null ? "" : `<circle class="chart-point${isPrimary ? " primary" : ""}" style="--point-delay:${150 + (index * 34)}ms" data-chart-index="${index}" data-series-name="${escapeHtml(item.name)}" cx="${x(index)}" cy="${y(value)}" r="${isPrimary ? 6.2 : 5.2}" fill="${item.color}"><title>${item.name}: ${value.toFixed(2)}%</title></circle>`).join("");
    return `<path class="chart-line${isPrimary ? " primary" : ""}" style="--series-index:${isPrimary ? 0 : 1}; --chart-color:${item.color}" d="${d}" fill="none" stroke="${item.color}" stroke-width="${isPrimary ? 4.6 : 4}" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }).join("");
  const labelsSvg = labels.map((label, index) => `<text class="chart-axis-label chart-x-label" x="${x(index)}" y="${height - 8}" text-anchor="middle">${escapeHtml(label)}</text>`).join("");
  const guideLine = tooltipEl ? `<line class="chart-guide-line" id="${target.id || "chart"}GuideLine" x1="${x(Math.max(0, labels.length - 1))}" y1="${padding.top}" x2="${x(Math.max(0, labels.length - 1))}" y2="${height - padding.bottom}" stroke-dasharray="4 5"/>` : "";
  const hoverZones = tooltipEl ? labels.map((label, index) => {
    const step = plotWidth / Math.max(1, labels.length - 1);
    const zoneX = index === 0 ? padding.left : x(index) - step / 2;
    const zoneWidth = labels.length === 1 ? plotWidth : step;
    return `<rect class="chart-hit" data-chart-index="${index}" x="${zoneX}" y="${padding.top}" width="${zoneWidth}" height="${plotHeight}" fill="transparent"/>`;
  }).join("") : "";
  const legendHtml = `<div class="chart-legend">${series.map((item) => `<span class="chart-legend-item" style="color:${item.color}"><i aria-hidden="true"></i><span>${escapeHtml(item.name)}</span></span>`).join("")}</div>`;
  target.innerHTML = `${legendHtml}<svg class="performance-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Top fund versus category average">${grid}${hoverZones}${guideLine}${lines}${labelsSvg}</svg>`;
  requestAnimationFrame(() => target.classList.remove("chart-updating"));
  if (tooltipEl) {
    const svg = target.querySelector("svg");
    const guide = target.querySelector(".chart-guide-line");
    const showTooltip = (index) => {
      tooltipEl.hidden = false;
      tooltipEl.textContent = `${labels[index]} | ${series.map((item) => `${item.name}: ${item.values[index] === null ? "-" : `${item.values[index].toFixed(1)}%`}`).join(" | ")}`;
      if (guide) {
        const pos = x(index);
        guide.setAttribute("x1", `${pos}`);
        guide.setAttribute("x2", `${pos}`);
      }
    };
    target.querySelectorAll("[data-chart-index]").forEach((zone) => {
      zone.addEventListener("mouseenter", () => showTooltip(Number(zone.dataset.chartIndex)));
      zone.addEventListener("click", () => showTooltip(Number(zone.dataset.chartIndex)));
      zone.addEventListener("touchstart", () => showTooltip(Number(zone.dataset.chartIndex)), { passive: true });
    });
    target.querySelectorAll(".chart-point").forEach((point) => {
      const activatePoint = () => showTooltip(Number(point.dataset.chartIndex));
      point.addEventListener("mouseenter", activatePoint);
      point.addEventListener("click", activatePoint);
      point.addEventListener("touchstart", activatePoint, { passive: true });
    });
    if (svg) {
      const handlePointerAt = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const relativeX = Math.max(padding.left, Math.min(width - padding.right, ((clientX - rect.left) / rect.width) * width));
        const step = labels.length <= 1 ? 0 : plotWidth / Math.max(1, labels.length - 1);
        const index = labels.length <= 1 ? 0 : Math.max(0, Math.min(labels.length - 1, Math.round((relativeX - padding.left) / step)));
        showTooltip(index);
      };
      svg.addEventListener("pointermove", (event) => handlePointerAt(event.clientX));
      svg.addEventListener("pointerdown", (event) => handlePointerAt(event.clientX));
      svg.addEventListener("touchmove", (event) => {
        const touch = event.touches?.[0];
        if (touch) handlePointerAt(touch.clientX);
      }, { passive: true });
    }
    showTooltip(Math.max(0, labels.length - 1));
  }
};

const renderFunds = () => {
  const query = state.query.trim();
  const funds = visibleFunds();
  const favorites = favoriteFundIds();
  const fundList = $("fundList");
  const rankingFilterMount = $("rankingFilterMount");
  if (rankingFilterMount) {
    if (state.sort === "return") {
      let filter = rankingFilterMount.querySelector(".ranking-filter");
      if (!filter) {
        rankingFilterMount.innerHTML = `
          <div class="quick-filter-row ranking-filter selector-container" aria-label="Ranking return horizon">
            <button class="${state.horizon === "oneYear" ? "active" : ""}" data-horizon="oneYear">1Y</button>
            <button class="${state.horizon === "threeYear" ? "active" : ""}" data-horizon="threeYear">3Y</button>
            <button class="${state.horizon === "fiveYear" ? "active" : ""}" data-horizon="fiveYear">5Y</button>
          </div>
        `;
        rankingFilterMount.querySelectorAll("[data-horizon]").forEach((button) => {
          button.addEventListener("click", () => applyOptionValue("horizon", button.dataset.horizon, 0));
        });
      }
    } else if (rankingFilterMount.innerHTML.trim()) {
      rankingFilterMount.innerHTML = "";
    }
  }
  fundList?.classList.toggle("saved-empty", !funds.length && state.fundView === "favorites");
  if (!funds.length) {
    if (state.fundView === "favorites") {
      fundList.innerHTML = `
        <div class="saved-empty-state" role="status" aria-live="polite">
          <div class="saved-empty-state__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.5 7.5a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z"></path>
              <path d="m15.2 11.8.35 1.08h1.14l-.92.66.35 1.08-.92-.67-.92.67.35-1.08-.92-.66h1.14z"></path>
            </svg>
          </div>
          <h3>No saved funds match this view yet.</h3>
          <p>Funds you save will appear here for quick access.</p>
        </div>
      `;
    } else {
      const emptyCopy = `No funds are available in ${state.category} for the current search.`;
      fundList.innerHTML = `<div class="list-note">${escapeHtml(emptyCopy)}</div>`;
    }
    return;
  }
  const note = query
? `Searching all results for "${query}"`
    : state.fundView === "favorites"
      ? `Saved funds | ${state.category} funds appear first | ${formatDate(latestNavDateForCategory(state.category))}`
      : `Top 10 funds in ${state.category} | ${formatDate(latestNavDateForCategory(state.category))}`;
  fundList.innerHTML = `
    <div class="list-note">${escapeHtml(note)}</div>
    ${funds.map((fund) => `
      <article class="fund-card" data-fund-id="${escapeHtml(fund.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(fund.fundName)} detail">
        <div class="fund-card-top">
          <div>
            <p class="eyebrow">${escapeHtml(fund.category)}</p>
            <h3 class="fund-name">${escapeHtml(fund.fundName)}</h3>
          </div>
          <div class="fund-card-actions">
            <button class="favorite-toggle ${favorites.has(fund.id) ? "is-active" : ""}" data-favorite-id="${escapeHtml(fund.id)}" aria-label="${favorites.has(fund.id) ? "Remove from saved funds" : "Save fund"}">${favorites.has(fund.id) ? "★" : "☆"}</button>
            <div class="rank-badge">#${fund.displayRank || fund.rank}</div>
          </div>
        </div>
        ${state.sort === "consistency" ? `
          <div class="return-strip">
            <div class="return-pill selected"><small>Consistency</small><strong>${consistencyOf(fund) === null ? "—" : consistencyOf(fund).toFixed(1)}</strong></div>
            <div class="return-pill"><small>Volatility</small><strong>${riskLabel(fund)}</strong></div>
            <div class="return-pill"><small>Score</small><strong>${scoreLabel(scoreOf(fund))}</strong></div>
          </div>
        ` : `
          <div class="return-strip">
            <div class="return-pill ${state.horizon === "oneYear" && state.sort === "return" ? "selected" : ""}"><small>1Y</small><strong>${formatPct(fund.oneYear)}</strong></div>
            <div class="return-pill ${state.horizon === "threeYear" && state.sort === "return" ? "selected" : ""}"><small>3Y</small><strong>${formatPct(fund.threeYear)}</strong></div>
            <div class="return-pill ${state.horizon === "fiveYear" && state.sort === "return" ? "selected" : ""}"><small>5Y</small><strong>${formatPct(fund.fiveYear)}</strong></div>
          </div>
        `}

        <div class="fund-card-bottom">
          <span class="muted">${riskLabel(fund)}</span>
          <strong>${escapeHtml(fund.flag || "Core")}</strong>
        </div>
        <div class="trend-row">
          ${trendMarkup(fund.trend)}
      <div class="nav-box${hasLiveNav(fund) ? "" : " nav-box--empty"}">
        <small>NAV</small>
        <strong>${hasLiveNav(fund) ? `₹${Number(fund.latestNav).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</strong>
      </div>
          <span>Score ${scoreLabel(scoreOf(fund))}</span>
        </div>
      </article>
    `).join("")}
  `;
  $("fundList").querySelectorAll("[data-favorite-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFavoriteFund(button.dataset.favoriteId);
      renderFunds();
    });
  });
  document.querySelectorAll("[data-fund-id]").forEach((card) => {
    const openCard = () => {
      const fundId = card.dataset.fundId;
      if (!fundId) return;
      state.selectedFundId = fundId;
      openDetail(fundId);
    };
    bindFundCardInteractions(card, openCard);
  });
};

const renderInsights = () => {
  const funds = allCategoryFunds();
  const summary = summaryForCategory();
  const fund = selectedFund() || funds[0];
  if (!summary || !fund) {
    renderFallback("insightsList", "Insights unavailable", "There is not enough category data available to generate insights for this selection.");
    $("analysisChart").innerHTML = `<div class="empty-chart">Leadership data is unavailable for this category.</div>`;
    return;
  }
  const signals = buildStorySignals(fund, funds);
  const chartFunds = funds.slice(0, 8);
  const tags = signals.tags.map((tag) => `<span class="story-tag ${tag.tone}">${escapeHtml(tag.label)}</span>`).join("");
  const comparisonBars = [
    {
      label: "Vs category score",
      value: normalizeProgress(Math.max(0, signals.scoreLead + 50), 100),
      note: `${signals.scoreLead >= 0 ? "+" : ""}${signals.scoreLead.toFixed(1)} score`
    },
    {
      label: "Vs category return",
      value: normalizeProgress(Math.max(0, (signals.latestComparison ?? 0) + 20), 40),
      note: signals.latestComparison === null ? "No comparable read" : `${signals.latestComparison >= 0 ? "+" : ""}${signals.latestComparison.toFixed(1)} pts`
    },
    {
      label: "Category rank strength",
      value: normalizeProgress(allCategoryFunds().length - fund.rank + 1, Math.max(1, allCategoryFunds().length)),
      note: `Rank #${fund.rank} of ${allCategoryFunds().length}`
    }
  ];
  const insightHistory = historyFor(fund);
  const insightCategoryAverage = categorySeries(funds);
  const insightOutperformCount = insightHistory.filter((point) => {
    const label = point.date ? point.date.slice(5) : point.label;
    const cat = insightCategoryAverage.find((item) => item.label === label);
    return metricAt(point) !== null && cat && metricAt(point) >= cat.avg;
  }).length;
  const aiSummary = `${buildHeadlineInsight(fund, funds)} ${storySentence(fund, funds)} ${
    signals.latestComparison === null
      ? "Category comparison is limited for the visible period."
      : `It is ${signals.latestComparison >= 0 ? "ahead of" : "behind"} the category average by ${Math.abs(signals.latestComparison).toFixed(1)} pts.`
  } Beat category average in ${insightOutperformCount} of ${insightHistory.length} visible periods.`;
  $("insightsList").innerHTML = `
    <article class="insight-card primary story-card">
      <p class="eyebrow">Headline insight</p>
      <h3>${escapeHtml(buildHeadlineInsight(fund, funds))}</h3>
      <p class="story-copy">${escapeHtml(storySentence(fund, funds))}</p>
      <div class="story-tags">${tags}</div>
    </article>
    <article class="insight-card story-card">
      <p class="eyebrow">AI-style summary</p>
      <h3>${escapeHtml(aiSummary)}</h3>
    </article>
    <article class="insight-card story-card">
      <p class="eyebrow">Trend interpretation</p>
      <h3>${fund.trend === "Improving" ? "Momentum is building" : fund.trend === "Declining" ? "Momentum is weakening" : "Momentum remains stable"}</h3>
      <p class="story-copy">${escapeHtml(fund.fundName)} currently carries ${riskLabel(fund)} with rank #${fund.rank} in ${escapeHtml(state.category)}.</p>
    </article>
    <article class="insight-card story-card full-span">
      <p class="eyebrow">Comparison insight</p>
      <h3>How the selected fund stacks up right now</h3>
      <div class="story-metrics">
        ${comparisonBars.map((item) => `
          <div class="story-progress">
            <div class="story-progress-head"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.note)}</span></div>
            <div class="story-progress-track"><i style="width:${item.value}%"></i></div>
          </div>
        `).join("")}
      </div>
    </article>
    <article class="insight-card story-card">
      <p class="eyebrow">Category snapshot</p>
      <h3>${escapeHtml(state.category)} has ${summary.totalFunds} funds and an average dashboard score of ${summary.categoryAverageScore.toFixed(1)}.</h3>
      <p class="story-copy">${escapeHtml(summary.topPerformer)} leads the category while the current view uses the ${datasetLabel().toLowerCase()}.</p>
    </article>
  `;
  const analysisChart = $("analysisChart");
  if (analysisChart) {
    analysisChart.innerHTML = `<div class="empty-chart">Loading category leadership chart...</div>`;
  }
  const insightKey = `${state.category}|${state.horizon}|insights`;
  scheduleDeferredRenderJob(`insights:${insightKey}`, () => {
    if (state.tab !== "insights" || state.category !== summary.category) return;
    renderReturnBarChart("analysisChart", chartFunds, false);
  }, 120);

};

const renderReturnBarChart = (id, funds, highlightSelected = true) => {
  const target = $(id);
  if (!target) return;
  if (!funds.length) {
    target.innerHTML = `<div class="empty-chart">No comparable funds are available in this category.</div>`;
    return;
  }
  const values = funds.map((fund) => (fund[state.horizon] || 0) * 100);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const rows = funds.map((fund, index) => {
    const value = values[index];
    const barWidth = Math.max(3, Math.abs(value / max) * 100);
    const selected = highlightSelected && fund.id === state.selectedFundId;
    return `
      <div class="leadership-row${selected ? " active" : ""}">
        <span class="leadership-name">${escapeHtml(fund.fundName)}</span>
        <span class="leadership-track"><i style="width:${barWidth}%"></i></span>
        <strong>${value.toFixed(1)}%</strong>
      </div>
    `;
  }).join("");
  target.innerHTML = `<div class="leadership-list" role="img" aria-label="Fund return comparison">${rows}</div>`;
};

const renderVerticalReturnBarChart = (id, funds) => {
  const target = $(id);
  if (!target) return;
  if (!funds.length) {
    target.innerHTML = `<div class="empty-chart">Choose funds to unlock comparison.</div>`;
    return;
  }
  const width = 360;
  const height = 250;
  const padding = { top: 28, right: 18, bottom: 48, left: 32 };
  const values = funds.map((fund) => ((fund?.[state.horizon] || 0) * 100));
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const barWidth = Math.min(90, plotWidth / Math.max(2, funds.length * 1.6));
  const gap = funds.length > 1 ? (plotWidth - barWidth * funds.length) / (funds.length - 1) : 0;
  const baseline = padding.top + plotHeight;
  const ticks = [0, max / 2, max];

  const grid = ticks.map((tick) => {
    const y = baseline - (tick / max) * plotHeight;
    return `<g><line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(255,255,255,0.08)" opacity=".08"/><text x="6" y="${y + 4}" fill="currentColor" opacity=".55" font-size="9">${tick.toFixed(0)}%</text></g>`;
  }).join("");

  const bars = funds.map((fund, index) => {
    const value = values[index];
    const barHeight = Math.max(4, Math.abs(value / max) * plotHeight);
    const x = padding.left + index * (barWidth + gap);
    const y = baseline - barHeight;
    const color = index === 0 ? "#0F766E" : "#2563EB";
    return `
      <g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="16" fill="${color}" opacity=".92"/>
        <text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" fill="currentColor" font-size="11" font-weight="900">${value.toFixed(1)}%</text>
        <text x="${x + barWidth / 2}" y="${height - 22}" text-anchor="middle" fill="currentColor" opacity=".7" font-size="10" font-weight="800">${escapeHtml((fund.fundName || "").split(" ").slice(0, 2).join(" "))}</text>
      </g>
    `;
  }).join("");

  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Vertical return comparison">${grid}${bars}</svg>`;
};

const renderCompare = () => {
  const { fundA, fundB } = compareFunds();
  if (!fundA || !fundB) {
    $("compareContent").innerHTML = `<article class="compare-card full-span"><p class="eyebrow">Compare</p><h3>Comparison unavailable</h3><p class="muted">Select a category with at least two funds to unlock cross-fund comparison.</p></article>`;
    return;
  }
  const compareKey = `${fundA.id}|${fundB.id}|${state.category}`;
  const activeA = fundA[state.horizon];
  const activeB = fundB[state.horizon];
  const leader = (activeA || 0) === (activeB || 0)
    ? `Both funds are aligned on ${horizonLabel()} return at ${formatPct(activeA)}.`
    : `${activeA > activeB ? fundA.fundName : fundB.fundName} leads the ${horizonLabel()} view by ${formatPct(Math.abs((activeA || 0) - (activeB || 0)))}.`;
  const metricRows = [
    ["Dashboard score", scoreLabel(scoreOf(fundA)), scoreLabel(scoreOf(fundB))],
    ["Current rank", `#${fundA.rank}`, `#${fundB.rank}`],
    ["1Y return", formatPct(fundA.oneYear), formatPct(fundB.oneYear)],
    ["3Y return", formatPct(fundA.threeYear), formatPct(fundB.threeYear)],
    ["5Y return", formatPct(fundA.fiveYear), formatPct(fundB.fiveYear)],
    ["Risk indicator", riskLabel(fundA), riskLabel(fundB)],
    ["Trend", fundA.trend, fundB.trend]
  ];
  const compareContent = $("compareContent");
  const existingKey = compareContent?.dataset.compareKey;
  if (compareContent && existingKey === compareKey && compareContent.querySelector(".compare-return-filter")) {
    const quickRead = $("compareLeaderText");
    const horizonHeading = $("compareHorizonHeading");
    if (quickRead) quickRead.textContent = leader;
    if (horizonHeading) horizonHeading.textContent = `${horizonLabel()} return comparison`;
    renderVerticalReturnBarChart("comparePageChart", [fundA, fundB]);
    return;
  }
  compareContent.innerHTML = `
    <article class="compare-card">
      <p class="eyebrow">Fund A</p>
      <h3>${escapeHtml(fundA.fundName)}</h3>
      <p class="muted">Rank #${fundA.rank} | Score ${scoreLabel(scoreOf(fundA))}</p>
    </article>
    <article class="compare-card">
      <p class="eyebrow">Fund B</p>
      <h3>${escapeHtml(fundB.fundName)}</h3>
      <p class="muted">Rank #${fundB.rank} | Score ${scoreLabel(scoreOf(fundB))}</p>
    </article>
    <article class="compare-card full-span">
      <p class="eyebrow">Side-by-side metrics</p>
      <h3>Compare key mutual fund metrics</h3>
      <div class="compare-metrics">
        <div class="compare-metrics-head"><span>Metric</span><span>${escapeHtml(fundA.fundName.slice(0, 16))}</span><span>${escapeHtml(fundB.fundName.slice(0, 16))}</span></div>
        ${metricRows.map((row) => `<div class="compare-metric-row"><strong>${row[0]}</strong><span>${row[1]}</span><span>${row[2]}</span></div>`).join("")}
      </div>
    </article>
    <article class="compare-card full-span">
      <p class="eyebrow">Quick read</p>
      <h3 id="compareLeaderText">${escapeHtml(leader)}</h3>
      <p class="muted">Use the return selector below to switch between 1Y, 3Y, and 5Y. The comparison stays locked to ${escapeHtml(state.category)} so the read stays category-accurate.</p>
    </article>
    <article class="compare-card full-span">
      <div class="section-head">
        <div>
          <p class="eyebrow">Return comparison</p>
          <h3 id="compareHorizonHeading">${horizonLabel()} return comparison</h3>
        </div>
      </div>
        <div class="quick-filter-row compare-return-filter selector-container">
          <button class="${state.horizon === "oneYear" ? "active" : ""}" data-horizon="oneYear">1Y</button>
          <button class="${state.horizon === "threeYear" ? "active" : ""}" data-horizon="threeYear">3Y</button>
          <button class="${state.horizon === "fiveYear" ? "active" : ""}" data-horizon="fiveYear">5Y</button>
        </div>
      <div id="comparePageChart" class="bar-chart"></div>
    </article>
  `;
  compareContent.dataset.compareKey = compareKey;
  renderVerticalReturnBarChart("comparePageChart", [fundA, fundB]);
  compareContent.querySelectorAll("[data-horizon]").forEach((button) => {
    button.addEventListener("click", () => {
      applyOptionValue("horizon", button.dataset.horizon, 0);
    });
  });
};

/* Investment planner */

const PLANNER_ALLOCATIONS = {
  conservative: [
    { label: "Large Cap Equity Funds", pct: 30, color: "#7B61FF" },
    { label: "Flexi Cap Equity Funds", pct: 10, color: "#5A4BFF" },
    { label: "Debt Funds", pct: 35, color: "#00D1B2" },
    { label: "Gold / Commodity Funds", pct: 15, color: "#FFD166" },
    { label: "Liquid / Overnight Funds", pct: 10, color: "#4DA3FF" }
  ],
  moderate: [
    { label: "Large Cap Equity Funds", pct: 40, color: "#7B61FF" },
    { label: "Flexi Cap Equity Funds", pct: 20, color: "#5A4BFF" },
    { label: "Mid Cap Equity Funds", pct: 15, color: "#00D1B2" },
    { label: "Small Cap Equity Funds", pct: 10, color: "#00E5A8" },
    { label: "Debt Funds", pct: 10, color: "#FFD166" },
    { label: "Gold / Commodity Funds", pct: 5, color: "#4DA3FF" }
  ],
  aggressive: [
    { label: "Large Cap Equity Funds", pct: 25, color: "#7B61FF" },
    { label: "Flexi Cap Equity Funds", pct: 20, color: "#5A4BFF" },
    { label: "Mid Cap Equity Funds", pct: 25, color: "#00D1B2" },
    { label: "Small Cap Equity Funds", pct: 20, color: "#00E5A8" },
    { label: "Sectoral / Thematic Funds", pct: 10, color: "#FF6B6B" }
  ]
};

const PLANNER_FUND_RECS = {
  "Large Cap Equity Funds": ["ICICI Prudential Large Cap Fund (G)", "Nippon India Large Cap Fund (G)"],
  "Flexi Cap Equity Funds": ["Parag Parikh Flexi Cap Fund (G)", "HDFC Flexi Cap Fund (G)"],
  "Mid Cap Equity Funds": ["Nippon India Growth Fund (G)", "Kotak Emerging Equity Fund (G)"],
  "Small Cap Equity Funds": ["Bandhan Small Cap Fund (G)", "Nippon India Small Cap Fund (G)"],
  "Debt Funds": ["HDFC Short Term Debt Fund (G)", "Axis Short Duration Fund (G)"],
  "Gold / Commodity Funds": ["Nippon India Gold Savings Fund (G)", "SBI Gold Fund (G)"]
};

const PLANNER_CATEGORY_MATCHES = {
  "Large Cap Equity Funds": ["large cap fund"],
  "Flexi Cap Equity Funds": ["flexi cap fund"],
  "Mid Cap Equity Funds": ["mid cap fund"],
  "Small Cap Equity Funds": ["small cap fund"],
  "Debt Funds": ["corporate bond fund", "dynamic bond", "short duration fund", "credit risk fund", "banking and psu fund", "debt fund"],
  "Gold / Commodity Funds": ["gold fund", "commodity fund"],
  "Liquid / Overnight Funds": ["liquid fund", "overnight fund"],
  "Sectoral / Thematic Funds": ["sectoral", "thematic"]
};

const plannerState = {
  amount: 5000,
  investType: "sip",
  goalText: "",
  targetAmount: null,
  years: 10,
  risk: "moderate",
  returnRate: 12.5,
  inflationRate: 6,
  resultsVisible: false
};

const formatIndianCurrency = (value) => {
  const amount = Math.max(0, Number(value) || 0);
  if (amount >= 10000000) return `\u20B9${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `\u20B9${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `\u20B9${(amount / 1000).toFixed(0)}K`;
  return `\u20B9${Math.round(amount).toLocaleString("en-IN")}`;
};

const formatExactRupees = (value) => `\u20B9${Math.max(0, Math.round(Number(value) || 0)).toLocaleString("en-IN")}`;

const roundPlannerDisplayAmount = (value) => Math.round((Number(value) || 0) / 100) * 100;

const roundedPlannerAllocations = (allocations = [], totalAmount = plannerState.amount) => {
  const rows = (allocations || []).filter(Boolean);
  if (!rows.length) return [];
  const displayTotal = roundPlannerDisplayAmount(totalAmount);
  let running = 0;
  return rows.map((item, index) => {
    const remaining = Math.max(0, displayTotal - running);
    const displayAmount = index === rows.length - 1
      ? remaining
      : Math.min(roundPlannerDisplayAmount(item.amount), remaining);
    running += displayAmount;
    return { ...item, displayAmount };
  });
};

const roundedPlannerFundEntries = (funds = [], categoryDisplayAmount = 0) => {
  const rows = (funds || []).filter(Boolean);
  if (!rows.length) return [];
  let running = 0;
  return rows.map((entry, index) => {
    const remaining = Math.max(0, categoryDisplayAmount - running);
    const displayAmount = index === rows.length - 1
      ? remaining
      : Math.min(roundPlannerDisplayAmount(entry.amount), remaining);
    running += displayAmount;
    return { ...entry, displayAmount };
  });
};

const calcProjectedValue = (principal, annualRate, years) => {
  const rate = annualRate / 100;
  return Math.round(principal * Math.pow(1 + rate, years));
};

const calcSipFutureValue = (monthlyAmount, annualRate, years) => {
  const rate = annualRate / (100 * 12);
  const months = years * 12;
  if (!months) return 0;
  if (rate === 0) return Math.round(monthlyAmount * months);
  return Math.round(monthlyAmount * ((Math.pow(1 + rate, months) - 1) / rate) * (1 + rate));
};

const calcMonthlyFV = (futureValue, annualRate, years) => {
  const rate = annualRate / (100 * 12);
  const months = years * 12;
  if (!months) return 0;
  if (rate === 0) return Math.round(futureValue / months);
  return Math.round((futureValue * rate) / (Math.pow(1 + rate, months) - 1));
};

const plannerRiskLabel = () => `${plannerState.risk.charAt(0).toUpperCase()}${plannerState.risk.slice(1)}`;

const plannerInvestAmount = () => Math.max(0, Number(plannerState.amount) || 0);
const plannerMonthlySip = () => (plannerState.investType === "sip" ? plannerInvestAmount() : 0);
const plannerLumpsumAmount = () => (plannerState.investType === "lumpsum" ? plannerInvestAmount() : 0);
const plannerAmountSuffix = () => (plannerState.investType === "sip" ? "/mo" : " once");
const plannerInvestPhrase = () => (
  plannerState.investType === "sip"
    ? `${formatExactRupees(plannerInvestAmount())}/month`
    : `one-time ${formatExactRupees(plannerInvestAmount())}`
);

const updatePlannerInsight = () => {
  const projected = calcSipFutureValue(plannerMonthlySip(), plannerState.returnRate, plannerState.years)
    + Math.round(plannerLumpsumAmount() * Math.pow(1 + plannerState.returnRate / 100, plannerState.years));
  const realProjected = Math.round(projected / Math.pow(1 + plannerState.inflationRate / 100, plannerState.years));
  const insight = $("plannerInsightText");
  if (insight) {
    insight.textContent = `${plannerInvestPhrase()} for ${plannerState.years} years can build ${formatIndianCurrency(projected)} nominally, or ${formatIndianCurrency(realProjected)} after inflation.`;
  }
};

const normalisePlannerText = (value) => String(value || "").toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim();

const plannerCategoryCandidates = (label) => {
  const liveFunds = appData?.funds || [];
  const accepted = PLANNER_CATEGORY_MATCHES[label] || [];
  if (!accepted.length) return [];
  return liveFunds.filter((fund) => {
    const category = normalisePlannerText(fund.category);
    return accepted.some((target) => {
      const wanted = normalisePlannerText(target);
      return category === wanted || category.includes(wanted);
    });
  });
};

const bestPlannerFundForCategory = (label) => {
  const candidates = plannerCategoryCandidates(label);
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const scoreDelta = scoreOf(b) - scoreOf(a);
    if (scoreDelta) return scoreDelta;
    return (a.rank || 9999) - (b.rank || 9999);
  })[0] || null;
};

const findPlannerFund = (label, fallback) => {
  const matched = bestPlannerFundForCategory(label);
  return matched?.fundName || fallback || "No matching app fund found";
};

const findPlannerFundDetail = (label, fallback) => {
  const matched = bestPlannerFundForCategory(label);
  return matched || { fundName: fallback || "No matching app fund found", rank: null, dashboardScore: null, threeYear: null, fiveYear: null, trend: "Core", category: label };
};

const topPlannerFundsForCategory = (label, limit = 2) => plannerCategoryCandidates(label)
  .sort((a, b) => {
    const scoreDelta = scoreOf(b) - scoreOf(a);
    if (scoreDelta) return scoreDelta;
    return (a.rank || 9999) - (b.rank || 9999);
  })
  .slice(0, limit);

const normaliseAllocationAmounts = (items, monthlyAmount) => {
  const valid = (items || []).filter((item) => Number(item?.pct) > 0);
  const totalPct = valid.reduce((sum, item) => sum + Number(item.pct || 0), 0);
  if (!valid.length || !totalPct) return [];
  const normalised = valid.map((item) => ({
    ...item,
    pct: (Number(item.pct || 0) / totalPct) * 100
  }));
  let running = 0;
  return normalised.map((item, index) => {
    const amount = index === normalised.length - 1
      ? Math.max(0, monthlyAmount - running)
      : Math.round((item.pct / 100) * monthlyAmount);
    running += amount;
    return {
      ...item,
      pct: Number(item.pct.toFixed(1)),
      amount
    };
  });
};

const parsePlannerMetricNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[%x,]/gi, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const plannerParamMetric = (fund, labels = []) => {
  const wanted = labels.map(normalisePlannerText);
  const params = [
    ...(fund?.parameterBreakdown || []),
    ...((fund?.analysisHistory?.new || []).flatMap((point) => point?.parameters || [])),
    ...((fund?.analysisHistory?.old || []).flatMap((point) => point?.parameters || []))
  ];
  const found = params.find((param) => wanted.some((label) => normalisePlannerText(param?.label).includes(label)));
  return parsePlannerMetricNumber(found?.value ?? found?.raw ?? found?.score ?? found?.normalized);
};

const plannerFundMetric = (fund, key) => {
  if (!fund) return null;
  const direct = {
    score: scoreOf(fund),
    oneYear: typeof fund.oneYear === "number" ? fund.oneYear * 100 : null,
    threeYear: typeof fund.threeYear === "number" ? fund.threeYear * 100 : null,
    fiveYear: typeof fund.fiveYear === "number" ? fund.fiveYear * 100 : null,
    sharpe: parsePlannerMetricNumber(fund.sharpe ?? fund.sharpeRatio),
    sortino: parsePlannerMetricNumber(fund.sortino ?? fund.sortinoRatio),
    pe: parsePlannerMetricNumber(fund.pe ?? fund.peRatio ?? fund.priceEarnings ?? fund.priceToEarnings),
    pb: parsePlannerMetricNumber(fund.pb ?? fund.pbRatio ?? fund.priceBook ?? fund.priceToBook)
  }[key];
  if (direct !== null && direct !== undefined && Number.isFinite(direct)) return direct;
  const fallbackLabels = {
    sharpe: ["sharpe"],
    sortino: ["sortino"],
    pe: ["p/e", "pe ratio", "price to earnings"],
    pb: ["p/b", "pb ratio", "price to book"]
  }[key] || [];
  return plannerParamMetric(fund, fallbackLabels);
};

const plannerAverage = (items, getter) => {
  const values = items.map(getter).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

const plannerCategoryAverages = (label) => {
  const funds = plannerCategoryCandidates(label);
  return {
    funds,
    score: plannerAverage(funds, (fund) => plannerFundMetric(fund, "score")),
    oneYear: plannerAverage(funds, (fund) => plannerFundMetric(fund, "oneYear")),
    threeYear: plannerAverage(funds, (fund) => plannerFundMetric(fund, "threeYear")),
    fiveYear: plannerAverage(funds, (fund) => plannerFundMetric(fund, "fiveYear")),
    sharpe: plannerAverage(funds, (fund) => plannerFundMetric(fund, "sharpe")),
    sortino: plannerAverage(funds, (fund) => plannerFundMetric(fund, "sortino")),
    pe: plannerAverage(funds, (fund) => plannerFundMetric(fund, "pe")),
    pb: plannerAverage(funds, (fund) => plannerFundMetric(fund, "pb"))
  };
};

const plannerBeatsBy = (value, average, pct) => Number.isFinite(value) && Number.isFinite(average) && average !== 0 && value > average * (1 + pct);
const plannerDiscountBy = (value, average, pct) => Number.isFinite(value) && Number.isFinite(average) && average > 0 && value < average * (1 - pct);

const plannerWhyTag = (fund, label) => {
  if (!fund) return `A steady fit for the ${label} sleeve`;
  const averages = plannerCategoryAverages(label);
  const rank = Number(fund.rank || 0);
  const sharpe = plannerFundMetric(fund, "sharpe");
  const pe = plannerFundMetric(fund, "pe");
  const sortino = plannerFundMetric(fund, "sortino");
  const fiveYear = plannerFundMetric(fund, "fiveYear");
  const threeYear = plannerFundMetric(fund, "threeYear");
  const oneYear = plannerFundMetric(fund, "oneYear");
  const pb = plannerFundMetric(fund, "pb");
  if (plannerBeatsBy(sharpe, averages.sharpe, 0.20)) return "Picked for stronger risk-adjusted returns";
  if (plannerDiscountBy(pe, averages.pe, 0.15)) return "Adds value exposure without chasing price";
  if (plannerBeatsBy(sortino, averages.sortino, 0.15)) return "Chosen for better downside control";
  if (plannerBeatsBy(fiveYear, averages.fiveYear, 0.10)) return "Keeps the long-term engine steady";
  if (plannerBeatsBy(threeYear, averages.threeYear, 0.10)) return "Brings a reliable three-year track record";
  if (plannerBeatsBy(oneYear, averages.oneYear, 0.15)) return "Adds recent momentum to the plan";
  if (plannerDiscountBy(pb, averages.pb, 0.15)) return "Balances growth with reasonable valuation";
  if (rank === 1) return "Anchors this bucket with top category score";
  return `Keeps the ${label.replace(" Equity Funds", "").replace(" Funds", "")} sleeve disciplined`;
};

const splitFundAmounts = (funds, categoryAmount, categoryLabel = "") => {
  const usable = (funds || []).slice(0, 2);
  if (!usable.length || !categoryAmount) return [];
  const weights = usable.length === 1 ? [100] : [60, 40];
  let running = 0;
  return usable.map((fund, index) => {
    const pct = weights[index] || 0;
    const amount = index === usable.length - 1
      ? Math.max(0, categoryAmount - running)
      : Math.round((categoryAmount * pct) / 100);
    running += amount;
    return {
      fund,
      pct,
      amount,
      reason: plannerWhyTag(fund, categoryLabel)
    };
  });
};

const plannerGoalKeywordMap = [
  ["House Purchase", ["house", "home", "flat", "apartment", "villa", "property", "plot", "ghar", "makaan", "down payment", "booking amount", "construction", "renovation", "home loan"], { isTimebound: true, needsCapitalSafety: true }],
  ["Education", ["education", "college", "university", "school", "fees", "iit", "iim", "mbbs", "abroad", "ms", "mba", "phd", "masters", "higher studies", "child education", "son college", "daughter college", "foreign university"], { isTimebound: true, needsCapitalSafety: true }],
  ["Wedding", ["wedding", "marriage", "shaadi", "nikah", "engagement", "honeymoon", "reception", "lehenga", "destination wedding", "daughter wedding"], { isTimebound: true, needsCapitalSafety: true }],
  ["Vehicle", ["car", "bike", "motorcycle", "ev", "suv", "sedan", "porsche", "bmw", "mercedes", "royal enfield", "tesla", "two wheeler", "four wheeler", "car loan"], { isTimebound: true, needsCapitalSafetyWhenYearsBelow: 5 }],
  ["Retirement", ["retire", "retirement", "pension", "financial freedom", "fire", "fat fire", "coast fire", "quit job", "passive income", "early retirement", "retire at", "no more 9 to 5"], { isLongterm: true }],
  ["Travel", ["travel", "trip", "vacation", "bali", "europe", "dubai", "maldives", "thailand", "japan", "london", "paris", "cruise", "world tour", "solo trip"], { isTimebound: true, needsCapitalSafetyWhenYearsBelow: 3, superShortWhenYearsAtMost: 1 }],
  ["Gadget", ["iphone", "macbook", "laptop", "gaming pc", "ps5", "xbox", "camera", "drone", "ipad", "airpods", "battlestation", "tech setup"], { isTimebound: true, needsCapitalSafetyWhenYearsBelow: 3, superShortWhenYearsAtMost: 2 }],
  ["Business", ["business", "startup", "franchise", "shop", "office", "seed capital", "own business", "side hustle", "agency", "restaurant", "cafe", "ecommerce"], { isTimebound: true, needsCapitalSafety: true }],
  ["Emergency", ["emergency", "safety net", "rainy day", "contingency", "job loss", "medical emergency", "cushion", "backup fund"], { needsCapitalSafety: true, isSuperShortTerm: true }],
  ["Child Future", ["child", "kids", "baby", "son", "daughter", "baccha", "newborn", "child future", "secure child"], { isTimebound: true, longtermWhenYearsAbove: 10 }],
  ["Parents", ["parents", "mother", "father", "maa", "papa", "family support", "medical parents", "elder care", "old age"], { isTimebound: true, needsCapitalSafety: true }],
  ["Luxury", ["luxury", "rolex", "designer", "gucci", "jewellery", "gold", "diamond", "branded", "lifestyle upgrade"], { isTimebound: true, needsCapitalSafetyWhenYearsBelow: 5 }],
  ["General Wealth", ["wealth", "grow", "invest", "corpus", "multiply", "compounding", "beat inflation", "just saving", "no goal", "general", "passive income"], { isFlexible: true }]
];

const parsePlannerGoalProfile = () => {
  const rawGoal = String(plannerState.goalText || "").trim() || "wealth creation";
  const text = normalisePlannerText(rawGoal);
  const years = Number(plannerState.years) || 10;
  const flags = { isTimebound: false, isLongterm: false, needsCapitalSafety: false, isFlexible: false, isSuperShortTerm: false };
  const matchedTypes = [];

  plannerGoalKeywordMap.forEach(([type, keywords, rules]) => {
    if (!keywords.some((keyword) => text.includes(normalisePlannerText(keyword)))) return;
    matchedTypes.push(type);
    if (rules.isTimebound) flags.isTimebound = true;
    if (rules.isLongterm) flags.isLongterm = true;
    if (rules.needsCapitalSafety) flags.needsCapitalSafety = true;
    if (rules.isFlexible) flags.isFlexible = true;
    if (rules.isSuperShortTerm) flags.isSuperShortTerm = true;
    if (rules.needsCapitalSafetyWhenYearsBelow && years < rules.needsCapitalSafetyWhenYearsBelow) flags.needsCapitalSafety = true;
    if (rules.superShortWhenYearsAtMost && years <= rules.superShortWhenYearsAtMost) flags.isSuperShortTerm = true;
    if (rules.longtermWhenYearsAbove && years > rules.longtermWhenYearsAbove) flags.isLongterm = true;
  });

  if (!matchedTypes.length) {
    matchedTypes.push("General Wealth");
    flags.isFlexible = true;
  }
  if (years <= 1) {
    flags.needsCapitalSafety = true;
    flags.isSuperShortTerm = true;
  }
  if (years <= 3) flags.needsCapitalSafety = true;
  if (years > 15) flags.isLongterm = true;

  return { rawGoal, detectedType: matchedTypes[0], flags };
};

const plannerNormalisePctRows = (rows) => {
  const valid = (rows || []).filter((item) => Number(item?.pct) > 0);
  const total = valid.reduce((sum, item) => sum + Number(item.pct || 0), 0);
  if (!valid.length || !total) return [];
  return valid.map((item) => ({ ...item, pct: (Number(item.pct || 0) / total) * 100 }));
};

const buildSmartPlannerAllocations = () => {
  const goalProfile = parsePlannerGoalProfile();
  const flags = goalProfile.flags;
  const risk = plannerState.returnRate < 8 ? "conservative" : (plannerState.risk || "moderate");
  const years = Number(plannerState.years) || 10;
  const inflation = Number(plannerState.inflationRate) || 6;
  const expectedReturn = Number(plannerState.returnRate) || 12.5;
  const base = {
    conservative: { equity: 30, debt: 55, gold: 15 },
    moderate: { equity: 60, debt: 30, gold: 10 },
    aggressive: { equity: 80, debt: 15, gold: 5 }
  }[risk] || { equity: 60, debt: 30, gold: 10 };
  const mix = { ...base };
  const warnings = [];
  let safetyOverride = false;

  if (flags.needsCapitalSafety) {
    if (years < 3) {
      mix.equity = Math.min(mix.equity, 20);
      mix.debt = 75;
      mix.gold = 5;
      safetyOverride = true;
    } else if (years <= 5) {
      mix.equity = Math.min(mix.equity, 40);
      mix.debt = Math.max(mix.debt, 50);
      safetyOverride = true;
    } else if (years <= 7) {
      mix.equity = Math.min(mix.equity, 55);
      mix.debt = Math.max(mix.debt, 35);
      safetyOverride = true;
    }
  }

  if (flags.isLongterm && years > 10) {
    const shift = Math.min(10, mix.debt, 90 - mix.equity);
    mix.equity += shift;
    mix.debt = Math.max(5, mix.debt - shift);
  }

  if (flags.isSuperShortTerm) {
    mix.equity = 10;
    mix.debt = 85;
    mix.gold = 5;
    safetyOverride = true;
    warnings.push("For goals under 2 years, liquid and ultra-short debt funds are prioritized.");
  }

  if (!safetyOverride) {
    if (years < 3) {
      const shift = Math.min(20, mix.equity);
      mix.equity -= shift;
      mix.debt += shift;
    } else if (years < 5) {
      const shift = Math.min(10, mix.equity);
      mix.equity -= shift;
      mix.debt += shift;
    } else if (years > 15) {
      const firstShift = Math.min(10, mix.debt, 90 - mix.equity);
      mix.equity += firstShift;
      mix.debt -= firstShift;
      const secondShift = Math.min(5, mix.debt, 90 - mix.equity);
      mix.equity += secondShift;
      mix.debt -= secondShift;
    } else if (years > 10) {
      const shift = Math.min(10, mix.debt, 90 - mix.equity);
      mix.equity += shift;
      mix.debt -= shift;
    }
  }

  let largeCapBoost = 0;
  if (inflation > 7.5) {
    const shift = Math.min(5, mix.debt);
    mix.debt -= shift;
    mix.gold += shift;
  } else if (inflation > 6.5) {
    const shift = Math.min(3, mix.debt);
    mix.debt -= shift;
    mix.gold += shift;
  } else if (inflation < 4.5) {
    const shift = Math.min(3, mix.gold);
    mix.gold -= shift;
    mix.equity += shift;
    largeCapBoost = 3;
  } else if (inflation < 5.5) {
    const shift = Math.min(2, mix.gold);
    mix.gold -= shift;
    mix.equity += shift;
    largeCapBoost = 2;
  }

  const colors = {
    "Large Cap Equity Funds": "#7B61FF",
    "Flexi Cap Equity Funds": "#5A4BFF",
    "Mid Cap Equity Funds": "#00D1B2",
    "Small Cap Equity Funds": "#00E5A8",
    "Sectoral / Thematic Funds": "#FF6B6B",
    "Debt Funds": "#FFD166",
    "Gold / Commodity Funds": "#4DA3FF"
  };

  const subProfile = expectedReturn < 8 ? "conservative" : risk;
  const baseSub = {
    conservative: { large: 55, flexi: 30, mid: 15, small: 0, thematic: 0 },
    moderate: { large: 35, flexi: 25, mid: 25, small: 10, thematic: 5 },
    aggressive: { large: 20, flexi: 20, mid: 25, small: 20, thematic: 15 }
  }[subProfile] || { large: 35, flexi: 25, mid: 25, small: 10, thematic: 5 };
  const sub = { ...baseSub, large: baseSub.large + largeCapBoost };
  if (years > 15) {
    sub.small += 5;
    sub.large -= 5;
  }
  if (years < 5) {
    const removedSmall = Math.max(0, sub.small);
    sub.small = 0;
    sub.flexi += 5;
    sub.large += Math.max(0, removedSmall - 5);
  }
  if (expectedReturn > 14) {
    sub.small += 5;
    sub.mid += 5;
    sub.large -= 10;
  } else if (expectedReturn > 12) {
    sub.mid += 5;
    sub.large -= 5;
  } else if (expectedReturn < 10) {
    sub.small = 0;
    sub.mid = Math.max(0, sub.mid - 5);
    sub.large += 5;
  }
  if (flags.needsCapitalSafety && years < 5) sub.small = 0;
  if (flags.needsCapitalSafety && years < 3) sub.mid = 0;

  const normalizedSub = plannerNormalisePctRows([
    { key: "large", pct: Math.max(0, sub.large) },
    { key: "flexi", pct: Math.max(0, sub.flexi) },
    { key: "mid", pct: Math.max(0, sub.mid) },
    { key: "small", pct: Math.max(0, sub.small) },
    { key: "thematic", pct: Math.max(0, sub.thematic) }
  ]).reduce((acc, item) => ({ ...acc, [item.key]: item.pct }), {});
  const normalizedMix = plannerNormalisePctRows([
    { key: "equity", pct: Math.max(0, mix.equity) },
    { key: "debt", pct: Math.max(0, mix.debt) },
    { key: "gold", pct: Math.max(0, mix.gold) }
  ]).reduce((acc, item) => ({ ...acc, [item.key]: item.pct }), {});

  const equity = normalizedMix.equity || 0;
  const desired = [
    { label: "Large Cap Equity Funds", pct: equity * ((normalizedSub.large || 0) / 100), color: colors["Large Cap Equity Funds"], type: "equity" },
    { label: "Flexi Cap Equity Funds", pct: equity * ((normalizedSub.flexi || 0) / 100), color: colors["Flexi Cap Equity Funds"], type: "equity" },
    { label: "Mid Cap Equity Funds", pct: equity * ((normalizedSub.mid || 0) / 100), color: colors["Mid Cap Equity Funds"], type: "equity" },
    { label: "Small Cap Equity Funds", pct: equity * ((normalizedSub.small || 0) / 100), color: colors["Small Cap Equity Funds"], type: "equity" },
    { label: "Sectoral / Thematic Funds", pct: equity * ((normalizedSub.thematic || 0) / 100), color: colors["Sectoral / Thematic Funds"], type: "equity" },
    { label: flags.isSuperShortTerm ? "Liquid / Overnight Funds" : "Debt Funds", pct: normalizedMix.debt || 0, color: colors["Debt Funds"], type: "debt" },
    { label: "Gold / Commodity Funds", pct: normalizedMix.gold || 0, color: colors["Gold / Commodity Funds"], type: "gold" }
  ];

  const available = plannerNormalisePctRows(desired.filter((item) => item.pct > 0 && plannerCategoryCandidates(item.label).length > 0));
  available.goalProfile = goalProfile;
  available.assetMix = {
    equity: Number((normalizedMix.equity || 0).toFixed(1)),
    debt: Number((normalizedMix.debt || 0).toFixed(1)),
    gold: Number((normalizedMix.gold || 0).toFixed(1))
  };
  available.warnings = warnings;
  return available;
};

const plannerAllocations = () => {
  const rawAllocations = buildSmartPlannerAllocations();
  const allocations = normaliseAllocationAmounts(rawAllocations, plannerState.amount).map((allocation) => {
    const funds = splitFundAmounts(topPlannerFundsForCategory(allocation.label, 2), allocation.amount, allocation.label);
    return { ...allocation, funds };
  });
  allocations.goalProfile = rawAllocations.goalProfile || parsePlannerGoalProfile();
  allocations.assetMix = rawAllocations.assetMix || {};
  allocations.warnings = rawAllocations.warnings || [];
  return allocations;
};

const plannerPortfolioProjection = () => {
  const allocations = plannerAllocations();
  const years = Number(plannerState.years) || 10;
  const monthly = plannerMonthlySip();
  const lumpsum = plannerLumpsumAmount();
  const targetAmount = null;
  const sipCorpus = calcSipFutureValue(monthly, plannerState.returnRate, years);
  const lumpsumCorpus = Math.round(lumpsum * Math.pow(1 + plannerState.returnRate / 100, years));
  const projected = sipCorpus + lumpsumCorpus;
  const realReturn = (((1 + plannerState.returnRate / 100) / (1 + plannerState.inflationRate / 100)) - 1) * 100;
  const realProjected = Math.round(projected / Math.pow(1 + plannerState.inflationRate / 100, years));
  const totalInvestment = (monthly * years * 12) + lumpsum;
  const estimatedGain = Math.max(0, projected - totalInvestment);
  const inflationErosion = Math.max(0, projected - realProjected);
  const inflationErosionPct = projected ? (inflationErosion / projected) * 100 : 0;
  const sipSharePct = projected ? (sipCorpus / projected) * 100 : 0;
  const lumpsumSharePct = projected ? (lumpsumCorpus / projected) * 100 : 0;
  const rate = plannerState.returnRate / 100 / 12;
  const months = years * 12;
  const annuityFactor = rate === 0 ? months : ((Math.pow(1 + rate, months) - 1) / rate) * (1 + rate);
  const gap = targetAmount ? targetAmount - projected : null;
  const additionalSIPNeeded = targetAmount && gap > 0 && annuityFactor
    ? Math.max(0, Math.ceil(((targetAmount - lumpsumCorpus) / annuityFactor) - monthly))
    : null;
  const additionalLumpsumNeeded = targetAmount && gap > 0
    ? Math.max(0, Math.ceil(gap / Math.pow(1 + plannerState.returnRate / 100, years)))
    : null;
  return {
    projected,
    sipCorpus,
    lumpsumCorpus,
    realProjected,
    realReturn,
    totalInvestment,
    estimatedGain,
    inflationErosion,
    inflationErosionPct,
    sipSharePct,
    lumpsumSharePct,
    goalProfile: allocations.goalProfile || parsePlannerGoalProfile(),
    assetMix: allocations.assetMix || {},
    gapAnalysis: {
      hasTarget: Boolean(targetAmount),
      targetAmount,
      gap,
      onTrack: targetAmount ? gap <= 0 : null,
      yearsAhead: null,
      additionalSIPNeeded,
      additionalLumpsumNeeded,
      message: targetAmount
        ? (gap <= 0
          ? `You're on track for ${formatIndianCurrency(targetAmount)} with this plan.`
          : `You're ${formatIndianCurrency(gap)} short. Add about ${formatExactRupees(additionalSIPNeeded)}/month or ${formatIndianCurrency(additionalLumpsumNeeded)} today.`)
        : ""
    },
    warnings: [
      ...(allocations.warnings || []),
      ...(inflationErosionPct > 30 ? [`Inflation is eating ${inflationErosionPct.toFixed(0)}% of nominal returns.`] : [])
    ],
    allocations
  };
};

const plannerFlatFundEntries = (allocations = []) => allocations.flatMap((category) => (
  (category.funds || []).map((entry) => ({ ...entry, category }))
));

const buildPlannerPlanExplanation = (projection = plannerPortfolioProjection()) => {
  const { projected, realProjected, realReturn, totalInvestment, estimatedGain, allocations, gapAnalysis, goalProfile } = projection;
  const displayAllocations = roundedPlannerAllocations(allocations);
  const displayAmountFor = (item) => displayAllocations.find((row) => row.label === item?.label)?.displayAmount ?? item?.amount ?? 0;
  const topCategory = [...allocations].sort((a, b) => b.amount - a.amount)[0];
  const flatFunds = plannerFlatFundEntries(allocations);
  const topFundEntry = flatFunds
    .slice()
    .sort((a, b) => scoreOf(b.fund) - scoreOf(a.fund))[0];
  const riskLabel = plannerRiskLabel().toLowerCase();
  const topCategoryName = topCategory?.label?.replace(" Equity Funds", "").replace(" Funds", "") || "core categories";
  const topFundName = topFundEntry?.fund?.fundName || "the highest-scored fund";
  const topFundReason = topFundEntry?.reason || "top rated in its category";
  const gold = allocations.find((item) => normalisePlannerText(item.label).includes("gold"));
  const debt = allocations.find((item) => normalisePlannerText(item.label).includes("debt"));
  const midSmall = allocations.filter((item) => /mid cap|small cap/i.test(item.label));
  const midSmallPct = midSmall.reduce((sum, item) => sum + Number(item.pct || 0), 0);

  const journey = plannerState.investType === "sip"
    ? `Every month, ${formatExactRupees(plannerInvestAmount())} is split across ${allocations.length} sleeves`
    : `Your one-time ${formatIndianCurrency(plannerInvestAmount())} starts working across ${allocations.length} sleeves`;
  const sentences = [
    `${journey}, with ${topCategoryName} carrying the biggest role at ${topCategory?.pct || 0}% (${formatExactRupees(displayAmountFor(topCategory))}${plannerAmountSuffix()}) for this ${riskLabel} ${plannerState.years}-year journey.`,
    `If the plan compounds at ${plannerState.returnRate}% p.a., it can grow to ${formatIndianCurrency(projected)}, while today's-money value is closer to ${formatIndianCurrency(realProjected)} after ${plannerState.inflationRate}% inflation.`
  ];

  if (gapAnalysis?.hasTarget && gapAnalysis.gap > 0) {
    sentences.push(`${gapAnalysis.message}`);
  } else if (plannerState.investType === "lumpsum") {
    sentences.push(`${topFundName} is the lead character inside the fund mix because it ${topFundReason.toLowerCase()}, helping the upfront money stay focused.`);
  } else if (plannerState.inflationRate > 6.5 && gold) {
    sentences.push(`Because inflation is running high, gold gets ${gold.pct}% (${formatExactRupees(displayAmountFor(gold))}${plannerAmountSuffix()}) as the shock absorber while ${topFundName} keeps the growth side moving.`);
  } else if (plannerState.years < 5 && debt) {
    sentences.push(`Since the runway is short, debt gets ${debt.pct}% (${formatExactRupees(displayAmountFor(debt))}${plannerAmountSuffix()}) so the plan is not forced to depend only on market timing.`);
  } else if (plannerState.years > 15 && midSmallPct > 0) {
    sentences.push(`The ${plannerState.years}-year runway gives mid/small caps room to breathe, so ${midSmallPct.toFixed(1)}% goes there while ${topFundName} anchors the selected funds.`);
  } else if (plannerState.risk === "conservative" && plannerState.years > 10) {
    sentences.push(`The conservative mix protects capital, but with ${plannerState.years} years available, the lower equity weight can reduce upside versus a moderate plan.`);
  } else if (realReturn < 4) {
    sentences.push(`Your real return is only ${realReturn.toFixed(1)}% after inflation, so the plan leans on stronger category leaders like ${topFundName}.`);
  } else {
    sentences.push(`${topFundName} leads the selected funds because it ${topFundReason.toLowerCase()}, and the plan estimates ${formatIndianCurrency(estimatedGain)} of wealth creation over time.`);
  }

  return sentences.slice(0, 3);
};

const SAVED_PORTFOLIOS_KEY = "funalytics-planner-saved-portfolios-v1";
const LEGACY_SAVED_PORTFOLIO_KEY = "funalytics-planner-saved-plan";

const safeJsonParse = (value, fallback = null) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const savedPortfolioDefaultName = () => `${plannerRiskLabel()} ${plannerState.investType === "sip" ? "SIP" : "Lumpsum"} - ${plannerState.years}Y`;

const currentPlannerSavedSnapshot = (name) => {
  const projection = plannerPortfolioProjection();
  const displayAllocations = roundedPlannerAllocations(projection.allocations);
  const topFund = plannerFlatFundEntries(projection.allocations)
    .slice()
    .sort((a, b) => scoreOf(b.fund) - scoreOf(a.fund))[0];
  return {
    id: `folio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || savedPortfolioDefaultName()).trim() || savedPortfolioDefaultName(),
    savedAt: new Date().toISOString(),
    state: {
      amount: plannerState.amount,
      investType: plannerState.investType,
      years: plannerState.years,
      risk: plannerState.risk,
      returnRate: plannerState.returnRate,
      inflationRate: plannerState.inflationRate
    },
    summary: {
      projected: projection.projected,
      realProjected: projection.realProjected,
      totalInvestment: projection.totalInvestment,
      estimatedGain: projection.estimatedGain,
      investPhrase: plannerInvestPhrase(),
      riskLabel: plannerRiskLabel(),
      allocationCount: displayAllocations.length,
      topFundName: topFund?.fund?.fundName || ""
    }
  };
};

const normaliseSavedPortfolio = (plan, index = 0) => {
  if (!plan || typeof plan !== "object") return null;
  const stateSource = plan.state || plan;
  const amount = Number(stateSource.amount);
  const years = Number(stateSource.years);
  const returnRate = Number(stateSource.returnRate);
  const inflationRate = Number(stateSource.inflationRate);
  return {
    id: plan.id || `legacy-${index}-${Number(new Date(plan.savedAt || Date.now())) || Date.now()}`,
    name: String(plan.name || `Saved Portfolio ${index + 1}`).trim(),
    savedAt: plan.savedAt || new Date().toISOString(),
    state: {
      amount: Number.isFinite(amount) && amount > 0 ? amount : 5000,
      investType: stateSource.investType === "lumpsum" ? "lumpsum" : "sip",
      years: Number.isFinite(years) && years > 0 ? years : 10,
      risk: ["conservative", "moderate", "aggressive"].includes(stateSource.risk) ? stateSource.risk : "moderate",
      returnRate: Number.isFinite(returnRate) ? returnRate : 12.5,
      inflationRate: Number.isFinite(inflationRate) ? inflationRate : 6
    },
    summary: plan.summary || {}
  };
};

const readSavedPortfolios = () => {
  const current = safeJsonParse(localStorage.getItem(SAVED_PORTFOLIOS_KEY), []);
  const plans = Array.isArray(current) ? current.map(normaliseSavedPortfolio).filter(Boolean) : [];
  const legacy = safeJsonParse(localStorage.getItem(LEGACY_SAVED_PORTFOLIO_KEY), null);
  if (legacy && !plans.some((plan) => plan.id === "legacy-portfolio")) {
    const migrated = normaliseSavedPortfolio({ ...legacy, id: "legacy-portfolio", name: "Saved Portfolio" }, plans.length);
    if (migrated) {
      plans.push(migrated);
      localStorage.setItem(SAVED_PORTFOLIOS_KEY, JSON.stringify(plans));
    }
    localStorage.removeItem(LEGACY_SAVED_PORTFOLIO_KEY);
  }
  return plans.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
};

const writeSavedPortfolios = (plans) => {
  localStorage.setItem(SAVED_PORTFOLIOS_KEY, JSON.stringify((plans || []).map(normaliseSavedPortfolio).filter(Boolean)));
};

const bindSavedPortfolioActions = (root = document) => {
  root.querySelectorAll("[data-open-saved-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      const plan = readSavedPortfolios().find((item) => item.id === button.dataset.openSavedPlan);
      applySavedPortfolio(plan);
    });
  });
  root.querySelectorAll("[data-delete-saved-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = readSavedPortfolios().filter((item) => item.id !== button.dataset.deleteSavedPlan);
      writeSavedPortfolios(next);
      if (state.tab === "saved-plans") {
        renderSavedPlans();
      } else {
        showSavedPortfoliosModal();
      }
    });
  });
};

const applySavedPortfolio = (plan) => {
  const saved = normaliseSavedPortfolio(plan);
  if (!saved) return;
  plannerState.amount = Number(saved.state.amount) || 5000;
  plannerState.investType = saved.state.investType === "lumpsum" ? "lumpsum" : "sip";
  plannerState.years = Number(saved.state.years) || 10;
  plannerState.risk = saved.state.risk || "moderate";
  plannerState.returnRate = Number(saved.state.returnRate) || 12.5;
  plannerState.inflationRate = Number(saved.state.inflationRate) || 6;
  plannerState.resultsVisible = true;
  renderPlanner();
  renderPortfolio();
  closeGlobalModal();
  navigateToTab("portfolio");
};

const savedPortfolioCardMarkup = (plan) => {
  const saved = normaliseSavedPortfolio(plan);
  if (!saved) return "";
  const tempState = { ...plannerState };
  Object.assign(plannerState, saved.state);
  const projection = plannerPortfolioProjection();
  const topFund = saved.summary?.topFundName || plannerFlatFundEntries(projection.allocations)
    .slice()
    .sort((a, b) => scoreOf(b.fund) - scoreOf(a.fund))[0]?.fund?.fundName || "Selected fund mix";
  Object.assign(plannerState, tempState);
  const savedDate = new Date(saved.savedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return `<article class="saved-plan-card" data-saved-plan-id="${escapeHtml(saved.id)}">
    <div class="saved-plan-card__main">
      <p class="eyebrow">Saved portfolio</p>
      <h3>${escapeHtml(saved.name)}</h3>
      <p class="saved-plan-story">${escapeHtml(`${saved.state.investType === "sip" ? formatExactRupees(saved.state.amount) + "/mo" : formatIndianCurrency(saved.state.amount)} gets a ${saved.state.risk} ${saved.state.years}-year route, led by ${topFund}.`)}</p>
    </div>
    <div class="saved-plan-card__stats">
      <span><strong>${escapeHtml(formatIndianCurrency(projection.projected))}</strong><small>Projected</small></span>
      <span><strong>${escapeHtml(formatIndianCurrency(projection.realProjected))}</strong><small>Today's value</small></span>
    </div>
    <div class="saved-plan-card__meta">
      <span>Saved ${escapeHtml(savedDate)}</span>
      <span>${escapeHtml(saved.state.risk.replace(/^./, (c) => c.toUpperCase()))} risk</span>
    </div>
    <div class="saved-plan-card__actions">
      <button class="saved-plan-open" data-open-saved-plan="${escapeHtml(saved.id)}" type="button">Open</button>
      <button class="saved-plan-delete" data-delete-saved-plan="${escapeHtml(saved.id)}" type="button" aria-label="Delete ${escapeHtml(saved.name)}">Delete</button>
    </div>
  </article>`;
};

const showSavedPortfoliosModal = () => {
  const plans = readSavedPortfolios();
  const html = `<div class="saved-plans-modal">
    <p class="eyebrow">Dashboard saved portfolios</p>
    <h2>Your Saved Plans</h2>
    <p class="story-copy">${plans.length ? "Pick up any plan exactly where you left it, or keep separate versions for different goals." : "No saved portfolios yet. Generate a plan, save it with a name, and it will live here."}</p>
    <div class="saved-plans-list">
      ${plans.length ? plans.map(savedPortfolioCardMarkup).join("") : `<article class="saved-plan-empty"><h3>No portfolios saved</h3><p class="muted">Create one from the planner and name it your way.</p><button class="planner-action-btn primary" id="savedPlanStartBtn" type="button">Start Planning</button></article>`}
    </div>
  </div>`;
  if (!openGlobalModal(html, { kind: "saved-plans", size: "wide" })) return;
  bindSavedPortfolioActions();
  $("savedPlanStartBtn")?.addEventListener("click", () => {
    closeGlobalModal();
    window.setTimeout(() => navigateToTab("planner"), MODAL_ANIMATION_MS + 20);
  });
};

const renderSavedPlans = () => {
  const count = $("savedPlansCount");
  const list = $("savedPlansList");
  const hint = $("savedPlansHint");
  if (!list) return;
  const plans = readSavedPortfolios();
  if (count) count.textContent = `${plans.length}/10 saved`;
  if (hint) hint.textContent = plans.length
    ? "Open a saved plan to review the exact portfolio, or delete an older one to make room."
    : "Save a generated portfolio and it will appear here.";
  list.innerHTML = plans.length
    ? plans.map(savedPortfolioCardMarkup).join("")
    : `<article class="saved-plan-empty saved-plan-empty--page"><h3>No saved portfolios yet</h3><p class="muted">Generate a plan, tap Save Plan, and give it a name.</p><button class="planner-action-btn primary" id="savedPlansCreateBtn" type="button">Create Portfolio</button></article>`;
  bindSavedPortfolioActions(list);
  $("savedPlansCreateBtn")?.addEventListener("click", () => navigateToTab("planner"));
};

const showSaveLimitModal = () => {
  const html = `<div class="save-plan-modal">
    <p class="eyebrow">Saved plan limit</p>
    <h2>Maximum 10 portfolios can be saved</h2>
    <p class="story-copy">Delete an older saved portfolio to make space for this new one.</p>
    <div class="save-plan-actions">
      <button class="planner-action-btn secondary" id="saveLimitCancel" type="button">Cancel</button>
      <button class="planner-action-btn primary" id="saveLimitManage" type="button">Manage Saved Plans</button>
    </div>
  </div>`;
  if (!openGlobalModal(html, { kind: "save-limit" })) return;
  $("saveLimitCancel")?.addEventListener("click", () => closeGlobalModal());
  $("saveLimitManage")?.addEventListener("click", () => {
    closeGlobalModal();
    window.setTimeout(() => navigateToTab("saved-plans"), MODAL_ANIMATION_MS + 20);
  });
};

const openSavePortfolioModal = () => {
  const projection = plannerPortfolioProjection();
  const suggestedName = savedPortfolioDefaultName();
  const html = `<div class="save-plan-modal">
    <p class="eyebrow">Save portfolio</p>
    <h2>Name this plan</h2>
    <p class="story-copy">Give this version a name so you can compare it later from Dashboard > Saved Plans.</p>
    <label class="save-plan-label" for="savePortfolioName">Portfolio name</label>
    <input class="save-plan-input" id="savePortfolioName" type="text" maxlength="44" value="${escapeHtml(suggestedName)}" placeholder="My 10Y SIP plan" />
    <div class="save-plan-preview">
      <span><strong>${escapeHtml(formatIndianCurrency(projection.projected))}</strong><small>Projected corpus</small></span>
      <span><strong>${escapeHtml(plannerInvestPhrase())}</strong><small>Investment</small></span>
    </div>
    <div class="save-plan-actions">
      <button class="planner-action-btn secondary" id="cancelSavePortfolio" type="button">Cancel</button>
      <button class="planner-action-btn primary" id="confirmSavePortfolio" type="button">Save Portfolio</button>
    </div>
  </div>`;
  if (!openGlobalModal(html, { kind: "save-plan" })) return;
  const input = $("savePortfolioName");
  input?.focus();
  input?.select();
  $("cancelSavePortfolio")?.addEventListener("click", () => closeGlobalModal());
  $("confirmSavePortfolio")?.addEventListener("click", () => {
    const name = String(input?.value || "").trim() || suggestedName;
    const plans = readSavedPortfolios();
    if (plans.length >= 10) {
      showSaveLimitModal();
      return;
    }
    plans.unshift(currentPlannerSavedSnapshot(name));
    writeSavedPortfolios(plans);
    const button = $("portfolioSaveBtn");
    if (button) {
      button.textContent = "Saved";
      window.setTimeout(() => {
        button.textContent = "Save Plan";
      }, 1400);
    }
    closeGlobalModal();
    plannerState.resultsVisible = false;
    renderSavedPlans();
    renderPlanner();
    window.setTimeout(() => navigateToTab("planner"), MODAL_ANIMATION_MS + 20);
  });
};

const renderPlannerResults = ({ scroll = false } = {}) => {
  const projection = plannerPortfolioProjection();
  const { projected, realProjected, totalInvestment, allocations } = projection;

  if ($("plannerProjectedValue")) $("plannerProjectedValue").textContent = formatIndianCurrency(projected);
  if ($("plannerRealValue")) $("plannerRealValue").textContent = formatIndianCurrency(realProjected);
  if ($("plannerSipValue")) $("plannerSipValue").textContent = formatIndianCurrency(totalInvestment);
  if ($("plannerProjectedSub")) $("plannerProjectedSub").textContent = `Total contribution ${formatIndianCurrency(totalInvestment)} | Return ${plannerState.returnRate}% | Inflation ${plannerState.inflationRate}%`;
  if ($("plannerRiskBadge")) $("plannerRiskBadge").textContent = `${plannerRiskLabel()} Risk`;
  if ($("plannerWhyRisk")) $("plannerWhyRisk").textContent = `Calibrated to ${plannerRiskLabel()} risk profile`;
  if ($("plannerWhyDuration")) $("plannerWhyDuration").textContent = `Optimised for ${plannerState.years}-year horizon`;

  const allocationList = $("plannerAllocList");
  if (allocationList) {
    allocationList.innerHTML = roundedPlannerAllocations(allocations).map((item) => {
      return `<div class="planner-alloc-row">
        <span class="planner-alloc-dot" style="background:${item.color}"></span>
        <span class="planner-alloc-label">${escapeHtml(item.label)}</span>
        <span class="planner-alloc-pct">${item.pct}%</span>
        <span class="planner-alloc-amt">${formatExactRupees(item.displayAmount)}${plannerAmountSuffix()}</span>
      </div>`;
    }).join("");
  }

  const whyList = $("plannerWhyList");
  if (whyList) {
    whyList.innerHTML = buildPlannerPlanExplanation(projection)
      .map((sentence) => `<li>${escapeHtml(sentence)}</li>`)
      .join("");
  }

  const results = $("plannerResults");
  if (results) {
    results.hidden = false;
    results.removeAttribute("aria-hidden");
    if (scroll) results.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  plannerState.resultsVisible = true;
};

const hidePlannerResults = () => {
  const results = $("plannerResults");
  if (results) {
    results.hidden = true;
    results.setAttribute("aria-hidden", "true");
  }
  plannerState.resultsVisible = false;
};

const renderPlanner = () => {
  const amount = $("plannerAmount");
  const investSubLabel = $("plannerInvestSubLabel");
  const years = $("plannerYears");
  const yearsButton = $("plannerYearsButton");
  const yearsLabel = $("plannerYearsLabel");
  const yearsMenu = $("plannerYearsMenu");
  const slider = $("plannerReturnSlider");
  const display = $("plannerReturnDisplay");
  const inflationSlider = $("plannerInflationSlider");
  const inflationDisplay = $("plannerInflationDisplay");

  if (amount && !amount.dataset.plannerWired) {
    amount.dataset.plannerWired = "true";

    amount.addEventListener("input", () => {
      plannerState.amount = Math.max(1000, Number(amount.value) || 5000);
      updatePlannerInsight();
      hidePlannerResults();
    });

    document.querySelectorAll("[data-invest-type]").forEach((button) => {
      button.addEventListener("click", () => {
        plannerState.investType = button.dataset.investType === "lumpsum" ? "lumpsum" : "sip";
        if (plannerState.investType === "lumpsum" && plannerState.amount < 10000) plannerState.amount = 100000;
        if (amount) {
          amount.value = String(plannerState.amount);
          amount.placeholder = plannerState.investType === "sip" ? "5000" : "100000";
        }
        if (investSubLabel) investSubLabel.textContent = plannerState.investType === "sip" ? "per month via SIP" : "one-time investment";
        document.querySelectorAll("[data-invest-type]").forEach((item) => item.classList.toggle("active", item === button));
        updatePlannerInsight();
        hidePlannerResults();
      });
    });

    years?.addEventListener("change", () => {
      plannerState.years = Number(years.value) || 10;
      if (yearsLabel) yearsLabel.textContent = `${plannerState.years} Years`;
      yearsMenu?.querySelectorAll("[data-years]").forEach((item) => item.classList.toggle("active", Number(item.dataset.years) === plannerState.years));
      updatePlannerInsight();
      hidePlannerResults();
    });

    yearsButton?.addEventListener("click", () => {
      const open = yearsButton.getAttribute("aria-expanded") === "true";
      yearsButton.setAttribute("aria-expanded", open ? "false" : "true");
      if (yearsMenu) yearsMenu.hidden = open;
    });

    yearsMenu?.querySelectorAll("[data-years]").forEach((button) => {
      button.addEventListener("click", () => {
        plannerState.years = Number(button.dataset.years) || 10;
        if (years) years.value = String(plannerState.years);
        if (yearsLabel) yearsLabel.textContent = button.textContent || `${plannerState.years} Years`;
        yearsMenu.querySelectorAll("[data-years]").forEach((item) => item.classList.toggle("active", item === button));
        yearsButton?.setAttribute("aria-expanded", "false");
        yearsMenu.hidden = true;
        updatePlannerInsight();
        hidePlannerResults();
      });
    });

    document.addEventListener("click", (event) => {
      const control = $("plannerYearsCustom");
      if (!control || !yearsMenu || yearsMenu.hidden || control.contains(event.target)) return;
      yearsMenu.hidden = true;
      yearsButton?.setAttribute("aria-expanded", "false");
    });

    slider?.addEventListener("input", () => {
      plannerState.returnRate = Number(slider.value) || 12.5;
      if (display) display.textContent = `${plannerState.returnRate}%`;
      updatePlannerInsight();
      hidePlannerResults();
    });

    inflationSlider?.addEventListener("input", () => {
      plannerState.inflationRate = Number(inflationSlider.value) || 6;
      if (inflationDisplay) inflationDisplay.textContent = `${plannerState.inflationRate}%`;
      updatePlannerInsight();
      hidePlannerResults();
    });

    document.querySelectorAll(".risk-btn[data-risk]").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".risk-btn[data-risk]").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        plannerState.risk = button.dataset.risk || "moderate";
        updatePlannerInsight();
        hidePlannerResults();
      });
    });

    $("plannerGenerateBtn")?.addEventListener("click", () => renderPlannerResults({ scroll: true }));
    $("plannerAdjustBtn")?.addEventListener("click", () => {
      const results = $("plannerResults");
      if (results) {
        results.hidden = true;
        results.setAttribute("aria-hidden", "true");
      }
      hidePlannerResults();
      $("plannerFormCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("plannerViewDetailBtn")?.addEventListener("click", () => {
      if (!plannerState.resultsVisible) renderPlannerResults();
      renderPortfolio();
      navigateToTab("portfolio");
    });
  }

  if (amount) amount.value = String(plannerState.amount);
  if (amount) amount.placeholder = plannerState.investType === "sip" ? "5000" : "100000";
  if (investSubLabel) investSubLabel.textContent = plannerState.investType === "sip" ? "per month via SIP" : "one-time investment";
  document.querySelectorAll("[data-invest-type]").forEach((button) => {
    button.classList.toggle("active", button.dataset.investType === plannerState.investType);
  });
  if (years) years.value = String(plannerState.years);
  if (yearsLabel) yearsLabel.textContent = `${plannerState.years} Years`;
  if (slider) slider.value = String(plannerState.returnRate);
  if (display) display.textContent = `${plannerState.returnRate}%`;
  if (inflationSlider) inflationSlider.value = String(plannerState.inflationRate);
  if (inflationDisplay) inflationDisplay.textContent = `${plannerState.inflationRate}%`;
  document.querySelectorAll(".risk-btn[data-risk]").forEach((button) => {
    button.classList.toggle("active", button.dataset.risk === plannerState.risk);
  });

  updatePlannerInsight();
  if (!plannerState.resultsVisible) hidePlannerResults();
};

const renderPortfolio = () => {
  const projection = plannerPortfolioProjection();
  const { projected, realProjected, totalInvestment, estimatedGain, allocations } = projection;
  const displayAllocations = roundedPlannerAllocations(allocations);
  if ($("portfolioProjectedValue")) $("portfolioProjectedValue").textContent = formatIndianCurrency(projected);
  if ($("portfolioTotalInvestment")) $("portfolioTotalInvestment").textContent = formatIndianCurrency(totalInvestment);
  if ($("portfolioExpectedReturn")) $("portfolioExpectedReturn").textContent = `${plannerState.returnRate}% p.a.`;
  if ($("portfolioRealValue")) $("portfolioRealValue").textContent = formatIndianCurrency(realProjected);
  if ($("portfolioSipValue")) $("portfolioSipValue").textContent = formatIndianCurrency(estimatedGain);

  const donut = $("portfolioDonut");
  if (donut) {
    donut.style.background = "transparent";
    let offset = 0;
    const segments = allocations.map((item, index) => {
      const fund = item.funds?.[0]?.fund || null;
      const fundName = fund?.fundName || "Category allocation";
      const why = item.funds?.[0]?.reason || "";
      const displayItem = displayAllocations[index] || item;
      const reason = why
        ? `${why}. Allocation bucket ${formatExactRupees(displayItem.displayAmount ?? item.amount)}${plannerAmountSuffix()}.`
        : `${plannerRiskLabel()} allocation anchor for this bucket.`;
      const segment = `
        <circle
          class="portfolio-donut-segment"
          data-donut-index="${index}"
          data-label="${escapeHtml(item.label)}"
          data-fund="${escapeHtml(fundName)}"
          data-pct="${item.pct}"
          data-reason="${escapeHtml(reason)}"
          cx="50"
          cy="50"
          r="36"
          pathLength="100"
          fill="none"
          stroke="${item.color}"
          stroke-width="22"
          stroke-dasharray="${item.pct} ${100 - item.pct}"
          stroke-dashoffset="${-offset}"
        />
        <circle
          class="portfolio-donut-hit"
          data-donut-index="${index}"
          data-label="${escapeHtml(item.label)}"
          data-fund="${escapeHtml(fundName)}"
          data-pct="${item.pct}"
          data-reason="${escapeHtml(reason)}"
          cx="50"
          cy="50"
          r="36"
          pathLength="100"
          fill="none"
          stroke="transparent"
          stroke-width="28"
          stroke-dasharray="${item.pct} ${100 - item.pct}"
          stroke-dashoffset="${-offset}"
        />`;
      offset += item.pct;
      return segment;
    }).join("");
    donut.innerHTML = `
      <svg viewBox="0 0 100 100" aria-label="Portfolio allocation chart">
        <circle class="portfolio-donut-track" cx="50" cy="50" r="36" pathLength="100" fill="none" stroke-width="22"></circle>
        <g transform="rotate(-90 50 50)">${segments}</g>
      </svg>
      <span class="portfolio-donut-center">100%</span>
      <small class="portfolio-donut-caption">Tap a slice for details</small>
    `;
    const center = donut.querySelector(".portfolio-donut-center");
    const caption = donut.querySelector(".portfolio-donut-caption");
    const setDonutDetail = (segment) => {
      donut.querySelectorAll(".portfolio-donut-segment").forEach((item) => item.classList.remove("active"));
      const visibleSegment = segment.classList.contains("portfolio-donut-hit")
        ? donut.querySelector(`.portfolio-donut-segment[data-donut-index="${segment.dataset.donutIndex}"]`)
        : segment;
      visibleSegment?.classList.add("active");
      if (center) center.textContent = `${segment.dataset.pct}%`;
      if (caption) {
        caption.innerHTML = `
          <strong>${escapeHtml(segment.dataset.label || "")}</strong>
          <span>${escapeHtml(segment.dataset.fund || "")}</span>
          <em>${escapeHtml(segment.dataset.reason || "Chosen to support the selected allocation mix.")}</em>
        `;
      }
    };
    const setDonutDetailFromEvent = (event) => {
      const segment = event.target?.closest?.(".portfolio-donut-segment, .portfolio-donut-hit");
      if (segment) setDonutDetail(segment);
    };
    donut.addEventListener("click", setDonutDetailFromEvent);
    donut.addEventListener("touchstart", setDonutDetailFromEvent, { passive: true });
    donut.querySelectorAll(".portfolio-donut-segment, .portfolio-donut-hit").forEach((segment) => {
      segment.addEventListener("click", () => setDonutDetail(segment));
      segment.addEventListener("touchstart", () => setDonutDetail(segment), { passive: true });
    });
    const firstSegment = donut.querySelector(".portfolio-donut-segment");
    if (firstSegment) setDonutDetail(firstSegment);
  }

  const allocationList = $("portfolioAllocList");
  if (allocationList) {
    allocationList.innerHTML = displayAllocations.map((item) => {
      return `<div class="planner-alloc-row">
        <span class="planner-alloc-dot" style="background:${item.color}"></span>
        <span class="planner-alloc-label">${escapeHtml(item.label.replace(" Equity Funds", "").replace(" Funds", ""))}</span>
        <span class="planner-alloc-pct">${item.pct}%</span>
        <span class="planner-alloc-amt">${formatExactRupees(item.displayAmount)}${plannerAmountSuffix()}</span>
      </div>`;
    }).join("");
  }

  const fundList = $("portfolioFundList");
  if (fundList) {
    fundList.innerHTML = displayAllocations.map((item) => {
      const fundsMarkup = roundedPlannerFundEntries(item.funds, item.displayAmount).map((entry) => {
        const fund = entry.fund;
        return `<div class="portfolio-fund-row portfolio-fund-row--child">
          <span class="planner-rec-dot" style="background:${item.color}"></span>
          <div class="planner-rec-info">
            <span class="planner-rec-fund">${escapeHtml(fund.fundName)}</span>
            <span class="planner-rec-category">${entry.pct}% of category | ${formatExactRupees(entry.displayAmount)}${plannerAmountSuffix()}</span>
            <span class="planner-rec-reason">${escapeHtml(entry.reason)}</span>
          </div>
        </div>`;
      }).join("");
      return `<div class="portfolio-category-group">
        <div class="portfolio-category-row">
          <span class="planner-alloc-dot" style="background:${item.color}"></span>
          <strong>${escapeHtml(item.label)}</strong>
          <span>${item.pct}% | ${formatExactRupees(item.displayAmount)}${plannerAmountSuffix()}</span>
        </div>
        ${fundsMarkup}
      </div>`;
    }).join("");
  }

  const whyList = $("portfolioWhyList");
  if (whyList) {
    whyList.innerHTML = buildPlannerPlanExplanation(projection)
      .map((sentence) => `<li>${escapeHtml(sentence)}</li>`)
      .join("");
  }
};

const renderProfile = () => {
  const lastSyncAt = localStorage.getItem(DAILY_SYNC_AT_KEY) || "";
  $("uploadStatus").textContent = lastSyncAt ? "Updated" : "Ready";
  const installButton = profileInstallButtonEl();
  const installValue = $("installStatus");
  const installed = isInstalledApp();
  const shouldShowInstall = !installed && (shouldShowBrowserInstallCta() || canShowInstall || Boolean(deferredInstallPrompt));
  if (installValue) {
    installValue.textContent = installed ? "Installed" : deferredInstallPrompt ? "Tap to install" : "Install from browser";
  }
  if (installButton) {
    installButton.hidden = !shouldShowInstall;
    installButton.style.display = shouldShowInstall ? "" : "none";
  }
};

const handleManualNavSync = async () => {
  const button = $("manualNavSyncButton");
  if (button) button.disabled = true;
  if ($("uploadStatus")) $("uploadStatus").textContent = "Syncing...";
  try {
    const result = await window.__fundpulseManualNavSync?.();
    if ($("uploadStatus")) $("uploadStatus").textContent = result ? "Updated" : "Last available";
  } finally {
    if (button) button.disabled = false;
  }
};

const isStandaloneMode = () => window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
const isInstalledApp = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const hasSeenOnboarding = () => localStorage.getItem(ONBOARDING_KEY) === "true" || localStorage.getItem(LEGACY_ONBOARDING_KEY) === "true";
const hasCompletedInstallFlow = () => localStorage.getItem(INSTALL_FLOW_KEY) === "true";
const shouldShowBrowserInstallCta = () => localStorage.getItem(BROWSER_INSTALL_CTA_KEY) === "true";

const setAppReady = () => {
  if (isAppReady) return;
  isAppReady = true;
  document.documentElement.classList.add("app-ready");
};

const markOnboardingDone = () => {
  localStorage.setItem(ONBOARDING_KEY, "true");
  localStorage.setItem(LEGACY_ONBOARDING_KEY, "true");
};

const showMainApp = () => {
  releaseInteractionLocks();
  $("skeleton")?.classList.add("hide");
  $("app")?.classList.remove("is-loading");
};

const loadDashboard = () => {
  ensureHashRoute();
  state.tab = routeFromHash();
  syncTabUi();
  renderCurrentView();
  renderChrome();
  showMainApp();
};

const enterApp = () => {
  loadDashboard();
  updateInstallButton();
  setUpdateBannerMessage("New update available • Tap to refresh");
  setUpdateBanner(false);
};

const updateOnboardingPanelHeight = (index = currentOnboardingIndex) => {
  const panel = document.querySelector(".onboarding-panel");
  const container = onboardContainerEl();
  if (!panel || !container) return;
  const steps = [...container.querySelectorAll(".onboarding-step")];
  const activeStep = steps[Math.max(0, Math.min(index, steps.length - 1))];
  if (!activeStep) return;
  requestAnimationFrame(() => {
    panel.style.height = `${activeStep.scrollHeight}px`;
  });
};

const updateOnboardingPosition = (index) => {
  const container = onboardContainerEl();
  if (!container) return;
  const safeIndex = Math.max(0, Math.min(index, LAST_ONBOARDING_INDEX));
  currentOnboardingIndex = safeIndex;
  container.style.transform = `translateX(-${safeIndex * 100}%)`;
  updateOnboardingPanelHeight(safeIndex);
  const finishButton = $("letsGoBtn") || $("onboardingFinish");
  if (finishButton) {
    finishButton.textContent = currentOnboardingIndex === LAST_ONBOARDING_INDEX ? "Let’s Go" : "Next";
  }
};

const hideOnboarding = () => {
  const overlay = onboardingEl();
  if (!overlay) {
    showMainApp();
    return;
  }
  overlay.hidden = true;
  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  overlay.remove();
  showMainApp();
};

const finishOnboarding = () => {
  markOnboardingDone();
  localStorage.setItem(INSTALL_FLOW_KEY, "true");
  if (!isInstalledApp()) {
    localStorage.setItem(BROWSER_INSTALL_CTA_KEY, "true");
  }
  hideOnboarding();
  enterApp();
};

const handleOnboardingNext = () => {
  currentOnboardingIndex = Math.min(currentOnboardingIndex, LAST_ONBOARDING_INDEX);
  if (currentOnboardingIndex < LAST_ONBOARDING_INDEX) {
    updateOnboardingPosition(currentOnboardingIndex + 1);
  } else {
    finishOnboarding();
  }
};

const showInstallCard = () => {
  const overlay = onboardingEl();
  if (!overlay) {
    enterApp();
    return;
  }
  overlay.hidden = false;
  overlay.style.display = "";
  overlay.setAttribute("aria-hidden", "false");
  currentOnboardingIndex = 0;
  updateOnboardingPosition(0);
  updateInstallButton();
};

const showOnboardingSlides = () => {
  const overlay = onboardingEl();
  if (!overlay) {
    enterApp();
    return;
  }
  overlay.hidden = false;
  overlay.style.display = "";
  overlay.setAttribute("aria-hidden", "false");
  currentOnboardingIndex = 1;
  updateOnboardingPosition(1);
  updateInstallButton();
};

const startExperience = () => {
  setAppReady();
  if (hasSeenOnboarding()) {
    hideOnboarding();
    enterApp();
    return;
  }
  if (isInstalledApp()) {
    document.querySelectorAll(".install-btn").forEach((el) => el.remove());
    showOnboardingSlides();
    return;
  }
  if (hasCompletedInstallFlow()) {
    showOnboardingSlides();
    return;
  }
  showInstallCard();
};

const playSplashAndBoot = () => {
  const splash = splashScreenEl();
  if (!splash) {
    startExperience();
    return;
  }
  window.setTimeout(() => {
    splash.classList.add("hide");
    window.setTimeout(() => {
      splash.hidden = true;
      startExperience();
    }, 160);
  }, 90);
};

const setUpdateBanner = (visible) => {
  const banner = $("updateBanner");
  if (!banner) return;
  banner.hidden = !visible;
  banner.classList.toggle("visible", visible);
};

const setUpdateBannerMessage = (message) => {
  const banner = $("updateBanner");
  if (!banner) return;
  banner.textContent = message;
};

const compareVersionStrings = (left, right) => {
  const a = String(left || "").split(".").map((part) => Number(part) || 0);
  const b = String(right || "").split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const aValue = a[index] || 0;
    const bValue = b[index] || 0;
    if (aValue > bValue) return 1;
    if (aValue < bValue) return -1;
  }
  return 0;
};

const syncUpdateBannerState = () => {
  const dismissedVersion = sessionStorage.getItem(UPDATE_BANNER_DISMISSED_KEY);
  const shouldShow = Boolean(serverUpdateVersion) && dismissedVersion !== serverUpdateVersion;
  if (shouldShow) {
    setUpdateBannerMessage("New update available • Tap to refresh");
  }
  setUpdateBanner(shouldShow);
};

const checkForServerUpdate = async () => {
  try {
    const response = await fetch(UPDATE_CHECK_URL, { cache: "no-store" });
    if (!response.ok) {
      syncUpdateBannerState();
      return;
    }
    const data = await response.json();
    if (!data || !data.version) {
      syncUpdateBannerState();
      return;
    }
    const storedVersion = localStorage.getItem(UPDATE_VERSION_KEY);
    if (!storedVersion) {
      localStorage.setItem(UPDATE_VERSION_KEY, data.version);
      serverUpdateVersion = null;
      syncUpdateBannerState();
      return;
    }
    const hasNewVersion = Boolean(data.updateAvailable) && compareVersionStrings(data.version, storedVersion) > 0;
    serverUpdateVersion = hasNewVersion ? data.version : null;
    syncUpdateBannerState();
  } catch (error) {
    console.error("Update check failed", error);
    syncUpdateBannerState();
  }
};

const scheduleUpdateChecks = () => {
  window.setTimeout(() => {
    checkForServerUpdate();
    if (updateCheckTimer) window.clearInterval(updateCheckTimer);
    updateCheckTimer = window.setInterval(checkForServerUpdate, UPDATE_CHECK_INTERVAL);
  }, 2000);
};

const bindPullToRefreshGuard = () => {
  /* Keep the hook in place for future refinement, but avoid aggressive
     touch interception that can block normal app scrolling on mobile. */
};

const updateInstallButton = () => {
  const button = profileInstallButtonEl();
  if (!button) return;
  const installed = isInstalledApp();
  const shouldShowInstall = !installed && (shouldShowBrowserInstallCta() || canShowInstall || Boolean(deferredInstallPrompt));
  if (!shouldShowInstall) {
    button.hidden = true;
    button.style.display = "none";
    return;
  }
  button.hidden = false;
  button.style.display = "";
  const installValue = $("installStatus");
  if (installValue) {
    installValue.textContent = deferredInstallPrompt ? "Tap to install" : "Install from browser";
  }
};

const openDetail = (fundId) => {
  const fund = appData.funds.find((item) => item.id === fundId);
  if (!fund) {
    openGlobalModal(`<div class="detail-hero"><p class="eyebrow">Fund detail</p><h2>Fund unavailable</h2><p class="muted">The selected fund record could not be loaded.</p></div>`, { kind: "detail" });
    return;
  }
  openGlobalModal(`<div class="detail-hero"><p class="eyebrow">${escapeHtml(state.category)}</p><h2>${escapeHtml(fund.fundName)}</h2><p class="muted">Loading fund details...</p></div>`, { kind: "detail" });
  requestAnimationFrame(() => {
  const detailContent = modalContent();
  if (!detailContent) return;
  const displayRank = currentRankingMap(allCategoryFunds()).get(fund.id) || fund.rank;
  const fundHistory = mergedFundHistory(fund);
  const rows = fundHistory.length
    ? fundHistory.map((point) => `<tr><td>${escapeHtml(point.date || "-")}</td><td>${scoreLabel(point.score)}</td><td>${formatPct(point.oneYear)}</td><td>${formatPct(point.threeYear)}</td><td>${formatPct(point.fiveYear)}</td></tr>`).join("")
    : `<tr><td colspan="5">No historical rows available for this fund.</td></tr>`;
  const params = (fundHistory.slice(-1)[0]?.parameters || fund.parameterBreakdown || []).map((param, index) => {
    const pct = Math.max(0, Math.min(100, Math.round((param.normalized || 0) * 100)));
    const contribution = param.contribution === null || param.contribution === undefined ? "-" : param.contribution.toFixed(1);
    return `<div class="parameter-row"><div><strong>${escapeHtml(param.label)}</strong><small>${param.value ?? "-"} | rank ${param.rank || "-"}</small></div><span>${contribution}</span><div class="parameter-track"><i style="--bar-width:${pct}%; --bar-delay:${120 + (index * 100)}ms"></i></div></div>`;
  }).join("");
  detailContent.innerHTML = `
    <div class="detail-hero">
      <p class="eyebrow">${escapeHtml(state.category)} | ${datasetLabel()}</p>
      <h2>${escapeHtml(fund.fundName)}</h2>
      <span class="rank-badge">Rank #${displayRank}</span>
    </div>
<div class="detail-grid">
      <div class="mini-stat"><small>Score</small><strong>${scoreLabel(scoreOf(fund))}</strong></div>
      <div class="mini-stat"><small>Trend</small><strong>${trendMarkup(fund.trend)}</strong></div>
      <div class="mini-stat"><small>Risk</small><strong>${riskLabel(fund)}</strong></div>
      <div class="mini-stat"><small>1Y</small><strong>${formatPct(fund.oneYear)}</strong></div>
      <div class="mini-stat"><small>3Y</small><strong>${formatPct(fund.threeYear)}</strong></div>
      <div class="mini-stat"><small>5Y</small><strong>${formatPct(fund.fiveYear)}</strong></div>
    </div>
     <div class="chart-panel"><div class="section-head"><div><p class="eyebrow">Score movement</p><h3>Historical dashboard score</h3></div></div><div id="detailLine" class="line-chart"></div><div id="detailHistoryState" class="chart-tooltip"></div></div>
    <div class="insight-card primary"><p class="eyebrow">Summary</p><h3>${escapeHtml(fund.fundName)} is ranked #${displayRank} in ${escapeHtml(fund.category)} with dashboard score ${scoreLabel(scoreOf(fund))}.</h3></div>
    <div class="insight-card"><div style="display:flex; justify-content:space-between; align-items:center;">
  <p class="eyebrow">Parameter contribution</p>
  <p class="eyebrow" style="margin:0;">Score</p>
</div>
<div class="parameter-list">${params || "<p class='muted'>Parameter contribution is unavailable for this record.</p>"}</div></div>
    <table class="history-table"><thead><tr><th>Date</th><th>Score</th><th>1Y</th><th>3Y</th><th>5Y</th></tr></thead><tbody>${rows}</tbody></table>
  `;
  if (fundHistory.length) {
    const validScorePoints = fundHistory.filter((point) => typeof point?.score === "number");
    if (validScorePoints.length > 1) {
      renderMultiLineSvg($("detailLine"), [{ name: "Dashboard score", values: validScorePoints.map((point) => point.score), color: "#4DA3FF" }], validScorePoints.map((point) => (point.date || "Current").slice(-5)), $("detailHistoryState"));
      $("detailHistoryState").hidden = false;
    } else if (validScorePoints.length === 1) {
      const onlyPoint = validScorePoints[0];
      renderMultiLineSvg($("detailLine"), [{ name: "Dashboard score", values: [onlyPoint.score], color: "#4DA3FF" }], [(onlyPoint.date || "Latest").slice(-5)], $("detailHistoryState"));
      $("detailHistoryState").textContent = "Limited historical data";
    } else {
      $("detailLine").innerHTML = `<div class="empty-chart">Historical score data is unavailable for this fund.</div>`;
      $("detailHistoryState").textContent = "Latest metrics are still available above.";
    }
  } else {
    $("detailLine").innerHTML = `<div class="empty-chart">Historical score data is unavailable for this fund.</div>`;
    $("detailHistoryState").textContent = "Latest metrics are still available above.";
  }
  });
};

const buildMiniReportChart = (funds) => {
  const width = 620;
  const height = 260;
  const padding = { top: 30, right: 28, bottom: 44, left: 36 };
  const values = funds.map((fund) => scoreOf(fund));
  const max = Math.max(10, ...values);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const barWidth = Math.min(74, plotWidth / Math.max(2, funds.length * 1.6));
  const gap = funds.length > 1 ? (plotWidth - barWidth * funds.length) / (funds.length - 1) : 0;
  const ticks = [0, Math.round(max / 2), max];
  const grid = ticks.map((tick) => {
    const y = height - padding.bottom - (tick / max) * plotHeight;
    return `<g><line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#cbd5e1"/><text x="6" y="${y + 4}" fill="#64748b" font-size="11">${tick}</text></g>`;
  }).join("");
  const bars = funds.map((fund, index) => {
    const x = padding.left + index * (barWidth + gap);
    const value = scoreOf(fund);
    const barHeight = (value / max) * plotHeight;
    const y = height - padding.bottom - barHeight;
    const color = index === 0 ? "#4a63ff" : "#58d0ff";
    return `<g><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="14" fill="${color}"/><text x="${x + barWidth / 2}" y="${y - 8}" text-anchor="middle" fill="#0f172a" font-size="11" font-weight="800">${scoreLabel(value)}</text><text x="${x + barWidth / 2}" y="${height - 18}" text-anchor="middle" fill="#64748b" font-size="10" font-weight="700">${escapeHtml(fund.fundName.slice(0, 14))}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top fund dashboard scores">${grid}${bars}</svg>`;
};

const buildReportHtml = () => {
  const fund = selectedFund();
  const summary = summaryForCategory();
  const categoryFunds = allCategoryFunds();
  const topFunds = categoryFunds.slice(0, 10);
  const chartFunds = categoryFunds.slice(0, 5);
  const rows = historyFor(fund).map((point) => `<tr><td>${point.date}</td><td>${scoreLabel(point.score)}</td><td>${formatPct(point.oneYear)}</td><td>${formatPct(point.threeYear)}</td><td>${formatPct(point.fiveYear)}</td></tr>`).join("");
  const leagueTable = topFunds.map((item) => `<tr><td>#${item.rank}</td><td>${escapeHtml(item.fundName)}</td><td>${scoreLabel(scoreOf(item))}</td><td>${formatPct(item.oneYear)}</td><td>${formatPct(item.threeYear)}</td><td>${formatPct(item.fiveYear)}</td><td>${riskLabel(item)}</td></tr>`).join("");
  return `
    <html><head><title>${APP_NAME} Report</title><style>
      body{font-family:Inter,Arial,sans-serif;padding:32px;color:#0f172a;background:#f8fafc} h1,h2,h3{margin:0 0 12px} .muted{color:#64748b;line-height:1.5}
      .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
      .card{border:1px solid #dbe3ef;border-radius:16px;padding:18px;background:#fff;box-shadow:0 10px 28px rgba(15,23,42,.05)}
      .wide{grid-column:1/-1}.two{display:grid;grid-template-columns:1.2fr .8fr;gap:16px}
      table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px} th,td{padding:10px;border-bottom:1px solid #e5e7eb;text-align:left}
      .badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#edf1ff;color:#4a63ff;font-weight:700;font-size:12px}
      ul{padding-left:18px;line-height:1.7}
      .cover{padding:28px;border-radius:24px;background:linear-gradient(135deg,#f8faff,#eaf0fb);border:1px solid #dbe3ef;box-shadow:0 12px 36px rgba(15,23,42,.06)}
      .cover h1{font-size:34px}.cover p{max-width:720px}
      .chart-box{margin-top:16px;padding:18px;border:1px solid #dbe3ef;border-radius:18px;background:#fff}
      .page-break{page-break-before:always}
    </style></head><body>
      <section class="cover">
        <p class="badge">${APP_NAME} category report</p>
        <h1>${state.category}</h1>
        <p class="muted">${formatDate(latestNavDateForCategory(state.category))} | ${datasetLabel()} | Built from the Excel-backed dashboard logic for category-level review, ranking, and fund comparison.</p>
      </section>
      <div class="grid">
        <div class="card"><h3>Category</h3><p>${state.category}</p></div>
        <div class="card"><h3>Total Funds</h3><p>${summary.totalFunds}</p></div>
        <div class="card"><h3>Average Score</h3><p>${summary.categoryAverageScore.toFixed(1)}</p></div>
        <div class="card"><h3>Average Return</h3><p>${summary.categoryAverageReturn.toFixed(1)}%</p></div>
      </div>
      <div class="card wide"><h2>Executive Summary</h2><p class="muted">${state.category} contains ${summary.totalFunds} analysed funds. The category leader is <strong>${escapeHtml(summary.topPerformer)}</strong>, while the selected reference fund is <strong>${escapeHtml(fund.fundName)}</strong> at rank #${fund.rank} with dashboard score ${scoreLabel(scoreOf(fund))}. Use the league table and historical section below for deeper analysis.</p></div>
      <div class="chart-box">${buildMiniReportChart(chartFunds)}</div>
      <div class="two">
        <div class="card"><h2>Selected Fund Snapshot</h2><p><span class="badge">Rank #${fund.rank}</span></p><p class="muted">Dashboard score ${scoreLabel(scoreOf(fund))} | ${horizonLabel()} ${formatPct(fund[state.horizon])} | ${riskLabel(fund)} | ${fund.trend}</p></div>
        <div class="card"><h2>Category Leader</h2><p><span class="badge">${escapeHtml(summary.topPerformer)}</span></p><p class="muted">Top category score ${scoreLabel(summary.topScore)} with ${summary.topTrend.toLowerCase()} trend.</p></div>
      </div>
      <div class="card wide page-break"><h2>Top 10 Funds In Category</h2><table><thead><tr><th>Rank</th><th>Fund</th><th>Score</th><th>1Y</th><th>3Y</th><th>5Y</th><th>Risk</th></tr></thead><tbody>${leagueTable}</tbody></table></div>
      <div class="card wide"><h2>Selected Fund Historical Data</h2><table><thead><tr><th>Date</th><th>Score</th><th>1Y</th><th>3Y</th><th>5Y</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="card wide"><h2>How To Read This Report</h2><ul><li><strong>Dashboard Score</strong> summarizes workbook-driven ranking logic.</li><li><strong>Rank</strong> compares funds within the selected category.</li><li><strong>Risk Indicator</strong> reflects score volatility across available periods.</li><li><strong>Returns</strong> help compare shorter and longer horizon performance.</li></ul></div>
      <div class="card wide"><h2>Methodology</h2><p class="muted">This report is generated from the Excel-backed dashboard logic using category-filtered data, rank-based weighted scoring, and available period histories from the workbook sheets. It is designed to support user-led analysis, not to provide financial advice.</p></div>
    </body></html>
  `;
};

const syncStateToData = () => {
  if (!appData?.categories?.length) return;
  if (!appData.categories.includes(state.category)) {
    state.category = appData.categories[0];
  }
  state.selectedFundId = null;
  state.compareFundAId = null;
  state.compareFundBId = null;
  const categoryFunds = allCategoryFunds();
  if (!categoryFunds.length) return;
  state.selectedFundId = categoryFunds[0].id;
  state.compareFundAId = categoryFunds[0].id;
  state.compareFundBId = categoryFunds[1]?.id || categoryFunds[0].id;
};

const handleUpload = async (file) => {
  if (!file) return;
  localStorage.setItem("fundpulse-live-upload-name", file.name);
  $("uploadStatus").textContent = file.name.slice(0, 22);
  if (file.name.endsWith(".json")) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!["excel-dashboard", "live-dashboard"].includes(parsed.analysis) || !parsed.funds || !parsed.summaries) throw new Error("Invalid data");
        appData = normalizeAppData(parsed);
            saveStoredData(appData);
        syncStateToData();
        renderAll();
        $("uploadStatus").textContent = "Updated";
      } catch {
        $("uploadStatus").textContent = "Invalid file";
      }
    };
    reader.readAsText(file);
    return;
  }
  $("uploadStatus").textContent = "Importing...";
  try {
    const imported = normalizeAppData(await window.WorkbookImporter.buildDataFromWorkbookFile(file));
    appData = imported;
      localStorage.removeItem(APP_DATA_STORAGE_KEY);
      saveStoredData(imported);
    syncStateToData();
    renderAll();
    $("uploadStatus").textContent = "Updated";
  } catch (error) {
    console.error(`${APP_NAME} workbook import failed`, error);
    $("uploadStatus").textContent = "Import failed";
  }
};

const renderAll = () => {
  try {
    renderChrome();
    renderHeaderControls();
    renderDashboard();
    renderFunds();
    renderInsights();
    renderCompare();
    renderProfile();
    renderPlanner();
    renderPortfolio();
    renderSavedPlans();
    syncControlState();
  } catch (error) {
    console.error(`${APP_NAME} render failure`, error);
    const activeScreen = document.querySelector(".screen.active");
    if (activeScreen) {
      activeScreen.innerHTML = `<article class="insight-card fallback-card"><p class="eyebrow">Something went wrong</p><h3>We could not load this view cleanly.</h3><p class="story-copy">Try switching category or tab again. The app caught the error instead of blanking the screen.</p></article>`;
    }
  }
};

const renderCurrentView = () => {
  renderChrome();
  renderHeaderControls();

  if (state.tab === "dashboard") renderDashboard();
  if (state.tab === "funds") renderFunds();
  if (state.tab === "insights") renderInsights();
  if (state.tab === "compare") renderCompare();
  if (state.tab === "planner") renderPlanner();
  if (state.tab === "profile") renderProfile();
  if (state.tab === "portfolio") renderPortfolio();
  if (state.tab === "saved-plans") renderSavedPlans();

  syncControlState();
};

const persistLiveDataWhenIdle = (data) => {
  const save = () => {
    try {
      saveStoredData(data);
    } catch (error) {
      console.warn(`${APP_NAME} live data cache write skipped`, error);
    }
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(save, { timeout: 1500 });
  } else {
    window.setTimeout(save, 120);
  }
};

const bindEvents = () => {
  $("themeToggle").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  $("themeToggle")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setTheme(state.theme === "dark" ? "light" : "dark");
  });
  $("aboutPillBtn")?.addEventListener("click", () => {
    navigateToTab("profile");
  });
  $("profileTheme").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  $("categoryTrigger").addEventListener("click", () => openPicker("category"));
  $("compareFundATrigger").addEventListener("click", () => openPicker("compareFundA"));
  $("compareFundBTrigger").addEventListener("click", () => openPicker("compareFundB"));
  const topPerformerCard = $("topPerformerCard");
  if (topPerformerCard) {
    bindFundCardInteractions(topPerformerCard, openTopPerformerInsight);
  }
  $("global-modal-backdrop").addEventListener("click", closeGlobalModal);
  $("global-modal-close").addEventListener("click", closeGlobalModal);
  window.addEventListener("popstate", () => {
    const root = modalRoot();
    if (!root || root.hidden || root.getAttribute("aria-hidden") === "true") return;
    modalHistoryNavigating = true;
    closeGlobalModal(false, { fromHistory: true });
  });

  document.querySelectorAll(".bottom-nav [data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab, 0));
  });

  $("aboutBackBtn")?.addEventListener("click", () => navigateToTab("dashboard"));
  $("savedPlansBackBtn")?.addEventListener("click", () => navigateToTab("dashboard"));
  $("portfolioBackBtn")?.addEventListener("click", () => navigateToTab("planner"));
  $("portfolioAdjustBtn")?.addEventListener("click", () => navigateToTab("planner"));
  $("portfolioSaveBtn")?.addEventListener("click", openSavePortfolioModal);

  document.querySelectorAll(".qa-card[data-qa]").forEach((card) => {
    const openAction = () => {
      const action = card.dataset.qa;
      if (action === "planner") {
        navigateToTab("planner");
      } else if (action === "compare") {
        navigateToTab("compare");
      } else if (action === "sip") {
        navigateToTab("planner");
        window.setTimeout(() => $("plannerModeTabSip")?.click(), 80);
      } else if (action === "saved-plans") {
        navigateToTab("saved-plans");
      } else if (action === "watchlist") {
        navigateToTab("funds");
        window.setTimeout(() => document.querySelector('[data-fund-view="favorites"]')?.click(), 80);
      }
    };
    card.addEventListener("click", openAction);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openAction();
    });
  });
  document.querySelectorAll(".planner-promo-action").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      navigateToTab("planner");
    });
  });

  document.querySelectorAll("[data-horizon]").forEach((button) => {
    button.addEventListener("click", () => {
      applyOptionValue("horizon", button.dataset.horizon, 0);
    });
  });

  document.querySelectorAll(".time-filter button").forEach((button) => {
    button.addEventListener("click", () => {
      applyOptionValue("period", button.dataset.period, 0);
    });
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      applyOptionValue("sort", chip.dataset.sort, 0);
    });
  });

  document.querySelectorAll("[data-fund-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.fundView = button.dataset.fundView || "all";
      localStorage.setItem("fundpulse-live-fund-view", state.fundView);
      renderFunds();
      syncControlState();
    });
  });

$("searchInput").addEventListener("input", (event) => {
  const nextValue = event.target.value;
  if (searchInputTimer) {
    window.clearTimeout(searchInputTimer);
  }
  searchInputTimer = window.setTimeout(() => {
    searchInputTimer = 0;
    state.query = nextValue;
    renderFunds();
  }, 70);
});

  $("clearSearch").addEventListener("click", () => {
    state.query = "";
    $("searchInput").value = "";
    renderFunds();
  });

  $("methodologyButton").addEventListener("click", () => {
    openGlobalModal(methodologyMarkup(), { kind: "docs", size: "wide" });
  });

  $("onboardingInstallButton")?.addEventListener("click", async () => {
    let acceptedInstall = false;
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        const choice = await deferredInstallPrompt.userChoice;
        acceptedInstall = choice?.outcome === "accepted";
      } finally {
        deferredInstallPrompt = null;
        updateInstallButton();
      }
    }
    if (acceptedInstall) {
      localStorage.removeItem(BROWSER_INSTALL_CTA_KEY);
    } else {
      localStorage.setItem(BROWSER_INSTALL_CTA_KEY, "true");
    }
    localStorage.setItem(INSTALL_FLOW_KEY, "true");
    showOnboardingSlides();
  });

  $("onboardingSkipInstall")?.addEventListener("click", () => {
    localStorage.setItem(BROWSER_INSTALL_CTA_KEY, "true");
    localStorage.setItem(INSTALL_FLOW_KEY, "true");
    showOnboardingSlides();
  });
  profileInstallButtonEl()?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      const installValue = $("installStatus");
      if (installValue) installValue.textContent = "Install from browser";
      return;
    }
    deferredInstallPrompt.prompt();
    try {
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === "accepted") {
        const installValue = $("installStatus");
        if (installValue) installValue.textContent = "Installed";
        localStorage.removeItem(BROWSER_INSTALL_CTA_KEY);
        updateInstallButton();
      } else {
        localStorage.setItem(BROWSER_INSTALL_CTA_KEY, "true");
      }
    } finally {
      deferredInstallPrompt = null;
      canShowInstall = false;
      updateInstallButton();
    }
  });
  document.querySelectorAll(".onboarding-next").forEach((button) => {
    button.addEventListener("click", handleOnboardingNext);
  });
  document.querySelectorAll(".onboarding-skip-all").forEach((button) => {
    button.addEventListener("click", finishOnboarding);
  });

  document.addEventListener("keydown", (event) => {
    markUserInteraction();
    if (event.key === "Escape") closeAllOverlays();
  });

  ["pointerdown", "touchstart", "wheel"].forEach((eventName) => {
    document.addEventListener(eventName, markUserInteraction, { passive: true });
  });

  window.addEventListener("hashchange", () => {
    markUserInteraction();
    const nextTab = routeFromHash();
    if (nextTab !== state.tab) {
      state.tab = nextTab;
      syncTabUi();
      renderCurrentView();
      requestAnimationFrame(() => resetViewScroll("auto"));
    }
  });

  window.addEventListener("load", () => {
    const app = $("app");
    if (!window.location.hash) {
      window.location.hash = "#dashboard";
    }
    if (app && !app.querySelector(".screen.active")) {
      loadDashboard();
      return;
    }
    const activeScreen = document.querySelector(".screen.active");
    if (activeScreen && !activeScreen.children.length) {
      loadDashboard();
    }
  });

  $("manualNavSyncButton")?.addEventListener("click", handleManualNavSync);
  document.querySelector(".daily-sync-fact-shell")?.addEventListener("click", () => {
    setDailySyncFact(nextDailySyncFact());
  });
  $("updateBanner")?.addEventListener("click", () => {
    if (serverUpdateVersion) {
      sessionStorage.setItem(UPDATE_BANNER_DISMISSED_KEY, serverUpdateVersion);
      localStorage.setItem(UPDATE_VERSION_KEY, serverUpdateVersion);
      serverUpdateVersion = null;
      setUpdateBanner(false);
    }
    window.location.reload();
  });
  $("saveReport").addEventListener("click", () => {
    const reportWindow = window.open("", "_blank", "width=1100,height=800");
    if (!reportWindow) return;
    reportWindow.document.write(buildReportHtml());
    reportWindow.document.close();
    reportWindow.focus();
    setTimeout(() => reportWindow.print(), 300);
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    canShowInstall = true;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    localStorage.setItem(INSTALL_FLOW_KEY, "true");
    deferredInstallPrompt = null;
    canShowInstall = false;
    updateInstallButton();
  });

  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", updateInstallButton);
  window.addEventListener("resize", () => requestAnimationFrame(updateAllSegmentedPills));
  bindPullToRefreshGuard();
};

const registerServiceWorkerWhenIdle = () => {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const startRegistration = () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(startRegistration, { timeout: 1200 });
  } else {
    window.setTimeout(startRegistration, 180);
  }
};

const init = () => {
  document.documentElement.classList.remove("app-ready");
  const onboardingDone = hasSeenOnboarding();
  if (onboardingDone) {
    onboardingEl()?.setAttribute("hidden", "true");
    if (onboardingEl()) onboardingEl().style.display = "none";
  }
  ensureHashRoute();
  state.tab = routeFromHash();
  setTheme(state.theme);
  bindEvents();
  updateInstallButton();
  syncTabUi();
  playSplashAndBoot();
};

window.resetOnboarding = () => {
  localStorage.removeItem(ONBOARDING_KEY);
  localStorage.removeItem(LEGACY_ONBOARDING_KEY);
  location.reload();
};

let pendingLiveUpdateData = null;
let liveUpdateFrameScheduled = false;

window.addEventListener("live-data:updated", (event) => {
  pendingLiveUpdateData = event.detail?.data || null;
  const forceLiveUpdate = event.detail?.force === true;
  if (liveUpdateFrameScheduled) return;
  liveUpdateFrameScheduled = true;

  const applyPendingUpdate = () => {
    liveUpdateFrameScheduled = false;
    const nextData = normalizeAppData(pendingLiveUpdateData);
    pendingLiveUpdateData = null;
    if (!nextData?.funds || !nextData?.summaries) return;

    const currentDate = safeIsoDate(appData?.liveNavDate);
    const nextDate = safeIsoDate(nextData?.liveNavDate);
    if (!forceLiveUpdate && currentDate && nextDate && currentDate === nextDate) return;

    appData = nextData;
    document.body.classList.add("live-sync-refresh");
    persistLiveDataWhenIdle(nextData);
    syncStateToData();
    renderCurrentView();
    if (safeIsoDate(nextData?.liveNavDate)) {
      setHeroSyncNotice(`Updated in ${currentSyncWindowLabel()}`, "good", 3200);
    }
    window.setTimeout(() => {
      document.body.classList.remove("live-sync-refresh");
    }, 900);
    if ($("uploadStatus")) {
      $("uploadStatus").textContent = "Live synced";
    }
  };

  if ("requestAnimationFrame" in window) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(applyPendingUpdate));
    return;
  }
  window.setTimeout(applyPendingUpdate, 0);
});

window.addEventListener("daily-sync:lifecycle", (event) => {
  handleDailySyncLifecycle(event);
});

init();
maybeShowWindowSyncNotice();
registerServiceWorkerWhenIdle();
scheduleUpdateChecks();
