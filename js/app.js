// Application bootstrap + shell controller.
window.CICKANO = window.CICKANO || {};
if (typeof window.CICKANO.debugMode === 'undefined') {
  window.CICKANO.debugMode = localStorage.getItem("CIC_DEBUG") === "true";
}

["log", "info", "warn", "error"].forEach(method => {
  const original = console[method];
  console[method] = function (...args) {
    if (window.CICKANO.debugMode) {
      original.apply(console, args);
      return;
    }
  };
});
import { db, flushQueue, pendingSyncCount } from "./core/db.js";
import { idbSet } from "./core/idb.js";
import { store } from "./core/store.js";
import { seedDefaults } from "./core/seed.js";
import { getCurrentUser, login, logout, onAuthChange, restoreSession, waitForSessionCache } from "./core/auth.js";
import { initCloud, refreshCloudData, startListeners, stopListeners, getState, setMode, logFirebaseDiagnostics } from "./core/adapter.js";
import { initAutoUpdate } from "./core/autoupdate.js";
import { loginWithBiometric } from "./core/webauthn.js";
import { fingerprintServiceAvailable, captureFingerprint, identifyFingerprint } from "./core/fingerprint.js";
import { canAccess, firstAllowedModule } from "./core/rbac.js";
import { configure, current, go, start } from "./core/router.js";
import { $, $$, el, toast } from "./core/utils.js";
import { getBranding } from "./core/branding.js";

const NAV = [
  { group: "Overview", items: [["dashboard", "Dashboard", "📊"]] },
  {
    group: "Personal", items: [
      ["myprofile", "My Profile", "👤"], ["myactivities", "My Activities", "📅"],
      ["myresults", "My Results", "📈"], ["myattendance", "My Attendance", "📅"],
      ["myappointments", "My Appointment Letter", "📄"],
      ["myassignments", "My Assignments", "📝"], ["mycbt", "My CBT", "💻"],
      ["myinvoices", "My Invoices", "🧾"], ["myreceipts", "My Receipts", "🧾"], ["complaints", "Complaints", "!"]
    ]
  },
  {
    group: "Admissions", items: [
      ["admission", "Admission Applications", "🎓"],
      ["enquiries", "Admission Enquiries", "📞"],
      ["admissionproposals", "Admission Proposal", "📄"]
    ]
  },
  {
    group: "Students", items: [
      ["regterm2", "2nd Term Registration", "📝"], ["regterm3", "3rd Term Registration", "📄"],
      ["migration", "Migration", "📥"],
      ["students", "Students", "👥"], ["studentactivity", "Student Activities", "🧑‍🎓"],
      ["graduations", "Alumni / Graduations", "🎓"],
      ["promotion", "Promotion", "⬆️"]]
  },
  {
    group: "Finance", items: [
      ["revenue", "Revenue Forecast", "📈"],
      ["fees", "Fees & Payments", "💰"], ["bulkinvoice", "Bulk Invoice Generator", "⚡"], ["family", "Family Ledger", "👪"],
      ["invoices", "Invoices", "🧾"], ["receipts", "Receipts", "🧾"], ["expense", "Expenses", "📉"],
      ["scholarships", "Scholarships & Discounts", "🎓"]]
  },
  {
    group: "Academics", items: [
      ["attendance", "Attendance", "📅"], ["exams", "Examinations / CBT", "📝"],
      ["results", "Results Entry", "📈"], ["reportcards", "Report Cards", "🏅"],
      ["schemeofwork", "Scheme of Work", "📚"], ["lessonplans", "Lesson Plans", "📚"],
      ["assignments", "Assignments", "📝"], ["testimonials", "Testimonial Generator", "🎓"],
      ["quranlink", "Qur'an Link", "📖"]]
  },
  {
    group: "Examinations", items: [
      ["examtimetable", "General Exam Timetable", "📅"]]
  },
  {
    group: "Staff & Payroll", items: [
      ["staff", "Staff", "👥"], ["appointmentletters", "Appointment Letters", "📄"], ["staffroster", "Duty Roster", "📅"], ["staffperformanceroster", "Performance Cycle Roster", "📋"], ["staffperformance", "Staff Weekly Performance", "📈"], ["staffactivity", "Staff Activities", "🏃‍♂️"],
      ["payslip", "Payslips", "💰"], ["complaints", "Complaints", "💬"], ["salary", "Salary", "💸"], ["voucher", "Payment Voucher", "🧾"]]
  },
  {
    group: "Operations", items: [
      ["bookshop", "Bookshop", "📚"], ["inventory", "Inventory", "📦"], ["reports", "Reports", "📑"],
      ["communication", "Notification Center", "📱"], ["whatsapp", "WhatsApp Agent", "🤖"],
      ["activities", "Extracurricular Activities", "⚽"], ["visitors", "Visitor Management", "🚶"], ["audit", "Audit Trail", "🔍"], ["backup", "Backup & Restore", "💾"]]
  },
  { group: "System", items: [["healthcheck", "Health Check", "🏥"], ["settings", "Settings", "⚙️"], ["recyclebin", "Recycle Bin", "🗑️"], ["usermanagement", "User Management", "👥"], ["biokiosk", "Attendance Kiosk", "⏱️"], ["biodiagnostics", "Biometrics Diagnostics", "🩺"], ["rolediagnostics", "Role Diagnostics", "?"], ["appreset", "App Reset", "🔄"], ["syncreport", "Sync Center", "🔍"]] }
];

