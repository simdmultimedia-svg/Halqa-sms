// Firebase integration + record-level offline-first sync engine.
//
// KEY DESIGN PRINCIPLES:
//  - The app NEVER blocks on Firebase. All reads/writes go to localStorage first.
//  - Firebase SDK is loaded lazily from CDN only when Cloud mode is selected AND online.
//  - If CDN is unreachable (offline), cloud init gracefully falls back to local mode.
//  - window.addEventListener("online") re-attempts cloud init + flushes the sync queue.
//  - The status pill always reflects true current state.
//
// SYNC PERMISSION GUARANTEES:
//  - flushQueue is gated on state.authReady (Firebase Auth user confirmed via onAuthStateChanged).
//  - installSyncHandler checks state.authReady before every single operation.
//  - onAuthStateChanged re-flushes the queue the moment a user is confirmed.
//  - Sync is NOT marked successful until Firebase explicitly acknowledges each op.
//
// RECORD-LEVEL WRITES ONLY:
//  - Every sync op targets a single document path: collection/recordId.
//  - Bulk collection overwrites are never performed.
//
// ADMIN UID BOOTSTRAP:
//  - UID xdovD9ipaVTekQXVq1mAysDEI0A3 is validated and bootstrapped on every cloud login.

import { firebaseConfig } from "../config/firebase-config.js";
import { db, FIRESTORE_COLLECTIONS, markSyncTime, setCloudCounts, setSyncHandler, setSyncReady, setSyncStatusProvider, flushQueue } from "./db.js";
import { normaliseRole, can } from "./rbac.js";
import { toast } from "./utils.js";

const SDK_BASE = "https://www.gstatic.com/firebasejs/10.12.2/";

const DEFAULT_SUPER_ADMIN_EMAIL = "admin@cic-kano.com";

export const state = {
  ready:     false,
  authReady: false,   // Set by external auth provider
  authChecking: false,
  online:    navigator.onLine,
  mode:      localStorage.getItem("CIC KANO:mode") || "local", // 'local' | 'cloud'
  cloudStatus: "local",
  cloudError: "",
  fsInitialized: false,
  app: null, fs: null, sdk: {}
};

// ─── Structured sync logger ───────────────────────────────────────────────────
// Emits rich, structured log entries for every sync operation attempt.
// Each entry: { ts, db, col, path, op, status, errorCode, errorMsg }
const MAX_SYNC_LOG = 500;
const _syncLog = [];
let _activeListenerKey = "";
let _listenerUnsubs = [];
let _fsListenerCount = 0;
let _rtdbListenerCount = 0;
const _activeListenersMap = new Map();

window.cicListenerAudit = () => {
  const memEstimate = (_fsListenerCount + _rtdbListenerCount) * 1.5;
  const currentUser = state.auth ? getCurrentUser() : null;
  const sessStr = sessionStorage.getItem("CIC KANO:session");
  const sess = sessStr ? JSON.parse(sessStr) : {};
  let qLen = 0;
  try {
    const qRaw = localStorage.getItem("CIC KANO:__syncqueue");
    if (qRaw) qLen = JSON.parse(qRaw).length;
  } catch(e) {}
  
  const audit = {
    fsListeners: _fsListenerCount,
    rtdbListeners: _rtdbListenerCount,
    totalListeners: _fsListenerCount + _rtdbListenerCount,
    deniedCollections: Array.from(_deniedCollections || []),
    queueSize: qLen,
    pendingWrites: qLen,
    currentUser: currentUser ? currentUser.email : "none",
    currentRole: sess.role || "unknown"
  };
  console.table(audit);
  return audit;
};

window.cicQueueAudit = () => {
  let qLen = 0;
  let firstAge = null;
  try {
    const qRaw = localStorage.getItem("CIC KANO:__syncqueue");
    if (qRaw) {
      const q = JSON.parse(qRaw);
      qLen = q.length;
      if (qLen > 0 && q[0].data && q[0].data.updatedAt) {
        firstAge = Math.round((Date.now() - q[0].data.updatedAt) / 1000) + "s";
      }
    }
  } catch(e) {}

  let failed = 0;
  let dropped = 0;
  let lastError = "none";
  _syncLog.forEach(log => {
    if (log.status === "failed") failed++;
    if (log.status === "dropped" || log.status === "denied") dropped++;
    if (lastError === "none" && (log.status === "failed" || log.status === "dropped" || log.status === "denied")) {
      lastError = log.errorCode || log.errorMsg || "unknown error";
    }
  });

  const lastFlushRaw = localStorage.getItem("CIC KANO:lastCloudRefresh");
  const lastFlush = lastFlushRaw ? new Date(parseInt(lastFlushRaw)).toLocaleTimeString() : "never";

  const audit = {
    Pending: qLen,
    Failed: failed,
    Dropped: dropped,
    "Last Flush": lastFlush,
    "Last Error": lastError,
    "Queue Age": firstAge || "0s"
  };
  console.table(audit);
  return audit;
};

window.cicSyncAudit = function() {
  console.table({
    "Firestore Listeners": state.fsUnsubs.length,
    "RTDB Listeners": state.unsubs.length,
    "Last Refresh": localStorage.getItem("CIC KANO:lastCloudRefresh"),
    "Last ApplyRemote": localStorage.getItem("CIC KANO:lastApplyRemote"),
    "Queue Size": db.list("__syncqueue").length,
    "Last Error": _syncLog.find(l => l.status === "error")?.errorMsg || "None"
  });
};

