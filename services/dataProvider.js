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

  const localIsoDate = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const latestSnapshotDate = () => {
    const explicit = localIsoDate(window.LIVE_NAV_SNAPSHOT?.latestDate);
    if (explicit) return explicit;
    const rows = Array.isArray(window.LIVE_NAV_SNAPSHOT?.items) ? window.LIVE_NAV_SNAPSHOT.items : [];
    return rows
      .map((row) => localIsoDate(row?.date || row?.latestDate))
      .filter(Boolean)
      .sort()
      .at(-1) || "";
  };

  const dateValue = (value) => {
    const iso = localIsoDate(value);
    if (!iso) return 0;
    const parsed = new Date(`${iso}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  };

  const navDateOf = (data) => data?.liveNavDate || data?.latestDate || "";

  const dominantDateFromRows = (rows = [], fallback = "") => {
    const counts = new Map();
    rows.forEach((row) => {
      const candidate = localIsoDate(row?.date || row?.latestDate);
      if (!candidate) return;
      counts.set(candidate, (counts.get(candidate) || 0) + 1);
    });
    if (!counts.size) return fallback || "";
    return [...counts.entries()]
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return dateValue(right[0]) - dateValue(left[0]);
      })[0][0] || fallback || "";
  };

  const sanitizeRowsToDominantDate = (rows = [], fallback = "") => {
    const authoritativeDate = dominantDateFromRows(rows, fallback);
    if (!authoritativeDate) return rows;
    const authoritativeValue = dateValue(authoritativeDate);
    return rows.map((row) => {
      const candidateDate = localIsoDate(row?.date || row?.latestDate);
      if (!candidateDate) return row;
      if (dateValue(candidateDate) > authoritativeValue) {
        return { ...row, date: authoritativeDate, latestDate: authoritativeDate };
      }
      return row;
    });
  };

  const sanitizeDatasetDates = (data, fallbackData) => {
    const safe = ensureAppShape(data, fallbackData);
    const authoritativeDate = dominantDateFromRows(
      (safe?.funds || []).map((fund) => ({ latestDate: fund?.liveNavDate || fund?.latestNavDate || null })),
      safe?.liveNavDate || fallbackData?.liveNavDate || ""
    );
    if (!authoritativeDate) return safe;
    const authoritativeValue = dateValue(authoritativeDate);
    let fundsChanged = false;

    const nextFunds = (safe.funds || []).map((fund) => {
      const candidateDate = localIsoDate(fund?.liveNavDate || fund?.latestNavDate);
      if (!candidateDate || dateValue(candidateDate) <= authoritativeValue) return fund;
      fundsChanged = true;
      return { ...fund, liveNavDate: authoritativeDate };
    });

    if (!fundsChanged && safe.liveNavDate === authoritativeDate) {
      return safe;
    }

    return {
      ...safe,
      funds: fundsChanged ? nextFunds : safe.funds,
      liveNavDate: authoritativeDate
    };
  };

  const RECENT_SNAPSHOT_WINDOW_MS = 48 * 60 * 60 * 1000;

  const pickFresherDataset = (left, right, fallbackData) => {
    const safeLeft = left ? sanitizeDatasetDates(left, fallbackData) : null;
    const safeRight = right ? sanitizeDatasetDates(right, fallbackData) : null;
    if (!safeLeft) return safeRight;
    if (!safeRight) return safeLeft;

    const leftDate = dateValue(navDateOf(safeLeft));
    const rightDate = dateValue(navDateOf(safeRight));
    if (rightDate > leftDate) return safeRight;
    if (leftDate > rightDate) return safeLeft;

    const leftFunds = Array.isArray(safeLeft.funds) ? safeLeft.funds.length : 0;
    const rightFunds = Array.isArray(safeRight.funds) ? safeRight.funds.length : 0;
    return rightFunds >= leftFunds ? safeRight : safeLeft;
  };

  const readCachedDataset = (backupData) => {
    const cached = cache.readJson(schema.cache.datasetKey);
    return cache.isFresh(cached, schema.cache.ttlMs) && cached?.data
      ? sanitizeDatasetDates(cached.data, backupData)
      : null;
  };

  const isSnapshotRecent = () => {
    const rows = Array.isArray(window.LIVE_NAV_SNAPSHOT?.items) ? window.LIVE_NAV_SNAPSHOT.items : [];
    if (!rows.length) return false;

    const generatedAt = new Date(window.LIVE_NAV_SNAPSHOT?.generatedAt || "");
    if (!Number.isNaN(generatedAt.getTime())) {
      return Date.now() - generatedAt.getTime() <= RECENT_SNAPSHOT_WINDOW_MS;
    }

    const snapshotDate = latestSnapshotDate();
    if (!snapshotDate) return false;
    const parsed = new Date(`${snapshotDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return false;
    return Date.now() - parsed.getTime() <= RECENT_SNAPSHOT_WINDOW_MS;
  };

  const snapshotRowsIfRecent = () => {
    const rows = Array.isArray(window.LIVE_NAV_SNAPSHOT?.items) ? window.LIVE_NAV_SNAPSHOT.items : [];
    return isSnapshotRecent() ? rows : [];
  };

  const snapshotRowsIfFresherThanBackup = (backupLatestDate = "") => {
    const rows = Array.isArray(window.LIVE_NAV_SNAPSHOT?.items) ? window.LIVE_NAV_SNAPSHOT.items : [];
    if (!rows.length) return [];
    const snapshotDate = dominantDateFromRows(rows, latestSnapshotDate());
    if (dateValue(snapshotDate) > dateValue(backupLatestDate)) return rows;
    return snapshotRowsIfRecent();
  };

  const buildSnapshotDataset = (backupData) => {
    const snapshotRows = sanitizeRowsToDominantDate(
      snapshotRowsIfFresherThanBackup(backupData?.latestDate),
      backupData?.latestDate
    );
    if (!snapshotRows.length) return null;
    const { data: merged } = mapper.mergeLatestNav(backupData, snapshotRows);
    merged.liveNavDate = latestDateFromRows(snapshotRows, merged.liveNavDate || backupData.liveNavDate || "");
    return sanitizeDatasetDates(merged, backupData);
  };

  const latestDateFromRows = (rows, fallback = "") => dominantDateFromRows(rows, fallback);

  const primeAppData = ({ backupData }) => {
    const snapshotData = buildSnapshotDataset(backupData);
    return pickFresherDataset(snapshotData, sanitizeDatasetDates(backupData, backupData), backupData);
  };

  const persistDataset = (data) => {
    const sanitized = sanitizeDatasetDates(data, data);
    cache.writeJson(schema.cache.datasetKey, { savedAt: Date.now(), data: sanitized });
    return sanitized;
  };

  const refreshAppData = async ({ backupData, forceLive = false }) => {
    const safeBackup = ensureAppShape(backupData, backupData) || await readBackupData();
    const snapshotData = buildSnapshotDataset(safeBackup);

    try {
      if (!forceLive && snapshotData) {
        return persistDataset(ensureAppShape(snapshotData, safeBackup));
      }

      const latestNavRows = sanitizeRowsToDominantDate(
        await liveNavService.resolveLatestRows(safeBackup.funds || []),
        safeBackup.latestDate
      );
      if (!latestNavRows.length) {
        if (snapshotData) return persistDataset(ensureAppShape(snapshotData, safeBackup));
        return persistDataset(safeBackup);
      }
      const { data: merged } = mapper.mergeLatestNav(safeBackup, latestNavRows);
      merged.liveNavDate = latestDateFromRows(latestNavRows, merged.liveNavDate || safeBackup.liveNavDate || "");
      return persistDataset(ensureAppShape(merged, safeBackup));
    } catch (error) {
      console.warn("[live-data-version] Latest NAV refresh failed, using cache/backup:", error);
      const cachedData = readCachedDataset(safeBackup);
      const fallback = pickFresherDataset(
        pickFresherDataset(cachedData, snapshotData, safeBackup),
        sanitizeDatasetDates(safeBackup, safeBackup),
        safeBackup
      );
      return persistDataset(ensureAppShape(fallback, safeBackup));
    }
  };

  return { readBackupData, primeAppData, refreshAppData };
})();
