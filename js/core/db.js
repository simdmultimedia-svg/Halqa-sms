// Public data-access API used by every module.
// - Local-first: all reads/writes hit the local store immediately (offline safe).
// - Each write enqueues a RECORD-LEVEL sync operation for Firebase.
// - Realtime UI updates are delivered through store.on().
// - flushQueue awaits Firebase acknowledgement for every op before removing it.
// - A concurrency guard prevents overlapping flush runs.

window.cicQueueForensicExport = function() {
  const q = loadQueue();
  const backup = {
    timestamp: new Date().toISOString(),
    totalPending: q.length,
    operations: q
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `queue-backup-${Date.now()}.json`;
  a.click();
  console.info("[FORENSICS] Queue backup exported.");
};

window.cicQueueForensicPurge = function() {
  console.warn("[FORENSICS] Executing one-time queue purge.");
  const q = loadQueue();
  const CRITICAL_COLS = ["students", "staff", "invoices", "receipts", "paymentVouchers", "reportCards", "attendance"];
  const kept = [];
  q.forEach(op => {
    // Keep critical collections
    if (CRITICAL_COLS.includes(op.col)) {
      kept.push(op);
    }
  });
  saveQueue(kept);
  console.info(`[FORENSICS] Purge complete. Kept ${kept.length} critical operations.`);
  flushQueue();
};

import { store } from "./store.js";
import { uuid } from "./utils.js";
import * as adapter from "./adapter.js";

// ALL collections have been fully migrated to Firestore.
// The system architecture utilizes:
// 1. Firestore (Primary Source of Truth)
// 2. IndexedDB Cache (Local-first offline rendering)
// 3. Sync Queue Architecture (Handles background syncing and reconnection)
export const FIRESTORE_COLLECTIONS = [
  "academic_sessions", "activeSessions", "activities", "admissionEnquiries", "admissionProposals", "appointmentLetters", "assets", "assignments", "attendance", "auditLogs", "behaviour", "biometricAttendance", "cbt", "cbtAttempts", "classes", "counters", "deletedInvoices", "deletedReceipts", "discounts", "examQuestions", "examTimetable", "expenses", "families", "familyInvoices", "familyLedger", "idCards", "inventory", "inventoryMoves", "invoices", "kioskScans", "lessonPlans", "liveCBT", "migrationLogs", "notifications", "onlineStatus", "passwordResetRequests", "payments", "paymentVouchers", "payslips", "performanceRosters", "programs", "promotionLogs", "realtimeNotifications", "receipts", "reportCards", "restorePoints", "resultApprovals", "results", "salaryComplaints", "schemeOfWork", "scholarships", "sections", "servicePayments", "settings", "smsLogs", "staff", "staffAttendance", "staffLoginMap", "staffPerformance", "staffRosters", "staffSalaries", "studentDiscounts", "students", "studentScholarships", "subjects", "terms", "testimonials", "userRoles", "users", "vouchers"
];

const PREFIX = "CIC KANO:";
const LEGACY_PREFIX = ["ci", "ck:"].join("");
const SYNC_QUEUE_KEY = PREFIX + "__syncqueue";
const SYNC_STATS_KEY = PREFIX + "__syncstats";
const CLOUD_COUNTS_KEY = PREFIX + "__cloudcounts";
let syncHandler = null; // set by sync engine: async (op) => boolean
let syncReady = () => true; // set by sync engine: true only when cloud auth can write
let syncStatusProvider = () => ({});
let _flushing   = false; // concurrency guard — only one flush runs at a time
let _flushAgain = false; // set when new work is queued during an active flush
let _retryTimer = null;  // scheduled auto-retry timer handle

function readLocal(key, fallback = "") {
  const legacyKey = LEGACY_PREFIX + key.slice(PREFIX.length);
  const current = localStorage.getItem(key);
  if (current != null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy != null) localStorage.setItem(key, legacy);
  return legacy ?? fallback;
}

function readSession(key) {
  const legacyKey = LEGACY_PREFIX + key.slice(PREFIX.length);
  return sessionStorage.getItem(key) || localStorage.getItem(key) ||
    sessionStorage.getItem(legacyKey) || localStorage.getItem(legacyKey);
}

let _memoryQueue = null;

function loadQueue() {
  if (_memoryQueue) return _memoryQueue;
  try { _memoryQueue = JSON.parse(readLocal(SYNC_QUEUE_KEY, "[]") || "[]"); } 
  catch { _memoryQueue = []; }
  return _memoryQueue;
}
function saveQueue(q) { 
  _memoryQueue = q;
  try { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q)); }
  catch (e) { console.warn("[QUEUE] Quota exceeded for sync queue. Running in-memory until flushed."); }
}