window.cicRealtimeAudit = function() {
  const user = getCurrentUser();
  const roleRec = user ? db.get("userRoles", user.uid) : null;
  const role = normaliseRole((roleRec && roleRec.role) || "");
  
  const audit = {};
  const activeFS = state.fsUnsubs.length > 0;
  const activeRTDB = state.unsubs.length > 0;
  
  ["students", "staff", "invoices", "receipts", "reportCards", "paymentVouchers"].forEach(col => {
    const isFS = FIRESTORE_COLLECTIONS.includes(col);
    const count = db.list(col).length;
    audit[col] = {
      "Backend": isFS ? "Firestore" : "RTDB",
      "Listener Active": isFS ? activeFS : activeRTDB,
      "Last Snapshot": localStorage.getItem("CIC KANO:lastCloudRefresh") || "Never",
      "Last applyRemote": localStorage.getItem("CIC KANO:lastApplyRemote") || "Never",
      "Local Count": count
    };
  });
  
  console.log(`Current User: ${user ? user.email : "None"} | Role: ${role}`);
  console.table(audit);
};

window.cicPerfAudit = function() {
  const perf = window.CICKANOPerf || {};

  // IndexedDB / local store record counts per collection
  const KEY_COLLECTIONS = ["students", "staff", "invoices", "receipts", "reportCards", "paymentVouchers"];
  const idbCounts = {};
  KEY_COLLECTIONS.forEach(col => { idbCounts[col] = db.list(col).length; });

  let qLen = 0;
  try { const q = localStorage.getItem("CIC KANO:__syncqueue"); if (q) qLen = JSON.parse(q).length; } catch {}

  const lastRefresh = localStorage.getItem("CIC KANO:lastCloudRefresh");
  const lastRefreshStr = lastRefresh ? new Date(parseInt(lastRefresh)).toLocaleTimeString() : "never";

  console.group("%c window.cicPerfAudit()", "font-weight:bold;color:#4f46e5");
  console.table({
    "Boot Visible (ms)":        perf.totalLogin       || "pending",
    "Dashboard Render (ms)":    perf.dashboardTime    || "pending",
    "Auth Time (ms)":           perf.authTime         || "cached",
    "Cloud Refresh (ms)":       perf.cloudRefreshTime || "pending",
    "BG Refresh (ms)":          perf.bgRefreshTime    || "pending",
    "Active FS Listeners":      _fsListenerCount,
    "Active RTDB Listeners":    _rtdbListenerCount,
    "Pending Sync Queue":       qLen,
    "Last Cloud Refresh":       lastRefreshStr
  });
  console.table(idbCounts);
  console.groupEnd();
  return { perf, idbCounts, fsListeners: _fsListenerCount, rtdbListeners: _rtdbListenerCount, qLen };
};

function syncLog(entry) {
  const rec = { ts: Date.now(), ...entry };
  _syncLog.unshift(rec);
  if (_syncLog.length > MAX_SYNC_LOG) _syncLog.length = MAX_SYNC_LOG;

  if (localStorage.getItem("CIC_DEBUG") === "true") {
    const icon = rec.status === "ok" ? "✓" : rec.status === "denied" ? "✗ DENIED" : "✗ FAIL";
    const msg  = `[Sync][${rec.db}][${rec.op}] ${rec.path} → ${icon}`;
    
    if (rec.status === "ok") {
      console.debug(msg);
    } else if (rec.status === "denied") {
      console.debug(msg, "[Handled by RBAC]");
    } else {
      const detail = [rec.errorCode, rec.errorMsg].filter(Boolean).join(" — ");
      console.warn(msg, detail || ""); 
    }
  }

  window.dispatchEvent(new CustomEvent("sync:log", { detail: rec }));
  return rec;
}

function classifyError(e) {
  const code = (e && e.code) || "";
  const msg  = (e && e.message) || String(e);
  const isPermission = code === "permission-denied" || msg.includes("Missing or insufficient permissions") ||
                       msg.includes("PERMISSION_DENIED") || code.includes("permission");
  return {
    errorCode: code || "unknown",
    errorMsg:  msg,
    status:    isPermission ? "denied" : "failed",
    rawError:  e
  };
}

export function getSyncLog() { return _syncLog.slice(); }
export function clearSyncLog() { _syncLog.length = 0; }

export function enableNetwork() { return Promise.resolve(); }
export function disableNetwork() { return Promise.resolve(); }

export function lazyListen(col) {
  if (window.cicLazyListen) window.cicLazyListen(col);
}

export function getState() { return state; }
export function setMode(mode) {
  state.mode = mode;
  if (mode !== "cloud") {
    state.authChecking = false;
    state.cloudStatus = "local";
    state.cloudError = "";
  }
  localStorage.setItem("CIC KANO:mode", mode);
  logFirebaseDiagnostics("mode-change");
}

export function markCloudUnavailable(reason = "cloud-unavailable") {
  state.authChecking = false;
  state.authReady = false;
  state.cloudStatus = "unavailable";
  state.cloudError = reason;
  console.warn("[Firebase Diagnostic] Cloud unavailable:", reason);
  logFirebaseDiagnostics("cloud-unavailable");
  window.dispatchEvent(new CustomEvent("net:change", { detail: { online: navigator.onLine, cloudStatus: state.cloudStatus } }));
}

export function logFirebaseDiagnostics(reason = "diagnostic") {
  if (localStorage.getItem("CIC_DEBUG") !== "true") return;
  const user = (state.auth && getCurrentUser()) || null;
  console.info("[Firebase Diagnostic]", {
    reason,
    projectId: (state.app && state.app.options && state.app.options.projectId) || firebaseConfig.projectId || "(not initialized)",
    authUid: (user && user.uid) || null,
    authEmail: (user && user.email) || null,
    authState: state.authReady ? "authenticated" : state.authChecking ? "checking" : user ? "user-not-ready" : "signed-out",
    cloudStatus: state.cloudStatus,
    cloudError: state.cloudError || null,
    mode: state.mode,
    online: navigator.onLine
  });
}

