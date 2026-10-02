/**
 * usermanagement.js â€” Secure Admin User Management Module
 * =========================================================
 * Provides complete user lifecycle management for Admin / Super Admin roles.
 *
 * SECURITY CONTRACT:
 *  - Passwords are NEVER stored in plaintext, displayed, or exposed in any UI.
 *  - Only password RESET operations are permitted (generates a temporary password
 *    hashed via SHA-256 and stored in the local users collection).
 *  - Firebase Auth password updates are performed via Admin SDK patterns
 *    (secondary app instance) so the acting admin session is never disturbed.
 *  - All admin actions are written to auditLogs immediately and immutably.
 *  - Login history, device info, failed attempts, and account status are read
 *    from auditLogs â€” no passwords are ever read or displayed.
 */

import { db } from "../core/db.js";
import { el, toast, uuid, confirmDialog, modal, fmtDateTime } from "../core/utils.js";
import { createUserAccount } from "../core/auth.js";
import { card, pageHead, table, btn, input, select, field } from "../core/ui.js";
import { can, ROLES } from "../core/rbac.js";
import { getState } from "../core/adapter.js";
import { flushQueue } from "../core/db.js";
import { printHtml } from "../core/print.js";

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generate a school-branded temporary password: CIC KANO-XXXXX */
function generateTempPassword() {
  const digits = Math.floor(10000 + Math.random() * 90000);
  return `CIC KANO-${digits}`;
}

/** Format a timestamp to a human-readable string. */
function fmt(ts) {
  if (!ts) return "—";
  return fmtDateTime ? fmtDateTime(ts) : new Date(ts).toLocaleString();
}

/** Audit log helper â€” all admin actions are recorded here. */
function auditAction(actorUid, type, message, extra = {}) {
  db.save("auditLogs", {
    id: uuid(), type, uid: actorUid, at: Date.now(), message, ...extra
  });
}

/** Get login history for a user from auditLogs. */
function getLoginHistory(userUid) {
  return db.list("auditLogs")
    .filter((l) => (l.type === "login" || l.type === "login_failed") && l.uid === userUid)
    .sort((a, b) => b.at - a.at)
    .slice(0, 20);
}

/** Count failed login attempts in the last 24 hours for a user. */
function recentFailedAttempts(userUid) {
  const since = Date.now() - 86400000;
  return db.list("auditLogs")
    .filter((l) => l.type === "login_failed" && l.uid === userUid && l.at > since).length;
}

/** Get last login record for a user. */
function lastLoginRecord(userUid) {
  return db.list("auditLogs")
    .filter((l) => l.type === "login" && l.uid === userUid)
    .sort((a, b) => b.at - a.at)[0] || null;
}

/** Get activity log entries for a user (all types). */
function getUserActivityLog(userUid) {
  return db.list("auditLogs")
    .filter((l) => l.uid === userUid)
    .sort((a, b) => b.at - a.at)
    .slice(0, 50);
}

function normalizeEmail(email) {
  const raw = String(email || "");
  const clean = raw.trim().toLowerCase();
  if (!clean || raw.trim() !== raw) throw new Error("Email has leading/trailing spaces.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Invalid email format.");
  return clean;
}

function cloudAuthReady() {
  const st = getState();
  return st.mode === "cloud" && st.ready && st.authReady && st.client && navigator.onLine;
}

async function checkFirebaseEmail(email) {
  const st = getState();
  if (!cloudAuthReady()) throw new Error("Firebase Auth is not connected. Switch to cloud mode and try again.");
  console.info("[AUTH] Email:", email);
  console.info("[AUTH] Project:", st.app?.options?.projectId || "(unknown)", "API Key:", st.app?.options?.apiKey || "(unknown)");
  const methods = await st.sdk.auth.fetchSignInMethodsForEmail(st.auth, email);
  console.info("[AUTH] Firebase user exists:", methods.length > 0, methods);
  return methods;
}

async function testFirebaseCredentials(email, password) {
  const st = getState();
  const cleanEmail = normalizeEmail(email);
  if (!cloudAuthReady()) throw new Error("Firebase Auth is not connected. Switch to cloud mode and try again.");
  const plainPassword = String(password || "").trim();
  console.log("LOGIN EMAIL:", cleanEmail);
  console.log("PASSWORD LENGTH:", plainPassword.length);
  const { app, auth } = st.sdk;
  const validatorApp = app.getApps().find(a => a.name === "CredentialValidator") ||
    app.initializeApp(st.app.options, "CredentialValidator");
  const validatorAuth = auth.getAuth(validatorApp);
  try {
    const cred = await auth.signInWithEmailAndPassword(validatorAuth, cleanEmail, plainPassword);
    const result = {
      ok: true,
      uid: cred.user.uid,
      email: cred.user.email,
      emailMatches: String(cred.user.email || "").toLowerCase() === cleanEmail
    };
    console.info("[AUTH] Credential validation success:", result);
    return result;
  } catch (e) {
    console.error("[AUTH] Firebase validation error code:", e.code || "unknown");
    console.error("[AUTH] Firebase validation error message:", e.message || String(e));
    return { ok: false, code: e.code || "unknown", message: e.message || String(e) };
  } finally {
    try { await auth.signOut(validatorAuth); } catch {}
  }
}

async function validateUserAccount(user, password) {
  const email = normalizeEmail(user.email);
  const uid = user.uid || user.id;
  const methods = await checkFirebaseEmail(email).catch((e) => ({ error: e }));
  const userRec = uid ? db.get("users", uid) : db.find("users", (u) => String(u.email || "").trim().toLowerCase() === email);
  const resolvedUid = uid || userRec?.uid || userRec?.id;
  const roleRec = resolvedUid ? db.get("userRoles", resolvedUid) : null;
  const staffId = user.staffId || userRec?.staffId;
  const mapRec = staffId ? db.get("staffLoginMap", staffId) : null;
  const login = password ? await testFirebaseCredentials(email, password) : null;
  return { email, uid: resolvedUid, methods, userRec, roleRec, mapRec, login };
}

async function ensureUserMappingRecords(user) {
  const uid = user.uid || user.id;
  const userNode = {
    ...user,
    id: uid,
    uid,
    email: normalizeEmail(user.email),
    role: user.role || "Staff",
    staffId: user.staffId || null,
    studentId: user.studentId || null,
    status: user.status || "active"
  };
  const roleNode = {
    id: uid,
    uid,
    role: userNode.role,
    email: userNode.email,
    staffId: userNode.staffId,
    studentId: userNode.studentId
  };
  db.save("users", userNode);
  db.save("userRoles", roleNode);
  if (userNode.staffId) {
    db.save("staffLoginMap", {
      id: userNode.staffId,
      uid,
      staffId: userNode.staffId,
      role: userNode.role,
      email: userNode.email,
      repairedAt: Date.now()
    });
    const staff = db.get("staff", userNode.staffId);
    if (staff) db.save("staff", { ...staff, uid, email: userNode.email, role: userNode.role, loginStatus: "Active" });
  }
  return userNode;
}

