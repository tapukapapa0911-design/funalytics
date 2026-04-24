import Fuse from "fuse.js";

export type SchemeMasterRow = {
  schemeCode: string;
  isin?: string | null;
  schemeName: string;
  nav?: number | null;
  date?: string | null;
};

export type MatchCandidate = {
  row: SchemeMasterRow;
  score: number;
  reason: "exact" | "alias" | "fuzzy";
};

const STOP_WORDS = new Set([
  "fund",
  "plan",
  "option",
  "growth",
  "regular",
  "reg",
  "direct",
  "dir",
  "idcw",
  "dividend",
  "reinvestment",
  "reinv",
  "payout",
  "bonus",
  "g",
  "gp",
]);

const COMMON_ALIASES: Record<string, string[]> = {
  "icici pru": ["icici prudential", "icici prud"],
  "sbi": ["sbi mutual fund"],
  "hdfc": ["hdfc mutual fund"],
  "nippon": ["nippon india", "reliance"],
  "parag": ["parag parikh", "ppfas"],
};

export function normalizeFundName(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/prudential/g, "pru")
    .replace(/advantage/g, "adv")
    .replace(/balanced/g, "balance")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

function expandAliases(input: string): string[] {
  const normalized = normalizeFundName(input);
  const variants = new Set([normalized]);

  Object.entries(COMMON_ALIASES).forEach(([needle, expansions]) => {
    if (normalized.includes(needle)) {
      expansions.forEach((expansion) => variants.add(normalized.replace(needle, expansion)));
    }
  });

  return [...variants].filter(Boolean);
}

function prefixScore(left: string, right: string): number {
  const leftPrefix = left.split(" ").slice(0, 2).join(" ");
  const rightPrefix = right.split(" ").slice(0, 2).join(" ");
  if (!leftPrefix || !rightPrefix) return 0;
  return leftPrefix === rightPrefix ? 0.08 : 0;
}

function categoryScore(left: string, right: string): number {
  const categories = [
    "large cap",
    "mid cap",
    "small cap",
    "flexi cap",
    "multi cap",
    "balanced advantage",
    "bluechip",
    "focused",
    "hybrid",
    "value",
  ];

  const leftCategory = categories.find((category) => left.includes(category));
  const rightCategory = categories.find((category) => right.includes(category));
  return leftCategory && rightCategory && leftCategory === rightCategory ? 0.08 : 0;
}

function brandScore(left: string, right: string): number {
  const brands = [
    "sbi",
    "hdfc",
    "icici",
    "axis",
    "dsp",
    "nippon",
    "kotak",
    "mirae",
    "invesco",
    "aditya",
    "birla",
    "parag",
    "franklin",
    "tata",
    "uti",
  ];
  const leftBrand = brands.find((brand) => left.includes(brand));
  const rightBrand = brands.find((brand) => right.includes(brand));
  return leftBrand && rightBrand && leftBrand === rightBrand ? 0.1 : 0;
}

export function buildFuse(master: SchemeMasterRow[]): Fuse<SchemeMasterRow> {
  return new Fuse(master, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.35,
    keys: [
      { name: "schemeName", weight: 1 },
    ],
  });
}

export function findBestSchemeMatch(
  fundName: string,
  master: SchemeMasterRow[],
  fuseInstance?: Fuse<SchemeMasterRow>
): MatchCandidate | null {
  const variants = expandAliases(fundName);
  if (!variants.length || !master.length) return null;

  const exactRows = master.filter((row) =>
    variants.some((variant) => normalizeFundName(row.schemeName) === variant)
  );
  if (exactRows.length) {
    return {
      row: exactRows[0],
      score: 0.99,
      reason: "exact",
    };
  }

  const fuse = fuseInstance || buildFuse(master);
  let best: MatchCandidate | null = null;

  variants.forEach((variant) => {
    const results = fuse.search(variant, { limit: 10 });
    results.forEach((result) => {
      const candidateNorm = normalizeFundName(result.item.schemeName);
      const baseScore = 1 - (result.score ?? 1);
      const boostedScore =
        baseScore +
        prefixScore(variant, candidateNorm) +
        categoryScore(variant, candidateNorm) +
        brandScore(variant, candidateNorm);

      if (!best || boostedScore > best.score) {
        best = {
          row: result.item,
          score: Math.min(boostedScore, 0.98),
          reason: "fuzzy",
        };
      }
    });
  });

  return best && best.score >= 0.7 ? best : null;
}
