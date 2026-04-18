# FundPulse - Mutual Fund Performance Dashboard

FundPulse is a mobile-first mutual fund dashboard prototype generated from:

`C:\Users\ameen\Documents\WORK\Mutual Fund Dashboard .xlsx`

## What is included

- Dashboard screen with category selection, Excel dashboard score ranking, KPI cards, top performer first, category average, line chart, score methodology panel, and AI-style summary.
- Rankings screen with top 10 by default, full-workbook search, sorting by rank/selected return/consistency, trend labels, and fund cards.
- Fund detail sheet with historical returns, trend chart, table, score metrics, and consistency heatmap.
- Fund detail sheet includes parameter contribution bars from the workbook scoring method.
- Analysis screen with top performer analysis, category health, best category, top funds, and underperformer watchlist.
- Compare screen for side-by-side category comparison.
- About screen with theme toggle, install guidance, upload control, print/export, data source status, and credits.
- Light and dark mode support.
- Self-contained data bundle in `assets/app-data.js`.

## Run

Open `index.html` in a browser. No package installation is required for this prototype.

## Update data from a newer workbook

Use an updated workbook with the same sheet structure and run:

```powershell
python scripts/import_workbook.py "C:\path\to\updated-dashboard.xlsx"
```

This regenerates `assets/app-data.js`.

## React Native porting map

- `src/app.js` state maps cleanly to Zustand or React Context.
- `src/styles.css` tokens map to a `theme.ts` object.
- SVG chart functions map to `react-native-svg`, `victory-native`, or `react-native-skia`.
- The detail sheet maps to `@gorhom/bottom-sheet`.
- The bottom nav maps to Expo Router tabs.