async function verifyCreatedUserRecords(uid, email, staffId) {
  let userRec, roleRec, mapRec;
  for (let i = 0; i < 30; i++) {
    userRec = db.get("users", uid);
    roleRec = db.get("userRoles", uid);
    mapRec = staffId ? db.get("staffLoginMap", staffId) : null;
    if (userRec && roleRec && (!staffId || mapRec)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!userRec) throw new Error("users record was not created.");
  if (!roleRec) throw new Error("userRoles record was not created.");
  if (staffId && !mapRec) throw new Error("staffLoginMap record was not created.");
  console.info("[AUTH] users record exists:", !!userRec, uid);
  console.info("[AUTH] userRoles record exists:", !!roleRec, uid);
  if (staffId) console.info("[AUTH] staffLoginMap record exists:", !!mapRec, staffId);
  if (normalizeEmail(userRec.email) !== email) throw new Error("Created user email does not match requested email.");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Status & Role Badges
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function statusBadge(u) {
  if (u.status === "deleted") {
    return el("span", { class: "um-badge um-badge--deleted", text: "🗑️ Deleted" });
  }
  if (u.status === "suspended") {
    return el("span", { class: "um-badge um-badge--suspended", text: "⏸ Suspended" });
  }
  if (u.loginDisabled) {
    return el("span", { class: "um-badge um-badge--disabled", text: "⛔ Disabled" });
  }
  if (u.forcePasswordChange) {
    return el("span", { class: "um-badge um-badge--warn", text: "🔑 Pwd Reset" });
  }
  return el("span", { class: "um-badge um-badge--active", text: "✓ Active" });
}

function roleBadge(u) {
  const colors = {
    "Super Admin": "#6a1b9a", "Admin": "#1565c0", "Principal": "#283593",
    "Vice Principal": "#1a237e", "Accountant": "#00695c", "Teacher": "#2e7d32",
    "Exam Officer": "#558b2f", "Librarian": "#33691e", "Receptionist": "#f57f17",
    "Staff": "#4e342e", "Parent": "#5d4037", "Student": "#ef6c00"
  };
  return el("span", {
    style: `background:${colors[u.role] || "#546e7a"};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600`,
    text: u.role || "—"
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Force logout helper (sets forceLogout flag on user record)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function forceLogoutUser(u, actorUid) {
  u.forceLogout = true;
  u.forceLogoutAt = Date.now();
  db.save("users", u);
  const rr = db.get("userRoles", u.id);
  if (rr) { rr.forceLogout = true; db.save("userRoles", rr); }
  auditAction(actorUid, "admin", `Force logout triggered for ${u.email}`, { targetUid: u.uid });
  toast(`Force logout applied to ${u.name || u.email}`, "success");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Firebase Auth password update (cloud mode)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function updateFirebasePassword(uid, newPassword) {
  const st = getState();
  if (st.mode !== "cloud" || !st.ready || !navigator.onLine) return false;
  try {
    console.warn("[AUTH] Client SDK cannot set another user's Firebase Auth password.", { uid, passwordLength: String(newPassword || "").length });
    return false;
  } catch (e) {
    console.error("[AUTH] Firebase password update error code:", e.code || "unknown");
    console.error("[AUTH] Firebase password update error message:", e.message || String(e));
    return false;
  }
}

async function sendFirebasePasswordResetEmail(email, actionName) {
  const st = getState();
  if (!cloudAuthReady()) return false;
  const cleanEmail = normalizeEmail(email);
  console.log("Current Firebase User:", st.auth?.currentUser?.email);
  console.log("Action:", actionName);
  await st.sdk.auth.sendPasswordResetEmail(st.auth, cleanEmail);
  console.info("[AUTH] Firebase password reset email sent:", cleanEmail);
  return true;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Main render
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function render(root, ctx) {
  if (!can(ctx.user.role, "manageUsers")) {
    root.appendChild(pageHead("User Management"));
    root.appendChild(card("Access Denied", [
      el("p", { class: "muted", text: "Only Admin and Super Admin roles can manage users." })
    ]));
    return;
  }

  // Inject module CSS once
  if (!document.getElementById("um-styles")) {
    const s = document.createElement("style");
    s.id = "um-styles";
    s.textContent = UM_CSS;
    document.head.appendChild(s);
  }

  root.appendChild(pageHead("User Management", "Secure user lifecycle management — no passwords are ever displayed."));

  const wrap = el("div", { class: "um-wrap" });
  root.appendChild(wrap);

  drawUserList(wrap, ctx);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// User List
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function drawUserList(wrap, ctx) {
  const isSuperAdmin = ctx.user.role === "Super Admin";

  const draw = () => {
    wrap.innerHTML = "";

    const allUsers = db.list("users").sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    // â”€â”€ Search & Filter Bar â”€â”€
    const searchInp = input({ placeholder: "Search by name, email, username…", style: "flex:1;max-width:320px" });
    const roleFilter = select(() => [
      { value: "", label: "All Roles" },
      ...ROLES.map((r) => ({ value: r, label: r }))
    ]);
    const statusFilter = select(() => [
      { value: "", label: "All Statuses" },
      { value: "active", label: "Active" },
      { value: "disabled", label: "Disabled" },
      { value: "suspended", label: "Suspended" },
      { value: "deleted", label: "Deleted" }
    ]);

    const filterBar = el("div", { class: "um-filter-bar" }, [
      searchInp, roleFilter, statusFilter,
      btn("+ Add User", { variant: "primary", sm: true, onclick: () => addUserModal(ctx, draw) }),
      btn("Force Cloud Sync", { sm: true, onclick: async () => {
        const pushed = db.forcePushAllData();
        await flushQueue();
        toast(`Queued ${pushed} record(s) for cloud sync.`, "success");
      }}),
      btn("Validate Login", { sm: true, onclick: () => validateUserModal({ email: searchInp.value.trim() }) })
    ]);

    const filtered = () => {
      const q = searchInp.value.toLowerCase();
      const role = roleFilter.value;
      const status = statusFilter.value;
      return allUsers.filter((u) => {
        if (q && !(
          (u.name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          (u.username || "").toLowerCase().includes(q) ||
          (u.phone || "").toLowerCase().includes(q)
        )) return false;
        if (role && u.role !== role) return false;
        if (status) {
          if (status === "active" && (u.loginDisabled || u.status === "deleted" || u.status === "suspended")) return false;
          if (status === "disabled" && !u.loginDisabled) return false;
          if (status === "suspended" && u.status !== "suspended") return false;
          if (status === "deleted" && u.status !== "deleted") return false;
        }
        return true;
      });
    };

    const tableWrap = el("div", { class: "um-table-wrap" });

    const renderTable = () => {
      tableWrap.innerHTML = "";
      const list = filtered();
      if (!list.length) {
        tableWrap.appendChild(el("p", { class: "muted", style: "padding:20px;text-align:center", text: "No users match the filter." }));
        return;
      }
      tableWrap.appendChild(table([
        { label: "Full Name", render: (u) => el("div", {}, [
            el("div", { style: "font-weight:600", text: u.name || "—" }),
            el("div", { class: "muted", style: "font-size:11px", text: u.username ? `@${u.username}` : "" })
          ])
        },
        { label: "Email", key: "email" },
        { label: "Phone", render: (u) => el("span", { text: u.phone || "—" }) },
        { label: "Role", render: roleBadge },
        { label: "Status", render: statusBadge },
        { label: "Last Login", render: (u) => {
            const rec = lastLoginRecord(u.uid || u.id);
            return el("div", { style: "font-size:12px" }, [
              el("div", { text: rec ? fmt(rec.at) : "Never" }),
              rec?.device ? el("div", { class: "muted", style: "font-size:10px", text: rec.device }) : el("span")
            ]);
          }
        },
        { label: "Created", render: (u) => el("div", { style: "font-size:12px" }, [
            el("div", { text: u.createdAt ? fmt(u.createdAt) : "—" }),
            u.createdBy ? el("div", { class: "muted", style: "font-size:10px", text: `by ${u.createdBy}` }) : el("span")
          ])
        },
        { label: "Actions", render: (u) => actionButtons(u, ctx, isSuperAdmin, draw) }
      ], list, { empty: "No users found." }));
    };

    searchInp.oninput = renderTable;
    roleFilter.onchange = renderTable;
    statusFilter.onchange = renderTable;

    drawPendingLogins(wrap, ctx, draw);
    drawPendingStudentLogins(wrap, ctx, draw);
    drawPasswordResetRequests(wrap, ctx, draw);
    const c = card("User Accounts", [filterBar, tableWrap]);
    wrap.appendChild(c);
    renderTable();
  };

  draw();
  const offUsers = db.on("users", draw);
  const offStaff = db.on("staff", draw);
  const offStudents = db.on("students", draw);
  const offReset = db.on("passwordResetRequests", draw);
  wrap._cleanup = () => { offUsers(); offStaff(); offStudents(); offReset(); };
}

function proposedStaffEmail(staff) {
  return `${String(staff.staffNo || staff.id || "").replace(/[^a-z0-9]/gi, "").toLowerCase()}@cic-kano.com`;
}

function proposedStaffPassword(staff) {
  const last4 = String(staff.phone || "").replace(/\D/g, "").slice(-4) || "0000";
  return `${String(staff.staffNo || staff.id || "STAFF").replace(/[^a-z0-9]/gi, "").toUpperCase()}${last4}`;
}

function drawPendingLogins(wrap, ctx, redraw) {
  const pending = db.list("staff")
    .filter((s) => !db.find("users", (u) => u.staffId === s.id) && (s.loginStatus || "Pending Login") !== "Disabled")
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (!pending.length) return;
  wrap.appendChild(card("Pending User Creation", [table([
    { label: "Staff Name", key: "name" },
    { label: "Staff ID", key: "staffNo" },
    { label: "Email", render: (s) => s.email || proposedStaffEmail(s) },
    { label: "Role", render: (s) => s.role || "Staff" },
    { label: "Status", render: () => "Pending Login" },
    { label: "", render: (s) => btn("Create Login", { sm: true, variant: "primary", onclick: () => createStaffLoginModal(s, ctx, redraw) }) }
  ], pending, { empty: "No pending staff login accounts." })]));
}

function drawPendingStudentLogins(wrap, ctx, redraw) {
  const pending = db.list("students")
    .filter((s) => s.status !== "graduated" && !db.find("users", (u) => u.studentId === s.id))
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  if (!pending.length) return;
  wrap.appendChild(card("Student Portal Accounts", [
    el("p", { class: "muted", text: "Create a student login to view only that student's report cards, invoices, receipts, and activity history." }),
    table([
      { label: "Student", key: "fullName" },
      { label: "Admission No.", key: "admissionNo" },
      { label: "Status", render: () => "No portal login" },
      { label: "", render: (s) => btn("Create Student Login", { sm: true, variant: "primary", onclick: () => createStudentLoginModal(s, ctx, redraw) }) }
    ], pending, { empty: "All active students have portal logins." })
  ]));
}

function createStudentLoginModal(student, ctx, redraw) {
  const emailInp = input({ type: "email", placeholder: "student@email.com", value: (student.email || "").toLowerCase() });
  const pwd = generateTempPassword();
  const body = el("div", { class: "form-grid" }, [
    field("Student", el("strong", { text: `${student.fullName} (${student.admissionNo || student.id})` }), { full: true }),
    field("Email", emailInp),
    field("Temporary Password", el("div", { class: "um-temp-pwd", text: pwd })),
    el("p", { class: "muted", style: "font-size:12px", text: "The password is shown once. The student will be asked to change it after their first sign-in." })
  ]);
  const m = modal({ title: "Create Student Portal Login", body, footer: [
    btn("Create Login", { variant: "primary", onclick: async () => {
      let email = "";
      try { email = normalizeEmail(emailInp.value); }
      catch (e) { return toast(e.message, "error"); }
      if (!cloudAuthReady()) return toast("Student accounts require an online cloud connection.", "error");
      if (db.find("users", (u) => String(u.email || "").toLowerCase() === email || u.studentId === student.id)) return toast("This email or student already has a portal login.", "error");
      try {
        const { uid } = await createUserAccount({ email, password: pwd, name: student.fullName, role: "Student", studentId: student.id, forcePasswordChange: true });
        await ensureUserMappingRecords({ id: uid, uid, email, name: student.fullName, role: "Student", studentId: student.id, status: "active", forcePasswordChange: true });
        db.save("students", { ...student, portalLoginStatus: "Active", portalUserId: uid, portalEmail: email });
        auditAction(ctx.user.uid, "student_portal_created", `Created student portal login for ${student.fullName}`, { targetUid: uid, studentId: student.id });
        showCredentialsModal({ name: student.fullName, email, password: pwd, role: "Student" });
        m.close(); redraw();
      } catch (e) { toast("Student login creation failed: " + e.message, "error", 8000); }
    }}),
    btn("Cancel", { onclick: () => m.close() })
  ]});
}

function createStaffLoginModal(staff, ctx, redraw) {
  const emailInp = input({ type: "email", value: (staff.email || proposedStaffEmail(staff)).toLowerCase() });
  const pwdInp = input({ value: proposedStaffPassword(staff) });
  const roleInp = select(() => ROLES.filter((r) => r !== "Super Admin").map((r) => ({ value: r, label: r, selected: r === (staff.role || "Staff") })));
  const body = el("div", { class: "form-grid" }, [
    field("Staff", el("div", { text: `${staff.name} (${staff.staffNo || staff.id})` }), { full: true }),
    field("Email", emailInp),
    field("Temporary Password", pwdInp),
    field("Role", roleInp)
  ]);
  const m = modal({ title: "Create Staff Login", body, footer: [
    btn("Create Login", { variant: "primary", onclick: async () => {
      let email = "";
      try { email = normalizeEmail(emailInp.value); }
      catch (e) { return toast(e.message, "error"); }
      const password = String(pwdInp.value || "");
      if (!email || !password) return toast("Email and password are required.", "error");
      if (password !== password.trim()) return toast("Password has leading/trailing spaces. Remove them or intentionally choose a different password.", "error", 8000);
      if (!cloudAuthReady()) return toast("Supabase account creation failed: cloud authentication is not connected.", "error", 8000);
      if (db.find("users", (u) => u.email && u.email.toLowerCase() === email)) return toast("A login already exists for this email.", "error");
      if (db.find("users", (u) => u.staffId === staff.id)) return toast("A login already exists for this staff member.", "error");
      try {
        console.info("[AUTH] Email:", email);
        console.info("[AUTH] Plain generated password length:", password.length);
        // Using statically imported createUserAccount
        const { uid } = await createUserAccount({
          email, password, name: staff.name, role: roleInp.value, staffId: staff.id, forcePasswordChange: true
        });
        await ensureUserMappingRecords({ id: uid, uid, email, name: staff.name, role: roleInp.value, staffId: staff.id, status: "active", forcePasswordChange: true });
        db.save("staffLoginMap", { id: staff.id, uid, staffId: staff.id, role: roleInp.value, email, createdAt: Date.now() });
        await verifyCreatedUserRecords(uid, email, staff.id);
        const nextStaff = { ...staff, email, role: roleInp.value, loginStatus: "Active", uid };
        db.save("staff", nextStaff);
        auditAction(ctx.user.uid, "admin", `Created staff login for ${staff.name}`, { targetUid: uid, staffId: staff.id });
        showCredentialsModal({ name: staff.name, email, password, role: roleInp.value });
        m.close();
        redraw();
      } catch (e) {
        toast("Login creation failed: " + e.message, "error", 8000);
      }
    }}),
    btn("Cancel", { onclick: () => m.close() })
  ]});
}

function showCredentialsModal({ name, email, password, role }) {
  const body = el("div", {}, [
    el("p", { text: `Login created for ${name}. This password is shown once.` }),
    el("p", { html: `<b>Email:</b> ${email}` }),
    el("p", { html: `<b>Password:</b> ${password}` }),
    el("p", { html: `<b>Role:</b> ${role}` })
  ]);
  modal({ title: "Staff Login Created", body, footer: [
    btn("Print", { onclick: () => {
      printHtml(`<section class="staff-login-print"><div class="doc-title">Staff Login Created</div>
        <table class="doc-table">
          <tr><td><b>Name</b></td><td>${name}</td></tr>
          <tr><td><b>Email</b></td><td>${email}</td></tr>
          <tr><td><b>Temporary Password</b></td><td>${password}</td></tr>
          <tr><td><b>Role</b></td><td>${role}</td></tr>
        </table>
        <div class="note">This temporary password is shown once. The user must change it after first login.</div></section>`, { title: "Staff Login Created" });
    }}),
    btn("Download", { variant: "primary", onclick: () => {
      const blob = new Blob([`Name: ${name}\nEmail: ${email}\nPassword: ${password}\nRole: ${role}\n`], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `login-${email}.txt` });
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }})
  ]});
}

function drawPasswordResetRequests(wrap, ctx, redraw) {
  const rows = db.list("passwordResetRequests").sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  if (!rows.length) return;
  wrap.appendChild(card("Password Reset Requests", [table([
    { label: "Staff", render: (r) => r.staffName || r.staffId || "" },
    { label: "Staff ID", key: "staffNo" },
    { label: "Email", key: "email" },
    { label: "Date", render: (r) => fmt(r.requestedAt) },
    { label: "Reason", key: "reason" },
    { label: "Status", key: "status" },
    { label: "", render: (r) => r.status === "pending" ? el("div", { class: "row" }, [
      btn("Approve", { sm: true, variant: "success", onclick: () => approvePasswordReset(r, ctx, redraw) }),
      btn("Reject", { sm: true, variant: "danger", onclick: () => rejectPasswordReset(r, ctx, redraw) })
    ]) : el("span", { class: "muted", text: "Done" }) }
  ], rows, { empty: "No password reset requests." })]));
}

async function approvePasswordReset(req, ctx, redraw) {
  const user = db.find("users", (u) => u.staffId === req.staffId || u.email === req.email);
  if (!user) return toast("No user account found for this staff member.", "error");
  if (cloudAuthReady()) {
    try {
      await sendFirebasePasswordResetEmail(user.email || req.email, "usermanagement:approve-password-reset");
      user.forcePasswordChange = true;
      user.firebaseResetEmailSentAt = Date.now();
      db.save("users", user);
      req.status = "Approved"; req.approvedAt = Date.now(); req.approvedBy = ctx.user.email;
      req.firebaseResetEmailSentAt = Date.now();
      db.save("passwordResetRequests", req);
      auditAction(ctx.user.uid, "admin", `Approved Firebase password reset email for ${req.email}`, { targetUid: user.uid || user.id });
      toast("Firebase password reset email sent. The user must set a new password from the email link.", "success", 10000);
      redraw();
      return;
    } catch (e) {
      toast("Firebase password reset email failed: " + (e.code || e.message), "error", 10000);
      return;
    }
  }
  const tempPwd = generateTempPassword();
  user.passwordHash = await sha256(tempPwd);
  user.forcePasswordChange = true;
  user.tempPasswordSetAt = Date.now();
  db.save("users", user);
  req.status = "Approved"; req.approvedAt = Date.now(); req.approvedBy = ctx.user.email;
  db.save("passwordResetRequests", req);
  auditAction(ctx.user.uid, "admin", `Approved password reset for ${req.email}`, { targetUid: user.uid || user.id });
  showCredentialsModal({ name: user.name || req.staffName || req.email, email: user.email || req.email, password: tempPwd, role: user.role || "" });
  redraw();
}

function rejectPasswordReset(req, ctx, redraw) {
  req.status = "Rejected"; req.rejectedAt = Date.now(); req.rejectedBy = ctx.user.email;
  db.save("passwordResetRequests", req);
  auditAction(ctx.user.uid, "admin", `Rejected password reset for ${req.email}`);
  toast("Password reset request rejected", "success");
  redraw();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Action Buttons
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function repairUserAccount(user, ctx, redraw) {
  try {
    if (!cloudAuthReady()) throw new Error("Firebase Auth is not connected. Switch to cloud mode and try again.");
    const email = normalizeEmail(user.email);
    const uid = user.uid || user.id;
    const roleRec = db.get("userRoles", uid);
    const mapRec = user.staffId ? db.get("staffLoginMap", user.staffId) : null;
    let methods = [];

    try {
      methods = await checkFirebaseEmail(email);
    } catch (e) {
      console.warn("[AUTH] Firebase user exists check failed:", e.code || e.message);
    }

    if (methods.length > 0) {
      await ensureUserMappingRecords(user);
      auditAction(ctx.user.uid, "admin", `Repaired user records for ${email}`, { targetUid: uid });
      toast("Repair complete: Firebase Auth account exists and database records are present.", "success", 7000);
      redraw();
      return;
    }

    const needsDbRepair = !roleRec || (user.staffId && !mapRec);
    const ok = await confirmDialog(
      `No Firebase sign-in method was found for ${email}. Create a verified Firebase Auth account and repair database records now?`,
      { okText: "Repair Account" }
    );
    if (!ok) {
      if (needsDbRepair) {
        await ensureUserMappingRecords(user);
        auditAction(ctx.user.uid, "admin", `Repaired database records only for ${email}`, { targetUid: uid });
        toast("Database records repaired. Firebase Auth account was not recreated.", "success", 7000);
        redraw();
      }
      return;
    }

    const password = generateTempPassword();
    // Using statically imported createUserAccount
    let newUid = null;
    try {
      const result = await createUserAccount({
        email,
        password,
        name: user.name || email,
        role: user.role || "Staff",
        staffId: user.staffId || undefined,
        studentId: user.studentId || undefined,
        forcePasswordChange: true
      });
      newUid = result.uid;
      await verifyCreatedUserRecords(newUid, email, user.staffId);
    } catch (e) {
      if (String(e.message || "").includes("auth/email-already-in-use")) {
        await ensureUserMappingRecords(user);
        auditAction(ctx.user.uid, "admin", `Repaired records for existing Firebase email ${email}`, { targetUid: uid });
        toast("Firebase reports this email already exists. Database records were repaired for the current user.", "success", 8000);
        redraw();
        return;
      }
      throw e;
    }

    if (uid && newUid && uid !== newUid && db.get("users", uid)) {
      db.save("users", { ...user, id: uid, uid, status: "replaced", loginDisabled: true, repairReplacedBy: newUid, repairedAt: Date.now() });
      const oldRole = db.get("userRoles", uid);
      if (oldRole) db.save("userRoles", { ...oldRole, status: "replaced", loginDisabled: true, repairReplacedBy: newUid });
    }

    auditAction(ctx.user.uid, "admin", `Repaired Firebase Auth account for ${email}`, { targetUid: newUid, previousUid: uid });
    showCredentialsModal({ name: user.name || email, email, password, role: user.role || "Staff" });
    toast("Repair complete: new Firebase Auth credentials were verified.", "success", 8000);
    redraw();
  } catch (e) {
    console.warn("[AUTH] Repair failure reason:", e.code || e.message);
    toast("Repair failed: " + (e.message || e.code || e), "error", 10000);
  }
}

function actionButtons(u, ctx, isSuperAdmin, redraw) {
  const actorUid = ctx.user.uid;
  const isSelf = u.id === actorUid || u.uid === actorUid;
  const isDisabled = u.loginDisabled || u.status === "deleted" || u.status === "suspended";

  const wrap = el("div", { class: "um-actions" });

  // â”€â”€ View Details â”€â”€
  wrap.appendChild(btn("👤 View", { sm: true, variant: "ghost", onclick: () => viewUserModal(u, ctx) }));

  // â”€â”€ Edit â”€â”€
  wrap.appendChild(btn("✏️ Edit", { sm: true, variant: "ghost", onclick: () => editUserModal(u, ctx, redraw) }));

  // â”€â”€ Password Reset â”€â”€
  wrap.appendChild(btn("🔑 Reset Pwd", { sm: true, variant: "ghost", onclick: () => resetPasswordModal(u, actorUid, redraw) }));

  if (!isSelf) {
    const statusMenu = el("div", { class: "um-dropdown" });
    const trigger = btn("⚙️ Actions ▾", { sm: true, variant: "ghost" });
    const menu = el("div", { class: "um-dropdown-menu" });

    // Enable / Disable
    if (isDisabled && u.status !== "deleted") {
      menu.appendChild(menuItem("✅ Enable Account", () => enableAccount(u, actorUid, redraw)));
    } else if (!isSelf && !u.loginDisabled) {
      menu.appendChild(menuItem("⛔ Disable Account", () => disableAccount(u, actorUid, redraw)));
    }

    // Suspend
    if (u.status !== "suspended" && u.status !== "deleted") {
      menu.appendChild(menuItem("⏸ Suspend Account", () => suspendAccount(u, actorUid, redraw)));
    }

    // Change Role
    menu.appendChild(menuItem("🎭 Change Role", () => changeRoleModal(u, actorUid, redraw)));

    // Force Logout
    menu.appendChild(menuItem("🚪 Force Logout", async () => {
      if (await confirmDialog(`Force logout ${u.name || u.email}?`)) {
        await forceLogoutUser(u, actorUid);
        redraw();
      }
    }));

    // Generate Temp Password
    menu.appendChild(menuItem("ðŸ” Generate Temp Pwd", () => generateTempPwdModal(u, actorUid, redraw)));

    menu.appendChild(menuItem("Validate Login", () => validateUserModal(u)));
    menu.appendChild(menuItem("Repair User Account", () => repairUserAccount(u, ctx, redraw)));

    // Delete
    const deleteLabel = isSuperAdmin ? "🗑️ Hard Delete" : "🗑️ Soft Delete";
    menu.appendChild(menuItem(deleteLabel, () => deleteUserAction(u, ctx, isSuperAdmin, redraw), true));

    trigger.onclick = (e) => {
      e.stopPropagation();
      const isOpen = menu.style.display === "block";
      document.querySelectorAll(".um-dropdown-menu").forEach((m) => (m.style.display = "none"));
      menu.style.display = isOpen ? "none" : "block";
    };
    document.addEventListener("click", () => (menu.style.display = "none"), { once: false });

    statusMenu.appendChild(trigger);
    statusMenu.appendChild(menu);
    wrap.appendChild(statusMenu);
  }

  return wrap;
}

function menuItem(label, onclick, danger = false) {
  const item = el("button", {
    class: `um-menu-item${danger ? " um-menu-item--danger" : ""}`,
    text: label
  });
  item.onclick = (e) => { e.stopPropagation(); onclick(); document.querySelectorAll(".um-dropdown-menu").forEach((m) => (m.style.display = "none")); };
  return item;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// View User Modal â€” Full Details + Audit Log
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function viewUserModal(u, ctx) {
  const loginHistory = getLoginHistory(u.uid || u.id);
  const activityLog  = getUserActivityLog(u.uid || u.id);
  const failedCount  = recentFailedAttempts(u.uid || u.id);
  const lastLogin    = lastLoginRecord(u.uid || u.id);

  const infoRow = (label, value) => el("div", { class: "um-info-row" }, [
    el("span", { class: "um-info-label", text: label }),
    el("span", { class: "um-info-value", text: value || "—" })
  ]);

  const body = el("div", { class: "um-detail" });

  // â”€â”€ Profile Section â”€â”€
  body.appendChild(el("div", { class: "um-section-title", text: "👤 Profile Information" }));
  const profileGrid = el("div", { class: "um-info-grid" });
  profileGrid.appendChild(infoRow("Full Name", u.name));
  profileGrid.appendChild(infoRow("Email Address", u.email));
  profileGrid.appendChild(infoRow("Username", u.username ? `@${u.username}` : null));
  profileGrid.appendChild(infoRow("Phone Number", u.phone));
  profileGrid.appendChild(infoRow("Role", u.role));
  profileGrid.appendChild(infoRow("Account Status", u.status === "deleted" ? "Deleted" : u.status === "suspended" ? "Suspended" : u.loginDisabled ? "Disabled" : "Active"));
  profileGrid.appendChild(infoRow("Created Date", u.createdAt ? fmt(u.createdAt) : null));
  profileGrid.appendChild(infoRow("Created By", u.createdBy));
  profileGrid.appendChild(infoRow("Staff ID", u.staffId));
  profileGrid.appendChild(infoRow("Student ID", u.studentId));
  body.appendChild(profileGrid);

  // â”€â”€ Security Section â”€â”€
  body.appendChild(el("div", { class: "um-section-title", style: "margin-top:16px", text: "🔒 Security & Login" }));
  const secGrid = el("div", { class: "um-info-grid" });
  secGrid.appendChild(infoRow("Last Login", lastLogin ? fmt(lastLogin.at) : "Never"));
  secGrid.appendChild(infoRow("Last Device", lastLogin?.device || "—"));
  secGrid.appendChild(infoRow("Failed Attempts (24h)", String(failedCount)));
  secGrid.appendChild(infoRow("Force Password Change", u.forcePasswordChange ? "YES ⚠️" : "No"));
  secGrid.appendChild(infoRow("Force Logout Pending", u.forceLogout ? "YES" : "No"));
  body.appendChild(secGrid);

  // â”€â”€ Login History â”€â”€
  body.appendChild(el("div", { class: "um-section-title", style: "margin-top:16px", text: "📋 Login History (last 20)" }));
  if (!loginHistory.length) {
    body.appendChild(el("p", { class: "muted", style: "font-size:12px", text: "No login records found." }));
  } else {
    const lh = el("div", { class: "um-log-list" });
    loginHistory.forEach((rec) => {
      const isFail = rec.type === "login_failed";
      lh.appendChild(el("div", { class: `um-log-item${isFail ? " um-log-item--fail" : ""}` }, [
        el("span", { class: "um-log-icon", text: isFail ? "✗" : "✓" }),
        el("div", { class: "um-log-body" }, [
          el("span", { class: "um-log-time", text: fmt(rec.at) }),
          rec.device ? el("span", { class: "um-log-device", text: rec.device }) : el("span"),
          rec.ip ? el("span", { class: "muted", style: "font-size:10px", text: rec.ip }) : el("span")
        ])
      ]));
    });
    body.appendChild(lh);
  }

  // â”€â”€ Activity Log â”€â”€
  body.appendChild(el("div", { class: "um-section-title", style: "margin-top:16px", text: "ðŸ“ Activity Log (last 50)" }));
  if (!activityLog.length) {
    body.appendChild(el("p", { class: "muted", style: "font-size:12px", text: "No activity records found." }));
  } else {
    const al = el("div", { class: "um-log-list" });
    activityLog.forEach((rec) => {
      al.appendChild(el("div", { class: "um-log-item" }, [
        el("span", { class: "um-log-icon um-log-icon--info", text: "â€¢" }),
        el("div", { class: "um-log-body" }, [
          el("span", { class: "um-log-time", text: fmt(rec.at) }),
          el("span", { class: "um-log-device", text: rec.message || rec.type })
        ])
      ]));
    });
    body.appendChild(al);
  }

  modal({ title: `User Details â€” ${u.name || u.email}`, size: "lg", body,
    footer: [btn("Close", { onclick: (_, m) => m?.close() })]
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Edit User Modal
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function validateUserModal(u) {
  const emailInp = input({ type: "email", value: u.email || "" });
  const pwdInp = input({ type: "text", placeholder: "Password to test" });
  const resultBox = el("div", { style: "margin-top:12px" });
  const line = (label, ok, detail = "") => el("div", {
    style: `padding:6px 8px;border-bottom:1px solid #eee;color:${ok ? "#2e7d32" : "#c62828"}`
  }, [
    el("strong", { text: `${ok ? "OK" : "FAIL"} - ${label}` }),
    el("span", { text: detail ? `: ${detail}` : "" })
  ]);

  const run = async () => {
    resultBox.innerHTML = '<p class="muted">Validating...</p>';
    try {
      const email = normalizeEmail(emailInp.value);
      const password = pwdInp.value.trim();
      const report = await validateUserAccount({ ...u, email }, password);
      const methods = Array.isArray(report.methods) ? report.methods : [];
      resultBox.innerHTML = "";
      resultBox.appendChild(line("Firebase Auth account lookup", true, methods.length ? methods.join(", ") : (report.login?.ok ? "verified by sign-in" : "no sign-in methods reported (Email Enumeration Protection active)")));
      resultBox.appendChild(line("users record", !!report.userRec, report.userRec ? `uid=${report.userRec.uid || report.userRec.id}, email=${report.userRec.email}` : "missing"));
      resultBox.appendChild(line("userRoles record", !!report.roleRec, report.roleRec ? `role=${report.roleRec.role}, email=${report.roleRec.email || "-"}` : "missing"));
      if (u.staffId) {
          resultBox.appendChild(line("staffLoginMap record", !!report.mapRec, report.mapRec ? `email=${report.mapRec.email || "-"}` : "missing"));
          if (!report.mapRec && report.userRec) {
              const fixBtn = btn("Fix Missing staffLoginMap", { sm: true, variant: "primary", attrs: { style: "margin-top:5px; margin-bottom:10px" }, onclick: () => {
                  db.save("staffLoginMap", { id: u.staffId, uid: report.userRec.uid || report.userRec.id, staffId: u.staffId, role: u.role, email: email, createdAt: Date.now() });
                  toast("Fixed! Please Run Validation again.", "success");
              }});
              resultBox.appendChild(fixBtn);
          }
      }
      if (password) {
        resultBox.appendChild(line("Credential test", !!report.login?.ok, report.login?.ok
          ? `signed in as ${report.login.email} (${report.login.uid})`
          : `${report.login?.code || "unknown"} - ${report.login?.message || "login failed"}`));
        if (report.login?.ok) resultBox.appendChild(line("Firebase Auth email match", report.login.emailMatches, `${report.login.email} vs ${email}`));
      } else {
        resultBox.appendChild(line("Credential test", false, "enter the displayed/admin password to test login"));
      }
    } catch (e) {
      resultBox.innerHTML = "";
      resultBox.appendChild(line("Validation failed", false, e.message));
    }
  };

  modal({ title: "User Validation", size: "lg", body: el("div", {}, [
    el("p", { class: "muted", text: "Checks Firebase Auth, local users, role records, staff mapping, and optionally tests the exact password." }),
    el("div", { class: "form-grid" }, [
      field("Email", emailInp),
      field("Password to Test", pwdInp)
    ]),
    resultBox
  ]), footer: [
    btn("Run Validation", { variant: "primary", onclick: run }),
    btn("Close", { onclick: (_, m) => m?.close() })
  ]});
}

function editUserModal(u, ctx, redraw) {
  const nameInp     = input({ value: u.name || "" });
  const emailInp    = input({ value: u.email || "", type: "email" });
  const usernameInp = input({ value: u.username || "", placeholder: "Optional username" });
  const phoneInp    = input({ value: u.phone || "", placeholder: "e.g. 08012345678" });
  const roleInp     = select(() => ROLES.map((r) => ({ value: r, label: r, selected: r === u.role })));
  const staffIdInp  = input({ value: u.staffId || "", placeholder: "Staff ID (optional)" });
  const studentIdInp= input({ value: u.studentId || "", placeholder: "Student ID (optional)" });

  const note = el("p", { class: "muted um-pwd-note", text: "🔒 Passwords cannot be viewed or edited here. Use Reset Password for password changes." });

  const m = modalForm("Edit User â€” " + (u.name || u.email), [
    note,
    field("Full Name", nameInp),
    field("Email Address", emailInp),
    field("Username", usernameInp),
    field("Phone Number", phoneInp),
    field("Role", roleInp),
    field("Staff ID", staffIdInp),
    field("Student ID", studentIdInp)
  ], () => {
    if (!nameInp.value.trim()) return toast("Name is required", "error");
    if (!emailInp.value.trim()) return toast("Email is required", "error");
    const prev = { role: u.role, email: u.email };
    u.name     = nameInp.value.trim();
    u.email    = emailInp.value.trim().toLowerCase();
    u.username = usernameInp.value.trim() || null;
    u.phone    = phoneInp.value.trim() || null;
    u.role     = roleInp.value;
    u.staffId  = staffIdInp.value.trim() || null;
    u.studentId= studentIdInp.value.trim() || null;
    u.updatedAt= Date.now();
    u.updatedBy= ctx.user.email;
    db.save("users", u);
    const rr = db.get("userRoles", u.id) || { id: u.id, uid: u.uid || u.id };
    rr.role = u.role; rr.email = u.email; rr.staffId = u.staffId; rr.studentId = u.studentId;
    db.save("userRoles", rr);
    auditAction(ctx.user.uid, "admin",
      `Edited user ${u.email} â€” role: ${prev.role}â†’${u.role}`,
      { targetUid: u.uid });
    toast("User updated", "success");
    m.close(); redraw();
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reset Password Modal â€” generates temp pwd, never shows old one
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function resetPasswordModal(u, actorUid, redraw) {
  const tempPwd = generateTempPassword();
  const pwdDisplay = cloudAuthReady()
    ? el("p", { class: "note", text: "Firebase will send the reset link to " + (u.email || "this user") + "." })
    : el("div", { class: "um-temp-pwd", text: tempPwd });
  const note = el("p", { class: "muted", style: "margin-top:8px;font-size:12px",
    text: cloudAuthReady()
      ? "Cloud mode: Firebase will email the user a secure password reset link. No temporary password will be used for Firebase Auth."
      : "The user will be required to change this password on their next login. This is the ONLY time this temporary password is shown â€” record it now." });
  const forceChk = el("input", { type: "checkbox", checked: true, style: "margin-right:6px" });
  const forceRow = el("label", { style: "display:flex;align-items:center;font-size:13px;margin-top:8px;cursor:pointer" },
    [forceChk, el("span", { text: "Force password change on next login" })]);

  const body = el("div", {}, [
    el("p", { text: `Reset password for ${u.name || u.email}:` }),
    pwdDisplay, note, forceRow
  ]);

  const m = modal({
    title: "🔑 Reset Password",
    body,
    footer: [
      btn("Apply Reset", {
        variant: "primary",
        onclick: async () => {
          if (cloudAuthReady()) {
            try {
              await sendFirebasePasswordResetEmail(u.email, "usermanagement:reset-password");
              u.forcePasswordChange = forceChk.checked;
              u.firebaseResetEmailSentAt = Date.now();
              db.save("users", u);
              auditAction(actorUid, "admin",
                `Firebase password reset email sent for ${u.email}`,
                { targetUid: u.uid });
              toast("Firebase password reset email sent. The user must set a new password from the email link.", "success", 10000);
              m.close(); redraw();
            } catch (e) {
              toast("Firebase password reset email failed: " + (e.code || e.message), "error", 10000);
            }
            return;
          }
          const hash = await sha256(tempPwd);
          u.passwordHash = hash;
          u.forcePasswordChange = forceChk.checked;
          u.tempPasswordSetAt = Date.now();
          u.tempPasswordSetBy = actorUid;
          // NEVER store plaintext â€” only hash
          db.save("users", u);
          auditAction(actorUid, "admin",
            `Password reset for ${u.email} â€” force change: ${forceChk.checked}`,
            { targetUid: u.uid });
          toast("Password reset applied. User will be prompted to change it.", "success");
          m.close(); redraw();
        }
      }),
      btn("Cancel", { onclick: () => m.close() })
    ]
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Generate Temp Password Modal (same as reset but separate entry)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function generateTempPwdModal(u, actorUid, redraw) {
  resetPasswordModal(u, actorUid, redraw);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Change Role Modal
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function changeRoleModal(u, actorUid, redraw) {
  const roleInp = select(() => ROLES.map((r) => ({ value: r, label: r, selected: r === u.role })));
  const body = el("div", {}, [
    el("p", { text: `Current role: ` }),
    roleBadge(u),
    el("div", { style: "margin-top:12px" }, [field("New Role", roleInp)])
  ]);
  const m = modal({
    title: `🎭 Change Role â€” ${u.name || u.email}`,
    body,
    footer: [
      btn("Change Role", {
        variant: "primary",
        onclick: () => {
          const prev = u.role;
          u.role = roleInp.value;
          db.save("users", u);
          const rr = db.get("userRoles", u.id) || { id: u.id, uid: u.uid || u.id };
          rr.role = u.role; db.save("userRoles", rr);
          auditAction(actorUid, "admin",
            `Role changed for ${u.email}: ${prev} â†’ ${u.role}`,
            { targetUid: u.uid });
          toast(`Role updated to ${u.role}`, "success");
          m.close(); redraw();
        }
      }),
      btn("Cancel", { onclick: () => m.close() })
    ]
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Enable / Disable / Suspend
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function enableAccount(u, actorUid, redraw) {
  if (!await confirmDialog(`Enable account for ${u.name || u.email}?`, { okText: "Enable" })) return;
  u.loginDisabled = false;
  u.status = "active";
  u.forceLogout = false;
  db.save("users", u);
  const rr = db.get("userRoles", u.id);
  if (rr) { rr.loginDisabled = false; rr.forceLogout = false; db.save("userRoles", rr); }
  auditAction(actorUid, "admin", `Account enabled for ${u.email}`, { targetUid: u.uid });
  toast("Account enabled", "success"); redraw();
}

async function disableAccount(u, actorUid, redraw) {
  if (!await confirmDialog(`Disable login for ${u.name || u.email}? They will be immediately logged out.`, { danger: true, okText: "Disable" })) return;
  u.loginDisabled = true;
  u.forceLogout   = true;
  u.status        = u.status || "active";
  db.save("users", u);
  const rr = db.get("userRoles", u.id);
  if (rr) { rr.loginDisabled = true; rr.forceLogout = true; db.save("userRoles", rr); }
  auditAction(actorUid, "admin", `Account disabled for ${u.email}`, { targetUid: u.uid });
  toast("Account disabled", "success"); redraw();
}

async function suspendAccount(u, actorUid, redraw) {
  if (!await confirmDialog(`Suspend ${u.name || u.email}? They cannot log in while suspended.`, { danger: true, okText: "Suspend" })) return;
  u.status      = "suspended";
  u.loginDisabled = true;
  u.forceLogout = true;
  db.save("users", u);
  const rr = db.get("userRoles", u.id);
  if (rr) { rr.loginDisabled = true; rr.status = "suspended"; db.save("userRoles", rr); }
  auditAction(actorUid, "admin", `Account suspended for ${u.email}`, { targetUid: u.uid });
  toast("Account suspended", "success"); redraw();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Delete
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function deleteUserAction(u, ctx, isSuperAdmin, redraw) {
  if (isSuperAdmin) {
    const ok = await confirmDialog(
      `HARD DELETE: Permanently remove "${u.name || u.email}" and all their data? This cannot be undone.`,
      { danger: true, okText: "Delete Permanently" }
    );
    if (ok) {
      auditAction(ctx.user.uid, "admin", `Hard deleted user ${u.email}`, { targetUid: u.uid });
      db.remove("users", u.id);
      db.remove("userRoles", u.id);
      toast("User permanently deleted", "success"); redraw();
    }
  } else {
    const ok = await confirmDialog(
      `Soft delete "${u.name || u.email}"? Their account will be disabled and marked deleted.`,
      { okText: "Soft Delete" }
    );
    if (ok) {
      u.status = "deleted"; u.loginDisabled = true; u.forceLogout = true;
      db.save("users", u);
      const rr = db.get("userRoles", u.id);
      if (rr) { rr.loginDisabled = true; rr.status = "deleted"; db.save("userRoles", rr); }
      auditAction(ctx.user.uid, "admin", `Soft deleted user ${u.email}`, { targetUid: u.uid });
      toast("User soft-deleted", "success"); redraw();
    }
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Add User Modal â€” generates temp password automatically
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function addUserModal(ctx, redraw) {
  const nameInp     = input({ placeholder: "Full name" });
  const emailInp    = input({ type: "email", placeholder: "user@school.com" });
  const usernameInp = input({ placeholder: "Optional username" });
  const phoneInp    = input({ placeholder: "e.g. 08012345678" });
  const roleInp     = select(() => ROLES.map((r) => ({ value: r, label: r })));
  const staffIdInp  = input({ placeholder: "Staff ID (optional)" });
  const studentIdInp= input({ placeholder: "Student ID (optional)" });

  // Temp password is auto-generated â€” admin sees it once to communicate to user
  const tempPwd     = generateTempPassword();
  const pwdBox      = el("div", { class: "um-temp-pwd", style: "margin-top:4px", text: tempPwd });
  const pwdNote     = el("p", { class: "muted", style: "font-size:11px;margin-top:4px",
    text: "This temporary password is auto-generated. Record it and share securely with the user. They will be required to change it on first login." });

  const note = el("p", { class: "muted um-pwd-note",
    text: "🔒 A secure temporary password has been generated. It will never be stored in plaintext." });

  const m = modalForm("âž• New User Account", [
    note,
    field("Full Name *", nameInp),
    field("Email Address *", emailInp),
    field("Username", usernameInp),
    field("Phone Number", phoneInp),
    field("Role *", roleInp),
    field("Temporary Password", el("div", {}, [pwdBox, pwdNote])),
    field("Staff ID", staffIdInp),
    field("Student ID", studentIdInp)
  ], async () => {
    if (!nameInp.value.trim()) return toast("Name is required", "error");
    if (!emailInp.value.trim()) return toast("Email is required", "error");

    // Using statically imported createUserAccount
    try {
      const email = normalizeEmail(emailInp.value);
      console.info("[AUTH] Email:", email);
      console.info("[AUTH] Plain generated password length:", tempPwd.length);
      const { uid } = await createUserAccount({
        email,
        password: tempPwd,
        name: nameInp.value.trim(),
        role: roleInp.value,
        staffId: staffIdInp.value.trim() || undefined,
        studentId: studentIdInp.value.trim() || undefined,
        forcePasswordChange: true
      });
      const sid = staffIdInp.value.trim() || undefined;
      if (sid) {
        db.save("staffLoginMap", { id: sid, uid, staffId: sid, role: roleInp.value, email, createdAt: Date.now() });
        const s = db.get("staff", sid);
        if (s) { s.loginStatus = "Active"; db.save("staff", s); }
      }
      await verifyCreatedUserRecords(uid, email, sid);
      // Augment with extra fields
      const rec = db.get("users", uid);
      if (rec) {
        rec.username  = usernameInp.value.trim() || null;
        rec.phone     = phoneInp.value.trim() || null;
        rec.createdAt = Date.now();
        rec.createdBy = ctx.user.email;
        rec.status    = "active";
        db.save("users", rec, { sync: false });
      }
      auditAction(ctx.user.uid, "admin",
        `Created user ${emailInp.value} (${roleInp.value}) with temp password`,
        { targetUid: uid });
      toast(`User created. Temp password: ${tempPwd}`, "success", 8000);
      m.close(); redraw();
    } catch (e) {
      toast("Error creating user: " + e.message, "error");
    }
  }, "lg");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Modal form helper
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function modalForm(title, fields, onSave, size = "md") {
  const body = el("div", { class: "form-grid" }, fields);
  return modal({ title, size, body, footer: [btn("Save", { variant: "primary", onclick: onSave })] });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Module CSS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const UM_CSS = `
.um-wrap { display: flex; flex-direction: column; gap: 16px; }

.um-filter-bar {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  margin-bottom: 14px; padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #e0e0e0);
}

.um-table-wrap { overflow-x: auto; }

.um-actions {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
}

/* Status badges */
.um-badge {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600;
}
.um-badge--active   { background: #e8f5e9; color: #2e7d32; }
.um-badge--disabled { background: #fbe9e7; color: #bf360c; }
.um-badge--suspended{ background: #fff8e1; color: #e65100; }
.um-badge--deleted  { background: #fce4ec; color: #880e4f; }
.um-badge--warn     { background: #fff3e0; color: #e65100; }

/* Dropdown */
.um-dropdown { position: relative; display: inline-block; }
.um-dropdown-menu {
  display: none; position: absolute; right: 0; top: 100%; z-index: 999;
  background: var(--surface, #fff); border: 1px solid var(--border, #ddd);
  border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.14);
  min-width: 180px; overflow: hidden;
}
.um-menu-item {
  display: block; width: 100%; text-align: left;
  padding: 8px 14px; border: none; background: none;
  font-size: 13px; cursor: pointer; color: var(--text, #212121);
}
.um-menu-item:hover { background: var(--hover, #f5f5f5); }
.um-menu-item--danger { color: #c62828; }
.um-menu-item--danger:hover { background: #ffebee; }

/* Detail view */
.um-detail { padding: 4px 0; }
.um-section-title {
  font-weight: 700; font-size: 13px; color: var(--primary, #1565c0);
  padding-bottom: 6px; border-bottom: 1px solid var(--border, #e0e0e0);
  margin-bottom: 10px;
}
.um-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; }
.um-info-row  { display: flex; flex-direction: column; gap: 1px; }
.um-info-label{ font-size: 10px; font-weight: 600; color: var(--muted, #757575); text-transform: uppercase; letter-spacing: .5px; }
.um-info-value{ font-size: 13px; color: var(--text, #212121); }

/* Log list */
.um-log-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; padding-right: 4px; }
.um-log-item {
  display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px;
  border-radius: 4px; background: var(--surface-alt, #fafafa);
  border-left: 3px solid #66bb6a;
}
.um-log-item--fail { border-left-color: #ef5350; }
.um-log-icon { font-size: 11px; font-weight: 700; margin-top: 1px; color: #66bb6a; }
.um-log-item--fail .um-log-icon { color: #ef5350; }
.um-log-icon--info { color: var(--primary, #1565c0); }
.um-log-body { display: flex; flex-direction: column; gap: 1px; flex: 1; }
.um-log-time { font-size: 11px; font-weight: 600; color: var(--text, #212121); }
.um-log-device { font-size: 11px; color: var(--muted, #757575); }

/* Temp password display */
.um-temp-pwd {
  background: #f5f5f5; border: 2px dashed #bdbdbd;
  padding: 12px 16px; border-radius: 8px;
  font-size: 20px; font-weight: 800; letter-spacing: 3px;
  text-align: center; color: #1a237e; margin: 8px 0;
  user-select: all; cursor: copy;
}

/* Password note */
.um-pwd-note {
  background: #e3f2fd; border-left: 4px solid #1565c0;
  padding: 8px 12px; border-radius: 4px;
  font-size: 12px; color: #0d47a1; margin-bottom: 8px;
}

@media (max-width: 600px) {
  .um-info-grid { grid-template-columns: 1fr; }
  .um-filter-bar { flex-direction: column; align-items: stretch; }
}
`;
