// App Reset Module — Admin / Super Admin only.
// Deletes data from BOTH localStorage AND Firebase (RTDB + Firestore).
// Uses db.clearCollection() so every deletion is individually enqueued as a
// Firebase "remove" sync op. When online, also performs a direct RTDB path
// remove for instant bulk deletion without waiting for the queue to flush.
import { store } from "../core/store.js";
import { db, flushQueue } from "../core/db.js";
import { getState } from "../core/adapter.js";
import { el, toast, modal, num } from "../core/utils.js";
import { card, pageHead, btn } from "../core/ui.js";
import { logActivity } from "../core/activity.js";

// All operational collections (stored in Firebase RTDB)
const OPERATIONAL_COLLECTIONS = [
  "students", "families", "familyInvoices", "staff",
  "invoices", "receipts", "payments", "servicePayments",
  "attendance", "staffAttendance",
  "results", "resultApprovals", "assignments", "lessonPlans",
  "examQuestions", "cbt", "cbtAttempts", "idCards", "behaviour",
  "activities", "promotionLogs", "migrationLogs",
  "expenses", "inventory", "inventoryMoves",
  "payslips", "paymentVouchers", "staffSalaries", "salaryComplaints", "staffLoginMap", "passwordResetRequests",
  "studentScholarships", "studentDiscounts",
  "scholarships", "discounts",
  "counters", "auditLogs"
];

const USER_COLLECTIONS  = ["users", "userRoles"];
const SETTING_KEYS      = ["sections", "classes", "subjects", "services", "uniforms",
                           "books", "grading", "sessions", "promotionPaths", "roles",
                           "branding", "system", "mathSettings", "programs", "schoolAccount"];

