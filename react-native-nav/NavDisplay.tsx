import React, { memo } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useLiveNav } from "./NavService";

type Props = {
  category: string;
  fundName: string;
};

// Keep this leaf component memoized so list filtering/search does not
// re-render unrelated fund cards. In the parent list, use keyExtractor/fund id,
// and if needed render as <NavDisplay key={`${category}:${fundName}`} ... />.
export const NavDisplay = memo(function NavDisplay({ category, fundName }: Props) {
  const { nav, loading, error, source, lastUpdated, isStale, refetch } = useLiveNav(category, fundName);

  const navLabel = typeof nav === "number"
    ? `\u20B9 ${nav.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "--.--";

  const timestampLabel = lastUpdated
    ? `As of ${new Date(`${lastUpdated}T00:00:00`).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      })}`
    : "";

  const isRefreshing = loading && typeof nav === "number";
  const showRetry = !!error && typeof nav !== "number";

  return (
    <View style={{ minWidth: 96, alignItems: "center", justifyContent: "center" }}>
      <>
        <Text style={{ fontSize: 11, opacity: 0.7 }}>NAV</Text>
        <Text style={{ fontSize: 15, fontWeight: "700" }}>{navLabel}</Text>
        {!!timestampLabel && <Text style={{ fontSize: 10, opacity: 0.65 }}>{timestampLabel}</Text>}
        {!!source && source !== "none" && (
          <Text style={{ fontSize: 10, opacity: 0.55 }}>{source.toUpperCase()}</Text>
        )}
        {isRefreshing && <Text style={{ fontSize: 10, color: "#94a3b8" }}>Refreshing</Text>}
        {isStale && <Text style={{ fontSize: 10, color: "#ffb86b" }}>Stale</Text>}
        {showRetry && (
          <TouchableOpacity onPress={refetch}>
            <Text style={{ fontSize: 11, color: "#ffb86b" }}>Retry</Text>
          </TouchableOpacity>
        )}
      </>
    </View>
  );
});
