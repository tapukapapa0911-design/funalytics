# Live NAV Integration Guide

This module set keeps Excel scoring untouched and only powers the NAV box.

## 1. Render the NAV box

```tsx
<NavDisplay
  key={`${fund.category}:${fund.fundName}`}
  category={fund.category}
  fundName={fund.fundName}
/>
```

Pass the same `category` and `fundName` your list item already uses.

## 2. Prefetch on category change

In the screen that owns the selected category and the visible fund list:

```tsx
import { useCategoryPrefetch } from "./react-native-nav/useCategoryPrefetch";

useCategoryPrefetch(selectedCategory, fundsForSelectedCategory);
```

This warms the in-memory cache in the background with a max of 3 requests at a time.

## 3. Foreground refresh behavior

`useLiveNav()` already installs the `AppState` listener the first time it runs.

Behavior:
- if a cached NAV is still fresh, it shows instantly
- if the cache is stale, the old NAV stays visible
- a silent refresh runs after the app returns to the foreground
- the UI never drops to `0.00`

## 4. Excel safety

These files do not touch formulas, ranking logic, or analysis sheets.

If you want one-time fund-name cleanup, use `ExcelUpdater.ts` separately and only on the fund-name column.

## 5. Offline behavior

- memory cache is used first
- AsyncStorage cache is used next
- if both are stale, stale-while-revalidate keeps the last known good NAV visible while refresh happens in the background