const MODULE_LOADERS = {
  dashboard: () => import("./modules/dashboard.js"),
  admission: () => import("./modules/admission.js"),
  enquiries: () => import("./modules/admissionproposals.js"),
  admissionproposals: () => import("./modules/admissionproposals.js"),
  regterm2: () => import("./modules/regterm2.js"),
  regterm3: () => import("./modules/regterm3.js"),
  migration: () => import("./modules/migration.js"),
  students: () => import("./modules/students.js"),
  bulkinvoice: () => import("./modules/bulkinvoice.js"),
  studentactivity: () => import("./modules/studentactivity.js"),
  promotion: () => import("./modules/promotion.js"),
  family: () => import("./modules/family.js"),
  fees: () => import("./modules/fees.js"),
  invoices: () => import("./modules/invoices.js"),
  receipts: () => import("./modules/receipts.js"),
  expense: () => import("./modules/expense.js"),
  scholarships: () => import("./modules/scholarships.js"),
  revenue: () => import("./modules/revenue.js"),
  attendance: () => import("./modules/attendance.js"),
  exams: () => import("./modules/exams.js"),
  results: () => import("./modules/results.js"),
  reportcards: () => import("./modules/reportcards.js"),
  staff: () => import("./modules/staff.js"),
  staffactivity: () => import("./modules/staffactivity.js"),
  payslip: () => import("./modules/payslip.js"),
  salary: () => import("./modules/salary.js"),
  voucher: () => import("./modules/voucher.js"),
  bookshop: () => import("./modules/bookshop.js"),
  inventory: () => import("./modules/inventory.js"),
  reports: () => import("./modules/reports.js"),
  audit: () => import("./modules/audit.js"),
  activities: () => import("./modules/activities.js"),
  backup: () => import("./modules/backup.js"),
  settings: () => import("./modules/settings.js"),
  biodiagnostics: () => import("./modules/biodiagnostics.js"),
  appreset: () => import("./modules/appreset.js"),
  syncreport: () => import("./modules/syncreport.js"),
  healthcheck: () => import("./modules/healthcheck.js"),
  usermanagement: () => import("./modules/usermanagement.js"),
  recyclebin: () => import("./modules/recyclebin.js"),
  rolediagnostics: () => import("./modules/rolediagnostics.js"),
  whatsapp: () => import("./modules/whatsapp.js"),
  biokiosk: () => import("./modules/biokiosk.js"),
  visitors: () => import("./modules/visitors.js"),
  complaints: () => import("./modules/complaints.js"),
  myprofile: () => import("./modules/myprofile.js"),
  myactivities: () => import("./modules/myactivities.js"),
  myresults: () => import("./modules/myresults.js"),
  myattendance: () => import("./modules/myattendance.js"),
  myassignments: () => import("./modules/myassignments.js"),
  mycbt: () => import("./modules/mycbt.js"),
  myinvoices: () => import("./modules/myinvoices.js"),
  myreceipts: () => import("./modules/myreceipts.js"),
  staffroster: () => import("./modules/staffroster.js"),
  staffroster: () => import("./modules/staffroster.js"),
  staffperformanceroster: () => import("./modules/staffperformanceroster.js"),
  staffperformance: () => import("./modules/staffperformance.js"),
  testimonials: () => import("./modules/testimonials_v2.js"),
  schemeofwork: () => import("./modules/schemeofwork.js"),
  examtimetable: () => import("./modules/examtimetable.js"),
  quranlink: () => import("./modules/quranlink.js"),
  graduations: () => import("./modules/graduations.js"),
  lessonplans: () => import("./modules/lessonplans.js"),
  assignments: () => import("./modules/assignments.js"),
  communication: () => import("./modules/communication.js"),
  whatsapp: () => import("./modules/whatsapp.js"),
  biokiosk: () => import("./modules/biokiosk.js"),
  appointmentletters: () => import("./modules/appointmentletters.js"),
  myappointments: () => import("./modules/myappointments.js")
};