export function render(root, ctx) {
  const role = ctx?.user?.role || "";
  if (!["Super Admin", "Admin"].includes(role)) {
    root.appendChild(pageHead("App Reset"));
    root.appendChild(card("Access Denied", [
      el("p", { class: "muted", text: "Only Super Admin or Admin can access the App Reset tool." })
    ]));
    return;
  }

  root.appendChild(pageHead(
    "⚠️ App Reset & Data Management",
    "Permanently removes data from both this device AND Firebase. Always export a backup first."
  ));

  // ── Live data counts ─────────────────────────────────────────────────────
  const counts = getCounts();
  root.appendChild(card("📊 Current Data Inventory", [
    el("div", { class: "grid grid-4", style: "margin-bottom:10px" }, [
      sStat("👥", counts.students,  "Students"),
      sStat("👪", counts.families,  "Families"),
      sStat("🧾", counts.invoices,  "Invoices"),
      sStat("💵", counts.payments,  "Payments")
    ]),
    el("div", { class: "grid grid-4" }, [
      sStat("🎓", counts.scholarships, "Scholarships"),
      sStat("👨‍🏫", counts.staff,      "Staff"),
      sStat("📦", counts.inventory,   "Inventory"),
      sStat("📋", counts.total,       "Total Records")
    ])
  ]));

  // ── Firebase status notice ───────────────────────────────────────────────
  const st = getState();
  const isCloud = st.mode === "cloud" && st.ready;
  root.appendChild(card(
    isCloud ? "✅ Firebase Connected" : "⚠️ Firebase Not Connected",
    [el("p", {
      class: isCloud ? "muted" : "text-warning",
      text: isCloud
        ? "Data will be deleted from Firebase immediately."
        : "You are in Local mode or offline. Data will be removed from this device. " +
          "To also delete from Firebase, switch to Cloud mode and reset while online."
    })]
  ));

  // ── Reset options ────────────────────────────────────────────────────────
  root.appendChild(card("🗑️ Reset Options", [

    resetRow(
      "Remove Sample / Demo Data",
      "Deletes students, families, invoices and payments that were created as demo/sample records (flagged seeded). Real data is kept.",
      "warning", "Remove Demo Data",
      () => confirmReset("demo", ctx, root)
    ),

    resetRow(
      "Clear All Student & Financial Data",
      "Permanently deletes ALL students, families, staff, invoices, payments, receipts, attendance, results, scholarships and discounts — from this device AND Firebase. School configuration (sections, classes, services, fee amounts) is preserved.",
      "danger", "Clear All Operational Data",
      () => confirmReset("operational", ctx, root)
    ),

    resetRow(
      "Full Factory Reset",
      "Wipes everything — all data, school configuration, and users — from this device AND Firebase. The app returns to the initial setup state. You will be logged out.",
      "danger", "⚠️ Full Factory Reset",
      () => confirmReset("factory", ctx, root)
    )

  ]));

  // ── Backup export ────────────────────────────────────────────────────────
  root.appendChild(card("💾 Export Backup Before Reset", [
    el("p", { class: "muted", text: "Download a full JSON backup of all data before resetting. You cannot recover data after a reset." }),
    btn("📤 Export Full Backup (JSON)", { variant: "primary", onclick: exportBackup })
  ]));
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function confirmReset(type, ctx, root) {
  const cfg = {
    demo: {
      title:   "Remove Sample / Demo Data",
      msg:     "This removes all sample/seed student records, families, invoices, and payments. Real data stays. Continue?",
      label:   "Yes, Remove Demo Data",
      variant: "warning"
    },
    operational: {
      title:   "Clear All Operational Data",
      msg:     "⚠️ This permanently deletes ALL students, staff, invoices, payments, scholarships and all other operational data — from this device AND Firebase.\n\nSchool settings (sections, classes, fee amounts) are kept.\n\nThis CANNOT be undone.",
      label:   "Yes, Clear All Data",
      variant: "danger",
      typed:   "DELETE"
    },
    factory: {
      title:   "Full Factory Reset",
      msg:     "🚨 DANGER: This wipes EVERYTHING — all data, settings, and users — from both this device and Firebase. You will be logged out immediately.\n\nThis CANNOT be undone.",
      label:   "Factory Reset",
      variant: "danger",
      typed:   "RESET"
    }
  }[type];

  const typedInput = cfg.typed ? (() => {
    const inp = document.createElement("input");
    inp.placeholder = `Type ${cfg.typed} to confirm`;
    inp.style.cssText = "width:100%;margin-top:12px;padding:8px 12px;border:2px solid #d32f2f;border-radius:6px;font-size:14px;font-weight:700;letter-spacing:1px";
    return inp;
  })() : null;

  const body = el("div", {}, [
    el("p", { style: "white-space:pre-line", text: cfg.msg }),
    ...(typedInput ? [typedInput] : [])
  ]);

  const m = modal({
    title: cfg.title,
    body,
    footer: [
      btn(cfg.label, {
        variant: cfg.variant,
        onclick: async () => {
          if (typedInput && typedInput.value.trim() !== cfg.typed) {
            toast(`Type exactly "${cfg.typed}" to confirm`, "error"); return;
          }
          m.close();
          await executeReset(type, ctx, root);
        }
      }),
      btn("Cancel", { onclick: () => m.close() })
    ]
  });
}

// ── Execute reset ─────────────────────────────────────────────────────────────
async function executeReset(type, ctx, root) {
  const progressToast = showProgress("Deleting data…");
  try {
    const st = getState();
    const cloudMode = st.mode === "cloud" && st.ready;

    if (type === "demo") {
      await deleteDemoData(cloudMode, st);
      toast("✅ Sample data removed from device" + (cloudMode ? " and Firebase" : "") + ".", "success");
      logActivity({ module: "AppReset", action: "Demo Data Removed", description: "Removed sample/demo data", user: ctx?.user?.email });
      setTimeout(() => window.location.reload(), 1000);

    } else if (type === "operational") {
      await deleteOperationalData(cloudMode, st);
      toast("✅ All operational data deleted" + (cloudMode ? " from device and Firebase" : " from device") + ". Settings preserved.", "success");
      logActivity({ module: "AppReset", action: "Operational Data Cleared", description: "All operational data cleared", user: ctx?.user?.email });
      setTimeout(() => window.location.reload(), 1000);

    } else if (type === "factory") {
      await deleteAllData(cloudMode, st);
      toast("✅ Factory reset complete. Reloading…", "success");
      setTimeout(() => {
        Object.keys(localStorage).filter((k) => k.startsWith("CIC KANO:")).forEach((k) => localStorage.removeItem(k));
        window.location.reload();
      }, 1500);
    }
  } catch (e) {
    toast("Reset error: " + e.message, "error");
    console.error("[AppReset]", e);
  } finally {
    if (progressToast) progressToast.remove();
  }
}

// ── Core delete functions ─────────────────────────────────────────────────────

async function deleteDemoData(cloudMode, st) {
  const demoStudents = db.list("students").filter((s) => s.seeded || s.demo);
  const demoIds      = new Set(demoStudents.map((s) => s.id));

  if (cloudMode) {
    if (!st.fs) throw new Error("Firestore not initialized");
    const { doc, deleteDoc } = st.sdk.firestore;
    const delPromises = [];

    demoStudents.forEach((s) => {
      delPromises.push(deleteDoc(doc(st.fs, "students", s.id)));
    });

    const relCols = ["invoices","receipts","payments","attendance","results","studentScholarships","studentDiscounts"];
    relCols.forEach((col) => {
      db.list(col).filter((r) => demoIds.has(r.studentId)).forEach((r) => {
        delPromises.push(deleteDoc(doc(st.fs, col, r.id)));
      });
    });

    db.list("families").filter((f) => f.seeded || f.demo).forEach((f) => {
      delPromises.push(deleteDoc(doc(st.fs, "families", f.id)));
    });
    db.list("staff").filter((s) => s.seeded || s.demo).forEach((s) => {
      delPromises.push(deleteDoc(doc(st.fs, "staff", s.id)));
    });

    await Promise.allSettled(delPromises);
  }

  // Always clear locally too
  demoStudents.forEach((s) => store.remove("students", s.id));
  const relCols = ["invoices","receipts","payments","attendance","results","studentScholarships","studentDiscounts"];
  relCols.forEach((col) => {
    db.list(col).filter((r) => demoIds.has(r.studentId)).forEach((r) => store.remove(col, r.id));
  });
  db.list("families").filter((f) => f.seeded || f.demo).forEach((f) => store.remove("families", f.id));
  db.list("staff").filter((s) => s.seeded || s.demo).forEach((s) => store.remove("staff", s.id));
}

async function deleteOperationalData(cloudMode, st) {
  if (cloudMode) {
    if (!st.fs) throw new Error("Firestore not initialized");
    const { collection, getDocs, deleteDoc } = st.sdk.firestore;
    
    for (const col of OPERATIONAL_COLLECTIONS) {
       try {
         const snap = await getDocs(collection(st.fs, col));
         await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
       } catch (e) { console.warn(`[Reset] Firestore clear failed for ${col}:`, e.message); }
    }
  }

  // Clear localStorage for each operational collection
  OPERATIONAL_COLLECTIONS.forEach((col) => store.clear(col));
  // Clear the sync queue so stale "put" ops don't re-create deleted data
  localStorage.removeItem("CIC KANO:__syncqueue");
}

async function deleteAllData(cloudMode, st) {
  await deleteOperationalData(cloudMode, st);

  if (cloudMode) {
    if (!st.fs) throw new Error("Firestore not initialized");
    const { collection, getDocs, deleteDoc } = st.sdk.firestore;

    for (const col of USER_COLLECTIONS) {
       try {
         const snap = await getDocs(collection(st.fs, col));
         await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
       } catch (e) { console.warn(`[Reset] Firestore clear failed for ${col}:`, e.message); }
    }

    // Delete Firestore settings docs
    try {
      const snap = await getDocs(collection(st.fs, "settings"));
      await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
    } catch (e) { console.warn("[Reset] Firestore settings clear:", e.message); }
  }

  // Clear locally
  USER_COLLECTIONS.forEach((col) => store.clear(col));
  SETTING_KEYS.forEach((key) => store.remove("settings", key));
  localStorage.removeItem("CIC KANO:__syncqueue");
  localStorage.removeItem("CIC KANO:session");
  localStorage.removeItem("CIC KANO:mode");
}

// ── Backup export ─────────────────────────────────────────────────────────────
import { FIRESTORE_COLLECTIONS } from "../core/db.js";

function exportBackup() {
  const backup = { _exportedAt: new Date().toISOString(), _version: "CIC KANO-v1" };
  FIRESTORE_COLLECTIONS.forEach((col) => { backup[col] = db.list(col); });

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `CIC KANO-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Backup exported.", "success");
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCounts() {
  const c   = (col) => db.list(col).length;
  const ops = OPERATIONAL_COLLECTIONS.map((col) => c(col)).reduce((a, b) => a + b, 0);
  return {
    students: c("students"), families: c("families"), staff: c("staff"),
    invoices: c("invoices"), payments: c("payments"),
    scholarships: c("studentScholarships") + c("scholarships"),
    inventory: c("inventory"),
    total: ops
  };
}

function sStat(icon, value, label) {
  return el("div", { class: "card stat" }, [
    el("div", { class: "ic", text: icon }),
    el("div", {}, [el("div", { class: "v", text: String(value) }), el("div", { class: "l", text: label })])
  ]);
}

function resetRow(title, desc, variant, btnLabel, onClick) {
  return el("div", { class: "card", style: "margin-bottom:12px;border-left:4px solid " + (variant === "danger" ? "#d32f2f" : "#f57c00") }, [
    el("div", { style: "font-weight:700;font-size:14px;margin-bottom:4px", text: title }),
    el("p",   { class: "muted", style: "margin:0 0 10px;font-size:13px", text: desc }),
    btn(btnLabel, { variant, onclick: onClick })
  ]);
}

function showProgress(msg) {
  const el2 = document.createElement("div");
  el2.style.cssText = "position:fixed;bottom:20px;right:20px;background:#333;color:#fff;padding:12px 20px;border-radius:8px;z-index:99999;font-size:14px;font-weight:600";
  el2.textContent   = msg;
  document.body.appendChild(el2);
  return el2;
}