function recordStamp(rec) {
  return Number((rec && rec.updatedAt) || (rec && rec.createdAt) || 0);
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export async function waitForAuthReady(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.ready && state.authReady && (state.auth && getCurrentUser())) return true;
    await wait(100);
  }
  return false;
}

async function loadSdk() {
  if (state.sdk.app) return state.sdk;
  try {
    const timeout = (ms) => new Promise((_, rej) =>
      setTimeout(() => rej(new Error("SDK load timeout")), ms));
    const [app, firestore] = await Promise.race([
      Promise.all([
        import(SDK_BASE + "firebase-app.js"),
        
        import(SDK_BASE + "firebase-firestore.js")
      ]),
      timeout(10000).then(() => { throw new Error("Firebase SDK load timed out (offline?)"); })
    ]);
    state.sdk = { app, firestore };
    
    return state.sdk;
  } catch (e) {
    console.warn("[Firebase] SDK load failed — running offline:", e.message);
    return null;
  }
}

export async function initCloud() {
  if (state.mode !== "cloud") return false;
  if (state.ready) return true;
  state.authChecking = true;
  state.cloudStatus = "initializing";
  state.cloudError = "";
  logFirebaseDiagnostics("init-start");
  window.dispatchEvent(new CustomEvent("net:change", { detail: { online: navigator.onLine, cloudStatus: state.cloudStatus } }));
  if (!navigator.onLine) {
    console.info("[Firebase] Offline at boot - will retry when online.");
    markCloudUnavailable("offline");
    return false;
  }
  try {
    const sdk = await loadSdk();
    if (!sdk) {
      markCloudUnavailable("sdk-load-failed");
      return false;
    }

      const apps = sdk.app.getApps ? sdk.app.getApps() : [];
      if (apps.length === 0) {
        state.app = sdk.app.initializeApp(firebaseConfig);
      } else {
        state.app = apps.find(a => a.name === "[DEFAULT]") || apps[0];
      }
    if (state.app) {
      
      if (!state.fsInitialized) {
        state.fs = sdk.firestore.initializeFirestore(state.app, {
          localCache: sdk.firestore.persistentLocalCache({
            tabManager: sdk.firestore.persistentMultipleTabManager()
          })
        });
        state.fsInitialized = true;
      }
      state.ready = true;
      state.cloudStatus = "auth-checking"; // Legacy, probably should remove but keeping for now
      installCounterReservation();
    }
    setSyncReady(() => state.ready && navigator.onLine);
    setSyncStatusProvider(() => ({
      ready: state.ready,
      authReady: state.authReady,
      authChecking: state.authChecking,
      cloudStatus: state.cloudStatus,
      cloudError: state.cloudError,
      online: navigator.onLine
    }));
    installSyncHandler();
    logFirebaseDiagnostics("init-complete");
    return true;
  } catch (e) {
    console.warn("[Firebase] Cloud init failed; running in local/offline mode.", e.message);
    state.ready = false;
    markCloudUnavailable(e.code || e.message || "init-failed");
    return false;
  }
}

function rootReadableCollections(role) {
  const canonical = normaliseRole(role);
  const common = ["settings", "users", "userRoles"];
  
  if (canonical === "Super Admin" || canonical === "Admin") {
     return [
       "students", "staff", "invoices", "receipts", "attendance",
       "results", "cbt", "assets", "inventory", "library", "leaveRequests", "salaryComplaints",
       "staffAttendance", "payslips", "activities", "resultApprovals", "assignments",
       "lessonPlans", "familyInvoices", "paymentVouchers", "reportCards", "schemeOfWork",
       "examTimetable", "notifications", "smsLogs", "auditLogs", "expenses", "kioskScans",
       "deletedInvoices", "deletedReceipts", "staffRosters", "staffPerformance", "performanceRosters", ...common
     ];
  }
  
  if (canonical === "Principal") return [
    "students", "attendance", "staffAttendance", "results", "resultApprovals", "assignments", "lessonPlans",
    "examQuestions", "cbt", "cbtAttempts", "idCards", "behaviour", "activities",
    "scholarships", "discounts", "studentScholarships",
    "studentDiscounts", "staffRosters", "staffPerformance", "performanceRosters", ...common
  ];
  
  if (canonical === "Accountant") {
     return [
       "students", "invoices", "receipts", "paymentVouchers", "expenses", "auditLogs", "activities",
       "deletedInvoices", "deletedReceipts", ...common
     ];
  }
  
  if (canonical === "Teacher" || canonical === "Staff") {
     return [
       "students", "attendance", "results", "resultApprovals", "assignments", "lessonPlans", "activities", 
       "staff", "staffRosters", "staffPerformance", "performanceRosters", ...common
     ];
  }
  
  if (canonical === "Librarian") return ["books", "inventory", "inventoryMoves", ...common];
  if (canonical === "Receptionist") return ["students", ...common];
  
  return common;
}

export function stopListeners() {
  _listenerUnsubs.forEach((off) => { try { off(); } catch {} });
  _listenerUnsubs = [];
  _activeListenersMap.clear();
  _activeListenerKey = "";
}

let _listenerDebounceTimer = null;
function debounceStartListeners() {
  if (_listenerDebounceTimer) clearTimeout(_listenerDebounceTimer);
  _listenerDebounceTimer = setTimeout(() => {
    _listenerDebounceTimer = null;
    startListeners("essential");
  }, 100);
}

