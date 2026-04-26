window.LiveDataVersion = window.LiveDataVersion || {};

window.LiveDataVersion.schema = {
  appAnalysis: "live-dashboard",
  sourceWorkbook: "Mutual Fund Dashboard .xlsx",
  liveSources: [
    {
      id: "amfi-latest-nav",
      label: "AMFI Latest NAV",
      url: "https://www.amfiindia.com/spages/NAVAll.txt",
      purpose: "Full scheme catalog: scheme codes, ISIN codes, latest NAV, latest date"
    },
    {
      id: "mfapi-history",
      label: "mfapi.in Full NAV History",
      url: "https://api.mfapi.in/mf/",
      purpose: "Per-scheme full NAV history. Used to compute 1Y/3Y/5Y CAGR, Sharpe, Sortino, Volatility. Free, no API key required."
    },
    {
      id: "amfi-history-portal",
      label: "AMFI NAV History Portal (legacy fallback)",
      url: "https://portal.amfiindia.com/NavHistoryReport_Rpt_Po.aspx",
      purpose: "Fallback history source if mfapi.in is unavailable"
    },
    {
      id: "rapidapi-pe-pb",
      label: "RapidAPI Mutual Fund India (PE/PB)",
      url: "https://latest-mutual-fund-nav.p.rapidapi.com/fetchMutualFundDetailsByISIN",
      purpose: "Portfolio PE and PB ratios per fund. Requires RAPIDAPI_KEY. Falls back to Excel backup if unavailable."
    }
  ],
  riskFreeRate: 0.065,
  cache: {
    bootstrapKey: "live-funalytics-bootstrap-cache",
    latestNavKey: "live-funalytics-latest-nav-cache-v6",
    navSchemeListKey: "live-funalytics-nav-scheme-list-v6",
    navMatchMapKey: "live-funalytics-nav-match-map-v6",
    navResolverKey: "live-funalytics-nav-resolver-cache-v6",
    navFallbackKey: "live-funalytics-nav-fallback-cache-v6",
    datasetKey: "fundpulse-live-data-v6",
    ttlMs: 10 * 60 * 1000,
    hardTtlMs: 60 * 60 * 1000,
    navTtlMs: 10 * 60 * 1000,
    schemeListTtlMs: 24 * 60 * 60 * 1000
  },
  scoring: {
    old: [
      { label: "1Y", metric: "oneYear", higherBetter: true, weight: 0.10 },
      { label: "3Y", metric: "threeYear", higherBetter: true, weight: 0.20 },
      { label: "5Y", metric: "fiveYear", higherBetter: true, weight: 0.25 },
      { label: "Sharpe", metric: "sharpe", higherBetter: true, weight: 0.15 },
      { label: "Volatility", metric: "volatility", higherBetter: false, weight: 0.30 }
    ],
    modern: [
      { label: "1Y", metric: "oneYear", higherBetter: true, weight: 0.10 },
      { label: "3Y", metric: "threeYear", higherBetter: true, weight: 0.20 },
      { label: "5Y", metric: "fiveYear", higherBetter: true, weight: 0.25 },
      { label: "Sharpe", metric: "sharpe", higherBetter: true, weight: 0.15 },
      { label: "P/E", metric: "pe", higherBetter: false, weight: 0.10 },
      { label: "P/B", metric: "pb", higherBetter: false, weight: 0.10 },
      { label: "Sortino", metric: "sortino", higherBetter: true, weight: 0.10 }
    ]
  },
  fieldMapping: {
    fund_name: "schemeName",
    nav: "nav",
    latest_date: "date",
    returns_1y: "derived from historical NAV",
    returns_3y: "derived from historical NAV",
    returns_5y: "derived from historical NAV",
    risk_ratio: "sharpe / sortino / volatility computed from NAV history, PE / PB preserved from verified backup until a reliable live portfolio source is configured"
  }
};