let currentUnsub = null;

function effectiveRole(user) {
  // TEMPORARY: Force Super Admin for admin user until debugging is complete
  if (user?.email === 'admin@halqa.local') {
    console.log("[TEMP] Forcing Super Admin for admin user");
    return "Super Admin";
  }

  // In Supabase mode, use user.role directly (from database query)
  // In Firebase mode, check IndexedDB first for compatibility
  const mode = getState().mode;
  console.log("[DEBUG] effectiveRole called - mode:", mode, "user:", user);
  console.log("[DEBUG] user.role:", user?.role, "user.email:", user?.email);

  if (mode === "cloud") {
    const role = (user && user.role) || "";
    console.log("[DEBUG] Cloud mode - returning role:", role);
    return role;
  }

  const roleRec = (user && user.uid) ? db.get("userRoles", user.uid) : null;
  console.log("[DEBUG] Local mode - roleRec:", roleRec);
  const role = (roleRec && roleRec.role) || (user && user.role) || "";
  console.log("[DEBUG] Local mode - returning role:", role);
  return role;
}

function applyTheme() {
  const t = localStorage.getItem("CIC KANO:theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
  const btn = $("#theme-btn");
  if (btn) btn.textContent = t === "dark" ? "\u2600\uFE0F" : "\u263D";
}

function buildNav(role) {
  const nav = $("#nav");
  nav.innerHTML = "";
  const seen = new Set();
  NAV.forEach((grp) => {
    const items = grp.items.filter(([key]) => {
      if (!canAccess(role, key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!items.length) return;
    nav.appendChild(el("div", { class: "nav-group", text: grp.group }));
    items.forEach(([key, label, icon]) => {
      nav.appendChild(el("a", { href: "#/" + key, "data-key": key }, [
        el("span", { class: "ic", text: icon }), el("span", { text: label })
      ]));
    });
  });
}

function setActiveNav(key) {
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.key === key));
}

function updateNetStatus() {
  const pill = $("#net-status");
  if (!pill) return;
  const st = getState();
  const isCloud = st.mode === "cloud";
  const isReady = st.ready;
  const checkingAuth = st.authChecking || ["initializing", "auth-checking", "auth-sign-in"].includes(st.cloudStatus);
  const pending = pendingSyncCount();

  if (!isCloud) {
    pill.className = "status-pill status-local";
    pill.textContent = "● Local";
  } else if (!navigator.onLine) {
    pill.className = "status-pill status-offline";
    pill.textContent = "● Offline";
    showOfflineBanner(true);
  } else if (checkingAuth) {
    pill.className = "status-pill status-sync";
    pill.textContent = "Verifying Auth";
    showOfflineBanner(false);
  } else if (!isReady || st.cloudStatus === "unavailable") {
    pill.className = "status-pill status-offline";
    pill.textContent = "No Cloud";
    showOfflineBanner(true);
  } else if (!st.authReady) {
    pill.className = "status-pill status-offline";
    pill.textContent = "Signed Out";
    showOfflineBanner(false);
  } else if (pending > 0) {
    pill.className = "status-pill status-sync";
    pill.textContent = "↻ Syncing " + pending;
    showOfflineBanner(false);
  } else {
    pill.className = "status-pill status-online";
    pill.textContent = "● Online";
    showOfflineBanner(false);
  }
}

function showOfflineBanner(show) {
  let banner = $("#offline-banner");
  if (show && !banner) {
    banner = el("div", {
      id: "offline-banner",
      style: "position:fixed;top:0;left:0;right:0;z-index:9999;background:#e65100;color:#fff;text-align:center;padding:6px 12px;font-size:13px;font-weight:600"
    }, [el("span", { text: "⚠ Offline — all data is saved locally and will sync when reconnected." })]);
    document.body.prepend(banner);
  } else if (!show && banner) {
    banner.remove();
  }
}

function renderAccessDenied(key) {
  setActiveNav("");
  $("#page-title").textContent = "Access Denied";
  const content = $("#content");
  content.innerHTML = "";
  content.appendChild(el("div", { class: "card" }, [
    el("h3", { text: "Access Denied" }),
    el("p", { class: "muted", text: `Your role is not allowed to open "${key}".` })
  ]));
  toast("You don't have access to that module.", "error");
}

async function verifyRoleConsistency(user) {
  if (!user || !user.uid) return true;
  const st = getState();
  // Don't enforce if cloud isn't ready or if we are local
  if (st.mode !== "cloud" || !st.ready || !st.sdk || !st.sdk.firestore) return true;

  try {
    const { doc, getDoc } = st.sdk.firestore;
    let cloudRole = null;
    const rSnap = await getDoc(doc(st.db, "userRoles", user.uid));
    if (rSnap.exists()) cloudRole = rSnap.data().role;
    else {
      const uSnap = await getDoc(doc(st.db, "users", user.uid));
      if (uSnap.exists()) cloudRole = uSnap.data().role;
    }

    if (cloudRole && user.role !== cloudRole) {
      console.error(`[AUTH SECURITY] Role mismatch detected! Cached: ${user.role}, Cloud: ${cloudRole}. Purging cache!`);
      user.role = cloudRole;
      sessionStorage.setItem("CIC KANO:session", JSON.stringify(user));
      await idbSet("fastLoginUser", user);
      return false; // Tells caller a reload/redirect is needed
    }
  } catch (e) {
    console.warn("[AUTH SECURITY] Verification failed. Assuming okay for now.", e.message);
  }
  return true;
}

async function navigateTo(key, _route, param) {
  const routeStart = performance.now();
  let user = getCurrentUser();
  if (!user) { showLogin(); return; }

  // 1. Consistency Verification (Silent Check)
  const roleConsistency = await verifyRoleConsistency(user);
  if (!roleConsistency) {
    location.reload();
    return;
  }

  user = getCurrentUser();

  if (user.forcePasswordChange && !window._passwordWarningShown) {
    toast("Security Recommendation: You are currently using the default password. For better security, please change your password.", "warning", 10000);
    window._passwordWarningShown = true;
  }

  const role = effectiveRole(user);

  // 2. Hard Admin Protection
  const adminKeys = ["admin", "accounting", "staff", "invoices"];
  const isSuperOrAdmin = role === "Super Admin" || role === "Admin" || role === "Accountant" || role === "Principal";

  if (role === "Student" && adminKeys.includes(key)) {
    renderAccessDenied(key);
    return;
  }

  // Protect Admin from seeing Student Dashboard
  if (isSuperOrAdmin && key === "student_dashboard") {
    console.error("[AUTH SECURITY] Admin attempting to render Student Dashboard. Intercepted.");
    toast("Redirected to Admin Dashboard.", "info");
    go("admin");
    return;
  }

  if (!canAccess(role, key)) {
    renderAccessDenied(key);
    return;
  }

  setActiveNav(key);
  const navItem = NAV.flatMap((g) => g.items).find((i) => i[0] === key);
  $("#page-title").textContent = navItem ? navItem[1] : "Dashboard";
  const content = $("#content");
  content.innerHTML = '<div class="empty"><div class="big">⏳</div>Loading…</div>';
  if (currentUnsub) { try { currentUnsub(); } catch { } currentUnsub = null; }
  try {
    const mod = await MODULE_LOADERS[key]();
    content.innerHTML = "";
    const res = await mod.render(content, { user: { ...user, role }, param, go });
    if (typeof res === "function") currentUnsub = res;
    window.dispatchEvent(new CustomEvent("app:route-rendered", { detail: { key, ms: Math.round(performance.now() - routeStart) } }));
  } catch (e) {
    console.error(e);
    content.innerHTML = `<div class="card"><h3>Module error</h3><p class="muted">${e.message}</p></div>`;
  }
  $("#sidebar").classList.remove("open");
  $("#scrim").classList.add("hidden");
}

function schedulePostLoginSync({ delay = 100 } = {}) {
  const st = getState();
  if (st.mode !== "cloud" || !st.ready) return;
  const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, delay));
  schedule(async () => {
    const t0 = performance.now();
    try {
      await refreshCloudData({ startRealtime: true });
      window.CICKANOPerf = window.CICKANOPerf || {};
      window.CICKANOPerf.postLoginSyncTime = Math.round(performance.now() - t0);
    } catch (e) {
      console.warn("[PERF] Post-login sync failed:", e.code || e.message);
    }
  });
}