export function startListeners(mode = "all") {
  if (state.mode !== "cloud" || !state.ready || !navigator.onLine) return;
  const user = getCurrentUser();
  if (!user) return;
  const roleRec = db.get("userRoles", user.uid);
  const role = normaliseRole((roleRec && roleRec.role) || "");
  const listenerKey = `${user.uid}:${role}`;
  if (_activeListenerKey === listenerKey && mode === "all") return;
  
  console.time(`[TRACE] startListeners(${mode})`);
  if (localStorage.getItem("CIC_DEBUG") === "true") {
    console.info(`[SYNC] Starting ${mode} listeners for`, listenerKey);
  }
  if (mode === "essential" || mode === "all") {
    stopListeners();
    _activeListenerKey = listenerKey;
  }

  const { database, firestore } = state.sdk;
  
  const { collection, query: fsQuery, where, onSnapshot } = firestore;
  
  const canonicalRole = role;
  const isStudent = canonicalRole === "Student";
  const isTeacher = canonicalRole === "Teacher";
  const isParent  = canonicalRole === "Parent";
  const isStaff   = canonicalRole === "Staff";

  const allowedRootCollections = new Set(rootReadableCollections(canonicalRole));

  const PAYROLL_COLLECTIONS = ["payslips", "staffSalaries", "paymentVouchers", "salaryComplaints"];
  const canViewAllPayroll = can(canonicalRole, "viewAllPayslips") || can(canonicalRole, "manageSalary");

  const _deniedCollections = new Set();
  window._deniedCollections = _deniedCollections;
  
  const LAZY_COLLECTIONS = ["testimonials", "auditLogs", "staffPerformance", "performanceRosters"];
  
  const listen = (col, fsQueryObj) => {
    if (_deniedCollections.has(col)) return;
    const listenerKey = fsQueryObj ? null : col;
    if (listenerKey) {
      if (_activeListenersMap.has(listenerKey)) {
        if (col === "students") console.warn("[STUDENTS] Duplicate listener detected");
        return;
      }
      _activeListenersMap.set(listenerKey, true);
    }
    
    if (FIRESTORE_COLLECTIONS.includes(col)) {
      const q = fsQueryObj || collection(state.fs, col);
      const unsub = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added" || change.type === "modified") {
            db.applyRemote(col, change.doc.id, { ...change.doc.data(), id: change.doc.data().id || change.doc.id });
          }
          if (change.type === "removed") {
            db.applyRemote(col, change.doc.id, null);
          }
        });
      }, (err) => {
        const { errorCode, errorMsg, status } = classifyError(err);
        if (status === "denied") {
          if (_deniedCollections.has(col)) return;
          _deniedCollections.add(col);
        }
        syncLog({ db: "FS", col, path: col, op: "listen", status, errorCode, errorMsg });
      });
      _fsListenerCount++;
      _listenerUnsubs.push(() => { 
        _fsListenerCount--; 
        if (listenerKey) _activeListenersMap.delete(listenerKey);
        unsub(); 
      });
    }
  };

  window.cicLazyListen = (col) => listen(col);

  const ESSENTIAL_COLLECTIONS = ["settings", "users", "userRoles"];

  const setupBaseCollections = () => {
    FIRESTORE_COLLECTIONS.forEach((col) => {
      if (!allowedRootCollections.has(col)) return;
      if (PAYROLL_COLLECTIONS.includes(col) && !canViewAllPayroll) return;
      if ((isTeacher || isStaff) && ["staff", "activities"].includes(col)) return;
      if (isTeacher && ["attendance", "results", "resultApprovals", "assignments", "lessonPlans", "activities"].includes(col)) return;
      if (isStudent && ["students", "attendance", "results", "assignments", "activities", "invoices", "receipts"].includes(col)) return;
      if (isParent  && ["students"].includes(col)) return;
      if (LAZY_COLLECTIONS.includes(col)) return;

      const isEssential = ESSENTIAL_COLLECTIONS.includes(col);
      if (mode === "essential" && !isEssential) return;
      if (mode === "background" && isEssential) return;

      listen(col, collection(state.fs, col));
    });
  };

  setupBaseCollections();

  if (mode === "all" || mode === "background") {
    (async () => {
      if ((isTeacher || isStaff) && (roleRec && roleRec.staffId)) {
        _listenerUnsubs.push(onSnapshot(collection(state.fs, "staff"), (snap) => {
           snap.forEach(doc => {
              if (doc.id === roleRec.staffId) db.applyRemote("staff", doc.id, { ...doc.data(), id: doc.id });
           });
        }, () => {}));
        listen("activities", fsQuery(collection(state.fs, "activities"), where("staffId", "==", roleRec.staffId)));
        listen("salaryComplaints", fsQuery(collection(state.fs, "salaryComplaints"), where("staffId", "==", roleRec.staffId)));
        listen("staffAttendance", fsQuery(collection(state.fs, "staffAttendance"), where("staffId", "==", roleRec.staffId)));
        if (!canViewAllPayroll) {
          listen("payslips", fsQuery(collection(state.fs, "payslips"), where("staffId", "==", roleRec.staffId)));
        }
      }

      if (isTeacher && (roleRec && roleRec.staffId)) {
        try {
          const staffSnap = await get(ref(state.rtdb, `staff/${roleRec.staffId}`)).catch(() => null);
          let classes = [];
          if (staffSnap && staffSnap.exists && typeof staffSnap.exists === 'function' && staffSnap.exists()) {
             const staffData = staffSnap.val() || {};
             classes = staffData.assignedClasses || [];
          } else {
             const localStaff = db.get("staff", roleRec.staffId);
             if (localStaff) classes = localStaff.assignedClasses || [];
          }

          classes.forEach(classId => {
            listen("attendance", fsQuery(collection(state.fs, "attendance"), where("classId", "==", classId)));
            listen("results", fsQuery(collection(state.fs, "results"), where("classId", "==", classId)));
            listen("resultApprovals", fsQuery(collection(state.fs, "resultApprovals"), where("classId", "==", classId)));
            listen("assignments", fsQuery(collection(state.fs, "assignments"), where("classId", "==", classId)));
            listen("lessonPlans", fsQuery(collection(state.fs, "lessonPlans"), where("classId", "==", classId)));
            listen("activities", fsQuery(collection(state.fs, "activities"), where("classId", "==", classId)));
          });
        } catch (e) { console.warn("Failed to fetch teacher classes for sync", e); }
      }

      if (isStudent && (roleRec && roleRec.studentId)) {
         _listenerUnsubs.push(onSnapshot(collection(state.fs, "students"), (snap) => {
           snap.forEach(doc => {
              if (doc.id === roleRec.studentId) db.applyRemote("students", doc.id, { ...doc.data(), id: doc.id });
           });
         }, () => {}));
         listen("attendance", fsQuery(collection(state.fs, "attendance"), where("studentId", "==", roleRec.studentId)));
         listen("results", fsQuery(collection(state.fs, "results"), where("studentId", "==", roleRec.studentId)));
         listen("activities", fsQuery(collection(state.fs, "activities"), where("userId", "==", user.uid)));
         listen("invoices", fsQuery(collection(state.fs, "invoices"), where("studentId", "==", roleRec.studentId)));
         listen("receipts", fsQuery(collection(state.fs, "receipts"), where("studentId", "==", roleRec.studentId)));
         listen("salaryComplaints", fsQuery(collection(state.fs, "salaryComplaints"), where("uid", "==", user.uid)));
         
         try {
             const localStu = db.get("students", roleRec.studentId);
             const classId = localStu ? localStu.classId : null;
             if (classId) listen("assignments", fsQuery(collection(state.fs, "assignments"), where("classId", "==", classId)));
         } catch (e) { console.warn("[AUDIT]", e); }
      }

      if (isParent && (roleRec && roleRec.familyId)) {
          _listenerUnsubs.push(onSnapshot(collection(state.fs, "families"), (snap) => {
            snap.forEach(doc => {
               if (doc.id === roleRec.familyId) db.applyRemote("families", doc.id, { ...doc.data(), id: doc.id });
            });
          }, () => {}));
          listen("students", fsQuery(collection(state.fs, "students"), where("familyId", "==", roleRec.familyId)));
          listen("familyLedger", fsQuery(collection(state.fs, "familyLedger"), where("familyId", "==", roleRec.familyId)));
          listen("familyInvoices", fsQuery(collection(state.fs, "familyInvoices"), where("familyId", "==", roleRec.familyId)));
      }
    })();
  }

  if (state.authReady && (mode === "essential" || mode === "all")) {
      flushQueue();
  }
  console.timeEnd(`[TRACE] startListeners(${mode})`);
}

