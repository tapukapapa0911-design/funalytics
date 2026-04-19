let appData = loadStoredData() || window.FUND_APP_DATA;

const APP_NAME = "Funalytics";
const APP_DESCRIPTION = "Funalytics is a smart mutual fund analytics platform that transforms Excel-based data into clear rankings, performance insights, and decision-ready dashboards.";

const state = {
  theme: localStorage.getItem("fundpulse-theme-v3") || "dark",
  category: "Large Cap Fund",
  tab: "dashboard",
  sort: "rank",
  horizon: "oneYear",
  dataset: "new",
  period: "1Y",
  query: "",
  pickerTarget: "category",
  selectedFundId: null,
  compareFundAId: null,
  compareFundBId: null
};

let deferredInstallPrompt = null;
let waitingServiceWorker = null;
let pendingUpdateReload = false;
const INSTALL_FLOW_KEY = "install_flow_done";
const ONBOARDING_KEY = "onboarding_done";
const ONBOARDING_STEPS = 5;
const LAST_ONBOARDING_INDEX = 4;
let currentOnboardingIndex = 0;
const MODAL_ANIMATION_MS = 220;

const $ = (id) => document.getElementById(id);
const modalRoot = () => $("global-modal");
const modalContent = () => $("global-modal-content");
const modalCard = () => $("global-modal-card");
const modalBackdrop = () => $("global-modal-backdrop");
const onboardingEl = () => $("onboarding");
const onboardContainerEl = () => $("onboardContainer");
const splashScreenEl = () => $("splashScreen");
const installButtonEl = () => $("installBtn");

const ensureHashRoute = () => {
  if (!window.location.hash) {
    window.location.hash = "#dashboard";
  }
};

