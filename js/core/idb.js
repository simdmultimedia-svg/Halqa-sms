// Simple IndexedDB wrapper for fast boot caching
const DB_NAME = "CICKANO_FastCache";
const STORE_NAME = "cache";
const DB_VERSION = 1;

let dbPromise = null;
let memoryCache = new Map();
let currentEngine = null;

function logEngine(engine) {
  if (currentEngine !== engine) {
    currentEngine = engine;
    console.info(`Storage Engine:\n${engine === 'IndexedDB' ? '✓' : 'Fallback →'} ${engine}`);
  }
}

function getDB() {
  if (dbPromise) return dbPromise;
  if (!window.indexedDB) {
    dbPromise = Promise.reject(new Error("IndexedDB not supported"));
    return dbPromise;
  }
  
  const t0 = performance.now();
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => {
        window.CICKANOPerf = window.CICKANOPerf || {};
        window.CICKANOPerf.idbInitComplete = performance.now();
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

export async function idbSet(key, val) {
  const t0 = performance.now();
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(val, key);
      tx.oncomplete = () => {
        logEngine("IndexedDB");
        window.CICKANOPerf = window.CICKANOPerf || {};
        window.CICKANOPerf.idbWriteTime = (window.CICKANOPerf.idbWriteTime || 0) + Math.round(performance.now() - t0);
        resolve(true);
      };
      tx.onerror = () => {
        fallbackSet(key, val);
        window.CICKANOPerf = window.CICKANOPerf || {};
        window.CICKANOPerf.idbWriteTime = (window.CICKANOPerf.idbWriteTime || 0) + Math.round(performance.now() - t0);
        resolve(false);
      };
    });
  } catch (err) {
    const res = fallbackSet(key, val);
    window.CICKANOPerf = window.CICKANOPerf || {};
    window.CICKANOPerf.idbWriteTime = (window.CICKANOPerf.idbWriteTime || 0) + Math.round(performance.now() - t0);
    return res;
  }
}

function fallbackSet(key, val) {
  try {
    localStorage.setItem(`idbFallback:${key}`, JSON.stringify(val));
    logEngine("LocalStorage");
    return true;
  } catch(e) {
    memoryCache.set(key, val);
    logEngine("Memory Cache");
    return true;
  }
}

export async function idbGet(key) {
  const t0 = performance.now();
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        logEngine("IndexedDB");
        window.CICKANOPerf = window.CICKANOPerf || {};
        window.CICKANOPerf.idbReadTime = (window.CICKANOPerf.idbReadTime || 0) + Math.round(performance.now() - t0);
        if (req.result !== undefined) resolve(req.result);
        else resolve(fallbackGet(key));
      };
      req.onerror = () => {
        window.CICKANOPerf = window.CICKANOPerf || {};
        window.CICKANOPerf.idbReadTime = (window.CICKANOPerf.idbReadTime || 0) + Math.round(performance.now() - t0);
        resolve(fallbackGet(key));
      };
    });
  } catch (err) {
    const res = fallbackGet(key);
    window.CICKANOPerf = window.CICKANOPerf || {};
    window.CICKANOPerf.idbReadTime = (window.CICKANOPerf.idbReadTime || 0) + Math.round(performance.now() - t0);
    return res;
  }
}

function fallbackGet(key) {
  try {
    const val = localStorage.getItem(`idbFallback:${key}`);
    if (val !== null) {
      logEngine("LocalStorage");
      return JSON.parse(val);
    }
  } catch (e) {}
  
  logEngine("Memory Cache");
  return memoryCache.has(key) ? memoryCache.get(key) : null;
}
