import { InteractionManager } from "react-native";
import RNFS from "react-native-fs";
import XLSX from "xlsx";
import Fuse from "fuse.js";
import { fetchAndParseAMFIMaster } from "./NavService";

type UpdateOptions = {
  workbookPath: string;
  sheetName?: string;
  nameColumn?: string;
  categoryColumn?: string;
  startRow?: number;
};

const normalize = (value: string) =>
  String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bpru\b/g, "prudential")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const categoryFits = (category: string, schemeName: string) => {
  const a = normalize(category).replace(/\bfund\b/g, "").trim();
  const b = normalize(schemeName);
  return !a || b.includes(a);
};

const runAfterInteractionsAsync = async <T>(task: () => Promise<T> | T): Promise<T> =>
  new Promise((resolve, reject) => {
    InteractionManager.runAfterInteractions(() => {
      Promise.resolve(task()).then(resolve).catch(reject);
    });
  });

export async function correctFundNamesInWorkbook(options: UpdateOptions) {
  return runAfterInteractionsAsync(async () => {
    const {
      workbookPath,
      sheetName = "Dashboard",
      nameColumn = "A",
      categoryColumn = "B",
      startRow = 2
    } = options;

    if (!(await RNFS.exists(workbookPath))) {
      return { updated: 0, skipped: 0, message: "Workbook not found" };
    }

    const masterMap = await fetchAndParseAMFIMaster();
    const masterRows = [...masterMap.values()];
    const workbookBase64 = await RNFS.readFile(workbookPath, "base64");
    const workbook = XLSX.read(workbookBase64, { type: "base64" });
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return { updated: 0, skipped: 0, message: `Sheet ${sheetName} not found` };
    }

    const globalFuse = new Fuse(masterRows, {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.28,
      keys: [{ name: "schemeName", weight: 1 }]
    });

    let updated = 0;
    let skipped = 0;
    const range = XLSX.utils.decode_range(sheet["!ref"] || `${nameColumn}${startRow}:${nameColumn}${startRow}`);

    for (let row = startRow; row <= range.e.r + 1; row += 1) {
      const nameCell = `${nameColumn}${row}`;
      const categoryCell = `${categoryColumn}${row}`;
      const currentName = String(sheet[nameCell]?.v || "").trim();
      const currentCategory = String(sheet[categoryCell]?.v || "").trim();
      if (!currentName) continue;

      const narrowed = masterRows.filter((entry) => categoryFits(currentCategory, entry.schemeName));
      const localFuse = new Fuse(narrowed.length ? narrowed : masterRows, {
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.28,
        keys: [{ name: "schemeName", weight: 1 }]
      });

      const match = localFuse.search(currentName, { limit: 1 })[0]?.item
        || globalFuse.search(currentName, { limit: 1 })[0]?.item;

      if (!match?.schemeName) {
        skipped += 1;
        continue;
      }

      if (match.schemeName !== currentName) {
        sheet[nameCell] = { ...sheet[nameCell], t: "s", v: match.schemeName };
        updated += 1;
      }
    }

    const output = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
    await RNFS.writeFile(workbookPath, output, "base64");
    return { updated, skipped, message: "Fund names corrected without touching formulas" };
  });
}