// One-time emergency purge on boot: strip all embedded data payloads from the queue
// to rapidly reclaim localStorage space before Firestore hits QuotaExceededError.
try {
  let q = loadQueue();
  let changed = false;
  q.forEach(op => {
    if (op.data && (op.action === "put" || op.action === "setting")) {
      delete op.data;
      changed = true;
    }
  });
  if (changed) saveQueue(q);
} catch (e) {
  console.error("Failed to execute emergency queue payload purge", e);
}

function loadStats() {
  try {
    return { successful: 0, failed: 0, lastSync: "Never", ...(JSON.parse(readLocal(SYNC_STATS_KEY, "{}") || "{}")) };
  } catch {
    return { successful: 0, failed: 0, lastSync: "Never" };
  }
}

function saveStats(stats) { localStorage.setItem(SYNC_STATS_KEY, JSON.stringify(stats)); }
function loadCloudCounts() {
  try { return JSON.parse(readLocal(CLOUD_COUNTS_KEY, "{}") || "{}"); } catch { return {}; }
}
export function setCloudCounts(counts) {
  localStorage.setItem(CLOUD_COUNTS_KEY, JSON.stringify(counts || {}));
  window.dispatchEvent(new CustomEvent("sync:counts", { detail: counts || {} }));
}

function updateStats(patch) {
  const stats = { ...loadStats(), ...patch };
  saveStats(stats);
  return stats;
}
export function markSyncTime(when = new Date().toLocaleString()) {
  localStorage.setItem(PREFIX + "lastSync", when);
  updateStats({ lastSync: when });
  window.dispatchEvent(new CustomEvent("sync:queue", { detail: { pending: loadQueue().length } }));
  return when;
}

function bumpStat(key) {
  const stats = loadStats();
  stats[key] = (Number(stats[key]) || 0) + 1;
  saveStats(stats);
  return stats;
}

function emitQueueStatus() {
  window.dispatchEvent(new CustomEvent("sync:queue", { detail: { pending: loadQueue().length } }));
}

function requestFlush() {
  if (_flushing) {
    _flushAgain = true;
    return;
  }
  Promise.resolve().then(() => flushQueue());
}

function scheduleRetry() {
  if (_retryTimer) return; // already scheduled
  _retryTimer = setTimeout(() => {
    _retryTimer = null;
    const q = loadQueue();
    if (q.length > 0) {
      flushQueue(); // silently retry — no console noise
    }
  }, 5000); // retry after 5s to resume quickly when network changes
}

function enqueue(op) {
  const q = loadQueue();
  // De-duplicate: if the same record already has a pending "put", update it in-place
  // so we don't accumulate stale intermediate states for the same record.
  if (op.action === "put" || op.action === "setting") {
    const idx = q.findIndex((x) => x.col === op.col && x.id === op.id &&
      (x.action === "put" || x.action === "setting"));
    if (idx !== -1) {
      q[idx] = { ...op, ts: Date.now(), qid: _flushing ? uuid() : q[idx].qid, deviceId: getDeviceId() };
      saveQueue(q);
      emitQueueStatus();
      requestFlush();
      return;
    }
  }
  q.push({ ...op, ts: Date.now(), qid: uuid(), deviceId: getDeviceId(), retryCount: 0 });
  saveQueue(q);
  emitQueueStatus();
  requestFlush();
}

function getDeviceId() {
  let deviceId = localStorage.getItem(PREFIX + "deviceId");
  if (!deviceId) {
    deviceId = "device-" + uuid().substring(0, 8);
    localStorage.setItem(PREFIX + "deviceId", deviceId);
  }
  return deviceId;
}