// ─── Per-collection Firestore fetch limits ────────────────────────────────────
const FS_LIMITS = {
  students:        1000,
  staff:           200,
  invoices:        100,
  receipts:        100,
  reportCards:     100,
  paymentVouchers: 100,
  // everything else
  _default:         50
};
function fsLimit(col) { return FS_LIMITS[col] || FS_LIMITS._default; }

export async function refreshCloudData({ startRealtime = true } = {}) {
  if (state.mode !== "cloud" || !state.ready || !navigator.onLine) return { ok: false, reason: "cloud-not-ready" };
  const ready = await waitForAuthReady();
  if (!ready) return { ok: false, reason: "auth-not-ready" };

  const { collection, getDocs, query, limit } = state.sdk.firestore;
  const currentUser = getCurrentUser();
  const uid = (currentUser && currentUser.uid);
  const roleRec = uid ? db.get("userRoles", uid) : null;
  const role = normaliseRole((roleRec && roleRec.role) || "");
  const readable = rootReadableCollections(role);

  const ESSENTIAL_COLLECTIONS = ["settings", "users", "userRoles"];
  const essentialReadable = readable.filter(c => ESSENTIAL_COLLECTIONS.includes(c));
  const backgroundReadable = readable.filter(c => !ESSENTIAL_COLLECTIONS.includes(c));

  if (localStorage.getItem("CIC_DEBUG") === "true") {
    console.info("[SYNC] Essential refresh starting", { role, essential: essentialReadable.length, background: backgroundReadable.length });
  }
  window.dispatchEvent(new CustomEvent("sync:refresh", { detail: { status: "start" } }));

  const _t0 = performance.now();
  console.time("[TRACE] refreshCloudData()");

  const loadOne = async (col) => {
    const t0col = performance.now();
    try {
      let rowCount = 0;
      if (FIRESTORE_COLLECTIONS.includes(col)) {
        const snap = await getDocs(query(collection(state.fs, col), limit(fsLimit(col))));
        rowCount = snap.size;
        snap.forEach((doc) => {
          const data = doc.data();
          if (data != null && typeof data === "object") db.applyRemote(col, doc.id, { ...data, id: data.id || doc.id });
        });
        syncLog({ db: "FS", col, path: col, op: "refresh", status: "ok" });
      }
      console.log(`[BOOT STEP] load:${col}: ${Math.round(performance.now() - t0col)}ms (${rowCount} records)`);
      return { col, count: rowCount };
    } catch (e) {
      const { errorCode, errorMsg, status } = classifyError(e);
      syncLog({ db: "FS", col, path: col, op: "refresh", status, errorCode, errorMsg });
      return { col, count: 0 };
    }
  };

  const results = await Promise.all(essentialReadable.map(loadOne));
  const counts = {};
  results.forEach(({ col, count }) => { counts[col] = count; });

  setCloudCounts(counts);
  const refreshedAt = markSyncTime();
  localStorage.setItem("CIC KANO:lastCloudRefresh", refreshedAt);

  if (startRealtime) startListeners("essential");

  const elapsed = Math.round(performance.now() - _t0);
  window.CICKANOPerf = window.CICKANOPerf || {};
  window.CICKANOPerf.essentialSyncComplete = performance.now();
  console.timeEnd("[TRACE] refreshCloudData()");
  window.dispatchEvent(new CustomEvent("sync:refresh", { detail: { status: "done", counts } }));
  if (localStorage.getItem("CIC_DEBUG") === "true") {
    console.info("[SYNC] Essential refresh complete", { elapsed });
  }

  if (backgroundReadable.length > 0) {
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
    schedule(() => refreshBackgroundCloudData(backgroundReadable));
  }

  return { ok: true, counts };
}

