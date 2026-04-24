(async () => {
  const loadScript = (src) => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-live-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
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

  const backupData = window.LiveDataVersion.validation.clone(window.FUND_APP_DATA || {});
  window.EXCEL_BACKUP_DATA = backupData;

  const bootData = window.LiveDataVersion.dataProvider.primeAppData({ backupData });
  window.FUND_APP_DATA = bootData;

  await loadOptionalScript("./assets/vendor/jszip.min.js");
  await loadOptionalScript("./src/workbook-import.js");
  await loadScript("./src/app.js");

  const startLiveRefresh = () => {
    window.LiveDataVersion.dataProvider.refreshAppData({ backupData }).then((liveData) => {
      if (!liveData) return;
      window.FUND_APP_DATA = liveData;
      window.dispatchEvent(new CustomEvent("live-data:updated", { detail: { data: liveData } }));
    }).catch((error) => {
      console.warn("[live-data-version] background refresh failed", error);
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(startLiveRefresh, { timeout: 900 });
  } else {
    window.setTimeout(startLiveRefresh, 180);
  }
})();