window.addEventListener("sync:refresh", (e) => {
  if (e.detail && e.detail.status === "bg-done") {
    window.CICKANOPerf.backgroundSyncComplete = performance.now();
    console.group("%c🚀 Performance Dashboard", "font-weight:bold;color:#4f46e5;font-size:14px;");
    console.table({
      "Authentication Start": window.CICKANOPerf.authStart || 0,
      "Firebase Auth Complete": window.CICKANOPerf.authComplete || 0,
      "IndexedDB Init Complete": window.CICKANOPerf.idbInitComplete || 0,
      "Essential Sync Complete": window.CICKANOPerf.essentialSyncComplete || 0,
      "Dashboard Rendered": window.CICKANOPerf.dashboardRendered || 0,
      "Background Sync Completed": window.CICKANOPerf.backgroundSyncComplete || 0,
      "Total Startup Time (ms)": Math.round((window.CICKANOPerf.dashboardRendered || performance.now()) - (window.CICKANOPerf.authStart || 0))
    });
    console.groupEnd();

    // Dashboard metrics logged to console above.
  }
});

function showApp(user, { forceLanding = false } = {}) {
  console.log("[DEBUG] showApp called - user:", user);
  if (!user) {
    showLogin();
    return;
  }

  // Hide landing page and login view, show app
  const landingPage = $("#landing-page");
  const loginView = $("#login-view");
  const appView = $("#app-view");
  const navbar = document.querySelector('.navbar');

  if (landingPage) landingPage.style.display = 'none';
  if (loginView) loginView.classList.add("hidden");
  if (appView) appView.classList.remove("hidden");
  if (navbar) navbar.style.display = 'none';

  const b = getBranding();
  const sideLogo = $("#side-logo");
  if (b.logoBase64 && sideLogo) { sideLogo.src = b.logoBase64; }
  const role = effectiveRole(user);
  console.log("[DEBUG] showApp - effective role:", role);

  const userName = user?.name || "Administrator";
  const userEmail = user?.email || "";

  $("#user-name").textContent = userName || userEmail;
  $("#user-role").textContent = role || "Role Not Assigned";
  $("#user-avatar").textContent = (userName || userEmail || "?").trim()[0].toUpperCase();
  console.log("[DEBUG] Building nav with role:", role);
  buildNav(role);
  updateNetStatus();
  if (forceLanding || location.hash === "") {
    const landing = firstAllowedModule(role);
    console.log("[DEBUG] First allowed module:", landing);
    if (landing) go(landing); else renderAccessDenied("Role Not Assigned");
  } else start();
}