// flushQueue processes every queued op sequentially, awaiting Firebase acknowledgement
// for each one. An op is removed ONLY when Firebase explicitly resolves (syncHandler
// returns true). On failure (false or throw), op stays for the next retry.
export async function flushQueue() {
  if (_flushing) { _flushAgain = true; return; }
  if ((localStorage.getItem(PREFIX + "mode") || "local") !== "cloud") {
    emitQueueStatus();
    return;
  }
  if (!syncHandler) {
    const pending = loadQueue().length;
    if (pending > 0) {
      console.info(`[QUEUE] Pending ${pending} operation(s); sync handler not ready`);
      emitQueueStatus();
      scheduleRetry();
    }
    return;
  }
  if (!syncReady()) {
    const pending = loadQueue().length;
    if (pending > 0) {
      const st = syncStatusProvider() || {};
      const checking = st.authChecking || ["initializing", "auth-checking", "auth-sign-in"].includes(st.cloudStatus);
      const reason = checking ? "auth verification in progress" : "cloud/auth not ready";
      console.info(`[QUEUE] Pending ${pending} operation(s); ${reason}`);
      emitQueueStatus();
      scheduleRetry();
    }
    return;
  }
  _flushing = true;
  _flushAgain = false;
  const q = loadQueue();
  if (!q.length) { _flushing = false; emitQueueStatus(); return; }

  console.info(`[QUEUE] Flushing ${q.length} operation(s)`);
  q.forEach((op, i) => {
    if (!op.action || !op.col || !op.id) {
      console.warn(`[QUEUE] Failed malformed op #${i} missing required fields`, op);
    }
  });
  try {
    const processed = new Set();
    const failed = new Set();
    const CRITICAL_COLS = ["students", "staff", "invoices", "receipts", "paymentVouchers", "reportCards", "attendance"];
    
    // Group operations by col/id to prevent race conditions on the same document
    const groups = {};
    for (const op of q) {
      const key = `${op.col}/${op.id}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(op);
    }

    const processGroup = async (ops) => {
      for (const op of ops) {
        processed.add(op.qid);
        
        op.retryCount = (op.retryCount || 0) + 1;
        let drop = false;
        if (!op.col || !op.id) drop = true;
        if (drop && !CRITICAL_COLS.includes(op.col)) {
           console.warn(`[FORENSICS] Auto-dropping corrupted/legacy operation col:${op.col} id:${op.id}`);
           continue;
        }

        // Exponential backoff: wait longer for each retry to avoid hammering cloud
        if (op.retryCount > 1) {
          const backoffMs = Math.min(1000 * Math.pow(1.5, op.retryCount - 2), 15000); // capped at 15s instead of 30s
          const timeSinceLastRetry = Date.now() - (op.lastRetryAt || op.ts);
          if (timeSinceLastRetry < backoffMs) {
            console.info(`[QUEUE] Backoff for ${op.col}/${op.id} — retry #${op.retryCount}, waiting ${Math.round(backoffMs - timeSinceLastRetry)}ms`);
            failed.add(op.qid);
            break; // Abort remaining ops in this group to preserve order
          }
        }

        if (!op.data && (op.action === "put" || op.action === "setting")) {
          const currentData = store.get(op.col, op.id);
          if (!currentData) {
             console.warn(`[QUEUE] Auto-dropping ${op.action} col:${op.col} id:${op.id} because it was deleted locally.`);
             processed.add(op.qid);
             continue;
          }
          op.data = currentData;
        }

        try {
          const ok = await syncHandler(op);
          if (ok) {
            console.info(`[QUEUE] Success col:${op.col} id:${op.id} action:${op.action}`);
            const lastSync = new Date().toLocaleString();
            markSyncTime(lastSync);
            bumpStat("successful");
          } else {
            console.warn(`[QUEUE] Failed col:${op.col} id:${op.id} action:${op.action} - will retry`);
            failed.add(op.qid);
            bumpStat("failed");
            break; // Abort remaining ops in this group
          }
        } catch (e) {
          console.warn(`[QUEUE] Failed col:${op.col} id:${op.id} action:${op.action} - exception:`, e.message);
          failed.add(op.qid);
          bumpStat("failed");
          break; // Abort remaining ops in this group
        }
      }
    };

    // Process up to 10 groups concurrently
    const groupArray = Object.values(groups);
    const CONCURRENCY = 10;
    const executeConcurrent = async () => {
      let i = 0;
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (i < groupArray.length) {
          const ops = groupArray[i++];
          await processGroup(ops);
        }
      });
      await Promise.all(workers);
    };

    await executeConcurrent();
    const latest = loadQueue();
    const remaining = latest.map((op) => failed.has(op.qid)
      ? { ...op, failed: true, lastFailedAt: Date.now(), lastRetryAt: Date.now() }
      : op
    ).filter((op) => !processed.has(op.qid) || failed.has(op.qid));
    saveQueue(remaining);
    if (remaining.length === 0) {
      console.info("[QUEUE] Pending 0 operation(s)");
    } else {
      console.warn(`[QUEUE] Pending ${remaining.length} operation(s); scheduling retry`);
      scheduleRetry();
    }
    emitQueueStatus();
  } finally {
    _flushing = false;
    if (_flushAgain && loadQueue().length > 0) {
      _flushAgain = false;
      requestFlush();
    }
  }
}