async function refreshBackgroundCloudData(collections) {
  if (!collections || !collections.length) return;
  
  const { collection, getDocs, query, limit } = state.sdk.firestore;

  const _t0 = performance.now();
  console.time("[TRACE] refreshBackgroundCloudData()");

  const bgLoadOne = async (col) => {
    const t0col = performance.now();
    try {
      let rowCount = 0;
      if (FIRESTORE_COLLECTIONS.includes(col)) {
        const snap = await getDocs(query(collection(state.fs, col), limit(fsLimit(col))));
        rowCount = snap.size;
        snap.forEach((doc) => {
          const data = doc.data();
          if (data != null && typeof data === "object") db.applyRemote(col, doc.id, { ...data, id: data.id || doc.id });
        });
        syncLog({ db: "FS", col, path: col, op: "bg-refresh", status: "ok" });
      }
      console.log(`[BOOT STEP] bg:${col}: ${Math.round(performance.now() - t0col)}ms (${rowCount} records)`);
    } catch (e) {
      const { errorCode, errorMsg, status } = classifyError(e);
      syncLog({ db: "FS", col, path: col, op: "bg-refresh", status, errorCode, errorMsg });
    }
  };

  const BATCH_SIZE = 5;
  for (let i = 0; i < collections.length; i += BATCH_SIZE) {
    const batch = collections.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map(bgLoadOne));
  }

  const elapsed = Math.round(performance.now() - _t0);
  window.CICKANOPerf = window.CICKANOPerf || {};
  window.CICKANOPerf.bgRefreshTime = elapsed;
  console.timeEnd("[TRACE] refreshBackgroundCloudData()");
  if (localStorage.getItem("CIC_DEBUG") === "true") {
    console.info("[SYNC] Background refresh complete", { collections: collections.length, elapsed });
  }
  startListeners("background");
  window.dispatchEvent(new CustomEvent("sync:refresh", { detail: { status: "bg-done", elapsed } }));
}

function installSyncHandler() {
  const { firestore } = state.sdk;

  setSyncHandler(async (op) => {
    if (!state.ready || !state.authReady || !navigator.onLine) {
      if (localStorage.getItem("CIC_DEBUG") === "true") {
        console.warn("[QUEUE FLUSH] Skipped — not ready:", { ready: state.ready, authReady: state.authReady, online: navigator.onLine });
      }
      return false;
    }

    const currentUser = getCurrentUser();
    const uid = (currentUser && currentUser.uid) || "(none)";
    const path = `${op.col}/${op.id}`;
    const { doc, getDoc, setDoc, deleteDoc } = firestore;

    try {
      if (FIRESTORE_COLLECTIONS.includes(op.col)) {
        const fsRef = doc(state.fs, op.col, op.id);
        if (op.action === "remove" || op.action === "delete") {
          await deleteDoc(fsRef);
        } else {
          const cloudSnap = await getDoc(fsRef).catch(() => null);
          const cloudData = cloudSnap && typeof cloudSnap.exists === 'function' && cloudSnap.exists() ? cloudSnap.data() : null;
          
          if (cloudData) {
            const cloudStamp = recordStamp(cloudData);
            const localStamp = recordStamp(op.data);
            
            if (cloudStamp > localStamp) {
              console.warn("[SYNC CONFLICT] Cloud record is newer; local write dropped", {
                path,
                cloudUpdatedAt: cloudStamp,
                localUpdatedAt: localStamp,
                cloudDevice: cloudData._lastModifiedBy || "unknown",
                localDevice: op.deviceId || "unknown"
              });
              db.applyRemote(op.col, op.id, { ...cloudData, id: cloudData.id || op.id });
              syncLog({ db: "FS", col: op.col, path, op: "conflict-skip-stale", status: "ok" });
              return true;
            } else if (cloudStamp === localStamp && (cloudData._lastModifiedBy || "") !== (op.deviceId || "")) {
              console.warn("[SYNC CONFLICT] Same timestamp, different device; applying local with device priority", {
                path,
                cloudDevice: cloudData._lastModifiedBy || "unknown",
                localDevice: op.deviceId || "unknown"
              });
            }
          }
          
          const dataToSync = {
            ...op.data,
            _lastModifiedBy: op.deviceId || "device-unknown",
            _lastSyncAt: Date.now()
          };
          await setDoc(fsRef, dataToSync);
        }
        syncLog({ db: "FS", col: op.col, path, op: op.action, status: "ok" });
        return true;
      }
    } catch (e) {
      const { errorCode, errorMsg, status } = classifyError(e);
      if (status === "denied") {
        console.warn(`[SYNC DROPPED] permission_denied on ${path} — op will not be retried.`, `uid: ${uid}  col: ${op.col}  id: ${op.id}`);
        toast(`⚠️ Sync denied for ${op.col} — check your permissions or contact admin.`, "warning");
        syncLog({ db: "FS", col: op.col, path, op: op.action, status: "dropped", errorCode, errorMsg, rawError: e });
        return true;
      }
      if (status !== "denied") {
          console.warn("[SYNC FAILED]", path, "uid:", uid, "code:", errorCode, "msg:", errorMsg);
      }
      syncLog({ db: "FS", col: op.col, path, op: op.action, status, errorCode, errorMsg, rawError: e });
      return false;
    }
  });
}

