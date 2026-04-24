window.LiveDataVersion = window.LiveDataVersion || {};

window.LiveDataVersion.cache = (() => {
  const readJson = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const writeJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore storage quota errors */
    }
  };

  const remove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };

  const isFresh = (entry, ttlMs) => {
    if (!entry || !entry.savedAt) return false;
    return Date.now() - entry.savedAt <= ttlMs;
  };

  return { readJson, writeJson, remove, isFresh };
})();
