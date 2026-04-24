export type NavStoreEntry<T = any> = T & {
  savedAt: number;
};

const navStore = new Map<string, NavStoreEntry>();
const navListeners = new Map<string, Set<() => void>>();

export function readNavStoreEntry<T = any>(key: string): NavStoreEntry<T> | null {
  return (navStore.get(key) as NavStoreEntry<T>) || null;
}

export function writeNavStoreEntry<T = any>(key: string, value: T, savedAt = Date.now()) {
  navStore.set(key, { ...(value as any), savedAt });
  navListeners.get(key)?.forEach((listener) => listener());
}

export function subscribeNavStoreEntry(key: string, listener: () => void) {
  if (!navListeners.has(key)) navListeners.set(key, new Set());
  navListeners.get(key)?.add(listener);
  return () => {
    navListeners.get(key)?.delete(listener);
    if (!navListeners.get(key)?.size) navListeners.delete(key);
  };
}

export function listNavStoreEntries<T = any>() {
  return [...navStore.entries()] as Array<[string, NavStoreEntry<T>]>;
}

export function clearNavStore() {
  navStore.clear();
  navListeners.clear();
}
