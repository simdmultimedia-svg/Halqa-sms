// Local-first persistence layer.
const PREFIX = "CIC KANO:";
const LEGACY_PREFIX = ["ci", "ck:"].join("");
const cache = {};
const listeners = {};

function load(col) {
  if (cache[col]) return cache[col];
  try {
    let raw = localStorage.getItem(PREFIX + col);
    if (raw == null) {
      raw = localStorage.getItem(LEGACY_PREFIX + col);
      if (raw != null) localStorage.setItem(PREFIX + col, raw);
    }
    cache[col] = raw ? JSON.parse(raw) : {};
  } catch {
    cache[col] = {};
  }
  return cache[col];
}

function persist(col) {
  try { localStorage.setItem(PREFIX + col, JSON.stringify(cache[col] || {})); }
  catch (error) { console.warn("Persist failed for", col, error); }
}

function emit(col, type, record) {
  (listeners[col] || []).forEach((fn) => { try { fn({ type, record, collection: col }); } catch (error) { console.error(error); } });
  (listeners["*"] || []).forEach((fn) => { try { fn({ type, record, collection: col }); } catch (error) { console.error(error); } });
}

export const store = {
  all(col) { return Object.values(load(col)); },
  map(col) { return { ...load(col) }; },
  get(col, id) { return load(col)[id] || null; },

  put(col, record, { origin = "local", silent = false } = {}) {
    if (!record || !record.id) throw new Error("Record must have an id");
    const collection = load(col);
    if (origin === "remote") {
      const existing = collection[record.id];
      if (existing && JSON.stringify(existing) === JSON.stringify(record)) return record;
    }
    record.updatedAt = record.updatedAt || Date.now();
    if (origin === "local") {
      let deviceId = localStorage.getItem(PREFIX + "deviceId");
      if (!deviceId) {
        deviceId = "device-" + Math.random().toString(36).substring(2, 10);
        localStorage.setItem(PREFIX + "deviceId", deviceId);
      }
      record._lastModifiedBy = deviceId;
      record._lastModifiedAt = Date.now();
    }
    collection[record.id] = record;
    persist(col);
    if (!silent) emit(col, "put", record);
    return record;
  },

  // Hydration writes a whole collection once instead of serialising it for every
  // remote record. This keeps large multi-device downloads responsive.
  mergeRemote(col, records) {
    if (!records || records.length === 0) return 0;
    const collection = load(col);
    records.forEach((record) => { if (record?.id) collection[record.id] = record; });
    persist(col);
    emit(col, "hydrate", null);
    return records.length;
  },

  remove(col, id, { silent = false } = {}) {
    const collection = load(col);
    const record = collection[id];
    if (record) { delete collection[id]; persist(col); if (!silent) emit(col, "remove", record); }
    return record;
  },
  clear(col) { cache[col] = {}; persist(col); emit(col, "clear", null); },
  on(col, fn) { (listeners[col] = listeners[col] || new Set()).add(fn); return () => listeners[col].delete(fn); },
  collections() {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX) || key.startsWith(LEGACY_PREFIX))
      .map((key) => key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key.slice(LEGACY_PREFIX.length))
      .filter((col, index, all) => all.indexOf(col) === index);
  },
  raw: { cache, PREFIX },
};