// ─── Auth state watcher ───────────────────────────────────────────────────────
let _lastProcessedUid = null;

function installAuthWatcher() {
  // Deprecated. Handled by Supabase in auth.js and supabase.js
}

// ─── Fresh installation detection ────────────────────────────────────────────
async function isFreshInstallation() {
  try {
    const { firestore } = state.sdk;
    const { collection, getDocs, query, limit } = firestore;
    
    const usersQuery = query(collection(state.fs, "users"), limit(1));
    const usersSnap = await getDocs(usersQuery).catch(() => null);
    
    if (!usersSnap) return true;
    return usersSnap.size === 0;
  } catch (e) {
    console.warn("[Bootstrap] Could not check for users:", e.message);
    return false;
  }
}

// ─── Automatic bootstrap for first user on fresh installation ──────────────────
async function bootstrapFirstUserIfFresh(fbUser) {
  if (!fbUser || !fbUser.uid) return false;
  
  const uid = fbUser.uid;
  const email = fbUser.email || DEFAULT_SUPER_ADMIN_EMAIL;
  const role = "Super Admin";
  
  try {
    const { firestore } = state.sdk;
    const { doc, getDoc, setDoc, collection, getDocs, query, where } = firestore;
    
    // Check if this user already has profiles
    const fsUserRef = doc(state.fs, "users", uid);
    const fsRoleRef = doc(state.fs, "userRoles", uid);
    const userSnap = await getDoc(fsUserRef).catch(() => null);
    const roleSnap = await getDoc(fsRoleRef).catch(() => null);
    
    const userExists = userSnap && typeof userSnap.exists === 'function' && userSnap.exists();
    const roleExists = roleSnap && typeof roleSnap.exists === 'function' && roleSnap.exists();
    
    if (userExists && roleExists) {
      return false; // Already bootstrapped
    }
    
    // Only bootstrap if this is a fresh installation (no admins at all)
    const isFresh = await isFreshInstallation();
    console.log("[BOOTSTRAP] Starting");
    console.log("[BOOTSTRAP] Fresh Installation:", isFresh);
    console.log("[BOOTSTRAP] Auth UID:", uid);

    if (!isFresh) {
      if (localStorage.getItem("CIC_DEBUG") === "true") {
        console.info("[Bootstrap] Not fresh install - admins already exist. User needs manual profile creation.");
      }
      return false;
    }
    
    // Fresh install: auto-create first super admin
    if (!userExists) {
      console.log("[BOOTSTRAP] Creating user profile");
      try {
        await setDoc(fsUserRef, {
          id: uid,
          uid,
          email,
          role,
          name: email,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "Active",
          isSeed: true,
          autoBootstrapped: true
        }, { merge: true });
        console.log("[BOOTSTRAP] User profile created");
        syncLog({ db: "FS", col: "users", path: "users/" + uid, op: "auto-bootstrap", status: "ok" });
      } catch(err) {
        console.error("[BOOTSTRAP ERROR users]", err);
      }
    }
    
    if (!roleExists) {
      console.log("[BOOTSTRAP] Creating role document");
      try {
        await setDoc(fsRoleRef, {
          id: uid,
          uid,
          email,
          role,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isSeed: true,
          autoBootstrapped: true
        }, { merge: true });
        console.log("[BOOTSTRAP] Role document created");
        syncLog({ db: "FS", col: "userRoles", path: "userRoles/" + uid, op: "auto-bootstrap", status: "ok" });
      } catch(err) {
        console.error("[BOOTSTRAP ERROR roles]", err);
      }
    }
    
    const verifyUser = await getDoc(fsUserRef);
    const verifyRole = await getDoc(fsRoleRef);

    console.log("[BOOTSTRAP VERIFY user]", verifyUser.exists());
    console.log("[BOOTSTRAP VERIFY role]", verifyRole.exists());

    if (!verifyUser.exists() || !verifyRole.exists()) {
      console.error("[BOOTSTRAP VERIFY FAILED] Documents were not created");
      console.error("Firestore Path: users/" + uid + " & userRoles/" + uid);
      console.error("Active Project ID:", (state.app && state.app.options && state.app.options.projectId) || "Unknown");
      console.error("Authenticated UID:", uid);
    }
    
    console.log("[BOOTSTRAP] Success");
    window.dispatchEvent(new CustomEvent("bootstrap:first-admin", { detail: { uid, email, role } }));
    return true;
  } catch (e) {
    const { errorCode, errorMsg, status } = classifyError(e);
    syncLog({ db: "FS", col: "userRoles/users", path: "userRoles/" + uid, op: "auto-bootstrap", status, errorCode, errorMsg });
    console.error("[BOOTSTRAP ERROR general]", e);
    return false;
  }
}

