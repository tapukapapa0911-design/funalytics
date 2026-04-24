window.LiveDataVersion = window.LiveDataVersion || {};

window.LiveDataVersion.dataProvider = (() => {
  const schema = window.LiveDataVersion.schema;
  const cache = window.LiveDataVersion.cache;
  const { ensureAppShape, clone } = window.LiveDataVersion.validation;
  const mapper = window.LiveDataVersion.dataMapper;
  const liveNavService = window.LiveDataVersion.liveNavService;

  const readBackupData = async () => {
    if (window.EXCEL_BACKUP_DATA) return clone(window.EXCEL_BACKUP_DATA);
    const response = await fetch("./mockData/excel-backup.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Backup dataset unavailable");
    return response.json();
  };

  const primeAppData = ({ backupData }) => {
    const cached = cache.readJson(schema.cache.datasetKey);
    if (cache.isFresh(cached, schema.cache.ttlMs) && cached?.data) {
      return ensureAppShape(cached.data, backupData);
    }
    const snapshotRows = Array.isArray(window.LIVE_NAV_SNAPSHOT?.items) ? window.LIVE_NAV_SNAPSHOT.items : [];
    if (snapshotRows.length) {
      const { data: merged } = mapper.mergeLatestNav(backupData, snapshotRows);
      return ensureAppShape(merged, backupData);
    }
    return ensureAppShape(backupData, backupData);
  };

  const persistDataset = (data) => {
    cache.writeJson(schema.cache.datasetKey, { savedAt: Date.now(), data });
    return data;
  };

  const refreshAppData = async ({ backupData }) => {
    const safeBackup = ensureAppShape(backupData, backupData) || await readBackupData();

    try {
      const snapshotRows = Array.isArray(window.LIVE_NAV_SNAPSHOT?.items) ? window.LIVE_NAV_SNAPSHOT.items : [];
      if (snapshotRows.length) {
        const { data: snapshotMerged } = mapper.mergeLatestNav(safeBackup, snapshotRows);
        return persistDataset(ensureAppShape(snapshotMerged, safeBackup));
      }

      const latestNavRows = await liveNavService.resolveLatestRows(safeBackup.funds || []);
      const { data: merged } = mapper.mergeLatestNav(safeBackup, latestNavRows);
      return persistDataset(ensureAppShape(merged, safeBackup));
    } catch (error) {
      console.warn("[live-data-version] Latest NAV refresh failed, using cache/backup:", error);
      const cached = cache.readJson(schema.cache.datasetKey);
      if (cached?.data) return ensureAppShape(cached.data, safeBackup);
      return safeBackup;
    }
  };

  return { readBackupData, primeAppData, refreshAppData };
})();