export function setSyncHandler(fn) {
  syncHandler = fn;
  if (loadQueue().length > 0) requestFlush();
}
export function setSyncReady(fn) { syncReady = typeof fn === "function" ? fn : () => true; }
export function setSyncStatusProvider(fn) { syncStatusProvider = typeof fn === "function" ? fn : () => ({}); }
export function pendingSyncCount() { return loadQueue().length; }

export const db = {
  list(col) { return store.all(col); },
  map(col) { return store.map(col); },
  get(col, id) { return store.get(col, id); },
  query(col, predicate) { return store.all(col).filter(predicate); },
  find(col, predicate) { return store.all(col).find(predicate) || null; },

  // Create or update a single record (record-level write — never overwrites entire collection).
  save(col, record, { sync = true, origin = "local" } = {}) {
    if (!record.id) record.id = uuid();
    
    // Global Data Integrity Constraints (Phase 1/8)
      if (origin === "local") {
        if (col === "students" && record.admissionNo) {
          const existing = db.query("students", s => s.admissionNo === record.admissionNo && s.id !== record.id);
          if (existing.length > 0) {
            console.warn(`Duplicate admission number detected: ${record.admissionNo}. Skipping write.`);
            return existing[0];
          }
        }
      if (col === "invoices" && record.invoiceNo) {
        const existing = db.query("invoices", i => i.invoiceNo === record.invoiceNo && i.id !== record.id);
        if (existing.length > 0) {
          console.warn(`Duplicate invoice number detected: ${record.invoiceNo}. Skipping write.`);
          return existing[0];
        }
      }
      if (col === "receipts" && record.receiptNo) {
        const existing = db.query("receipts", r => r.receiptNo === record.receiptNo && r.id !== record.id);
        if (existing.length > 0) {
          console.warn(`Duplicate receipt number detected: ${record.receiptNo}. Skipping write.`);
          return existing[0];
        }
      }
    }

    if (!record.createdAt) record.createdAt = Date.now();
    record.updatedAt = Date.now();
    store.put(col, record, { origin });
    const mode = localStorage.getItem("CIC KANO:mode") || "local";
    if (sync && origin === "local" && mode === "cloud") {
      enqueue({ action: "put", col, id: record.id });
    }
    return record;
  },

  remove(col, id, { sync = true } = {}) {
    const rec = store.remove(col, id);
    const mode = localStorage.getItem("CIC KANO:mode") || "local";
    if (sync && mode === "cloud") {
      enqueue({ action: "remove", col, id });
    }
    return rec;
  },

  // Alias for remove — same behaviour, clearer name at call sites.
  delete(col, id, { sync = true } = {}) {
    return this.remove(col, id, { sync });
  },

  // Clear an entire collection: deletes every record INDIVIDUALLY so each
  // deletion is enqueued as a separate Firebase "remove" op (never a bulk wipe).
  async clearCollection(col) {
    const records = store.all(col);
    records.forEach((rec) => {
      store.remove(col, rec.id);
      enqueue({ action: "remove", col, id: rec.id });
    });
    return records.length;
  },

  // Clear settings — enqueues a standard RTDB "remove" op per record.
  async clearSettings() {
    const records = store.all("settings");
    records.forEach((rec) => {
      store.remove("settings", rec.id);
      enqueue({ action: "remove", col: "settings", id: rec.id });
    });
    return records.length;
  },

  // Apply a record received from Firebase without re-enqueuing a sync op.
  applyRemote(col, id, data) {
    if (data == null) store.remove(col, id, { silent: false });
    else store.put(col, { ...data, id }, { origin: "remote" });
  },

  on(col, fn) { return store.on(col, fn); },

  // Settings live in the "settings" collection keyed by name (Firestore doc id).
  setting(name) { return store.get("settings", name); },
  saveSetting(name, value, { sync = true } = {}) {
    const rec = { ...value, id: name, updatedAt: Date.now() };
    store.put("settings", rec, { origin: "local" });
    if (sync) {
      if (syncReady()) {
        adapter.directSaveSetting(name, rec).then(success => {
          if (!success) {
            enqueue({ action: "setting", col: "settings", id: name });
          }
        }).catch(() => {
          enqueue({ action: "setting", col: "settings", id: name });
        });
      } else {
        enqueue({ action: "setting", col: "settings", id: name });
      }
    }
    return rec;
  },

  // --- Diagnostics & Admin Override ---
  getSyncStats() {
    const q = loadQueue();
    const stats = loadStats();
    const cloudCounts = loadCloudCounts();
    let totalLocal = 0;
    FIRESTORE_COLLECTIONS.forEach(col => totalLocal += store.all(col).length);
    return {
      totalLocal,
      pending: q.length,
      successful: Number(stats.successful) || 0,
      failed: Number(stats.failed) || q.filter(op => op.failed).length,
      lastSync: stats.lastSync && stats.lastSync !== "Never" ? stats.lastSync : (readLocal(PREFIX + "lastSync", "Never") || "Never"),
      cloudCounts,
      localCounts: Object.fromEntries(FIRESTORE_COLLECTIONS.map((col) => [col, store.all(col).length]))
    };
  },

  forcePushAllData() {
    console.warn("[FORCE PUSH] Admin initiated forced cloud synchronization...");
    let pushed = 0;
    FIRESTORE_COLLECTIONS.forEach(col => {
      const records = store.all(col);
      records.forEach(rec => {
        enqueue({ action: col === "settings" ? "setting" : "put", col, id: rec.id, data: rec });
        pushed++;
      });
    });
    return pushed;
  }
};

