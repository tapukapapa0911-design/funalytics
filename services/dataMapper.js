window.LiveDataVersion = window.LiveDataVersion || {};

window.LiveDataVersion.dataMapper = (() => {
  const { clone, ensureAppShape } = window.LiveDataVersion.validation;
  const { buildParameterBreakdown, scoreFromBreakdown, trendFromHistory, summarizeCategory, stdev } = window.LiveDataVersion.calculations;
  const schema = window.LiveDataVersion.schema;

  const canon = (value) => String(value || "")
    .toLowerCase()
    .replace(/\(g\)|regular|direct|growth|plan|fund|option|reinvestment|payout|bonus|dividend|idcw|-/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const nameKeys = (value) => {
    const base = canon(value);
    const compact = base.replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();
    const noSpaces = compact.replace(/\s+/g, "");
    return [...new Set([base, compact, noSpaces].filter(Boolean))];
  };

  const buildBackupLookup = (backupData) => {
    const rows = new Map();
    for (const fund of backupData?.funds || []) {
      const keys = new Set([
        ...nameKeys(fund.fundName),
        ...nameKeys(fund.rawFundName)
      ]);
      keys.forEach((key) => {
        if (key) rows.set(key, fund);
      });
    }
    return rows;
  };

  const mergeLatestNav = (backupData, latestRows) => {
    const next = clone(backupData);
    const backupLookup = buildBackupLookup(backupData);
    const mappedFunds = [];
    const latestByTargetId = new Map();
    const latestBySchemeCode = new Map();
    const latestByNameKey = new Map();

    for (const row of latestRows) {
      if (row?.targetId) {
        latestByTargetId.set(row.targetId, row);
      }
      if (row?.schemeCode) {
        latestBySchemeCode.set(String(row.schemeCode), row);
      }
      for (const key of nameKeys(row?.schemeName)) {
        if (key && !latestByNameKey.has(key)) latestByNameKey.set(key, row);
      }
    }

    for (const fund of backupData?.funds || []) {
      let liveMatch = latestByTargetId.get(fund.id) || null;

      if (!liveMatch && fund.schemeCode) {
        liveMatch = latestBySchemeCode.get(String(fund.schemeCode)) || null;
      }

      if (!liveMatch) {
        liveMatch = [...nameKeys(fund.fundName), ...nameKeys(fund.rawFundName)]
          .map((key) => latestByNameKey.get(key))
          .find(Boolean);
      }

      if (!liveMatch || !Number.isFinite(Number(liveMatch.nav))) continue;
      mappedFunds.push({
        schemeCode: liveMatch.schemeCode,
        schemeName: liveMatch.schemeName,
        isinGrowth: liveMatch.isinGrowth,
        targetId: fund.id,
        latestNav: liveMatch.nav,
        latestDate: liveMatch.date
      });
    }

    const mappedById = new Map(mappedFunds.map((entry) => [entry.targetId, entry]));
    next.funds = next.funds.map((fund) => {
      const liveMatch = mappedById.get(fund.id);
      if (!liveMatch) return fund;
      return {
        ...fund,
        schemeCode: liveMatch.schemeCode,
        liveSchemeName: liveMatch.schemeName,
        latestNav: liveMatch.latestNav,
        latestDate: liveMatch.latestDate || fund.latestDate
      };
    });

    next.latestDate = next.funds.map((fund) => fund.latestDate).filter(Boolean).sort().at(-1) || next.latestDate;
    return { data: next, mappedFunds };
  };

  const applyHistoryToFunds = (data, historiesByFundId) => {
    const next = clone(data);

    next.funds = next.funds.map((fund) => {
      const liveSeries = historiesByFundId[fund.id];
      if (!Array.isArray(liveSeries) || !liveSeries.length) return fund;

      const calc = window.LiveDataVersion.calculations;
      const { deriveTrailingReturn, sharpeFromHistory, sortinoFromHistory, volatilityFromHistory } = calc;

      // ── Returns from NAV history (CAGR) ────────────────────────────────────────
      const oneYear   = deriveTrailingReturn(liveSeries, 1) ?? fund.oneYear;
      const threeYear = deriveTrailingReturn(liveSeries, 3) ?? fund.threeYear;
      const fiveYear  = deriveTrailingReturn(liveSeries, 5) ?? fund.fiveYear;

      // ── Risk metrics computed from 3Y monthly NAV series ──────────────────────
      // All three use identical monthly-returns window to match Excel/SEBI convention
      const liveSharpe    = sharpeFromHistory(liveSeries);
      const liveSortino   = sortinoFromHistory(liveSeries);
      const liveVolatility = volatilityFromHistory(liveSeries);

      // Fall back to backup if live computation yields null
      // (e.g. fund has less than 12 months of data)
      const sharpe     = liveSharpe    ?? fund.sharpe;
      const sortino    = liveSortino   ?? fund.sortino;
      const volatility = liveVolatility ?? fund.volatility;

      // ── Latest NAV for fund card display ──────────────────────────────────────
      // liveSeries is ascending (oldest first), so last item is most recent
      const latestNavPoint = liveSeries.at(-1);
      const latestNav  = latestNavPoint?.nav ?? fund.latestNav ?? null;
      const latestDate = latestNavPoint?.date ?? fund.latestDate;

      // ── PE and PB ──────────────────────────────────────────────────────────────
      // These are portfolio fundamental metrics (not derivable from NAV).
      // They are provided by fund's AMC factsheet, fetched via RapidAPI if key is
      // configured (see dataProvider.js pePbCache), else use backup values.
      // The pePbData is injected into each fund object by dataProvider before
      // applyHistoryToFunds is called. Use it if available, else keep backup.
      const pe = (Number.isFinite(Number(fund.livePe)) && fund.livePe > 0)
        ? fund.livePe
        : fund.pe;
      const pb = (Number.isFinite(Number(fund.livePb)) && fund.livePb > 0)
        ? fund.livePb
        : fund.pb;

      const updatedHistory = [
        ...(fund.history || []).slice(0, Math.max((fund.history || []).length - 1, 0)),
        {
          ...(fund.history || []).at(-1),
          date: latestDate,
          oneYear,
          threeYear,
          fiveYear,
          sharpe,
          sortino,
          pe,
          pb
        }
      ];

      return {
        ...fund,
        latestDate,
        latestNav,
        oneYear,
        threeYear,
        fiveYear,
        sharpe,
        sortino,
        volatility,
        pe,
        pb,
        averageReturn: calc.mean(
          [oneYear, threeYear, fiveYear].filter((v) => Number.isFinite(v))
        ) ?? fund.averageReturn,
        history: updatedHistory
      };
    });

    const byCategory = new Map();
    for (const fund of next.funds) {
      const key = fund.category;
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(fund);
    }

    for (const funds of byCategory.values()) {
      const peers = funds.map((fund) => ({
        oneYear: fund.oneYear,
        threeYear: fund.threeYear,
        fiveYear: fund.fiveYear,
        sharpe: fund.sharpe,
        pe: fund.pe,
        pb: fund.pb,
        sortino: fund.sortino,
        volatility: fund.volatility
      }));

      funds.forEach((fund) => {
        const breakdown = buildParameterBreakdown(fund, peers, schema.scoring.modern);
        fund.parameterBreakdown = breakdown.some((entry) => entry.contribution !== null) ? breakdown : fund.parameterBreakdown;
        const computedScore = scoreFromBreakdown(fund.parameterBreakdown);
        if (Number.isFinite(computedScore)) fund.dashboardScore = computedScore;
      });

      const ordered = [...funds].sort((a, b) => (b.dashboardScore || 0) - (a.dashboardScore || 0));
      ordered.forEach((fund, index) => {
        fund.rank = index + 1;
        const scoreHistory = (fund.history || []).map((point) => ({ score: point.score ?? fund.dashboardScore }));
        const { trend, delta } = trendFromHistory(scoreHistory);
        fund.trend = trend;
        fund.trendDelta = delta;
        fund.consistency = Number(stdev((fund.history || []).map((point) => Number(point.score))).toFixed(2));
        fund.flag = fund.rank <= 5 ? "Top Performers" : (fund.flag || "Core");
      });
    }

    next.summaries = [...byCategory.entries()].map(([category, funds]) => summarizeCategory(category, funds));
    next.analysis = schema.appAnalysis;
    next.generatedFrom = "live-amfi + excel-backup";
    next.categories = [...byCategory.keys()].sort();
    next.latestDate = next.funds.map((fund) => fund.latestDate).filter(Boolean).sort().at(-1) || next.latestDate;

    return ensureAppShape(next, data);
  };

  return { mergeLatestNav, applyHistoryToFunds, buildBackupLookup };
})();