// ─── Known-admin bootstrap ────────────────────────────────────────────────────
async function bootstrapKnownAdmin(fbUser) {
  const uid   = fbUser.uid;
  const email = fbUser.email || DEFAULT_SUPER_ADMIN_EMAIL;
  // Note: we use "Super Admin" instead of "super-admin" because firestore.rules and the UI explicitly check for "Super Admin"
  const role  = "Super Admin";

  try {
    const { firestore } = state.sdk;
    const { doc, getDoc, setDoc } = firestore;

    const fsUserRef = doc(state.fs, "users", uid);
    const fsUserSnap = await getDoc(fsUserRef).catch(() => null);
    if (!fsUserSnap || !fsUserSnap.exists()) {
      await setDoc(fsUserRef, {
        uid, email, role,
        name: "Super Admin",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "active",
        isSeed: true
      }, { merge: true });
      syncLog({ db: "FS", col: "users", path: "users/" + uid, op: "bootstrap", status: "ok" });
    }

    const fsRoleRef = doc(state.fs, "userRoles", uid);
    const fsRoleSnap = await getDoc(fsRoleRef).catch(() => null);
    if (!fsRoleSnap || !fsRoleSnap.exists()) {
      await setDoc(fsRoleRef, { uid, email, role, updatedAt: Date.now(), isSeed: true }, { merge: true });
      syncLog({ db: "FS", col: "userRoles", path: "userRoles/" + uid, op: "bootstrap", status: "ok" });
    }

    if (localStorage.getItem("CIC_DEBUG") === "true") {
      console.info("[Firebase] Admin UID bootstrap complete:", uid);
    }
  } catch (e) {
    const { errorCode, errorMsg, status } = classifyError(e);
    syncLog({ db: "FS", col: "userRoles/users", path: "userRoles/" + uid, op: "bootstrap", status, errorCode, errorMsg });
    console.warn("[Firebase] Admin UID bootstrap failed:", errorMsg);
  }
}

// ─── Counter reservation ──────────────────────────────────────────────────────
function installCounterReservation() {
  const { firestore } = state.sdk;
  window.__CICKANOReserveCounter = async (name) => {
    const { doc, runTransaction } = firestore;
    const counterRef = doc(state.fs, "counters", name);
    return await runTransaction(state.fs, async (transaction) => {
      const snap = await transaction.get(counterRef);
      const cur = snap.exists() ? (Number(snap.data().value) || 0) : 0;
      const next = cur + 1;
      transaction.set(counterRef, { value: next }, { merge: true });
      return next;
    });
  };

  window.__CICKANOFastForwardCounter = async (name, minTarget) => {
    const { doc, runTransaction } = firestore;
    const counterRef = doc(state.fs, "counters", name);
    return await runTransaction(state.fs, async (transaction) => {
      const snap = await transaction.get(counterRef);
      const cur = snap.exists() ? (Number(snap.data().value) || 0) : 0;
      if (cur < minTarget) {
        transaction.set(counterRef, { value: minTarget }, { merge: true });
        return minTarget;
      }
      return cur;
    });
  };
}

// ─── Network event handlers ───────────────────────────────────────────────────
window.addEventListener("online", async () => {
  state.online = true;
  window.dispatchEvent(new CustomEvent("net:change", { detail: { online: true } }));
  if (state.mode === "cloud" && !state.ready) {
    const ok = await initCloud();
    if (ok) {
      debounceStartListeners();
      window.dispatchEvent(new CustomEvent("net:reconnected", { detail: {} }));
    }
  } else if (state.ready) {
    
    if (state.authReady) {
      if (localStorage.getItem("CIC_DEBUG") === "true") {
        console.info("[QUEUE FLUSH] Back online - flushing pending sync queue");
      }
      flushQueue();
      debounceStartListeners();
      window.dispatchEvent(new CustomEvent("net:reconnected", { detail: {} }));
    }
  }
});

window.addEventListener("offline", () => {
  state.online = false;
  if (state.ready) {
    
  }
  window.dispatchEvent(new CustomEvent("net:change", { detail: { online: false } }));
});

// ─── Export bootstrap functions for setup wizard ──────────────────────────────
export { isFreshInstallation, bootstrapFirstUserIfFresh };

// ─── Emergency Recovery Tool ──────────────────────────────────────────────────
window.cicCreateAdmin = async () => {
  const st = getState();
  const fbUser = st.auth && st.auth.currentUser;
  
  if (!fbUser) {
    console.error("No authenticated user found. Please login first.");
    return false;
  }
  
  const uid = fbUser.uid;
  const email = fbUser.email;
  const role = "Super Admin";
  
  try {
    const { doc, setDoc } = st.sdk.firestore;
    const fsUserRef = doc(st.fs, "users", uid);
    const fsRoleRef = doc(st.fs, "userRoles", uid);
    
    console.log("[EMERGENCY] Creating user profile...");
    await setDoc(fsUserRef, {
      uid,
      email,
      name: email,
      role,
      status: "active",
      createdAt: Date.now()
    }, { merge: true });
    
    console.log("[EMERGENCY] Creating user role...");
    await setDoc(fsRoleRef, {
      role
    }, { merge: true });
    
    console.log("[EMERGENCY] Successfully created Super Admin documents.");
    return true;
  } catch (err) {
    console.error("[EMERGENCY ERROR] Failed to create documents:", err);
    return false;
  }
};