const routeFromHash = () => {
  const raw = String(window.location.hash || "").replace(/^#/, "").trim();
  return ["dashboard", "funds", "insights", "compare", "profile"].includes(raw) ? raw : "dashboard";
};

function loadStoredData() {
  try {
    const raw = localStorage.getItem("fundpulse-data");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.analysis === "excel-dashboard" && parsed.funds && parsed.summaries ? parsed : null;
  } catch {
    return null;
  }
}

function standardizeFundName(value) {
  return String(value || "").replace(/\bIcici\b/g, "ICICI");
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
  return {
    ...data,
    summaries: data.summaries.map((summary) => ({
      ...summary,
      topPerformer: standardizeFundName(summary.topPerformer)
    })),
    funds: data.funds.map((fund) => ({
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

const formatDate = (iso) => {
  if (!iso) return "Data as of latest workbook extract";
  const date = new Date(`${iso}T00:00:00`);
  return `Data as of ${date.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
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
const horizonLabel = () => ({ oneYear: "1Y", threeYear: "3Y", fiveYear: "5Y" })[state.horizon];
const periodCount = () => ({ "1M": 2, "3M": 2, "6M": 3, "1Y": 5 })[state.period] || 5;
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

const horizonValueOf = (fund) => {
  const value = fund?.[state.horizon];
  return typeof value === "number" ? value : null;
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
  let funds = query
    ? categoryFunds.filter((fund) => fund.fundName.toLowerCase().includes(query))
    : categoryFunds;

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
  funds = [...funds]
    .sort(sorters[state.sort])
    .map((fund) => ({ ...fund, displayRank: displayRanks.get(fund.id) || fund.rank || 999 }));
  return query ? funds.slice(0, 40) : funds.slice(0, 10);
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
  requestAnimationFrame(() => root.classList.add("open"));
  document.body.classList.add("modal-open");
  return true;
};

const closeGlobalModal = (immediate = false) => {
  const root = modalRoot();
  const content = modalContent();
  const card = modalCard();
  if (!root || !content || !card) return;
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
    state.horizon = value;
    renderAll();
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
    renderDashboard();
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#F7F9FC" : "#070A12");
  localStorage.setItem("fundpulse-theme-v3", theme);
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
      renderAll();
    });
  });
};

const closePicker = () => {
  closeGlobalModal();
};

const tabOrder = ["dashboard", "funds", "insights", "compare", "profile"];

const syncTabUi = () => {
  document.querySelectorAll(".bottom-nav button").forEach((item) => item.classList.toggle("active", item.dataset.tab === state.tab));
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === `screen-${state.tab}`));
};

const switchTab = (tab, direction = 0) => {
  if (!tab || tab === state.tab) return;
  const nextScreen = $(`screen-${tab}`);
  if (!nextScreen) return;
  state.tab = tab;
  window.location.hash = `#${tab}`;
  syncTabUi();
  nextScreen.style.setProperty("--tab-shift", `${direction * 12}px`);
  renderChrome();
  renderAll();
  const app = $("app");
  if (app) app.scrollTo({ top: 0, behavior: "smooth" });
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
  document.querySelector(".controls-strip").classList.toggle("hidden", !showControls);
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
  group.style.setProperty("--pill-visible", "1");
  group.style.setProperty("--pill-x", `${active.offsetLeft - group.scrollLeft}px`);
  group.style.setProperty("--pill-y", `${active.offsetTop}px`);
  group.style.setProperty("--pill-w", `${active.offsetWidth}px`);
  group.style.setProperty("--pill-h", `${active.offsetHeight}px`);
};

const updateAllSegmentedPills = () => {
  document.querySelectorAll(".dashboard-return-tabs, .ranking-filter, .compare-return-filter, .chip-row, .time-filter").forEach(updateSegmentedPill);
};

const bindSegmentedPillTracking = () => {
  document.querySelectorAll(".dashboard-return-tabs, .ranking-filter, .compare-return-filter, .chip-row, .time-filter").forEach((group) => {
    if (!(group instanceof HTMLElement) || group.dataset.pillBound === "true") return;
    group.dataset.pillBound = "true";
    group.addEventListener("scroll", () => updateSegmentedPill(group), { passive: true });
  });
};

const syncControlState = () => {
  document.querySelectorAll("[data-horizon]").forEach((button) => {
    button.classList.toggle("active", button.dataset.horizon === state.horizon);
  });
  document.querySelectorAll(".time-filter button").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === state.period);
  });
  document.querySelectorAll(".chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sort);
  });
  requestAnimationFrame(() => {
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
  const history = historyFor(fund);
  const signals = buildStorySignals(fund, funds);
  const categoryAverage = categorySeries(funds);
  const categoryAvgReturn = funds.map((item) => item[state.horizon]).filter((value) => typeof value === "number");
  const avgReturn = categoryAvgReturn.length ? categoryAvgReturn.reduce((a, b) => a + b, 0) / categoryAvgReturn.length : null;
  const outperformCount = history.filter((point) => {
    const label = point.date ? point.date.slice(5) : point.label;
    const cat = categoryAverage.find((item) => item.label === label);
    return metricAt(point) !== null && cat && metricAt(point) >= cat.avg;
  }).length;

  $("heroCategory").textContent = state.category;
  $("heroDate").textContent = formatDate(summary.latestDate || appData.latestDate);
  const heroScoreValue = scoreOf(fund);
  $("heroScore").textContent = scoreLabel(heroScoreValue);
  $("heroScoreBadge")?.setAttribute("data-score-tone", scoreTone(heroScoreValue));
  $("topPerformer").textContent = fund.fundName;
  $("avgReturn").textContent = formatPct(avgReturn);
  $("categoryAverage").textContent = scoreLabel(summary.categoryAverageScore);
  $("consistency").textContent = Number.isFinite(Number(fund?.consistency)) ? `${Number(fund.consistency).toFixed(1)} vol` : "—";
  $("totalFunds").textContent = summary.totalFunds;
  $("dashboardInsight").textContent = `${buildHeadlineInsight(fund, funds)} ${storySentence(fund, funds)} It beat the category average in ${outperformCount} of ${history.length} visible periods.`;

  renderPerformanceChart("lineChart", fund, funds);
  $("performanceTooltip").hidden = false;
  $("performanceTooltip").textContent = `Top fund: ${fund.fundName} | Return view: ${horizonLabel()} | Score lead: ${signals.scoreLead >= 0 ? "+" : ""}${signals.scoreLead.toFixed(1)}`;
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

const renderPerformanceChart = (id, fund, funds) => {
  const target = $(id);
  if (!target || !fund) return;
  const fundHistory = chartHistoryFor(fund);
  const category = categorySeries(funds);
  const labels = [...new Set([...fundHistory.map((point) => point.label), ...category.map((point) => point.label)])];
  const selectedValues = labels.map((label) => fundHistory.find((point) => point.label === label)?.value ?? null);
  const categoryValues = labels.map((label) => category.find((point) => point.label === label)?.avg ?? null);
  renderMultiLineSvg(target, [
    { name: "Top fund", values: selectedValues, color: "#0F766E" },
    { name: "Category average", values: categoryValues, color: "#2563EB" }
  ], labels, $("performanceTooltip"));
};

const renderMultiLineSvg = (target, series, labels, tooltipEl = null) => {
  const width = 360;
  const height = 220;
  const padding = 34;
  const values = series.flatMap((item) => item.values).filter((value) => value !== null && value !== undefined);
  if (!values.length) {
    target.innerHTML = `<div class="empty-chart">Performance history is unavailable for the selected view.</div>`;
    return;
  }
  const min = Math.min(...values, 0) - 2;
  const max = Math.max(...values, 1) + 2;
  const denom = max - min || 1;
  const x = (index) => padding + index * ((width - padding * 2) / Math.max(1, labels.length - 1));
  const y = (value) => height - padding - ((value - min) / denom) * (height - padding * 2);
  const grid = [min, (min + max) / 2, max].map((tick) => `<g><line x1="${padding}" y1="${y(tick)}" x2="${width - padding}" y2="${y(tick)}" stroke="currentColor" opacity=".08"/><text x="6" y="${y(tick) + 4}" fill="currentColor" opacity=".55" font-size="9">${tick.toFixed(0)}%</text></g>`).join("");
  const lines = series.map((item) => {
    const points = item.values.map((value, index) => value === null ? null : `${x(index)},${y(value)}`).filter(Boolean).join(" ");
    const isPrimary = item === series[0];
    const dots = item.values.map((value, index) => value === null ? "" : `<circle cx="${x(index)}" cy="${y(value)}" r="${isPrimary ? 4 : 3}" fill="${item.color}"><title>${item.name}: ${value.toFixed(2)}%</title></circle>`).join("");
    return `<polyline class="chart-line" points="${points}" fill="none" stroke="${item.color}" stroke-width="${isPrimary ? 4 : 2.5}" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
  }).join("");
  const labelsSvg = labels.map((label, index) => `<text x="${x(index)}" y="${height - 8}" text-anchor="middle" fill="currentColor" opacity=".58" font-size="10" font-weight="800">${escapeHtml(label)}</text>`).join("");
  const guideLine = tooltipEl ? `<line class="chart-guide-line" id="${target.id || "chart"}GuideLine" x1="${x(Math.max(0, labels.length - 1))}" y1="${padding / 2}" x2="${x(Math.max(0, labels.length - 1))}" y2="${height - padding}" stroke="currentColor" opacity=".16" stroke-width="1.2" stroke-dasharray="4 4"/>` : "";
  const hoverZones = tooltipEl ? labels.map((label, index) => {
    const zoneX = index === 0 ? padding : x(index) - ((width - padding * 2) / Math.max(1, labels.length - 1)) / 2;
    const zoneWidth = labels.length === 1 ? width - padding * 2 : (width - padding * 2) / Math.max(1, labels.length - 1);
    return `<rect class="chart-hit" data-chart-index="${index}" x="${zoneX}" y="${padding / 2}" width="${zoneWidth}" height="${height - padding}" fill="transparent"/>`;
  }).join("") : "";
  const legendHtml = `<div class="chart-legend">${series.map((item) => `<span class="chart-legend-item" style="color:${item.color}"><i aria-hidden="true"></i><span>${escapeHtml(item.name)}</span></span>`).join("")}</div>`;
  target.innerHTML = `${legendHtml}<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top fund versus category average">${grid}${guideLine}${lines}${hoverZones}${labelsSvg}</svg>`;
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
    if (svg) {
      const handlePointerAt = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const relativeX = Math.max(padding, Math.min(width - padding, ((clientX - rect.left) / rect.width) * width));
        const step = labels.length <= 1 ? 0 : (width - padding * 2) / Math.max(1, labels.length - 1);
        const index = labels.length <= 1 ? 0 : Math.max(0, Math.min(labels.length - 1, Math.round((relativeX - padding) / step)));
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
  const rankingFilterMount = $("rankingFilterMount");
  if (rankingFilterMount) {
    rankingFilterMount.innerHTML = state.sort === "return" ? `
      <div class="quick-filter-row ranking-filter selector-container" aria-label="Ranking return horizon">
        <button class="${state.horizon === "oneYear" ? "active" : ""}" data-horizon="oneYear">1Y</button>
        <button class="${state.horizon === "threeYear" ? "active" : ""}" data-horizon="threeYear">3Y</button>
        <button class="${state.horizon === "fiveYear" ? "active" : ""}" data-horizon="fiveYear">5Y</button>
      </div>
    ` : "";
    rankingFilterMount.querySelectorAll("[data-horizon]").forEach((button) => {
      button.addEventListener("click", () => applyOptionValue("horizon", button.dataset.horizon, 0));
    });
  }
  if (!funds.length) {
    $("fundList").innerHTML = `<div class="list-note">${escapeHtml(`No funds are available in ${state.category} for the current search.`)}</div>`;
    return;
  }
  const note = query
    ? `Matching funds in ${state.category} | ${formatDate(appData.latestDate)}`
    : `Top 10 funds in ${state.category} | ${formatDate(appData.latestDate)}`;
  $("fundList").innerHTML = `
    <div class="list-note">${escapeHtml(note)}</div>
    ${funds.map((fund) => `
      <article class="fund-card" data-fund-id="${escapeHtml(fund.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(fund.fundName)} detail">
        <div class="fund-card-top">
          <div>
            <p class="eyebrow">${escapeHtml(fund.category)}</p>
            <h3 class="fund-name">${escapeHtml(fund.fundName)}</h3>
          </div>
          <div class="rank-badge">#${fund.displayRank || fund.rank}</div>
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
          <span>Score ${scoreLabel(scoreOf(fund))}</span>
        </div>
      </article>
    `).join("")}
  `;
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
  $("insightsList").innerHTML = `
    <article class="insight-card primary story-card">
      <p class="eyebrow">Headline insight</p>
      <h3>${escapeHtml(buildHeadlineInsight(fund, funds))}</h3>
      <p class="story-copy">${escapeHtml(storySentence(fund, funds))}</p>
      <div class="story-tags">${tags}</div>
    </article>
    <article class="insight-card story-card">
      <p class="eyebrow">Performance breakdown</p>
      <h3>${typeof fund.threeYear === "number" && fund.threeYear > 0.12 ? "Strong long-term return profile" : "Balanced long-term profile with mixed signals"}</h3>
      <p class="story-copy">${typeof fund.oneYear === "number" && fund.oneYear < 0.02 ? "Recent 1Y softness suggests short-term weakness." : "Recent 1Y performance is still constructive."}</p>
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
  renderReturnBarChart("analysisChart", chartFunds, false);
};

const renderReturnBarChart = (id, funds, highlightSelected = true) => {
  const target = $(id);
  if (!target) return;
  if (!funds.length) {
    target.innerHTML = `<div class="empty-chart">No comparable funds are available in this category.</div>`;
    return;
  }
  const width = 360;
  const height = Math.max(170, funds.length * 34 + 34);
  const values = funds.map((fund) => (fund[state.horizon] || 0) * 100);
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const rows = funds.map((fund, index) => {
    const value = values[index];
    const barWidth = Math.abs(value / max) * 170;
    const y = 26 + index * 34;
    const color = highlightSelected && fund.id === state.selectedFundId ? "#0F766E" : "#60A5FA";
    return `<text x="12" y="${y + 14}" fill="currentColor" opacity=".72" font-size="10" font-weight="800">${escapeHtml(fund.fundName.slice(0, 24))}</text><rect x="176" y="${y}" width="${barWidth}" height="18" rx="9" fill="${color}" opacity=".9"/><text x="${182 + barWidth}" y="${y + 14}" fill="currentColor" font-size="10" font-weight="900">${value.toFixed(1)}%</text>`;
  }).join("");
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Fund return comparison">${rows}</svg>`;
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
    return `<g><line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="currentColor" opacity=".08"/><text x="6" y="${y + 4}" fill="currentColor" opacity=".55" font-size="9">${tick.toFixed(0)}%</text></g>`;
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
  $("compareContent").innerHTML = `
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
      <h3>${escapeHtml(leader)}</h3>
      <p class="muted">Use the return selector below to switch between 1Y, 3Y, and 5Y. The comparison stays locked to ${escapeHtml(state.category)} so the read stays category-accurate.</p>
    </article>
    <article class="compare-card full-span">
      <div class="section-head">
        <div>
          <p class="eyebrow">Return comparison</p>
          <h3>${horizonLabel()} return comparison</h3>
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
  renderVerticalReturnBarChart("comparePageChart", [fundA, fundB]);
  document.querySelectorAll("#compareContent [data-horizon]").forEach((button) => {
    button.addEventListener("click", () => {
      applyOptionValue("horizon", button.dataset.horizon, 0);
    });
  });
};

const renderProfile = () => {
  const stored = localStorage.getItem("fundpulse-upload-name");
  $("uploadStatus").textContent = stored ? stored.slice(0, 22) : "Choose .xlsx";
};

const isStandaloneMode = () => window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
const isInstalledApp = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const hasSeenOnboarding = () => localStorage.getItem(ONBOARDING_KEY) === "true";
const hasCompletedInstallFlow = () => localStorage.getItem(INSTALL_FLOW_KEY) === "true";

const showMainApp = () => {
  $("skeleton")?.classList.add("hide");
  $("app")?.classList.remove("is-loading");
};

const loadDashboard = () => {
  state.tab = "dashboard";
  ensureHashRoute();
  window.location.hash = "#dashboard";
  syncTabUi();
  renderAll();
  renderChrome();
  showMainApp();
};

const enterApp = () => {
  const floatingInstall = installButtonEl();
  const shouldShowInstallCta = !isInstalledApp();
  if (floatingInstall) {
    floatingInstall.hidden = !shouldShowInstallCta;
    floatingInstall.style.display = shouldShowInstallCta ? "inline-flex" : "none";
  }
  loadDashboard();
};

const updateOnboardingPosition = (index) => {
  const container = onboardContainerEl();
  if (!container) return;
  const safeIndex = Math.max(0, Math.min(index, LAST_ONBOARDING_INDEX));
  currentOnboardingIndex = safeIndex;
  container.style.transform = `translateX(-${safeIndex * 100}%)`;
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
  localStorage.setItem(ONBOARDING_KEY, "true");
  localStorage.setItem(INSTALL_FLOW_KEY, "true");
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
};

const startExperience = () => {
  if (isInstalledApp()) {
    document.querySelectorAll(".install-btn").forEach((el) => el.remove());
    if (!hasSeenOnboarding()) {
      showOnboardingSlides();
    } else {
      enterApp();
    }
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
    }, 300);
  }, 300);
};

const setUpdateBanner = (visible) => {
  const banner = $("updateBanner");
  if (!banner) return;
  banner.hidden = !visible;
  banner.classList.toggle("visible", visible);
};

const updateInstallButton = () => {
  const button = installButtonEl();
  if (!button) return;
  const installed = isInstalledApp();
  if (!hasCompletedInstallFlow() || installed) {
    button.hidden = true;
    button.style.display = "none";
    button.classList.remove("visible");
    return;
  }
  button.hidden = false;
  button.style.display = "inline-flex";
  button.classList.toggle("visible", Boolean(deferredInstallPrompt));
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
  const params = (fundHistory.slice(-1)[0]?.parameters || fund.parameterBreakdown || []).map((param) => {
    const pct = Math.max(0, Math.min(100, Math.round((param.normalized || 0) * 100)));
    const contribution = param.contribution === null || param.contribution === undefined ? "-" : param.contribution.toFixed(1);
    return `<div class="parameter-row"><div><strong>${escapeHtml(param.label)}</strong><small>${param.value ?? "-"} | rank ${param.rank || "-"}</small></div><span>${contribution}</span><div class="parameter-track"><i style="width:${pct}%"></i></div></div>`;
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
    <div class="insight-card"><p class="eyebrow">Parameter contribution</p><div class="parameter-list">${params || "<p class='muted'>Parameter contribution is unavailable for this record.</p>"}</div></div>
    <table class="history-table"><thead><tr><th>Date</th><th>Score</th><th>1Y</th><th>3Y</th><th>5Y</th></tr></thead><tbody>${rows}</tbody></table>
  `;
  if (fundHistory.length) {
    const validScorePoints = fundHistory.filter((point) => typeof point?.score === "number");
    if (validScorePoints.length > 1) {
      renderMultiLineSvg($("detailLine"), [{ name: "Dashboard score", values: validScorePoints.map((point) => point.score), color: "#0F766E" }], validScorePoints.map((point) => (point.date || "Current").slice(-5)));
      $("detailHistoryState").textContent = validScorePoints.length <= 3 ? "Limited historical data" : "Historical series loaded";
    } else if (validScorePoints.length === 1) {
      const onlyPoint = validScorePoints[0];
      renderMultiLineSvg($("detailLine"), [{ name: "Dashboard score", values: [onlyPoint.score], color: "#0F766E" }], [(onlyPoint.date || "Latest").slice(-5)]);
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
    const color = index === 0 ? "#0f766e" : "#60a5fa";
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
      .badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#ecfeff;color:#0f766e;font-weight:700;font-size:12px}
      ul{padding-left:18px;line-height:1.7}
      .cover{padding:28px;border-radius:24px;background:linear-gradient(135deg,#dff7f4,#eef2ff);border:1px solid #dbe3ef;box-shadow:0 12px 36px rgba(15,23,42,.06)}
      .cover h1{font-size:34px}.cover p{max-width:720px}
      .chart-box{margin-top:16px;padding:18px;border:1px solid #dbe3ef;border-radius:18px;background:#fff}
      .page-break{page-break-before:always}
    </style></head><body>
      <section class="cover">
        <p class="badge">${APP_NAME} category report</p>
        <h1>${state.category}</h1>
        <p class="muted">${formatDate(summary.latestDate)} | ${datasetLabel()} | Built from the Excel-backed dashboard logic for category-level review, ranking, and fund comparison.</p>
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
  localStorage.setItem("fundpulse-upload-name", file.name);
  $("uploadStatus").textContent = file.name.slice(0, 22);
  if (file.name.endsWith(".json")) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.analysis !== "excel-dashboard" || !parsed.funds || !parsed.summaries) throw new Error("Invalid data");
        appData = normalizeAppData(parsed);
        localStorage.setItem("fundpulse-data", JSON.stringify(appData));
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
    localStorage.removeItem("fundpulse-data");
    localStorage.setItem("fundpulse-data", JSON.stringify(imported));
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
    syncControlState();
  } catch (error) {
    console.error(`${APP_NAME} render failure`, error);
    const activeScreen = document.querySelector(".screen.active");
    if (activeScreen) {
      activeScreen.innerHTML = `<article class="insight-card fallback-card"><p class="eyebrow">Something went wrong</p><h3>We could not load this view cleanly.</h3><p class="story-copy">Try switching category or tab again. The app caught the error instead of blanking the screen.</p></article>`;
    }
  }
};

const bindEvents = () => {
  $("themeToggle").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  $("profileTheme").addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  $("categoryTrigger").addEventListener("click", () => openPicker("category"));
  $("compareFundATrigger").addEventListener("click", () => openPicker("compareFundA"));
  $("compareFundBTrigger").addEventListener("click", () => openPicker("compareFundB"));
  $("global-modal-backdrop").addEventListener("click", closeGlobalModal);
  $("global-modal-close").addEventListener("click", closeGlobalModal);

  document.querySelectorAll(".bottom-nav [data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab, 0));
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

  $("searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderFunds();
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
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } finally {
        deferredInstallPrompt = null;
        updateInstallButton();
      }
    }
    localStorage.setItem(INSTALL_FLOW_KEY, "true");
    enterApp();
  });

  $("onboardingSkipInstall")?.addEventListener("click", showOnboardingSlides);
  document.querySelectorAll(".onboarding-next").forEach((button) => {
    button.addEventListener("click", handleOnboardingNext);
  });
  document.querySelectorAll(".onboarding-skip-all").forEach((button) => {
    button.addEventListener("click", finishOnboarding);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllOverlays();
  });

  window.addEventListener("hashchange", () => {
    const nextTab = routeFromHash();
    if (nextTab !== state.tab) {
      state.tab = nextTab;
      syncTabUi();
      renderChrome();
      renderAll();
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

  $("excelUpload").addEventListener("change", (event) => handleUpload(event.target.files[0]));
  $("updateBanner")?.addEventListener("click", () => {
    if (waitingServiceWorker) {
      pendingUpdateReload = true;
      setUpdateBanner(false);
      waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
      window.setTimeout(() => {
        if (pendingUpdateReload) {
          window.location.reload();
        }
      }, 800);
    }
  });
  $("saveReport").addEventListener("click", () => {
    const reportWindow = window.open("", "_blank", "width=1100,height=800");
    if (!reportWindow) return;
    reportWindow.document.write(buildReportHtml());
    reportWindow.document.close();
    reportWindow.focus();
    setTimeout(() => reportWindow.print(), 300);
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("/service-worker.js").then((registration) => {
      if (registration.waiting) {
        waitingServiceWorker = registration.waiting;
        waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            waitingServiceWorker = registration.waiting || installing;
            if (registration.waiting) {
              registration.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          }
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        const reloadKey = "funalytics-sw-reload";
        if (!sessionStorage.getItem(reloadKey)) {
          sessionStorage.setItem(reloadKey, "1");
          pendingUpdateReload = false;
          window.location.reload();
        }
      });
    }).catch(() => {});
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    localStorage.setItem(INSTALL_FLOW_KEY, "true");
    deferredInstallPrompt = null;
    updateInstallButton();
  });

  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", updateInstallButton);
  window.addEventListener("resize", () => requestAnimationFrame(updateAllSegmentedPills));
};

const init = () => {
  ensureHashRoute();
  state.tab = routeFromHash();
  setTheme(state.theme);
  bindEvents();
  updateInstallButton();
  renderAll();
  playSplashAndBoot();
};

init();