export async function autoFixStudentClasses() {
  const students = await db.getAll('students');
  let fixedCount = 0;
  for (const s of students) {
    let changed = false;
    let oldClass = s.classId || "";
    if (oldClass && !oldClass.includes(':')) {
      let lower = oldClass.toLowerCase();
      if (lower.includes("primary") || lower.includes("basic")) {
        lower = lower.replace("primary", "basic");
        s.classId = "basic:" + lower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        changed = true;
      } else if (lower.includes("nursery") || lower.includes("pre-basic") || lower.includes("pre")) {
        lower = lower.replace("nursery", "pre-basic");
        if (!lower.includes("pre-basic")) lower = lower.replace("pre", "pre-basic");
        s.classId = "pre-basic:" + lower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        changed = true;
      } else if (lower.includes("islamiyya") || lower.includes("abu") || lower.includes("umar") || lower.includes("uthman") || lower.includes("ali") || lower.includes("tahfeez")) {
        s.classId = "islamiyya:" + lower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        changed = true;
      } else {
        s.classId = "western:" + lower.replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        changed = true;
      }
    } else if (oldClass.includes(':')) {
      if (oldClass.includes("primary")) {
        s.classId = oldClass.replace("primary", "basic");
        changed = true;
      }
      if (oldClass.includes("nursery")) {
        s.classId = oldClass.replace("nursery", "pre-basic");
        changed = true;
      }
    }
    
    let oldIslamiyya = s.islamiyyaClassId || "";
    if (oldIslamiyya && !oldIslamiyya.includes(':')) {
      s.islamiyyaClassId = "islamiyya:" + oldIslamiyya.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      changed = true;
    }

    if (changed) {
      console.log(`[Auto-Fix] Migrating student ${s.id} class from '${oldClass}' to '${s.classId}'`);
      await db.save('students', s);
      fixedCount++;
    }
  }
  if (fixedCount > 0) {
    console.log(`[Auto-Fix] Successfully fixed ${fixedCount} student class IDs.`);
  }
}

window.addEventListener("online", () => {
  console.info("[QUEUE] Pending browser online event; attempting queue flush");
  flushQueue();
});

setInterval(() => {
  const pending = loadQueue().length;
  if (!pending || !navigator.onLine) return;
  console.info(`[QUEUE] Pending ${pending} operation(s); background scheduler flush`);
  flushQueue();
}, 5000);

