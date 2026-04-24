import { useEffect } from "react";
import { InteractionManager } from "react-native";
import { prefetchCategoryNAVs } from "./NavService";

type FundLike = {
  category?: string;
  fundName: string;
};

export function useCategoryPrefetch(category: string, funds: FundLike[]) {
  useEffect(() => {
    if (!category || !Array.isArray(funds) || !funds.length) return;

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      prefetchCategoryNAVs(category, funds).catch(() => {
        // Keep prefetch failures silent. The screen should still render from cache/on-demand lookups.
      });
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [category, funds]);
}