window.authReady = false;

function showLogin() {
  if (currentUnsub) { try { currentUnsub(); } catch { } currentUnsub = null; }
  stopListeners();

  // Hide landing page and show login view
  const landingPage = $("#landing-page");
  const loginView = $("#login-view");
  const appView = $("#app-view");
  const navbar = document.querySelector('.navbar');

  if (landingPage) landingPage.style.display = 'none';
  if (loginView) loginView.classList.remove("hidden");
  if (appView) appView.classList.add("hidden");
  if (navbar) navbar.style.display = 'none';

  const nav = $("#nav");
  const content = $("#content");
  const pageTitle = $("#page-title");
  const sidebar = $("#sidebar");
  const scrim = $("#scrim");

  if (nav) nav.innerHTML = "";
  if (content) content.innerHTML = "";
  if (pageTitle) pageTitle.textContent = "Login";
  if (sidebar) sidebar.classList.remove("open");
  if (scrim) scrim.classList.add("hidden");

  // PRELOAD FIREBASE & LOCK BUTTON
  const btn = $("#login-btn");
  const bioBtn = $("#bio-login-btn");
  const modeNode = document.querySelector('input[name="mode"]:checked');
  const mode = modeNode ? modeNode.value : "cloud";

  if (mode === "cloud" && !window.authReady) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Initializing System...";
    }
    if (bioBtn) bioBtn.disabled = true;

    console.log("[AUTH INIT] Preloading Firebase...");
    const _tInit = performance.now();

    const timeout = setTimeout(() => {
      if (!window.authReady && btn) {
        btn.textContent = "System initialization taking longer than expected";
      }
    }, 15000);

    initCloud().then(ready => {
      clearTimeout(timeout);
      window.authReady = true;
      console.log(`[AUTH READY] Firebase App Ready in ${Math.round(performance.now() - _tInit)}ms`);
      console.log(`[FIRESTORE READY] Verified`);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Sign In";
      }
      if (bioBtn) bioBtn.disabled = false;
    }).catch(err => {
      clearTimeout(timeout);
      console.error("[AUTH INIT FAIL]", err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Sign In";
      }
      if (bioBtn) bioBtn.disabled = false;
    });
  }
}

