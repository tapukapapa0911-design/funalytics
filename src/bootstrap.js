(async () => {
  const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
  const BUILD_VERSION = "2026-04-26-navfix3";

  const loadScript = (src) => new Promise((resolve, reject) => {
    const versionedSrc = src.includes("?") ? `${src}&v=${BUILD_VERSION}` : `${src}?v=${BUILD_VERSION}`;
    const existing = document.querySelector(`script[data-live-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = versionedSrc;
    script.async = false;
    script.dataset.liveSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });

  const loadOptionalScript = async (src) => {
    try {
      await loadScript(src);
      return true;
    } catch (error) {
      console.warn(`[live-data-version] optional script skipped: ${src}`, error);
      return false;
    }
  };

  const todayIso = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const isoDateValue = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  };

  const navDateOf = (data) => data?.liveNavDate || data?.latestDate || "";

  const shouldReplaceDataset = (currentData, nextData) => {
    const currentDate = isoDateValue(navDateOf(currentData));
    const nextDate = isoDateValue(navDateOf(nextData));
    if (nextDate > currentDate) return true;
    if (currentDate > nextDate) return false;
    const currentFunds = Array.isArray(currentData?.funds) ? currentData.funds.length : 0;
    const nextFunds = Array.isArray(nextData?.funds) ? nextData.funds.length : 0;
    return nextFunds >= currentFunds;
  };

  const DATA_FRESHNESS_WINDOW_MS = 36 * 60 * 60 * 1000;
  const isRecentNavDate = (value) => {
    const time = isoDateValue(value);
    if (!time) return false;
    return (Date.now() - time) <= DATA_FRESHNESS_WINDOW_MS;
  };

  const nextMidnightDelayMs = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return Math.max(1000, next.getTime() - now.getTime());
  };

  const waitForDataProvider = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.LiveDataVersion?.dataProvider) return window.LiveDataVersion.dataProvider;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return null;
  };

  const clearStaleNavCaches = () => {
    const cacheApi = window.LiveDataVersion?.cache;
    const schema = window.LiveDataVersion?.schema;
    if (!cacheApi || !schema?.cache) return;
    cacheApi.purgeStaleByPrefix?.("live-funalytics", MAX_CACHE_AGE_MS);
    cacheApi.purgeKeysOlderThan?.([schema.cache.datasetKey], MAX_CACHE_AGE_MS);
    cacheApi.remove?.("fundpulse-live-data-v5");
  };

  const preloadLiveIfNeeded = async (dataProvider, backupData, bootData) => {
    if (isRecentNavDate(navDateOf(bootData))) return bootData;

    try {
      const timeout = new Promise((resolve) => window.setTimeout(() => resolve(null), 4500));
      const live = await Promise.race([
        dataProvider.refreshAppData({ backupData, forceLive: true }),
        timeout
      ]);
      return live || bootData;
    } catch (error) {
      console.warn("[live-data-version] live preload failed; using boot data", error);
      return bootData;
    }
  };

  const backupData = window.LiveDataVersion.validation.clone(window.FUND_APP_DATA || {});
  window.EXCEL_BACKUP_DATA = backupData;

  clearStaleNavCaches();

  const dataProvider = await waitForDataProvider();
  if (!dataProvider) {
    console.warn("[live-data-version] dataProvider unavailable during bootstrap; using backup data");
    window.FUND_APP_DATA = backupData;
    await loadScript("./src/app.js");
    window.setTimeout(() => {
      loadOptionalScript("./assets/vendor/jszip.min.js")
        .then(() => loadOptionalScript("./src/workbook-import.js"));
    }, 0);
    return;
  }

  const bootData = dataProvider.primeAppData({ backupData });
  const initialData = bootData;
  window.FUND_APP_DATA = initialData;

  await loadScript("./src/app.js");

  window.setTimeout(() => {
    loadOptionalScript("./assets/vendor/jszip.min.js")
      .then(() => loadOptionalScript("./src/workbook-import.js"));
  }, 0);

  let refreshInFlight = null;

  const startLiveRefresh = (reason = "background") => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = dataProvider.refreshAppData({ backupData, forceLive: true }).then((liveData) => {
      if (!liveData) return;
      if (!shouldReplaceDataset(window.FUND_APP_DATA, liveData)) return;
      window.FUND_APP_DATA = liveData;
      window.dispatchEvent(new CustomEvent("live-data:updated", { detail: { data: liveData, reason } }));
    }).catch((error) => {
      console.warn("[live-data-version] background refresh failed", error);
    }).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  if (!isRecentNavDate(navDateOf(bootData))) {
    window.setTimeout(async () => {
      try {
        const preloaded = await preloadLiveIfNeeded(dataProvider, backupData, bootData);
        if (preloaded && preloaded !== window.FUND_APP_DATA && shouldReplaceDataset(window.FUND_APP_DATA, preloaded)) {
          window.FUND_APP_DATA = preloaded;
          window.dispatchEvent(new CustomEvent("live-data:updated", { detail: { data: preloaded, reason: "startup-preload" } }));
        }
      } catch (error) {
        console.warn("[live-data-version] startup preload failed", error);
      }
    }, 120);
  }

  const scheduleDailyMidnightRefresh = () => {
    const queueNext = () => {
      window.setTimeout(async () => {
        await startLiveRefresh("daily-midnight");
        queueNext();
      }, nextMidnightDelayMs());
    };
    queueNext();
  };

  const handleVisibilityRefresh = () => {
    if (document.visibilityState !== "visible") return;
    if (isRecentNavDate(navDateOf(window.FUND_APP_DATA))) return;
    window.setTimeout(() => startLiveRefresh("visibility"), 40);
  };

  if (!isRecentNavDate(navDateOf(initialData))) {
    window.setTimeout(() => startLiveRefresh("startup-stale"), 180);
  } else if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => startLiveRefresh("startup-idle"), { timeout: 900 });
  } else {
    window.setTimeout(() => startLiveRefresh("startup-idle"), 320);
  }

  scheduleDailyMidnightRefresh();
  document.addEventListener("visibilitychange", handleVisibilityRefresh);
})();