async function boot() {
  const CIC_SCHEMA_VERSION = "2026-06-prod-v1";
  const MIGRATION_DATE = "2026-06-16";
  const currentSchema = localStorage.getItem("CIC_SCHEMA_VERSION");

  if (currentSchema !== CIC_SCHEMA_VERSION) {
    console.warn(`[MIGRATION] Schema version mismatch. Expected ${CIC_SCHEMA_VERSION}, found ${currentSchema}. Purging local cache.`);

    // Safely clear local storage matching our app prefix, avoiding Firebase Auth
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("CIC KANO:")) {
        localStorage.removeItem(k);
      }
    }

    // Set migration history
    localStorage.setItem("CIC_SCHEMA_VERSION", CIC_SCHEMA_VERSION);
    localStorage.setItem("CIC_MIGRATION_DATE", MIGRATION_DATE);

    // Clear IndexedDB Cache safely
    try {
      indexedDB.deleteDatabase("CICKANO_FastCache");
    } catch (e) {
      console.warn("Failed to delete IDB", e);
    }

    // Force reload to apply clean state
    location.reload();
    return;
  }

  // ── BOOT PERFORMANCE TRACE ────────────────────────────────────────────────
  // Uses performance.now() throughout.
  // ────────────────────────────────────────────────────────────
  const _bootStart = performance.now();
  const _step = (name) => {
    const ms = Math.round(performance.now() - _bootStart);
    console.log(`[BOOT STEP] ${name}: +${ms}ms from start`);
    return performance.now();
  };

  window.CICKANOPerf = {
    authTime: "cached",
    dashboardTime: "pending",
    totalLogin: "pending",
    cloudRefreshTime: "pending",
    bgRefreshTime: "pending"
  };
  applyTheme();

  // 1. Auto Update
  initAutoUpdate();
  _step("initAutoUpdate");

  // 2. Firebase Cloud Init & Role Validation (BLOCKING)
  const connSetting = db.setting("connectivity");
  const connectivityMode = ((connSetting && connSetting.mode) || localStorage.getItem("CIC KANO:connectivityMode") || "FIREBASE").toUpperCase();
  const isCloud = connectivityMode === "FIREBASE" || (connectivityMode === "AUTO" && navigator.onLine);

  if (isCloud) {
    setMode("cloud");
    const _tc = performance.now();
    await initCloud();
    console.log(`[BOOT STEP] Firebase Auth Ready: ${Math.round(performance.now() - _tc)}ms`);

    // STRICTLY BLOCK AND WAIT FOR FIRESTORE ROLE TO BE LOADED
    const { waitForAuthReady } = await import("./core/adapter.js");
    const roleReady = await waitForAuthReady(10000);
    console.log(`[BOOT STEP] Firestore Role Loaded: +${Math.round(performance.now() - _bootStart)}ms (Success: ${roleReady})`);

    const cloudRadio = document.querySelector('input[name="mode"][value="cloud"]');
    if (cloudRadio) cloudRadio.checked = true;
  } else {
    setMode("local");
    const localRadio = document.querySelector('input[name="mode"][value="local"]');
    if (localRadio) localRadio.checked = true;
  }

  logFirebaseDiagnostics("startup");

  // 3. Restore cached session now that cloud is validated
  const _t2 = performance.now();
  const fastUser = await restoreSession();
  console.log(`[BOOT STEP] Cache Synced: ${Math.round(performance.now() - _t2)}ms`);

  if (fastUser) {
    const st = getState();
    if (!st) {
      console.error("Application state object missing");
      return;
    }
    console.log("Firebase Auth User:", st.auth ? st.auth.currentUser : null);
    console.log("Firestore Profile:", fastUser);

    // Validate user profile exists
    if (!fastUser || !fastUser.role) {
      console.warn("User profile missing or incomplete. Showing login...");
      toast("Account profile incomplete. Contact administrator.", "error", 6000);
      showLogin();
      return;
    }

    // Fetch master and user data before showing app
    const { bootstrapMasterData, bootstrapUserData, startListeners } = await import("./core/adapter.js");

    const _tMaster = performance.now();
    await bootstrapMasterData();
    console.log(`[BOOT STEP] master data sync: ${Math.round(performance.now() - _tMaster)}ms`);

    const _tUser = performance.now();
    await bootstrapUserData();
    console.log(`[BOOT STEP] user data sync: ${Math.round(performance.now() - _tUser)}ms`);

    // Auto-fix any invalid student classes locally before showing the UI
    try {
      const { autoFixStudentClasses } = await import("./core/db.js");
      await autoFixStudentClasses();
    } catch (err) {
      console.warn("Failed to auto-fix student classes:", err);
    }


    await startListeners();

    // Show dashboard ONLY if role is confirmed
    const onFastRender = (evt) => {
      window.CICKANOPerf.dashboardRendered = performance.now();
      console.log(`[BOOT STEP] Dashboard Mounted`);
    };
    window.addEventListener("app:route-rendered", onFastRender);
    const _tshow = performance.now();
    showApp(fastUser, { forceLanding: true });
    console.log(`[BOOT STEP] showApp: ${Math.round(performance.now() - _tshow)}ms`);
  } else {
    // Fail closed! Show login view.
    showLogin();
  }

  // 4. Seed defaults (sync, fast — localStorage only)
  const _t3 = performance.now();
  seedDefaults();
  console.log(`[BOOT STEP] seedDefaults: ${Math.round(performance.now() - _t3)}ms`);

  // 5. Router
  const _t5 = performance.now();
  configure(MODULE_LOADERS, navigateTo);
  console.log(`[BOOT STEP] configureRouter: ${Math.round(performance.now() - _t5)}ms`);

  // 6. Live status listeners
  window.addEventListener("app:settings-updated", () => {
    window.dispatchEvent(new CustomEvent("master-data-updated"));
    toast("School settings have been updated.", "info");
  });
  window.addEventListener("sync:queue", updateNetStatus);
  window.addEventListener("net:change", updateNetStatus);
  window.addEventListener("net:reconnected", async () => {
    updateNetStatus();
    toast("Internet detected. Syncing pending records...", "success");
    if (getState().ready) {
      await refreshCloudData({ startRealtime: true });
      await flushQueue();
    }
  });
  setInterval(updateNetStatus, 4000);

  // 7. Admin override security listener
  db.on("users", () => {
    const user = getCurrentUser();
    if (user) {
      const uRec = db.get("users", user.uid);
      if (uRec && (uRec.loginDisabled || uRec.forceLogout)) {
        if (uRec.forceLogout) {
          uRec.forceLogout = false;
          db.save("users", uRec);
        }
        logout();
        toast("Your session has been terminated by an Administrator.", "error", 10000);
      }
    }
  });

  // app:backup-restored — fired by backupSync.js after a successful remote restore.
  // All actual restore logic lives in backupSync.js; this listener just refreshes the
  // currently rendered view so the user sees the new data without a full page reload.
  window.addEventListener("app:backup-restored", () => {
    // Re-navigate to the current route to trigger a fresh render of the active module
    const route = current() || firstAllowedModule((getCurrentUser() || {}).role);
    if (route) go(route);
  });


  // 8. Login form
  const loginForm = $("#login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("[LOGIN START] Commencing authentication...");
      const totalStart = performance.now();
      const btn = $("#login-btn");
      if (btn) {
        btn.disabled = true; btn.textContent = "Signing in\u2026";
      }
      const mode = document.querySelector('input[name="mode"]:checked')?.value || "cloud";
      const email = $("#login-email")?.value?.trim().toLowerCase() || "";
      setMode(mode);
      try {
        if (mode === "cloud") {
          const _tci = performance.now();
          await initCloud();
          window.authReady = true;
        }
        const _tauth = performance.now();
        const loginPassword = $("#login-password")?.value || "";
        await login(email, loginPassword);
        window.CICKANOPerf.authTime = Math.round(performance.now() - _tauth);
        console.log(`[BOOT STEP] auth: ${window.CICKANOPerf.authTime}ms`);

        const { waitForAuthReady } = await import("./core/adapter.js");
        // Using statically imported restoreSession and waitForSessionCache

        const roleReady = await waitForAuthReady(10000);

        if (!roleReady) {
          console.log("[LOGIN FAIL] Auth profile incomplete timeout.");
          toast("Account profile incomplete. Contact administrator.", "error", 6000);
          return;
        }

        console.log("[LOGIN] Waiting for session cache...");
        await waitForSessionCache();

        const user = await restoreSession();
        if (!user || !user.role) {
          console.log("[RESTORE SESSION FAIL] Restored user has no valid role:", user);
          console.log("[LOGIN FAIL] Restored user has no valid role.");
          toast("Account profile incomplete. Contact administrator.", "error", 6000);
          return;
        }

        console.log("[RESTORE SESSION SUCCESS] Authenticated successfully.");

        const { bootstrapMasterData, bootstrapUserData, startListeners } = await import("./core/adapter.js");

        const _tMaster = performance.now();
        await bootstrapMasterData();
        console.log(`[BOOT STEP] master data sync: ${Math.round(performance.now() - _tMaster)}ms`);

        const _tUser = performance.now();
        await bootstrapUserData();
        console.log(`[BOOT STEP] user data sync: ${Math.round(performance.now() - _tUser)}ms`);

        await startListeners();

        const onFirstRender = (evt) => {
          window.CICKANOPerf.dashboardRendered = performance.now();
          console.log(`[BOOT STEP] dashboard visible (fresh-login path)`);
        };
        window.addEventListener("app:route-rendered", onFirstRender, { once: true });
        showApp(user, { forceLanding: true });
      } catch (err) {
        console.log("[LOGIN FAIL] Exception during login sequence:", err.message);
        toast(err.message || "Login failed", "error", 4500);
      } finally {
        if (btn) {
          btn.disabled = false; btn.textContent = "Sign In";
        }
      }
    });

    const bioBtn = $("#bio-login-btn");
    if (bioBtn) {
      if (localStorage.getItem("CIC KANO:bio_default")) {
        bioBtn.style.display = "block";
      }
      bioBtn.addEventListener("click", async () => {
        try {
          bioBtn.disabled = true; bioBtn.innerHTML = "Authenticating...";
          const { email, password } = await loginWithBiometric();
          const loginEmail = $("#login-email");
          const loginPassword = $("#login-password");
          const loginForm = $("#login-form");
          if (loginEmail) loginEmail.value = email;
          if (loginPassword) loginPassword.value = password;
          if (loginForm) loginForm.dispatchEvent(new Event("submit", { cancelable: true }));
        } catch (err) {
          toast(err.message, "error");
        } finally {
          bioBtn.disabled = false; bioBtn.innerHTML = "<span style='font-size:18px;'>👤</span> Biometric Login";
        }
      });
    }

    const hwBtn = $("#hw-login-btn");
    const hwStatus = $("#hw-scanner-status");
    if (hwBtn && hwStatus) {
      setInterval(async () => {
        const loginView = $("#login-view");
        if (loginView && loginView.classList.contains("hidden")) return; // Stop polling if outside login screen

        const isAvailable = await fingerprintServiceAvailable();
        if (isAvailable) {
          hwStatus.textContent = "🟢 Scanner Connected";
          hwStatus.style.color = "var(--success)";
          hwBtn.style.display = "block";
          hwBtn.disabled = false;
        } else {
          hwStatus.textContent = "🔴 Scanner Disconnected";
          hwStatus.style.color = "var(--muted)";
          hwBtn.style.display = "none";
          hwBtn.disabled = true;
        }
      }, 2000);

      hwBtn.addEventListener("click", async () => {
        try {
          hwBtn.disabled = true; hwBtn.innerHTML = "Capturing...";
          const capture = await captureFingerprint();
          if (!capture.success) throw new Error(capture.error || "Capture failed");

          hwBtn.innerHTML = "Identifying...";
          const allPrints = db.list("fingerprints") || [];
          if (allPrints.length === 0) throw new Error("No fingerprints registered in the database.");

          const fmds = allPrints.map(f => f.template);
          const match = await identifyFingerprint(capture.template, fmds);

          if (!match.success) throw new Error(match.error || "Unrecognized Fingerprint");

          const matchedRecord = allPrints[match.matchIndex];
          const userRec = db.find("users", u => u.id === matchedRecord.ownerId || u.uid === matchedRecord.ownerId || u.staffId === matchedRecord.ownerId);

          if (!userRec) throw new Error("Fingerprint matched but user account not found.");

          let pwd = localStorage.getItem("CIC KANO:hw_pwd:" + userRec.email);
          if (!pwd) {
            pwd = prompt(`Welcome back, ${userRec.name || userRec.email}! Please enter your password to link your fingerprint:`);
            if (!pwd) throw new Error("Password required for first-time hardware login.");
            localStorage.setItem("CIC KANO:hw_pwd:" + userRec.email, pwd);
          }

          $("#login-email").value = userRec.email;
          $("#login-password").value = pwd;
          $("#login-form").dispatchEvent(new Event("submit", { cancelable: true }));

        } catch (err) {
          toast(err.message, "error");
        } finally {
          hwBtn.disabled = false; hwBtn.innerHTML = "<span style='font-size:18px;'>🖐️</span> Hardware Scanner Login";
        }
      });
    }

    window.CICKANOPerf = window.CICKANOPerf || {};
    window.CICKANOPerf.authStart = performance.now();
    const logoutBtn = $("#logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async (e) => { await logout(); showLogin(); });
    }
    const themeBtn = $("#theme-btn");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const t = (localStorage.getItem("CIC KANO:theme") || "light") === "light" ? "dark" : "light";
        localStorage.setItem("CIC KANO:theme", t); applyTheme();
      });
    }
    const menuBtn = $("#menu-btn");
    const sidebar = $("#sidebar");
    const scrim = $("#scrim");
    if (menuBtn && sidebar && scrim) {
      menuBtn.addEventListener("click", () => { sidebar.classList.toggle("open"); scrim.classList.toggle("hidden"); });
      scrim.addEventListener("click", () => { sidebar.classList.remove("open"); scrim.classList.add("hidden"); });
    }

    onAuthChange((user) => { if (!user) showLogin(); });

    // If no cached session, show login screen
    if (!fastUser) showLogin();
  }

  boot();

  // Register service worker for offline support
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js")
        .then((reg) => {
          console.log("[SW] Registered, scope:", reg.scope);
          reg.update();
        })
        .catch((err) => console.warn("[SW] Registration failed:", err));
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
